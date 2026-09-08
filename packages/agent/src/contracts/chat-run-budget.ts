import type {
  ChatRunBudgetReservation,
  ChatRunBudgetReservationRequest,
  ChatRunBudgetStage,
  ChatRunBudgetUsage,
} from '@repo/types';

/**
 * Narrow capability injected by the server composition root. The agent
 * package can account a stage without depending on Prisma or Nest.
 */
export type AgentBudgetPort = {
  reserve(input: ChatRunBudgetReservationRequest): Promise<ChatRunBudgetReservation>;
  /** Only a fresh RESERVED -> DISPATCHED transition may return updated. */
  dispatch(ownerId: string, reservationId: string): Promise<BudgetTransition>;
  settle(
    ownerId: string,
    reservationId: string,
    usage: ChatRunBudgetUsage,
  ): Promise<BudgetTransition>;
  settleUncertain(
    ownerId: string,
    reservationId: string,
    usage: ChatRunBudgetUsage,
  ): Promise<BudgetTransition>;
  release(ownerId: string, reservationId: string): Promise<BudgetTransition>;
  uncertain(ownerId: string, reservationId: string): Promise<BudgetTransition>;
};

export type BudgetTransition =
  | { kind: 'not-found' }
  | { kind: 'conflict'; reservation: ChatRunBudgetReservation }
  | { kind: 'updated'; reservation: ChatRunBudgetReservation };

/** A dispatch conflict after a durable attempt must never execute the stage again. */
export class AgentBudgetDispatchError extends Error {
  constructor() {
    super('Agent stage budget reservation was already dispatched');
    this.name = 'AgentBudgetDispatchError';
  }
}

export class AgentBudgetAdmissionError extends Error {
  constructor() {
    super('Agent stage budget reservation could not be dispatched');
    this.name = 'AgentBudgetAdmissionError';
  }
}

/**
 * A stage can keep its deterministic fallback while retaining a dispatched
 * provider hold as UNCERTAIN. This is for callers that have an explicit safe
 * fallback but cannot prove whether the provider consumed tokens.
 */
export class AgentBudgetUncertainResult<T> extends Error {
  constructor(readonly value: T) {
    super('Agent stage provider outcome is uncertain; deterministic fallback retained');
    this.name = 'AgentBudgetUncertainResult';
  }
}

export type BudgetedStageInput = Omit<ChatRunBudgetReservationRequest, 'stage'> & {
  stage: ChatRunBudgetStage;
};

/**
 * Execute one stage only after winning a fresh dispatch. Unknown dispatch or
 * provider outcomes keep the hold; only unstarted work may be released.
 */
export async function runBudgetedStage<T>(
  budget: AgentBudgetPort,
  input: BudgetedStageInput,
  execute: () => Promise<{ value: T; usage: ChatRunBudgetUsage }>,
): Promise<T> {
  const reservation = await budget.reserve(input);
  const dispatched = await budget.dispatch(input.ownerId, reservation.id);
  if (dispatched.kind !== 'updated') {
    if (dispatched.kind === 'conflict' && dispatched.reservation.status === 'RESERVED') {
      await budget.release(input.ownerId, reservation.id);
    }
    if (
      dispatched.kind === 'conflict' &&
      ['DISPATCHED', 'UNCERTAIN', 'SETTLED'].includes(dispatched.reservation.status)
    ) {
      throw new AgentBudgetDispatchError();
    }
    throw new AgentBudgetAdmissionError();
  }

  try {
    const result = await execute();
    const settled = await budget.settle(input.ownerId, reservation.id, result.usage);
    if (settled.kind !== 'updated') {
      throw new Error('Agent stage budget settlement conflicted');
    }
    return result.value;
  } catch (error) {
    try {
      await budget.uncertain(input.ownerId, reservation.id);
    } catch {
      // A failed diagnostic write leaves DISPATCHED held, never refunded.
    }
    if (error instanceof AgentBudgetUncertainResult) return error.value;
    throw error;
  }
}
