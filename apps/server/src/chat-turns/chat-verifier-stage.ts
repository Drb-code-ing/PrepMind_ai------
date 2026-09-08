import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  createModelAgentRuntime,
  createOpenAICompatibleStructuredExecutor,
  type ModelAgentRuntime,
} from '@repo/ai';
import {
  AgentBudgetUncertainResult,
} from '@repo/agent/chat-run-budget';
import {
  isKnowledgeVerifierModelEligible,
  runKnowledgeVerifierModelCandidate,
  type KnowledgeVerifierModelCandidateEnvelope,
} from '@repo/agent/model-candidates';
import {
  verifyKnowledgeChunks,
  type KnowledgeVerifierChunk,
  type KnowledgeVerifierResult,
} from '@repo/agent/knowledge-verifier';

import { ChatRunBudgetStageRunner } from './chat-run-budget-stage-runner';

const RUNTIME = Symbol('CHAT_KNOWLEDGE_VERIFIER_RUNTIME');
const INPUT_TOKENS = 1_600;
const OUTPUT_TOKENS = 400;
const INPUT_MICROS_PER_TOKEN = 3;
const OUTPUT_MICROS_PER_TOKEN = 6;
const REQUEST_CAP_MICROS = 30_000;

export type ChatVerifierStageRuntime = Readonly<{
  enabled: boolean;
  runtime: ModelAgentRuntime;
}>;

export type ChatVerifierStageInput = Readonly<{
  ownerId: string;
  turnId: string;
  policyVersion: string;
  attempt: number;
  query: string;
  chunks: readonly KnowledgeVerifierChunk[];
  signal?: AbortSignal;
}>;

export type ChatVerifierStageResult = Readonly<{
  result: KnowledgeVerifierResult;
  observation: KnowledgeVerifierModelCandidateEnvelope['observation'];
  degraded: boolean;
}>;

@Injectable()
export class ChatVerifierStageService {
  constructor(
    private readonly budgetRunner: ChatRunBudgetStageRunner,
    @Optional()
    @Inject(RUNTIME)
    private readonly configuration?: ChatVerifierStageRuntime,
  ) {}

  async run(input: ChatVerifierStageInput): Promise<ChatVerifierStageResult> {
    const deterministic = verifyKnowledgeChunks({
      query: input.query,
      chunks: [...input.chunks],
    });
    if (!this.configuration?.enabled) {
      return {
        result: deterministic,
        observation: localObservation(),
        degraded: false,
      };
    }

    // Eligibility is deterministic and must be checked before opening a
    // durable reservation. Empty/unsafe/clearly supported evidence therefore
    // consumes neither a provider call nor a child-stage budget slot.
    const candidateEligible = isKnowledgeVerifierModelEligible({
      query: input.query,
      chunks: [...input.chunks],
      deterministic,
    });
    if (!candidateEligible) {
      return {
        result: deterministic,
        observation: localObservation(),
        degraded: false,
      };
    }

    const scope = await this.budgetRunner.forTurn(
      input.ownerId,
      input.turnId,
      input.policyVersion,
      input.attempt,
    );
    return scope.run(
      'VERIFIER',
      {
        inputTokens: INPUT_TOKENS,
        outputTokens: OUTPUT_TOKENS,
        costMicros: REQUEST_CAP_MICROS,
      },
      async () => {
        const envelope = await runKnowledgeVerifierModelCandidate({
          runId: `${input.turnId}:verifier:${input.attempt}`,
          query: input.query,
          chunks: [...input.chunks],
          deterministic,
          candidateEligible,
          budget: {
            maxCalls: 1,
            usedCalls: 0,
            maxInputTokens: INPUT_TOKENS,
            usedInputTokens: 0,
            maxOutputTokens: OUTPUT_TOKENS,
            usedOutputTokens: 0,
          },
          signal: input.signal,
          runtime: this.configuration!.runtime,
        });
        const calculatedCostMicros =
          envelope.observation.usage.inputTokens * INPUT_MICROS_PER_TOKEN +
          envelope.observation.usage.outputTokens * OUTPUT_MICROS_PER_TOKEN;
        const usageWithinCap =
          Number.isSafeInteger(calculatedCostMicros) &&
          calculatedCostMicros <= REQUEST_CAP_MICROS;
        const unknownOutcome =
          envelope.observation.attempted &&
          (envelope.observation.traceUnavailable === true ||
            envelope.observation.usageUnavailable === true ||
            envelope.observation.disposition === 'fallback_runtime_error' ||
            envelope.observation.disposition === 'fallback_timeout' ||
            !usageWithinCap);
        const value = {
            result: envelope.result,
            observation: envelope.observation,
            degraded: envelope.observation.disposition !== 'candidate_applied',
          } satisfies ChatVerifierStageResult;
        const usage = unknownOutcome
          ? {
              inputTokens: INPUT_TOKENS,
              outputTokens: OUTPUT_TOKENS,
              costMicros: REQUEST_CAP_MICROS,
            }
          : {
              inputTokens: envelope.observation.usage.inputTokens,
              outputTokens: envelope.observation.usage.outputTokens,
              costMicros: calculatedCostMicros,
            };
        if (unknownOutcome) {
          throw new AgentBudgetUncertainResult(value);
        }
        return {
          value,
          // A dispatched call with no trustworthy usage must retain its full
          // hold rather than settling it as a free provider request.
          usage,
        };
      },
    );
  }
}

export function createChatVerifierStageRuntime(
  env: Record<string, unknown>,
): ChatVerifierStageRuntime {
  const enabled =
    env.AI_PROVIDER_MODE === 'live' &&
    env.AI_ENABLE_LIVE_CALLS === true &&
    env.KNOWLEDGE_VERIFIER_MODEL_ENABLED === true &&
    typeof env.KNOWLEDGE_AGENT_DEEPSEEK_API_KEY === 'string' &&
    env.KNOWLEDGE_AGENT_DEEPSEEK_API_KEY.length > 0 &&
    env.AI_BASE_URL === 'https://api.deepseek.com/v1';
  if (!enabled) {
    return {
      enabled: false,
      runtime: createModelAgentRuntime({
        mode: 'mock',
        provider: 'mock',
        model: 'disabled-knowledge-verifier-candidate',
        liveCallsEnabled: false,
        timeoutMs: 4_500,
      }),
    };
  }
  const model = 'deepseek-v4-pro';
  const executor = createOpenAICompatibleStructuredExecutor({
    provider: 'deepseek',
    apiKey: env.KNOWLEDGE_AGENT_DEEPSEEK_API_KEY as string,
    baseURL: 'https://api.deepseek.com/v1',
    model,
    structuredOutputMode: 'deepseek_v4_pro_nonthinking_json',
  });
  return {
    enabled: true,
    runtime: createModelAgentRuntime({
      mode: 'live',
      provider: 'deepseek',
      model,
      liveCallsEnabled: true,
      timeoutMs: 4_500,
      executor,
    }),
  };
}

function localObservation(): KnowledgeVerifierModelCandidateEnvelope['observation'] {
  return {
    attempted: false,
    disposition: 'not_eligible',
    budget: {
      maxCalls: 1,
      usedCalls: 0,
      maxInputTokens: INPUT_TOKENS,
      usedInputTokens: 0,
      maxOutputTokens: OUTPUT_TOKENS,
      usedOutputTokens: 0,
    },
    usage: { inputTokens: 0, outputTokens: 0 },
    reasonCodes: ['not_eligible'],
  };
}

export const CHAT_KNOWLEDGE_VERIFIER_RUNTIME = RUNTIME;
