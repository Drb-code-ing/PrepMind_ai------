import { describe, expect, it, mock } from 'bun:test';

import {
  AgentBudgetDispatchError,
  AgentBudgetUncertainResult,
  runBudgetedStage,
  type AgentBudgetPort,
} from '../src/contracts/chat-run-budget';

function makeBudget(overrides: Partial<AgentBudgetPort> = {}) {
  const reservation = { id: 'reservation_1' } as never;
  return {
    reserve: async () => reservation,
    dispatch: async () => ({ kind: 'updated', reservation }) as const,
    settle: async () => ({ kind: 'updated', reservation }) as const,
    settleUncertain: async () => ({ kind: 'updated', reservation }) as const,
    release: async () => ({ kind: 'updated', reservation }) as const,
    uncertain: async () => ({ kind: 'updated', reservation }) as const,
    ...overrides,
  } satisfies AgentBudgetPort;
}

const input = {
  ownerId: 'user_1',
  turnId: 'turn_1',
  ledgerId: 'ledger_1',
  reservationId: 'reservation_1',
  stage: 'TUTOR' as const,
  inputTokens: 10,
  outputTokens: 20,
  costMicros: 30,
};

describe('runBudgetedStage', () => {
  it('does not execute or release a duplicate dispatched reservation', async () => {
    const release = mock(async () => ({ kind: 'not-found' }) as const);
    const execute = mock(async () => ({ value: 'unexpected', usage: input }));
    const budget = makeBudget({
      dispatch: async () => ({ kind: 'conflict', reservation: { status: 'DISPATCHED' } as never }),
      release,
    });
    await expect(runBudgetedStage(budget, input, execute)).rejects.toBeInstanceOf(
      AgentBudgetDispatchError,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('preserves the execution error if recording uncertain fails', async () => {
    const error = new Error('execution failed');
    const budget = makeBudget({
      uncertain: async () => {
        throw new Error('database offline');
      },
    });
    await expect(
      runBudgetedStage(budget, input, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it('dispatches and settles observed usage', async () => {
    const calls: string[] = [];
    const budget = makeBudget({
      reserve: async (request) => {
        calls.push(`reserve:${request.stage}`);
        return { id: 'reservation_1' } as never;
      },
      dispatch: async () => {
        calls.push('dispatch');
        return { kind: 'updated', reservation: {} as never };
      },
      settle: async (_owner, _id, usage) => {
        calls.push(`settle:${usage.outputTokens}`);
        return { kind: 'updated', reservation: {} as never };
      },
    });

    await expect(
      runBudgetedStage(budget, input, async () => ({
        value: 'ok',
        usage: { inputTokens: 8, outputTokens: 12, costMicros: 9 },
      })),
    ).resolves.toBe('ok');
    expect(calls).toEqual(['reserve:TUTOR', 'dispatch', 'settle:12']);
  });

  it('marks provider failure uncertain and does not release dispatched work', async () => {
    const calls: string[] = [];
    const budget = makeBudget({
      uncertain: async () => {
        calls.push('uncertain');
        return { kind: 'updated', reservation: {} as never };
      },
      release: async () => {
        calls.push('release');
        return { kind: 'updated', reservation: {} as never };
      },
    });

    await expect(
      runBudgetedStage(budget, input, async () => {
        throw new Error('provider failed');
      }),
    ).rejects.toThrow('provider failed');
    expect(calls).toEqual(['uncertain']);
  });

  it('returns an explicit fallback while retaining the dispatched hold', async () => {
    const calls: string[] = [];
    const budget = makeBudget({
      uncertain: async () => {
        calls.push('uncertain');
        return { kind: 'updated', reservation: {} as never };
      },
      settle: async () => {
        calls.push('settle');
        return { kind: 'updated', reservation: {} as never };
      },
    });

    await expect(
      runBudgetedStage(budget, input, async () => {
        throw new AgentBudgetUncertainResult('deterministic fallback');
      }),
    ).resolves.toBe('deterministic fallback');
    expect(calls).toEqual(['uncertain']);
  });
});
