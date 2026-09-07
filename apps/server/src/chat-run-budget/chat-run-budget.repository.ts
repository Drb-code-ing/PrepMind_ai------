import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type ChatRunBudget,
  type ChatRunBudgetReservation,
} from '@prisma/client';
import type {
  ChatRunBudgetPolicy,
  ChatRunBudgetReservationRequest,
  ChatRunBudgetUsage,
} from '@repo/types';
import {
  chatRunBudgetPolicySchema,
  chatRunBudgetReservationRequestSchema,
  chatRunBudgetUsageSchema,
} from '@repo/types';

import { PrismaService } from '../database/prisma.service';

const MAX_TRANSACTION_ATTEMPTS = 5;

export const DEFAULT_CHAT_RUN_BUDGET_POLICY: ChatRunBudgetPolicy = {
  policyVersion: 'chat-v1',
  maxCalls: 5,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_800,
  maxCostMicros: 100_000,
};

export type BudgetTransition =
  | { kind: 'not-found' }
  | { kind: 'conflict'; reservation: ChatRunBudgetReservation }
  | { kind: 'updated'; reservation: ChatRunBudgetReservation };

@Injectable()
export class ChatRunBudgetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createLedger(
    ownerId: string,
    turnId: string,
    policy: ChatRunBudgetPolicy,
  ): Promise<ChatRunBudget> {
    const validatedPolicy = chatRunBudgetPolicySchema.parse(policy);
    return this.runSerializable((transaction) =>
      this.createLedgerInTransaction(
        transaction,
        ownerId,
        turnId,
        validatedPolicy,
      ),
    );
  }

  createLedgerInTransaction(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    turnId: string,
    policy: ChatRunBudgetPolicy,
  ) {
    const validatedPolicy = chatRunBudgetPolicySchema.parse(policy);
    return transaction.chatRunBudget.upsert({
      where: { turnId_userId: { turnId, userId: ownerId } },
      create: {
        userId: ownerId,
        turnId,
        policyVersion: validatedPolicy.policyVersion,
        maxCalls: validatedPolicy.maxCalls,
        maxInputTokens: validatedPolicy.maxInputTokens,
        maxOutputTokens: validatedPolicy.maxOutputTokens,
        maxCostMicros: validatedPolicy.maxCostMicros,
      },
      update: {},
    });
  }

  findLedger(ownerId: string, turnId: string) {
    return this.prisma.chatRunBudget.findUnique({
      where: { turnId_userId: { turnId, userId: ownerId } },
    });
  }

  async reserve(
    input: ChatRunBudgetReservationRequest,
  ): Promise<ChatRunBudgetReservation> {
    const validatedInput = chatRunBudgetReservationRequestSchema.parse(input);
    return this.runSerializable(async (transaction) => {
      const existing = await transaction.chatRunBudgetReservation.findUnique({
        where: {
          id_userId: {
            id: validatedInput.reservationId,
            userId: validatedInput.ownerId,
          },
        },
      });
      if (existing) {
        assertSameReservation(existing, validatedInput);
        return existing;
      }

      const ledger = await transaction.chatRunBudget.findUnique({
        where: {
          id_userId: {
            id: validatedInput.ledgerId,
            userId: validatedInput.ownerId,
          },
        },
      });
      if (
        !ledger ||
        ledger.turnId !== validatedInput.turnId ||
        ledger.cancelledAt ||
        !(await this.isTurnOpen(
          transaction,
          validatedInput.ownerId,
          validatedInput.turnId,
        ))
      ) {
        throw new Error('Chat run budget is unavailable');
      }
      const updated = await transaction.chatRunBudget.updateMany({
        where: {
          id: validatedInput.ledgerId,
          userId: validatedInput.ownerId,
          cancelledAt: null,
          usedCalls: { lte: ledger.maxCalls - 1 - ledger.heldCalls },
          usedInputTokens: {
            lte:
              ledger.maxInputTokens -
              validatedInput.inputTokens -
              ledger.heldInputTokens,
          },
          usedOutputTokens: {
            lte:
              ledger.maxOutputTokens -
              validatedInput.outputTokens -
              ledger.heldOutputTokens,
          },
          usedCostMicros: {
            lte:
              ledger.maxCostMicros -
              validatedInput.costMicros -
              ledger.heldCostMicros,
          },
        },
        data: {
          heldCalls: { increment: 1 },
          heldInputTokens: { increment: validatedInput.inputTokens },
          heldOutputTokens: { increment: validatedInput.outputTokens },
          heldCostMicros: { increment: validatedInput.costMicros },
        },
      });
      if (updated.count !== 1) throw new Error('Chat run budget exhausted');

      const reservation = await transaction.chatRunBudgetReservation.create({
        data: {
          id: validatedInput.reservationId,
          userId: validatedInput.ownerId,
          turnId: validatedInput.turnId,
          ledgerId: validatedInput.ledgerId,
          stage: validatedInput.stage,
          inputTokens: validatedInput.inputTokens,
          outputTokens: validatedInput.outputTokens,
          costMicros: validatedInput.costMicros,
        },
      });
      await transaction.chatRunBudgetEvent.create({
        data: {
          userId: validatedInput.ownerId,
          turnId: validatedInput.turnId,
          ledgerId: validatedInput.ledgerId,
          reservationId: validatedInput.reservationId,
          stage: validatedInput.stage,
          type: 'RESERVED',
        },
      });
      return reservation;
    });
  }

  async dispatch(
    ownerId: string,
    reservationId: string,
  ): Promise<BudgetTransition> {
    return this.transition(ownerId, reservationId, 'DISPATCHED');
  }

  async uncertain(
    ownerId: string,
    reservationId: string,
  ): Promise<BudgetTransition> {
    return this.runSerializable(async (transaction) => {
      const current = await transaction.chatRunBudgetReservation.findUnique({
        where: { id_userId: { id: reservationId, userId: ownerId } },
      });
      if (!current) return { kind: 'not-found' } as const;
      if (current.status === 'UNCERTAIN')
        return { kind: 'updated', reservation: current } as const;
      if (current.status !== 'DISPATCHED')
        return { kind: 'conflict', reservation: current } as const;
      const reservation = await transaction.chatRunBudgetReservation.update({
        where: { id_userId: { id: reservationId, userId: ownerId } },
        data: { status: 'UNCERTAIN' },
      });
      await transaction.chatRunBudgetEvent.create({
        data: {
          userId: ownerId,
          turnId: current.turnId,
          ledgerId: current.ledgerId,
          reservationId,
          stage: current.stage,
          type: 'UNCERTAIN',
        },
      });
      return { kind: 'updated', reservation } as const;
    });
  }

  /**
   * Settles a dispatched attempt after an operator/provider recovery confirms
   * the usage. An UNCERTAIN reservation is never released: without evidence
   * that the provider did not run, releasing would undercount spend.
   */
  async settleUncertain(
    ownerId: string,
    reservationId: string,
    usage: ChatRunBudgetUsage,
  ): Promise<BudgetTransition> {
    const validatedUsage = chatRunBudgetUsageSchema.parse(usage);
    return this.runSerializable(async (transaction) => {
      const current = await transaction.chatRunBudgetReservation.findUnique({
        where: { id_userId: { id: reservationId, userId: ownerId } },
      });
      if (!current) return { kind: 'not-found' } as const;
      if (current.status === 'SETTLED') {
        return current.usageInputTokens === validatedUsage.inputTokens &&
          current.usageOutputTokens === validatedUsage.outputTokens &&
          current.usageCostMicros === validatedUsage.costMicros
          ? ({ kind: 'updated', reservation: current } as const)
          : ({ kind: 'conflict', reservation: current } as const);
      }
      if (
        current.status !== 'UNCERTAIN' ||
        validatedUsage.inputTokens > current.inputTokens ||
        validatedUsage.outputTokens > current.outputTokens ||
        validatedUsage.costMicros > current.costMicros
      ) {
        return { kind: 'conflict', reservation: current } as const;
      }
      const ledger = await transaction.chatRunBudget.findUnique({
        where: { id_userId: { id: current.ledgerId, userId: ownerId } },
      });
      if (!ledger) return { kind: 'not-found' } as const;
      const updatedLedger = await transaction.chatRunBudget.updateMany({
        where: {
          id: current.ledgerId,
          userId: ownerId,
          heldCalls: { gte: 1 },
          heldInputTokens: { gte: current.inputTokens },
          heldOutputTokens: { gte: current.outputTokens },
          heldCostMicros: { gte: current.costMicros },
          usedCalls: { lte: ledger.maxCalls - 1 },
          usedInputTokens: {
            lte: ledger.maxInputTokens - validatedUsage.inputTokens,
          },
          usedOutputTokens: {
            lte: ledger.maxOutputTokens - validatedUsage.outputTokens,
          },
          usedCostMicros: {
            lte: ledger.maxCostMicros - validatedUsage.costMicros,
          },
        },
        data: {
          heldCalls: { decrement: 1 },
          heldInputTokens: { decrement: current.inputTokens },
          heldOutputTokens: { decrement: current.outputTokens },
          heldCostMicros: { decrement: current.costMicros },
          usedCalls: { increment: 1 },
          usedInputTokens: { increment: validatedUsage.inputTokens },
          usedOutputTokens: { increment: validatedUsage.outputTokens },
          usedCostMicros: { increment: validatedUsage.costMicros },
        },
      });
      if (updatedLedger.count !== 1)
        return { kind: 'conflict', reservation: current } as const;
      const reservation = await transaction.chatRunBudgetReservation.update({
        where: { id_userId: { id: reservationId, userId: ownerId } },
        data: {
          status: 'SETTLED',
          usageInputTokens: validatedUsage.inputTokens,
          usageOutputTokens: validatedUsage.outputTokens,
          usageCostMicros: validatedUsage.costMicros,
          settledAt: new Date(),
        },
      });
      await transaction.chatRunBudgetEvent.create({
        data: {
          userId: ownerId,
          turnId: current.turnId,
          ledgerId: current.ledgerId,
          reservationId,
          stage: current.stage,
          type: 'SETTLED',
          usageInputTokens: validatedUsage.inputTokens,
          usageOutputTokens: validatedUsage.outputTokens,
          usageCostMicros: validatedUsage.costMicros,
        },
      });
      return { kind: 'updated', reservation } as const;
    });
  }

  async settle(
    ownerId: string,
    reservationId: string,
    usage: ChatRunBudgetUsage,
  ): Promise<BudgetTransition> {
    const validatedUsage = chatRunBudgetUsageSchema.parse(usage);
    return this.runSerializable(async (transaction) => {
      const current = await transaction.chatRunBudgetReservation.findUnique({
        where: { id_userId: { id: reservationId, userId: ownerId } },
      });
      if (!current) return { kind: 'not-found' } as const;
      if (current.status === 'SETTLED') {
        return current.usageInputTokens === validatedUsage.inputTokens &&
          current.usageOutputTokens === validatedUsage.outputTokens &&
          current.usageCostMicros === validatedUsage.costMicros
          ? ({ kind: 'updated', reservation: current } as const)
          : ({ kind: 'conflict', reservation: current } as const);
      }
      if (
        current.status !== 'DISPATCHED' ||
        validatedUsage.inputTokens > current.inputTokens ||
        validatedUsage.outputTokens > current.outputTokens ||
        validatedUsage.costMicros > current.costMicros
      ) {
        return { kind: 'conflict', reservation: current } as const;
      }
      const ledger = await transaction.chatRunBudget.findUnique({
        where: { id_userId: { id: current.ledgerId, userId: ownerId } },
      });
      if (!ledger) return { kind: 'not-found' } as const;
      const updatedLedger = await transaction.chatRunBudget.updateMany({
        where: {
          id: current.ledgerId,
          userId: ownerId,
          usedCalls: { lte: ledger.maxCalls - 1 },
          usedInputTokens: {
            lte: ledger.maxInputTokens - validatedUsage.inputTokens,
          },
          usedOutputTokens: {
            lte: ledger.maxOutputTokens - validatedUsage.outputTokens,
          },
          usedCostMicros: {
            lte: ledger.maxCostMicros - validatedUsage.costMicros,
          },
        },
        data: {
          heldCalls: { decrement: 1 },
          heldInputTokens: { decrement: current.inputTokens },
          heldOutputTokens: { decrement: current.outputTokens },
          heldCostMicros: { decrement: current.costMicros },
          usedCalls: { increment: 1 },
          usedInputTokens: { increment: validatedUsage.inputTokens },
          usedOutputTokens: { increment: validatedUsage.outputTokens },
          usedCostMicros: { increment: validatedUsage.costMicros },
        },
      });
      if (updatedLedger.count !== 1)
        return { kind: 'conflict', reservation: current } as const;
      const reservation = await transaction.chatRunBudgetReservation.update({
        where: { id_userId: { id: reservationId, userId: ownerId } },
        data: {
          status: 'SETTLED',
          usageInputTokens: validatedUsage.inputTokens,
          usageOutputTokens: validatedUsage.outputTokens,
          usageCostMicros: validatedUsage.costMicros,
          settledAt: new Date(),
        },
      });
      await transaction.chatRunBudgetEvent.create({
        data: {
          userId: ownerId,
          turnId: current.turnId,
          ledgerId: current.ledgerId,
          reservationId,
          stage: current.stage,
          type: 'SETTLED',
          usageInputTokens: validatedUsage.inputTokens,
          usageOutputTokens: validatedUsage.outputTokens,
          usageCostMicros: validatedUsage.costMicros,
        },
      });
      return { kind: 'updated', reservation } as const;
    });
  }

  async release(
    ownerId: string,
    reservationId: string,
  ): Promise<BudgetTransition> {
    return this.runSerializable(async (transaction) => {
      const current = await transaction.chatRunBudgetReservation.findUnique({
        where: { id_userId: { id: reservationId, userId: ownerId } },
      });
      if (!current) return { kind: 'not-found' } as const;
      if (current.status === 'RELEASED')
        return { kind: 'updated', reservation: current } as const;
      if (current.status !== 'RESERVED')
        return { kind: 'conflict', reservation: current } as const;
      const updatedLedger = await transaction.chatRunBudget.updateMany({
        where: { id: current.ledgerId, userId: ownerId },
        data: {
          heldCalls: { decrement: 1 },
          heldInputTokens: { decrement: current.inputTokens },
          heldOutputTokens: { decrement: current.outputTokens },
          heldCostMicros: { decrement: current.costMicros },
        },
      });
      if (updatedLedger.count !== 1)
        return { kind: 'conflict', reservation: current } as const;
      const reservation = await transaction.chatRunBudgetReservation.update({
        where: { id_userId: { id: reservationId, userId: ownerId } },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      await transaction.chatRunBudgetEvent.create({
        data: {
          userId: ownerId,
          turnId: current.turnId,
          ledgerId: current.ledgerId,
          reservationId,
          stage: current.stage,
          type: 'RELEASED',
        },
      });
      return { kind: 'updated', reservation } as const;
    });
  }

  async cancel(
    ownerId: string,
    ledgerId: string,
  ): Promise<ChatRunBudget | null> {
    return this.runSerializable(async (transaction) => {
      const ledger = await transaction.chatRunBudget.findUnique({
        where: { id_userId: { id: ledgerId, userId: ownerId } },
      });
      if (!ledger) return null;
      if (ledger.cancelledAt) return ledger;

      const now = new Date();
      const releasable = await transaction.chatRunBudgetReservation.findMany({
        where: { ledgerId, userId: ownerId, status: 'RESERVED' },
        select: {
          id: true,
          turnId: true,
          stage: true,
          inputTokens: true,
          outputTokens: true,
          costMicros: true,
        },
      });
      const totals = releasable.reduce(
        (sum, reservation) => ({
          inputTokens: sum.inputTokens + reservation.inputTokens,
          outputTokens: sum.outputTokens + reservation.outputTokens,
          costMicros: sum.costMicros + reservation.costMicros,
          calls: sum.calls + 1,
        }),
        { inputTokens: 0, outputTokens: 0, costMicros: 0, calls: 0 },
      );
      if (releasable.length > 0) {
        await transaction.chatRunBudgetReservation.updateMany({
          where: { ledgerId, userId: ownerId, status: 'RESERVED' },
          data: { status: 'RELEASED', releasedAt: now },
        });
        await transaction.chatRunBudgetEvent.createMany({
          data: releasable.map((reservation) => ({
            userId: ownerId,
            turnId: reservation.turnId,
            ledgerId,
            reservationId: reservation.id,
            stage: reservation.stage,
            type: 'RELEASED' as const,
            createdAt: now,
          })),
        });
      }
      const cancelled = await transaction.chatRunBudget.update({
        where: { id_userId: { id: ledgerId, userId: ownerId } },
        data: {
          cancelledAt: now,
          heldCalls: { decrement: totals.calls },
          heldInputTokens: { decrement: totals.inputTokens },
          heldOutputTokens: { decrement: totals.outputTokens },
          heldCostMicros: { decrement: totals.costMicros },
        },
      });
      await transaction.chatRunBudgetEvent.create({
        data: {
          userId: ownerId,
          turnId: ledger.turnId,
          ledgerId,
          type: 'CANCELLED',
          createdAt: now,
        },
      });
      return cancelled;
    });
  }

  async reconcileTerminal(ownerId: string, turnId: string) {
    return this.runSerializable(async (transaction) => {
      const turn = await transaction.chatTurn.findUnique({
        where: { id_userId: { id: turnId, userId: ownerId } },
        select: { status: true },
      });
      if (!turn) return null;
      if (turn.status === 'QUEUED' || turn.status === 'ACTIVE') {
        throw new Error('Chat run budget turn is not terminal');
      }
      const ledger = await transaction.chatRunBudget.findUnique({
        where: { turnId_userId: { turnId, userId: ownerId } },
      });
      if (!ledger) return null;
      const now = new Date();
      const releasable = await transaction.chatRunBudgetReservation.findMany({
        where: { ledgerId: ledger.id, userId: ownerId, status: 'RESERVED' },
        select: {
          id: true,
          turnId: true,
          stage: true,
          inputTokens: true,
          outputTokens: true,
          costMicros: true,
        },
      });
      if (releasable.length === 0) return ledger;
      const totals = releasable.reduce(
        (sum, reservation) => ({
          calls: sum.calls + 1,
          inputTokens: sum.inputTokens + reservation.inputTokens,
          outputTokens: sum.outputTokens + reservation.outputTokens,
          costMicros: sum.costMicros + reservation.costMicros,
        }),
        { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
      );
      await transaction.chatRunBudgetReservation.updateMany({
        where: { ledgerId: ledger.id, userId: ownerId, status: 'RESERVED' },
        data: { status: 'RELEASED', releasedAt: now },
      });
      await transaction.chatRunBudgetEvent.createMany({
        data: releasable.map((reservation) => ({
          userId: ownerId,
          turnId: reservation.turnId,
          ledgerId: ledger.id,
          reservationId: reservation.id,
          stage: reservation.stage,
          type: 'RELEASED' as const,
          createdAt: now,
        })),
      });
      return transaction.chatRunBudget.update({
        where: { id_userId: { id: ledger.id, userId: ownerId } },
        data: {
          heldCalls: { decrement: totals.calls },
          heldInputTokens: { decrement: totals.inputTokens },
          heldOutputTokens: { decrement: totals.outputTokens },
          heldCostMicros: { decrement: totals.costMicros },
        },
      });
    });
  }

  private async transition(
    ownerId: string,
    reservationId: string,
    status: 'DISPATCHED',
  ): Promise<BudgetTransition> {
    return this.runSerializable(async (transaction) => {
      const current = await transaction.chatRunBudgetReservation.findUnique({
        where: { id_userId: { id: reservationId, userId: ownerId } },
      });
      if (!current) return { kind: 'not-found' } as const;
      // An existing dispatch is not permission to execute the provider again.
      if (current.status !== 'RESERVED')
        return { kind: 'conflict', reservation: current } as const;
      const ledger = await transaction.chatRunBudget.findUnique({
        where: { id_userId: { id: current.ledgerId, userId: ownerId } },
      });
      if (
        !ledger ||
        ledger.cancelledAt ||
        ledger.turnId !== current.turnId ||
        !(await this.isTurnOpen(transaction, ownerId, current.turnId))
      ) {
        return { kind: 'conflict', reservation: current } as const;
      }
      const reservation = await transaction.chatRunBudgetReservation.update({
        where: { id_userId: { id: reservationId, userId: ownerId } },
        data: { status, dispatchedAt: new Date() },
      });
      await transaction.chatRunBudgetEvent.create({
        data: {
          userId: ownerId,
          turnId: current.turnId,
          ledgerId: current.ledgerId,
          reservationId,
          stage: current.stage,
          type: status,
        },
      });
      return { kind: 'updated', reservation } as const;
    });
  }

  private async isTurnOpen(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    turnId: string,
  ) {
    const turn = await transaction.chatTurn.findUnique({
      where: { id_userId: { id: turnId, userId: ownerId } },
      select: { status: true },
    });
    return turn?.status === 'QUEUED' || turn?.status === 'ACTIVE';
  }

  private async runSerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        lastError = error;
        if (attempt === MAX_TRANSACTION_ATTEMPTS || !isRetryable(error))
          throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Chat run budget transaction retry exhausted');
  }
}

function assertSameReservation(
  existing: ChatRunBudgetReservation,
  input: ChatRunBudgetReservationRequest,
) {
  if (
    existing.userId !== input.ownerId ||
    existing.turnId !== input.turnId ||
    existing.ledgerId !== input.ledgerId ||
    existing.stage !== input.stage ||
    existing.inputTokens !== input.inputTokens ||
    existing.outputTokens !== input.outputTokens ||
    existing.costMicros !== input.costMicros
  ) {
    throw new Error('Chat run budget reservation idempotency conflict');
  }
}

function isRetryable(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2002')
  );
}
