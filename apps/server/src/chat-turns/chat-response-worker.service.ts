import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  Prisma,
  type BackgroundJob,
  type ChatMessage,
  type ChatTurn,
  type ChatTurnErrorCode,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import type { RouterResult } from '@repo/types/api/agent';
import {
  verifyKnowledgeChunks,
  type KnowledgeVerifierResult,
} from '@repo/agent/knowledge-verifier';

import {
  CHAT_RESPONSE_COMPLETED_EVENT,
  CHAT_RESPONSE_FAILED_EVENT,
  CHAT_RESPONSE_JOB,
  CHAT_RESPONSE_QUEUE,
  CHAT_RESPONSE_RESOURCE_TYPE,
  chatResponseCompletedIdempotencyKey,
  chatResponseFailedIdempotencyKey,
} from './chat-turn.constants';
import {
  chatResponseCompletedEventPayloadSchema,
  chatResponseFailedEventPayloadSchema,
  chatResponseJobPayloadSchema,
  type ChatResponseJobPayload,
} from './chat-response.job';
import { resolveChatResponseGenerationTimeout } from './chat-response-worker.config';
import { PrismaService } from '../database/prisma.service';
import { ChatRunBudgetRepository } from '../chat-run-budget/chat-run-budget.repository';
import { ChatStreamStore } from './chat-stream.store';
import {
  ChatRunBudgetStageRunner,
  ChatRunBudgetUnavailableError,
} from './chat-run-budget-stage-runner';
import {
  AgentBudgetAdmissionError,
  AgentBudgetDispatchError,
} from '@repo/agent/chat-run-budget';
import { ChatRouterStageService } from './chat-router-stage';
import { ChatRetrieverStageService } from './chat-retriever-stage';
import { ChatVerifierStageService } from './chat-verifier-stage';

export const CHAT_RESPONSE_GENERATOR = Symbol('CHAT_RESPONSE_GENERATOR');

export type ChatResponseInputMessage = Readonly<{
  id: string;
  role: ChatMessage['role'];
  content: string;
  order: number;
}>;

export type ChatResponseGeneratorInput = Readonly<{
  userId: string;
  turnId: string;
  conversationId: string;
  messages: readonly ChatResponseInputMessage[];
  budgetPolicyVersion: string;
  signal: AbortSignal;
  route?: RouterResult;
  verifierResult?: KnowledgeVerifierResult;
}>;

export type ChatResponseGeneratorResult = Readonly<{
  content: string;
  generator: string;
}>;

export interface ChatResponseGenerator {
  generate(
    input: ChatResponseGeneratorInput,
  ): Promise<ChatResponseGeneratorResult>;
}

/**
 * Safe baseline used until the independent live-model gate is enabled. It is
 * intentionally explicit in persisted metadata so a mock result cannot be
 * mistaken for a provider-backed answer.
 */
@Injectable()
export class DeterministicChatResponseGenerator implements ChatResponseGenerator {
  async generate(
    input: ChatResponseGeneratorInput,
  ): Promise<ChatResponseGeneratorResult> {
    await Promise.resolve();
    if (input.signal.aborted) {
      throw new ChatResponseWorkerError(
        'GENERATION_ABORTED',
        true,
        'Chat response generation was aborted',
      );
    }

    const questionCount = input.messages.filter(
      (message) => message.role === 'USER',
    ).length;
    return {
      content: `后台回答任务已完成（第 ${Math.max(1, questionCount)} 个问题）。`,
      generator: 'deterministic-worker-v1',
    };
  }
}

type ActiveClaim = Readonly<{
  turn: ChatTurn;
  backgroundJob: BackgroundJob;
}>;

type ClaimResult =
  | {
      kind: 'active';
      claim: ActiveClaim;
    }
  | {
      kind: 'terminal';
      turn: ChatTurn;
      backgroundJob: BackgroundJob;
    };

type FailureDecision =
  | 'retry'
  | 'complete'
  | Extract<ClaimResult, { kind: 'terminal' }>;

const CHAT_RESPONSE_WORKER_VERSION = 'chat-response-worker-v1';
const MAX_SERIALIZABLE_ATTEMPTS = 3;
const INPUT_CONTENT_MAX_LENGTH = 100_000;

@Injectable()
export class ChatResponseWorkerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHAT_RESPONSE_GENERATOR)
    private readonly generator: ChatResponseGenerator,
    @Optional() private readonly streams?: ChatStreamStore,
    @Optional() private readonly budgets?: ChatRunBudgetRepository,
    @Optional() private readonly budgetRunner?: ChatRunBudgetStageRunner,
    @Optional() private readonly routerStage?: ChatRouterStageService,
    @Optional() private readonly retrieverStage?: ChatRetrieverStageService,
    @Optional() private readonly verifierStage?: ChatVerifierStageService,
  ) {}

  async process(job: Job<unknown>): Promise<void> {
    let payload: ChatResponseJobPayload;
    try {
      payload = parsePayload(job.data);
    } catch (error) {
      job.discard();
      throw error;
    }
    const bullJobId = String(job.id);
    const claim = await this.claim(payload, bullJobId, attemptNumber(job));
    if (claim.kind === 'terminal') {
      await this.budgets?.reconcileTerminal(claim.turn.userId, claim.turn.id);
      await this.publishDurableTerminal(claim.turn, claim.backgroundJob);
      return;
    }

    await this.publishStarted(claim.claim.turn);
    let generatedTextObserved = false;
    let terminalCommitted = false;
    try {
      const messages = await this.loadInputMessages(claim.claim.turn);
      let generated: ChatResponseGeneratorResult;
      if (this.budgetRunner) {
        generated = await this.runBudgetedGeneration(
          claim.claim.turn,
          messages,
          attemptNumber(job),
        );
      } else {
        if (this.budgets) throw new ChatRunBudgetUnavailableError();
        generated = await this.generate(claim.claim.turn, messages);
      }
      validateGeneratedResult(generated);
      generatedTextObserved = generated.content.length > 0;
      await this.publishTextDelta(claim.claim.turn, generated.content);
      await this.commitSuccess(payload, claim.claim, generated, bullJobId);
      terminalCommitted = true;
      await this.budgets?.reconcileTerminal(
        claim.claim.turn.userId,
        claim.claim.turn.id,
      );
      await this.publishCompleted(
        claim.claim.turn,
        generated,
        chatResponseMessageId(claim.claim.turn.id),
      );
    } catch (error) {
      // Publication/reconciliation retries and losing deliveries must not rewrite job facts.
      if (terminalCommitted || error instanceof AgentBudgetDispatchError) {
        throw error;
      }
      const decision = await this.handleFailure(
        payload,
        claim.claim,
        error,
        attemptNumber(job),
        bullJobId,
      );
      if (decision === 'retry') throw error;
      if (decision !== 'complete') {
        await this.budgets?.reconcileTerminal(
          decision.turn.userId,
          decision.turn.id,
        );
        await this.publishDurableTerminal(
          decision.turn,
          decision.backgroundJob,
        );
        job.discard();
        return;
      }
      await this.budgets?.reconcileTerminal(
        claim.claim.turn.userId,
        claim.claim.turn.id,
      );
      await this.publishFailed(
        claim.claim.turn,
        classifyFailure(error).code,
        classifyFailure(error).code === 'GENERATION_ABORTED'
          ? 'aborted'
          : generatedTextObserved
            ? 'after_first_token'
            : 'before_first_token',
      );
      job.discard();
    }
  }

  private async runBudgetedGeneration(
    turn: ChatTurn,
    messages: readonly ChatResponseInputMessage[],
    attempt: number,
  ): Promise<ChatResponseGeneratorResult> {
    const scope = await this.budgetRunner!.forTurn(
      turn.userId,
      turn.id,
      turn.budgetPolicyVersion,
      attempt,
    );
    return scope.run(
      'WORKER',
      {
        // WORKER is a durable execution lease. Child model stages reserve
        // their own bounded budgets; reserving the whole ledger here would
        // starve Router/Verifier and make the enabled path fail closed.
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
      },
      async () => {
        const router = await this.routerStage?.run({
          ownerId: turn.userId,
          turnId: turn.id,
          policyVersion: turn.budgetPolicyVersion,
          attempt,
          text:
            messages.filter((message) => message.role === 'USER').at(-1)
              ?.content ?? '',
        });
        let verifierResult: KnowledgeVerifierResult | undefined;
        if (
          router &&
          shouldRetrieveForRoute(router.route) &&
          this.retrieverStage
        ) {
          const retrieved = await this.retrieverStage.run({
            ownerId: turn.userId,
            query:
              messages.filter((message) => message.role === 'USER').at(-1)
                ?.content ?? '',
          });
          const query =
            messages.filter((message) => message.role === 'USER').at(-1)
              ?.content ?? '';
          verifierResult = this.verifierStage
            ? (
                await this.verifierStage.run({
                  ownerId: turn.userId,
                  turnId: turn.id,
                  policyVersion: turn.budgetPolicyVersion,
                  attempt,
                  query,
                  chunks: [...retrieved.chunks],
                })
              ).result
            : verifyKnowledgeChunks({ query, chunks: [...retrieved.chunks] });
        }
        const value = await this.generate(
          turn,
          messages,
          router?.route,
          verifierResult,
        );
        validateGeneratedResult(value);
        return {
          value,
          usage: {
            inputTokens: Math.min(
              10_000,
              estimateTokens(
                messages.map((message) => message.content).join('\n'),
              ),
            ),
            outputTokens: Math.min(2_800, estimateTokens(value.content)),
            costMicros: 0,
          },
        };
      },
    );
  }

  private async publishStarted(turn: ChatTurn) {
    await this.appendStreamEvent(turn, {
      eventId: eventIdFor(turn.id, 'response_started'),
      type: 'response_started',
      mode: 'mock',
      generator: 'deterministic-worker-v1',
    });
  }

  private async publishTextDelta(turn: ChatTurn, content: string) {
    const codePoints = Array.from(content);
    for (let offset = 0, index = 0; offset < codePoints.length; ) {
      const text = codePoints.slice(offset, offset + 4_000).join('');
      offset += 4_000;
      await this.appendStreamEvent(turn, {
        eventId: eventIdFor(
          turn.id,
          `text_delta:${index}:${contentHash(text)}`,
        ),
        type: 'text_delta',
        text,
      });
      index += 1;
    }
  }

  private async publishCompleted(
    turn: ChatTurn,
    generated: ChatResponseGeneratorResult,
    responseMessageId: string,
  ) {
    await this.appendStreamEvent(turn, {
      eventId: eventIdFor(turn.id, 'response_completed'),
      type: 'response_completed',
      responseMessageId,
      finishReason: 'stop',
      generator: generated.generator,
    });
  }

  private async publishFailed(
    turn: ChatTurn,
    errorCode: ChatTurnErrorCode,
    phase: 'before_first_token' | 'after_first_token' | 'aborted',
  ) {
    await this.appendStreamEvent(turn, {
      eventId: eventIdFor(turn.id, 'response_failed'),
      type: 'response_failed',
      errorCode,
      phase,
    });
  }

  private async publishDurableTerminal(
    turn: ChatTurn,
    backgroundJob: BackgroundJob,
  ) {
    await this.publishStarted(turn);
    if (turn.status === 'SUCCEEDED' && turn.responseMessageId) {
      await this.publishCompleted(
        turn,
        {
          content: '',
          generator: durableGenerator(backgroundJob.resultSummary),
        },
        turn.responseMessageId,
      );
      return;
    }
    await this.publishFailed(
      turn,
      turn.errorCode ?? 'INTERNAL_FAILURE',
      turn.errorCode === 'GENERATION_ABORTED'
        ? 'aborted'
        : 'before_first_token',
    );
  }

  private async appendStreamEvent(
    turn: ChatTurn,
    event: Parameters<ChatStreamStore['append']>[2],
  ) {
    if (!this.streams) return;
    try {
      await this.streams.append(turn.userId, turn.id, event);
    } catch {
      // Redis is a bounded replay transport; it must never turn a durable
      // PostgreSQL success/failure transition into a worker retry.
    }
  }

  private async claim(
    payload: ChatResponseJobPayload,
    bullJobId: string,
    attempt: number,
  ): Promise<ClaimResult> {
    return this.runSerializable(async (transaction) => {
      const turn = await transaction.chatTurn.findUnique({
        where: { id: payload.turnId },
      });
      const backgroundJob = await transaction.backgroundJob.findUnique({
        where: { id: payload.backgroundJobId },
      });
      const linked = assertLinkedFacts(turn, backgroundJob, payload, bullJobId);
      const linkedTurn = linked.turn;
      const linkedBackgroundJob = linked.backgroundJob;

      if (isTerminalTurn(linkedTurn.status)) {
        await reconcileTerminalBackgroundJob(
          transaction,
          linkedTurn,
          linkedBackgroundJob,
        );
        return {
          kind: 'terminal',
          turn: linkedTurn,
          backgroundJob: linkedBackgroundJob,
        } as const;
      }

      if (isTerminalJob(linkedBackgroundJob.status)) {
        throw stateMismatch(
          'Background job is terminal while ChatTurn is active',
        );
      }
      if (attempt < 1 || attempt > linkedBackgroundJob.maxAttempts) {
        throw new ChatResponseWorkerError(
          'INTERNAL_FAILURE',
          false,
          'Chat response attempt is outside the configured limit',
        );
      }

      const now = await readDatabaseClock(transaction);
      let claimedTurn = linkedTurn;
      if (linkedTurn.status === 'QUEUED') {
        const updated = await transaction.chatTurn.updateMany({
          where: {
            id: linkedTurn.id,
            userId: linkedTurn.userId,
            status: 'QUEUED',
            startedAt: null,
            finishedAt: null,
            responseMessageId: null,
            errorCode: null,
          },
          data: { status: 'ACTIVE', startedAt: now },
        });
        if (updated.count !== 1) {
          const winner = await transaction.chatTurn.findUnique({
            where: { id: linkedTurn.id },
          });
          if (!winner || winner.status !== 'ACTIVE') {
            throw stateMismatch('ChatTurn claim was lost');
          }
          claimedTurn = winner;
        } else {
          const refreshed = await transaction.chatTurn.findUnique({
            where: { id: linkedTurn.id },
          });
          if (!refreshed)
            throw stateMismatch('ChatTurn disappeared after claim');
          claimedTurn = refreshed;
        }
      }

      if (claimedTurn.status !== 'ACTIVE') {
        throw stateMismatch('ChatTurn is not active for generation');
      }

      if (linkedBackgroundJob.status === 'QUEUED') {
        const updated = await transaction.backgroundJob.updateMany({
          where: {
            id: linkedBackgroundJob.id,
            userId: claimedTurn.userId,
            scope: 'ACCOUNT',
            resourceType: CHAT_RESPONSE_RESOURCE_TYPE,
            resourceId: claimedTurn.id,
            status: 'QUEUED',
            OR: [{ bullJobId: null }, { bullJobId: bullJobId }],
          },
          data: {
            status: 'ACTIVE',
            attempt,
            startedAt: linkedBackgroundJob.startedAt ?? now,
            progress: 0,
            bullJobId,
          },
        });
        if (updated.count !== 1) {
          const winner = await transaction.backgroundJob.findUnique({
            where: { id: linkedBackgroundJob.id },
          });
          if (
            !winner ||
            winner.status !== 'ACTIVE' ||
            winner.bullJobId !== bullJobId
          ) {
            throw stateMismatch('Background job claim was lost');
          }
          return {
            kind: 'active',
            claim: { turn: claimedTurn, backgroundJob: winner },
          } as const;
        }
      } else if (linkedBackgroundJob.status === 'ACTIVE') {
        if (linkedBackgroundJob.bullJobId === null) {
          const bound = await transaction.backgroundJob.updateMany({
            where: {
              id: linkedBackgroundJob.id,
              userId: claimedTurn.userId,
              scope: 'ACCOUNT',
              resourceType: CHAT_RESPONSE_RESOURCE_TYPE,
              resourceId: claimedTurn.id,
              status: 'ACTIVE',
              bullJobId: null,
            },
            data: { bullJobId },
          });
          if (bound.count !== 1) {
            const current = await transaction.backgroundJob.findUnique({
              where: { id: linkedBackgroundJob.id },
            });
            if (!current || current.bullJobId !== bullJobId) {
              throw stateMismatch(
                'Background job is owned by another Bull job',
              );
            }
          }
        } else if (linkedBackgroundJob.bullJobId !== bullJobId) {
          throw stateMismatch('Background job is owned by another Bull job');
        }
      }

      const refreshedJob = await transaction.backgroundJob.findUnique({
        where: { id: linkedBackgroundJob.id },
      });
      if (!refreshedJob || refreshedJob.status !== 'ACTIVE') {
        throw stateMismatch('Background job is not active after claim');
      }
      return {
        kind: 'active',
        claim: { turn: claimedTurn, backgroundJob: refreshedJob },
      } as const;
    });
  }

  private async loadInputMessages(turn: ChatTurn) {
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        id: { in: turn.inputMessageIds },
        userId: turn.userId,
        conversationId: turn.conversationId,
      },
      orderBy: { order: 'asc' },
    });
    if (messages.length !== turn.inputMessageIds.length) {
      throw new ChatResponseWorkerError(
        'INTERNAL_FAILURE',
        false,
        'Chat turn input messages are missing or not owned by the turn',
      );
    }
    return messages.map((message) => {
      if (message.content.length > INPUT_CONTENT_MAX_LENGTH) {
        throw new ChatResponseWorkerError(
          'OUTPUT_INVALID',
          false,
          'Chat turn input message is too large',
        );
      }
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        order: message.order,
      } satisfies ChatResponseInputMessage;
    });
  }

  private async generate(
    turn: ChatTurn,
    messages: readonly ChatResponseInputMessage[],
    route?: RouterResult,
    verifierResult?: KnowledgeVerifierResult,
  ) {
    const controller = new AbortController();
    const timeoutMs = readGenerationTimeoutMs();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const generation = this.generator.generate({
      userId: turn.userId,
      turnId: turn.id,
      conversationId: turn.conversationId,
      messages,
      budgetPolicyVersion: turn.budgetPolicyVersion,
      signal: controller.signal,
      ...(route ? { route } : {}),
      ...(verifierResult ? { verifierResult } : {}),
    });
    try {
      return await new Promise<ChatResponseGeneratorResult>(
        (resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(
              new ChatResponseWorkerError(
                'GENERATION_TIMEOUT',
                true,
                'Chat response generation timed out',
              ),
            );
          }, timeoutMs);
          generation.then(resolve, reject);
        },
      );
    } catch (error) {
      if (error instanceof ChatResponseWorkerError) throw error;
      if (controller.signal.aborted) {
        throw new ChatResponseWorkerError(
          'GENERATION_ABORTED',
          true,
          'Chat response generation was aborted',
        );
      }
      throw new ChatResponseWorkerError(
        'PROVIDER_FAILURE',
        true,
        'Chat response generator failed',
        error,
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      // A generator that ignores AbortSignal must not become an unhandled
      // rejection after the worker has already timed out.
      void generation.catch(() => undefined);
    }
  }

  private async commitSuccess(
    payload: ChatResponseJobPayload,
    claim: ActiveClaim,
    generated: ChatResponseGeneratorResult,
    bullJobId: string,
  ) {
    return this.runSerializable(async (transaction) => {
      const turnRecord = await transaction.chatTurn.findUnique({
        where: { id: payload.turnId },
      });
      const backgroundJobRecord = await transaction.backgroundJob.findUnique({
        where: { id: payload.backgroundJobId },
      });
      const linked = assertLinkedFacts(
        turnRecord,
        backgroundJobRecord,
        payload,
        bullJobId,
      );
      const turn = linked.turn;
      const backgroundJob = linked.backgroundJob;

      if (isTerminalTurn(turn.status)) {
        await reconcileTerminalBackgroundJob(transaction, turn, backgroundJob);
        return;
      }
      if (turn.status !== 'ACTIVE') {
        throw stateMismatch(
          'ChatTurn cannot be completed from its current state',
        );
      }

      const responseMessageId = chatResponseMessageId(turn.id);
      const latest = await transaction.chatMessage.findFirst({
        where: { userId: turn.userId, conversationId: turn.conversationId },
        orderBy: { order: 'desc' },
      });
      const existingMessage = await transaction.chatMessage.findUnique({
        where: {
          id_userId: { id: responseMessageId, userId: turn.userId },
        },
      });
      const responseMessage = existingMessage
        ? validateResponseMessage(existingMessage, turn, generated.content)
        : await transaction.chatMessage.create({
            data: {
              id: responseMessageId,
              userId: turn.userId,
              conversationId: turn.conversationId,
              role: 'ASSISTANT',
              content: generated.content,
              order: (latest?.order ?? -1) + 1,
              metadata: {
                chatTurnId: turn.id,
                generator: generated.generator,
                workerVersion: CHAT_RESPONSE_WORKER_VERSION,
              },
            },
          });

      const now = await readDatabaseClock(transaction);
      const turnUpdated = await transaction.chatTurn.updateMany({
        where: {
          id: turn.id,
          userId: turn.userId,
          status: 'ACTIVE',
          responseMessageId: null,
          errorCode: null,
          startedAt: { not: null },
          finishedAt: null,
        },
        data: {
          status: 'SUCCEEDED',
          responseMessageId: responseMessage.id,
          finishedAt: now,
        },
      });
      if (turnUpdated.count !== 1) {
        const winner = await transaction.chatTurn.findUnique({
          where: { id: turn.id },
        });
        if (
          !winner ||
          winner.status !== 'SUCCEEDED' ||
          winner.responseMessageId !== responseMessage.id
        ) {
          throw stateMismatch('ChatTurn completion CAS was lost');
        }
      }

      const jobUpdated = await transaction.backgroundJob.updateMany({
        where: {
          id: backgroundJob.id,
          userId: turn.userId,
          scope: 'ACCOUNT',
          bullJobId,
          status: { in: ['QUEUED', 'ACTIVE'] },
        },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          resultSummary: {
            turnId: turn.id,
            responseMessageId: responseMessage.id,
            responseHash: contentHash(generated.content),
            generator: generated.generator,
          },
          errorCode: null,
          errorMessage: null,
          finishedAt: now,
        },
      });
      if (jobUpdated.count !== 1) {
        const winner = await transaction.backgroundJob.findUnique({
          where: { id: backgroundJob.id },
        });
        if (
          !winner ||
          winner.status !== 'SUCCEEDED' ||
          !resultSummaryMatchesResponse(
            winner.resultSummary,
            responseMessage.id,
          )
        ) {
          throw stateMismatch('BackgroundJob completion CAS was lost');
        }
      }

      const eventPayload = {
        turnId: turn.id,
        backgroundJobId: backgroundJob.id,
        responseMessageId: responseMessage.id,
        inputHash: turn.inputHash,
        budgetPolicyVersion: turn.budgetPolicyVersion,
      };
      const parsedPayload =
        chatResponseCompletedEventPayloadSchema.parse(eventPayload);
      await transaction.outboxEvent.upsert({
        where: {
          idempotencyKey: chatResponseCompletedIdempotencyKey(turn.id),
        },
        create: {
          type: CHAT_RESPONSE_COMPLETED_EVENT,
          status: 'PENDING',
          aggregateType: 'ChatTurn',
          aggregateId: turn.id,
          idempotencyKey: chatResponseCompletedIdempotencyKey(turn.id),
          payload: parsedPayload,
          payloadHash: contentHash(JSON.stringify(parsedPayload)),
          maxAttempts: 5,
        },
        update: {},
      });
    });
  }

  private async handleFailure(
    payload: ChatResponseJobPayload,
    claim: ActiveClaim,
    error: unknown,
    attempt: number,
    bullJobId: string,
  ): Promise<FailureDecision> {
    const classified = classifyFailure(error);
    const hasRemainingAttempt = attempt < claim.backgroundJob.maxAttempts;
    if (classified.retryable && hasRemainingAttempt) {
      await this.runSerializable(async (transaction) => {
        const updated = await transaction.backgroundJob.updateMany({
          where: {
            id: claim.backgroundJob.id,
            userId: claim.turn.userId,
            scope: 'ACCOUNT',
            bullJobId,
            status: 'ACTIVE',
          },
          data: {
            status: 'QUEUED',
            attempt,
            errorCode: classified.code,
            errorMessage: safeErrorMessage(error),
            finishedAt: null,
          },
        });
        if (updated.count !== 1) {
          const current = await transaction.backgroundJob.findUnique({
            where: { id: claim.backgroundJob.id },
          });
          if (
            !current ||
            current.status !== 'QUEUED' ||
            current.bullJobId !== bullJobId ||
            current.attempt !== attempt
          ) {
            throw stateMismatch('BackgroundJob retry CAS was lost');
          }
        }
      });
      return 'retry';
    }

    const terminal = await this.runSerializable(async (transaction) => {
      const turnRecord = await transaction.chatTurn.findUnique({
        where: { id: payload.turnId },
      });
      const backgroundJobRecord = await transaction.backgroundJob.findUnique({
        where: { id: payload.backgroundJobId },
      });
      const linked = assertLinkedFacts(
        turnRecord,
        backgroundJobRecord,
        payload,
        bullJobId,
      );
      const turn = linked.turn;
      const backgroundJob = linked.backgroundJob;
      if (isTerminalTurn(turn.status)) {
        await reconcileTerminalBackgroundJob(transaction, turn, backgroundJob);
        return { kind: 'terminal', turn, backgroundJob } as const;
      }

      const now = await readDatabaseClock(transaction);
      const turnUpdated = await transaction.chatTurn.updateMany({
        where: {
          id: turn.id,
          userId: turn.userId,
          status: { in: ['QUEUED', 'ACTIVE'] },
          responseMessageId: null,
          ...(turn.status === 'QUEUED'
            ? { startedAt: null, finishedAt: null }
            : { startedAt: { not: null }, finishedAt: null }),
        },
        data: {
          status: 'FAILED',
          errorCode: classified.code,
          finishedAt: now,
          ...(turn.status === 'QUEUED' ? { startedAt: now } : {}),
        },
      });
      if (turnUpdated.count !== 1) {
        const winner = await transaction.chatTurn.findUnique({
          where: { id: turn.id },
        });
        if (isTerminalTurn(winner?.status ?? 'QUEUED')) {
          const currentJob = await transaction.backgroundJob.findUnique({
            where: { id: backgroundJob.id },
          });
          if (!winner || !currentJob) {
            throw stateMismatch('ChatTurn failure CAS lost its paired facts');
          }
          await reconcileTerminalBackgroundJob(transaction, winner, currentJob);
          return {
            kind: 'terminal',
            turn: winner,
            backgroundJob: currentJob,
          } as const;
        }
        if (
          !winner ||
          winner.status !== 'FAILED' ||
          winner.errorCode !== classified.code
        ) {
          throw stateMismatch('ChatTurn failure CAS was lost');
        }
      }

      const jobUpdated = await transaction.backgroundJob.updateMany({
        where: {
          id: backgroundJob.id,
          userId: turn.userId,
          scope: 'ACCOUNT',
          bullJobId,
          status: { in: ['QUEUED', 'ACTIVE'] },
        },
        data: {
          status: 'FAILED',
          errorCode: classified.code,
          errorMessage: safeErrorMessage(error),
          finishedAt: now,
        },
      });
      if (jobUpdated.count !== 1) {
        const winner = await transaction.backgroundJob.findUnique({
          where: { id: backgroundJob.id },
        });
        if (
          !winner ||
          winner.status !== 'FAILED' ||
          winner.errorCode !== classified.code
        ) {
          throw stateMismatch('BackgroundJob failure CAS was lost');
        }
      }

      const eventPayload = {
        turnId: turn.id,
        backgroundJobId: backgroundJob.id,
        inputHash: turn.inputHash,
        budgetPolicyVersion: turn.budgetPolicyVersion,
        errorCode: classified.code,
      };
      const parsedPayload =
        chatResponseFailedEventPayloadSchema.parse(eventPayload);
      await transaction.outboxEvent.upsert({
        where: { idempotencyKey: chatResponseFailedIdempotencyKey(turn.id) },
        create: {
          type: CHAT_RESPONSE_FAILED_EVENT,
          status: 'PENDING',
          aggregateType: 'ChatTurn',
          aggregateId: turn.id,
          idempotencyKey: chatResponseFailedIdempotencyKey(turn.id),
          payload: parsedPayload,
          payloadHash: contentHash(JSON.stringify(parsedPayload)),
          maxAttempts: 5,
        },
        update: {},
      });
    });
    return terminal ?? 'complete';
  }

  private async runSerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        lastError = error;
        if (
          attempt === MAX_SERIALIZABLE_ATTEMPTS ||
          !isSerializationConflict(error)
        ) {
          throw error;
        }
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error('Chat response transaction retry exhausted');
  }
}

export function shouldRetrieveForRoute(route: RouterResult): boolean {
  return route.name === 'rag_answer' && route.requiresRag;
}

export class ChatResponseWorkerError extends Error {
  constructor(
    readonly code: ChatTurnErrorCode,
    readonly retryable: boolean,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ChatResponseWorkerError';
  }
}

function parsePayload(value: unknown): ChatResponseJobPayload {
  const parsed = chatResponseJobPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new ChatResponseWorkerError(
      'INTERNAL_FAILURE',
      false,
      'Chat response Bull payload is invalid',
    );
  }
  return parsed.data;
}

function assertLinkedFacts(
  turn: ChatTurn | null,
  backgroundJob: BackgroundJob | null,
  payload: ChatResponseJobPayload,
  bullJobId: string,
): { turn: ChatTurn; backgroundJob: BackgroundJob } {
  if (!turn || !backgroundJob) {
    throw new ChatResponseWorkerError(
      'INTERNAL_FAILURE',
      false,
      'Chat response delivery facts are missing',
    );
  }
  if (
    bullJobId !== payload.backgroundJobId ||
    turn.inputHash !== payload.inputHash ||
    turn.budgetPolicyVersion !== payload.budgetPolicyVersion ||
    backgroundJob.userId !== turn.userId ||
    backgroundJob.scope !== 'ACCOUNT' ||
    backgroundJob.queueName !== CHAT_RESPONSE_QUEUE ||
    backgroundJob.jobName !== CHAT_RESPONSE_JOB ||
    backgroundJob.resourceType !== CHAT_RESPONSE_RESOURCE_TYPE ||
    backgroundJob.resourceId !== turn.id ||
    (backgroundJob.bullJobId !== null &&
      bullJobId.length > 0 &&
      backgroundJob.bullJobId !== bullJobId)
  ) {
    throw stateMismatch('Chat response delivery facts are inconsistent');
  }

  return { turn, backgroundJob };
}

function validateResponseMessage(
  message: ChatMessage,
  turn: ChatTurn,
  expectedContent: string,
) {
  if (
    message.conversationId !== turn.conversationId ||
    message.role !== 'ASSISTANT' ||
    message.content !== expectedContent
  ) {
    throw stateMismatch('Existing chat response message is inconsistent');
  }
  return message;
}

function validateGeneratedResult(result: ChatResponseGeneratorResult) {
  if (
    !result ||
    typeof result.content !== 'string' ||
    result.content.trim().length === 0 ||
    result.content.length > INPUT_CONTENT_MAX_LENGTH ||
    typeof result.generator !== 'string' ||
    result.generator.trim().length === 0 ||
    result.generator.length > 80
  ) {
    throw new ChatResponseWorkerError(
      'OUTPUT_INVALID',
      false,
      'Chat response generator returned an invalid result',
    );
  }
}

function classifyFailure(error: unknown) {
  if (
    error instanceof ChatRunBudgetUnavailableError ||
    error instanceof AgentBudgetAdmissionError
  ) {
    return { code: 'BUDGET_EXHAUSTED' as const, retryable: false };
  }
  if (error instanceof ChatResponseWorkerError) {
    return { code: error.code, retryable: error.retryable };
  }
  return { code: 'PROVIDER_FAILURE' as const, retryable: true };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof ChatResponseWorkerError)
    return error.message.slice(0, 240);
  return 'Chat response generation failed';
}

function stateMismatch(message: string) {
  return new ChatResponseWorkerError('INTERNAL_FAILURE', false, message);
}

function isTerminalTurn(status: ChatTurn['status']) {
  return (
    status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED'
  );
}

function isTerminalJob(status: BackgroundJob['status']) {
  return (
    status === 'SUCCEEDED' ||
    status === 'FAILED' ||
    status === 'CANCELLED' ||
    status === 'STALE_SKIPPED'
  );
}

function estimateTokens(content: string) {
  return Math.max(1, Math.ceil(content.length / 4));
}

function compatibleTerminalStates(
  turnStatus: ChatTurn['status'],
  jobStatus: BackgroundJob['status'],
) {
  return (
    (turnStatus === 'SUCCEEDED' && jobStatus === 'SUCCEEDED') ||
    (turnStatus === 'FAILED' && jobStatus === 'FAILED') ||
    (turnStatus === 'CANCELLED' && jobStatus === 'CANCELLED')
  );
}

async function reconcileTerminalBackgroundJob(
  transaction: Prisma.TransactionClient,
  turn: ChatTurn,
  backgroundJob: BackgroundJob,
) {
  if (isTerminalJob(backgroundJob.status)) {
    if (!compatibleTerminalStates(turn.status, backgroundJob.status)) {
      throw stateMismatch(
        'ChatTurn and BackgroundJob terminal states are inconsistent',
      );
    }
    return;
  }

  const now = await readDatabaseClock(transaction);
  const update = terminalBackgroundJobUpdate(turn, now);
  const updated = await transaction.backgroundJob.updateMany({
    where: {
      id: backgroundJob.id,
      userId: turn.userId,
      scope: 'ACCOUNT',
      status: { in: ['QUEUED', 'ACTIVE'] },
    },
    data: update,
  });
  if (updated.count === 1) return;

  const current = await transaction.backgroundJob.findUnique({
    where: { id: backgroundJob.id },
  });
  if (!current || !compatibleTerminalStates(turn.status, current.status)) {
    throw stateMismatch('BackgroundJob terminal reconciliation was lost');
  }
}

function terminalBackgroundJobUpdate(turn: ChatTurn, now: Date) {
  if (turn.status === 'SUCCEEDED') {
    if (!turn.responseMessageId) {
      throw stateMismatch(
        'Succeeded ChatTurn is missing its response message reference',
      );
    }
    return {
      status: 'SUCCEEDED' as const,
      progress: 100,
      resultSummary: {
        turnId: turn.id,
        responseMessageId: turn.responseMessageId,
        reconciled: true,
      },
      errorCode: null,
      errorMessage: null,
      finishedAt: turn.finishedAt ?? now,
    };
  }

  return {
    status:
      turn.status === 'CANCELLED'
        ? ('CANCELLED' as const)
        : ('FAILED' as const),
    errorCode: turn.errorCode,
    errorMessage:
      turn.status === 'CANCELLED'
        ? 'Chat turn was cancelled before generation'
        : 'Chat turn reached a failed terminal state before generation completed',
    finishedAt: turn.finishedAt ?? now,
  };
}

function resultSummaryMatchesResponse(
  value: unknown,
  responseMessageId: string,
) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { responseMessageId?: unknown }).responseMessageId ===
      responseMessageId
  );
}

function attemptNumber(job: Job<unknown>) {
  return Math.max(1, job.attemptsMade + 1);
}

function readGenerationTimeoutMs() {
  return resolveChatResponseGenerationTimeout();
}

async function readDatabaseClock(transaction: Prisma.TransactionClient) {
  const rows = await transaction.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS now
  `;
  const row = rows[0];
  if (!row) throw new Error('Database clock query returned no rows');
  return row.now;
}

function isSerializationConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2034';
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '40001'
  );
}

function chatResponseMessageId(turnId: string) {
  return `chat-response-${createHash('sha256').update(turnId).digest('hex')}`;
}

function contentHash(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function eventIdFor(turnId: string, suffix: string) {
  return `evt_${createHash('sha256')
    .update(`${turnId}\u0000${suffix}`)
    .digest('hex')}`;
}

function durableGenerator(value: unknown) {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { generator?: unknown }).generator === 'string'
  ) {
    const generator = (value as { generator: string }).generator.trim();
    if (generator.length > 0 && generator.length <= 80) return generator;
  }
  return 'deterministic-worker-v1';
}
