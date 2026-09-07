/* eslint-disable @typescript-eslint/require-await */
import type { ChatRunBudgetReservation } from '@prisma/client';
import type { ChatRunBudgetReservationRequest } from '@repo/types';
import { AgentBudgetDispatchError } from '@repo/agent/chat-run-budget';

import { ChatRunBudgetStageRunner } from './chat-run-budget-stage-runner';

const reserved = { inputTokens: 100, outputTokens: 100, costMicros: 100 };
const usage = { inputTokens: 70, outputTokens: 60, costMicros: 50 };

describe('ChatRunBudgetStageRunner', () => {
  it('binds stages to the same durable owner/turn/ledger without exposing persistence', async () => {
    const h = harness();
    const scope = await h.runner.forTurn('owner', 'turn', 'chat-v1', 1);
    expect(Object.keys(scope).sort()).toEqual(['limits', 'run']);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.limits)).toBe(true);
    for (const stage of ['ROUTER', 'VERIFIER'] as const) {
      await expect(
        scope.run(stage, reserved, async () => ({ value: stage, usage })),
      ).resolves.toBe(stage);
      expect(h.repo.reserve).toHaveBeenLastCalledWith({
        ...reserved,
        ownerId: 'owner',
        turnId: 'turn',
        ledgerId: 'ledger',
        stage,
        reservationId: `${stage.toLowerCase()}:turn:1`,
      });
    }
    expect(h.repo.settle).toHaveBeenCalledTimes(2);
    expect(h.repo.uncertain).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { userId: 'foreign' },
    { turnId: 'foreign' },
    { policyVersion: 'foreign' },
    { cancelledAt: new Date() },
  ])(
    'rejects missing or inconsistent ledgers before issuing a capability: %j',
    async (override) => {
      const h = harness();
      h.repo.findLedger.mockResolvedValueOnce(
        override === null ? null : { ...h.ledger, ...override },
      );
      await expect(
        h.runner.forTurn('owner', 'turn', 'chat-v1', 1),
      ).rejects.toThrow('unavailable');
      expect(h.repo.reserve).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid attempt %s',
    async (attempt) => {
      const h = harness();
      await expect(
        h.runner.forTurn('owner', 'turn', 'chat-v1', attempt),
      ).rejects.toThrow('unavailable');
    },
  );

  it.each(['DISPATCHED', 'UNCERTAIN', 'SETTLED'] as const)(
    'does not execute or release a previously %s stage',
    async (status) => {
      const h = harness();
      const scope = await h.runner.forTurn('owner', 'turn', 'chat-v1', 1);
      h.repo.dispatch.mockImplementationOnce(async () => ({
        kind: 'conflict',
        reservation: h.row(status),
      }));
      const execute = jest.fn(async () => ({ value: 'answer', usage }));
      await expect(
        scope.run('ROUTER', reserved, execute),
      ).rejects.toBeInstanceOf(AgentBudgetDispatchError);
      expect(execute).not.toHaveBeenCalled();
      expect(h.repo.release).not.toHaveBeenCalled();
      expect(h.repo.uncertain).not.toHaveBeenCalled();
    },
  );

  it('releases only an undispatched conflict and preserves holds when dispatch is unknown', async () => {
    const h = harness();
    const scope = await h.runner.forTurn('owner', 'turn', 'chat-v1', 1);
    h.repo.dispatch.mockImplementationOnce(async () => ({
      kind: 'conflict',
      reservation: h.row('RESERVED'),
    }));
    const execute = jest.fn(async () => ({ value: 'answer', usage }));
    await expect(scope.run('TUTOR', reserved, execute)).rejects.toThrow(
      'could not be dispatched',
    );
    expect(h.repo.release).toHaveBeenCalledWith('owner', 'tutor:turn:1');
    h.repo.release.mockClear();
    h.repo.dispatch.mockRejectedValueOnce(new Error('connection lost'));
    await expect(scope.run('VERIFIER', reserved, execute)).rejects.toThrow(
      'connection lost',
    );
    expect(h.repo.release).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the original execution error when uncertain recording also fails', async () => {
    const h = harness();
    const scope = await h.runner.forTurn('owner', 'turn', 'chat-v1', 1);
    const error = new Error('aborted stage');
    h.repo.uncertain.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      scope.run('RETRIEVER', reserved, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(h.repo.uncertain).toHaveBeenCalledWith('owner', 'retriever:turn:1');
    expect(h.repo.settle).not.toHaveBeenCalled();
    expect(h.repo.release).not.toHaveBeenCalled();
  });

  it('does not return success when settlement conflicts', async () => {
    const h = harness();
    const scope = await h.runner.forTurn('owner', 'turn', 'chat-v1', 1);
    h.repo.settle.mockImplementationOnce(async () => ({
      kind: 'conflict',
      reservation: h.row('UNCERTAIN'),
    }));
    await expect(
      scope.run('FINAL_RESPONSE', reserved, async () => ({
        value: 'answer',
        usage,
      })),
    ).rejects.toThrow('settlement conflicted');
    expect(h.repo.uncertain).toHaveBeenCalledWith(
      'owner',
      'final_response:turn:1',
    );
    expect(h.repo.release).not.toHaveBeenCalled();
  });
});

function harness() {
  const now = new Date('2026-09-07T00:00:00.000Z');
  const ledger = {
    id: 'ledger',
    userId: 'owner',
    turnId: 'turn',
    policyVersion: 'chat-v1',
    maxCalls: 5,
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
    maxCostMicros: 1000,
    cancelledAt: null as Date | null,
  };
  let input: ChatRunBudgetReservationRequest;
  const row = (
    status: ChatRunBudgetReservation['status'],
  ): ChatRunBudgetReservation => ({
    id: input.reservationId,
    userId: input.ownerId,
    turnId: input.turnId,
    ledgerId: input.ledgerId,
    stage: input.stage,
    status,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costMicros: input.costMicros,
    usageInputTokens: status === 'SETTLED' ? usage.inputTokens : 0,
    usageOutputTokens: status === 'SETTLED' ? usage.outputTokens : 0,
    usageCostMicros: status === 'SETTLED' ? usage.costMicros : 0,
    createdAt: now,
    dispatchedAt: ['RESERVED', 'RELEASED'].includes(status) ? null : now,
    settledAt: status === 'SETTLED' ? now : null,
    releasedAt: status === 'RELEASED' ? now : null,
  });
  const repo = {
    findLedger: jest
      .fn<Promise<typeof ledger | null>, [string, string]>()
      .mockResolvedValue(ledger),
    reserve: jest.fn(async (request: ChatRunBudgetReservationRequest) => {
      input = request;
      return row('RESERVED');
    }),
    dispatch: jest.fn(async () => ({
      kind: 'updated' as 'updated' | 'conflict',
      reservation: row('DISPATCHED'),
    })),
    settle: jest.fn(async () => ({
      kind: 'updated' as 'updated' | 'conflict',
      reservation: row('SETTLED'),
    })),
    settleUncertain: jest.fn(),
    release: jest.fn(async () => ({
      kind: 'updated' as const,
      reservation: row('RELEASED'),
    })),
    uncertain: jest.fn(async () => ({
      kind: 'updated' as const,
      reservation: row('UNCERTAIN'),
    })),
  };
  return {
    ledger,
    repo,
    row,
    runner: new ChatRunBudgetStageRunner(repo as never),
  };
}
