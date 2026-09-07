import {
  Prisma,
  type ChatRunBudget,
  type ChatRunBudgetReservation,
} from '@prisma/client';

import { ChatRunBudgetRepository } from './chat-run-budget.repository';

const ownerId = 'user_1';
const turnId = 'turn_1';
const ledgerId = 'ledger_1';
const reservationId = 'reservation_1';

describe('ChatRunBudgetRepository', () => {
  it('does not grant another execution permit to a dispatched reservation', async () => {
    const reservation = makeReservation({
      status: 'DISPATCHED',
      dispatchedAt: new Date('2026-09-05T00:00:01.000Z'),
    });
    const transaction = {
      chatRunBudgetReservation: {
        findUnique: jest.fn().mockResolvedValue(reservation),
        update: jest.fn(),
      },
      chatRunBudgetEvent: { create: jest.fn() },
    };
    const repository = new ChatRunBudgetRepository({
      $transaction: (operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
    } as never);

    await expect(repository.dispatch(ownerId, reservationId)).resolves.toEqual({
      kind: 'conflict',
      reservation,
    });
    expect(transaction.chatRunBudgetReservation.update).not.toHaveBeenCalled();
  });

  it('reserves an owner-bound stage and is idempotent for the same reservation', async () => {
    const ledger = makeLedger();
    const reservation = makeReservation();
    const transaction = {
      chatTurn: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      chatRunBudget: {
        findUnique: jest.fn().mockResolvedValue(ledger),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatRunBudgetReservation: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(reservation),
        create: jest.fn().mockResolvedValue(reservation),
      },
      chatRunBudgetEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as never;
    const repository = new ChatRunBudgetRepository(prisma);
    const input = {
      ownerId,
      turnId,
      ledgerId,
      reservationId,
      stage: 'TUTOR' as const,
      inputTokens: 100,
      outputTokens: 50,
      costMicros: 1000,
    };

    await expect(repository.reserve(input)).resolves.toBe(reservation);
    await expect(repository.reserve(input)).resolves.toBe(reservation);
    expect(transaction.chatRunBudgetReservation.create).toHaveBeenCalledTimes(
      1,
    );
    expect(transaction.chatRunBudgetEvent.create).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the owner ledger cannot hold the reservation', async () => {
    const transaction = {
      chatTurn: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      chatRunBudget: {
        findUnique: jest.fn().mockResolvedValue(makeLedger()),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      chatRunBudgetReservation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      chatRunBudgetEvent: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as never;
    const repository = new ChatRunBudgetRepository(prisma);

    await expect(
      repository.reserve({
        ownerId,
        turnId,
        ledgerId,
        reservationId,
        stage: 'ROUTER',
        inputTokens: 100,
        outputTokens: 50,
        costMicros: 1000,
      }),
    ).rejects.toThrow('exhausted');
    expect(transaction.chatRunBudgetReservation.create).not.toHaveBeenCalled();
  });

  it('retries a serializable transaction conflict without duplicating the reservation', async () => {
    const ledger = makeLedger();
    const reservation = makeReservation();
    const transaction = {
      chatTurn: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      chatRunBudget: {
        findUnique: jest.fn().mockResolvedValue(ledger),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatRunBudgetReservation: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(reservation),
        create: jest.fn().mockResolvedValue(reservation),
      },
      chatRunBudgetEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const serializationConflict = new Prisma.PrismaClientKnownRequestError(
      'serialization conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    const prisma = {
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(serializationConflict)
        .mockImplementation((operation: (tx: typeof transaction) => unknown) =>
          operation(transaction),
        ),
    } as never;
    const repository = new ChatRunBudgetRepository(prisma);

    await expect(
      repository.reserve({
        ownerId,
        turnId,
        ledgerId,
        reservationId,
        stage: 'ROUTER',
        inputTokens: 100,
        outputTokens: 50,
        costMicros: 1000,
      }),
    ).resolves.toBe(reservation);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.chatRunBudgetReservation.create).toHaveBeenCalledTimes(
      1,
    );
  });

  it('settles once and moves held usage into used usage', async () => {
    const reservation = makeReservation({
      status: 'DISPATCHED',
      dispatchedAt: new Date('2026-09-05T00:00:01.000Z'),
    });
    const transaction = {
      chatRunBudgetReservation: {
        findUnique: jest.fn().mockResolvedValue(reservation),
        update: jest
          .fn()
          .mockResolvedValue({ ...reservation, status: 'SETTLED' }),
      },
      chatRunBudget: {
        findUnique: jest.fn().mockResolvedValue(makeLedger()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatRunBudgetEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as never;
    const repository = new ChatRunBudgetRepository(prisma);

    const result = await repository.settle(ownerId, reservationId, {
      inputTokens: 90,
      outputTokens: 40,
      costMicros: 900,
    });
    expect(result.kind).toBe('updated');
    expect(transaction.chatRunBudget.updateMany).toHaveBeenCalled();
    expect(transaction.chatRunBudgetEvent.create).toHaveBeenCalledWith({
      data: {
        userId: ownerId,
        turnId,
        ledgerId,
        reservationId,
        stage: 'TUTOR',
        type: 'SETTLED',
        usageInputTokens: 90,
        usageOutputTokens: 40,
        usageCostMicros: 900,
      },
    });
  });

  it('settles an UNCERTAIN reservation only with explicit recovered usage', async () => {
    const reservation = makeReservation({
      status: 'UNCERTAIN',
      dispatchedAt: new Date('2026-09-05T00:00:01.000Z'),
    });
    const settled = {
      ...reservation,
      status: 'SETTLED' as const,
      usageInputTokens: 90,
      usageOutputTokens: 40,
      usageCostMicros: 900,
      settledAt: new Date('2026-09-05T00:00:02.000Z'),
    };
    const transaction = {
      chatRunBudgetReservation: {
        findUnique: jest.fn().mockResolvedValue(reservation),
        update: jest.fn().mockResolvedValue(settled),
      },
      chatRunBudget: {
        findUnique: jest.fn().mockResolvedValue(makeLedger()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatRunBudgetEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as never;
    const repository = new ChatRunBudgetRepository(prisma);

    await expect(
      repository.settleUncertain(ownerId, reservationId, {
        inputTokens: 90,
        outputTokens: 40,
        costMicros: 900,
      }),
    ).resolves.toMatchObject({ kind: 'updated', reservation: settled });
    expect(transaction.chatRunBudgetEvent.create).toHaveBeenCalledWith({
      data: {
        userId: ownerId,
        turnId,
        ledgerId,
        reservationId,
        stage: 'TUTOR',
        type: 'SETTLED',
        usageInputTokens: 90,
        usageOutputTokens: 40,
        usageCostMicros: 900,
      },
    });
  });

  it('reconciles unstarted reservations without touching uncertain work', async () => {
    const ledger = makeLedger({
      heldCalls: 1,
      heldInputTokens: 100,
      heldOutputTokens: 50,
      heldCostMicros: 1000,
    });
    const transaction = {
      chatTurn: {
        findUnique: jest.fn().mockResolvedValue({ status: 'SUCCEEDED' }),
      },
      chatRunBudget: {
        findUnique: jest.fn().mockResolvedValue(ledger),
        update: jest.fn().mockResolvedValue({ ...ledger, heldCalls: 0 }),
      },
      chatRunBudgetReservation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: reservationId,
            turnId,
            stage: 'TUTOR',
            inputTokens: 100,
            outputTokens: 50,
            costMicros: 1000,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatRunBudgetEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as never;
    const repository = new ChatRunBudgetRepository(prisma);

    await expect(
      repository.reconcileTerminal(ownerId, turnId),
    ).resolves.toMatchObject({ heldCalls: 0 });
    expect(transaction.chatRunBudgetEvent.createMany).toHaveBeenCalledTimes(1);
  });

  it('never reconciles reservations for an active turn', async () => {
    const transaction = {
      chatTurn: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      chatRunBudget: { findUnique: jest.fn().mockResolvedValue(makeLedger()) },
      chatRunBudgetReservation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const repository = new ChatRunBudgetRepository({
      $transaction: (operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
    } as never);

    await expect(repository.reconcileTerminal(ownerId, turnId)).rejects.toThrow(
      'not terminal',
    );
    expect(
      transaction.chatRunBudgetReservation.findMany,
    ).not.toHaveBeenCalled();
  });

  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED', null])(
    'rejects new reserve and dispatch for a closed or absent turn: %s',
    async (status) => {
      const reservation = makeReservation();
      const transaction = {
        chatTurn: {
          findUnique: jest.fn().mockResolvedValue(status ? { status } : null),
        },
        chatRunBudget: {
          findUnique: jest.fn().mockResolvedValue(makeLedger()),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        chatRunBudgetReservation: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValue(reservation),
          create: jest.fn().mockResolvedValue(reservation),
          update: jest.fn().mockResolvedValue(reservation),
        },
        chatRunBudgetEvent: { create: jest.fn() },
      };
      const repository = new ChatRunBudgetRepository({
        $transaction: (operation: (tx: typeof transaction) => unknown) =>
          operation(transaction),
      } as never);

      await expect(
        repository.reserve({
          ownerId,
          turnId,
          ledgerId,
          reservationId,
          stage: 'TUTOR',
          inputTokens: 100,
          outputTokens: 50,
          costMicros: 1000,
        }),
      ).rejects.toThrow('unavailable');
      await expect(
        repository.dispatch(ownerId, reservationId),
      ).resolves.toMatchObject({ kind: 'conflict' });
      expect(transaction.chatRunBudget.updateMany).not.toHaveBeenCalled();
      expect(
        transaction.chatRunBudgetReservation.update,
      ).not.toHaveBeenCalled();
    },
  );
});

function makeLedger(overrides: Partial<ChatRunBudget> = {}): ChatRunBudget {
  return {
    id: ledgerId,
    userId: ownerId,
    turnId,
    policyVersion: 'chat-v1',
    maxCalls: 5,
    maxInputTokens: 10000,
    maxOutputTokens: 2800,
    maxCostMicros: 100000,
    usedCalls: 0,
    usedInputTokens: 0,
    usedOutputTokens: 0,
    usedCostMicros: 0,
    heldCalls: 0,
    heldInputTokens: 0,
    heldOutputTokens: 0,
    heldCostMicros: 0,
    cancelledAt: null,
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    updatedAt: new Date('2026-09-05T00:00:00.000Z'),
    ...overrides,
  };
}

function makeReservation(
  overrides: Partial<ChatRunBudgetReservation> = {},
): ChatRunBudgetReservation {
  return {
    id: reservationId,
    userId: ownerId,
    turnId,
    ledgerId,
    stage: 'TUTOR',
    status: 'RESERVED',
    inputTokens: 100,
    outputTokens: 50,
    costMicros: 1000,
    usageInputTokens: 0,
    usageOutputTokens: 0,
    usageCostMicros: 0,
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    dispatchedAt: null,
    settledAt: null,
    releasedAt: null,
    ...overrides,
  };
}
