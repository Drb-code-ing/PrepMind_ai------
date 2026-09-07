import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  createModelAgentRuntime,
  createOpenAICompatibleStructuredExecutor,
  type ModelAgentRuntime,
} from '@repo/ai';
import {
  isRouterModelEligible,
  runRouterModelCandidate,
  type RouterModelCandidateEnvelope,
} from '@repo/agent/model-candidates';
import { routeAgentRequest } from '@repo/agent/router';
import type { AgentRoute, AgentState, RouterResult } from '@repo/types/api/agent';

import { ChatRunBudgetStageRunner } from './chat-run-budget-stage-runner';

const ROUTER_RUNTIME = Symbol('CHAT_ROUTER_RUNTIME');

export type ChatRouterStageInput = Readonly<{
  ownerId: string;
  turnId: string;
  policyVersion: string;
  attempt: number;
  text: string;
  activeStudyContext?: string;
  signal?: AbortSignal;
}>;

export type ChatRouterStageResult = Readonly<{
  route: RouterResult;
  observation: RouterModelCandidateEnvelope['observation'];
}>;

export type ChatRouterStageRuntime = Readonly<{
  enabled: boolean;
  runtime: ModelAgentRuntime;
}>;

@Injectable()
export class ChatRouterStageService {
  constructor(
    private readonly budgetRunner: ChatRunBudgetStageRunner,
    @Optional()
    @Inject(ROUTER_RUNTIME)
    private readonly configuration?: ChatRouterStageRuntime,
  ) {}

  async run(input: ChatRouterStageInput): Promise<ChatRouterStageResult> {
    const deterministic = routeAgentRequest({
      runId: `${input.turnId}:router:${input.attempt}`,
      userId: input.ownerId,
      input: { text: input.text },
      chatContext: {
        recentMessages: [],
        ...(input.activeStudyContext
          ? { activeStudyContext: input.activeStudyContext }
          : {}),
      },
      proposals: [],
      errors: [],
    } satisfies AgentState);

    if (!this.configuration?.enabled) {
      return {
        route: deterministic,
        observation: localObservation(),
      };
    }

    const scope = await this.budgetRunner.forTurn(
      input.ownerId,
      input.turnId,
      input.policyVersion,
      input.attempt,
    );
    return scope.run(
      'ROUTER',
      {
        inputTokens: Math.min(800, estimateTokens(input.text)),
        outputTokens: 400,
        costMicros: 0,
      },
      async () => {
        const candidateEligible = isRouterModelEligible({
          text: input.text,
          activeStudyContext: input.activeStudyContext,
          deterministic,
        });
        const envelope = await runRouterModelCandidate({
          runId: `${input.turnId}:router:${input.attempt}`,
          text: input.text,
          activeStudyContext: input.activeStudyContext,
          deterministic,
          candidateEligible,
          budget: {
            maxCalls: 1,
            usedCalls: 0,
            maxInputTokens: 800,
            usedInputTokens: 0,
            maxOutputTokens: 400,
            usedOutputTokens: 0,
          },
          signal: input.signal,
          runtime: this.configuration!.runtime,
        });
        const route =
          envelope.observation.disposition === 'candidate_applied'
            ? canonicalizeRoute(envelope.result)
            : envelope.result;
        return {
          value: { route, observation: envelope.observation },
          usage: {
            inputTokens: envelope.observation.usage.inputTokens,
            outputTokens: envelope.observation.usage.outputTokens,
            costMicros: 0,
          },
        };
      },
    );
  }
}

export function createChatRouterStageRuntime(env: Record<string, unknown>): ChatRouterStageRuntime {
  const enabled =
    env.AI_PROVIDER_MODE === 'live' &&
    env.AI_ENABLE_LIVE_CALLS === true &&
    env.ROUTER_MODEL_ENABLED === true &&
    typeof env.DEEPSEEK_API_KEY === 'string' &&
    env.DEEPSEEK_API_KEY.length > 0;
  if (!enabled) {
    return {
      enabled: false,
      runtime: createModelAgentRuntime({
        mode: 'mock',
        provider: 'mock',
        model: 'mock-agent-candidate',
        liveCallsEnabled: false,
        timeoutMs: 5_000,
      }),
    };
  }
  const executor = createOpenAICompatibleStructuredExecutor({
    provider: 'deepseek',
    apiKey: env.DEEPSEEK_API_KEY as string,
    baseURL:
      typeof env.AI_BASE_URL === 'string'
        ? env.AI_BASE_URL
        : 'https://api.deepseek.com/v1',
    model: typeof env.AI_MODEL === 'string' ? env.AI_MODEL : 'deepseek-v4-flash',
    structuredOutputMode: 'json_object',
  });
  return {
    enabled: true,
    runtime: createModelAgentRuntime({
      mode: 'live',
      provider: 'deepseek',
      model: typeof env.AI_MODEL === 'string' ? env.AI_MODEL : 'deepseek-v4-flash',
      liveCallsEnabled: true,
      timeoutMs: 5_000,
      executor,
    }),
  };
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(Array.from(value).length / 4));
}

function localObservation(): RouterModelCandidateEnvelope['observation'] {
  return {
    attempted: false,
    disposition: 'not_eligible',
    budget: {
      maxCalls: 1,
      usedCalls: 0,
      maxInputTokens: 800,
      usedInputTokens: 0,
      maxOutputTokens: 400,
      usedOutputTokens: 0,
    },
    usage: { inputTokens: 0, outputTokens: 0 },
    reasonCodes: ['not_eligible'],
  };
}

function canonicalizeRoute(route: RouterResult): RouterResult {
  const requiresRag = route.name === 'rag_answer';
  const requiresHumanApproval =
    route.name === 'study_plan' ||
    route.name === 'review_analysis' ||
    route.name === 'wrong_question_organize';
  return { ...route, requiresRag, requiresHumanApproval };
}

export const CHAT_ROUTER_RUNTIME = ROUTER_RUNTIME;
export type ChatRouterRoute = AgentRoute;
