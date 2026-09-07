import { Injectable } from '@nestjs/common';
import type { ChatRunBudgetReservation as PrismaReservation } from '@prisma/client';
import {
  chatRunBudgetPolicySchema,
  chatRunBudgetReservationSchema,
  type ChatRunBudgetPolicy,
  type ChatRunBudgetStage,
  type ChatRunBudgetUsage,
} from '@repo/types';
import {
  runBudgetedStage,
  type AgentBudgetPort,
  type BudgetTransition,
} from '@repo/agent/chat-run-budget';

import { ChatRunBudgetRepository } from '../chat-run-budget/chat-run-budget.repository';

export type ChatRunBudgetStageRunnerScope = Readonly<{
  limits: Readonly<ChatRunBudgetPolicy>;
  run<T>(
    stage: ChatRunBudgetStage,
    reservation: ChatRunBudgetUsage,
    execute: () => Promise<{ value: T; usage: ChatRunBudgetUsage }>,
  ): Promise<T>;
}>;

export class ChatRunBudgetUnavailableError extends Error {
  constructor() {
    super('Chat run budget is unavailable');
  }
}

@Injectable()
export class ChatRunBudgetStageRunner {
  constructor(private readonly budgets: ChatRunBudgetRepository) {}

  async forTurn(
    ownerId: string,
    turnId: string,
    policyVersion: string,
    attempt: number,
  ): Promise<ChatRunBudgetStageRunnerScope> {
    const ledger = await this.budgets.findLedger(ownerId, turnId);
    if (
      !ledger ||
      ledger.userId !== ownerId ||
      ledger.turnId !== turnId ||
      ledger.policyVersion !== policyVersion ||
      ledger.cancelledAt ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1
    ) {
      throw new ChatRunBudgetUnavailableError();
    }
    const limits = Object.freeze(
      chatRunBudgetPolicySchema.parse({
        policyVersion,
        maxCalls: ledger.maxCalls,
        maxInputTokens: ledger.maxInputTokens,
        maxOutputTokens: ledger.maxOutputTokens,
        maxCostMicros: ledger.maxCostMicros,
      }),
    );
    const ledgerId = ledger.id;
    const port: AgentBudgetPort = {
      reserve: async (value) =>
        toReservation(await this.budgets.reserve(value)),
      dispatch: (owner, id) =>
        this.budgets.dispatch(owner, id).then(toTransition),
      settle: (owner, id, usage) =>
        this.budgets.settle(owner, id, usage).then(toTransition),
      settleUncertain: (owner, id, usage) =>
        this.budgets.settleUncertain(owner, id, usage).then(toTransition),
      release: (owner, id) =>
        this.budgets.release(owner, id).then(toTransition),
      uncertain: (owner, id) =>
        this.budgets.uncertain(owner, id).then(toTransition),
    };

    // Identity and reservation keys stay in the Server closure, not in Agent input.
    return Object.freeze({
      limits,
      run: <T>(
        stage: ChatRunBudgetStage,
        reservation: ChatRunBudgetUsage,
        execute: () => Promise<{ value: T; usage: ChatRunBudgetUsage }>,
      ) =>
        runBudgetedStage(
          port,
          {
            ownerId,
            turnId,
            ledgerId,
            reservationId: `${stage.toLowerCase()}:${turnId}:${attempt}`,
            stage,
            inputTokens: reservation.inputTokens,
            outputTokens: reservation.outputTokens,
            costMicros: reservation.costMicros,
          },
          execute,
        ),
    });
  }
}

function toReservation(value: PrismaReservation) {
  return chatRunBudgetReservationSchema.parse({
    id: value.id,
    ownerId: value.userId,
    turnId: value.turnId,
    ledgerId: value.ledgerId,
    stage: value.stage,
    status: value.status,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    costMicros: value.costMicros,
    usageInputTokens: value.usageInputTokens,
    usageOutputTokens: value.usageOutputTokens,
    usageCostMicros: value.usageCostMicros,
    createdAt: value.createdAt.toISOString(),
    dispatchedAt: value.dispatchedAt?.toISOString() ?? null,
    settledAt: value.settledAt?.toISOString() ?? null,
    releasedAt: value.releasedAt?.toISOString() ?? null,
  });
}

function toTransition(
  value: Awaited<ReturnType<ChatRunBudgetRepository['dispatch']>>,
): BudgetTransition {
  if (value.kind === 'not-found') return value;
  return { kind: value.kind, reservation: toReservation(value.reservation) };
}
