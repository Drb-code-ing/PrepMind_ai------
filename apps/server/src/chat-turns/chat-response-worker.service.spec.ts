/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */

import type { BackgroundJob, ChatMessage, ChatTurn } from '@prisma/client';
import type { Job } from 'bullmq';

import {
  CHAT_RESPONSE_COMPLETED_EVENT,
  CHAT_RESPONSE_FAILED_EVENT,
  CHAT_RESPONSE_JOB,
  CHAT_RESPONSE_QUEUE,
  CHAT_RESPONSE_RESOURCE_TYPE,
} from './chat-turn.constants';
import {
  ChatResponseWorkerError,
  ChatResponseWorkerService,
  type ChatResponseGenerator,
  type ChatResponseGeneratorResult,
} from './chat-response-worker.service';
import type { ChatStreamStore } from './chat-stream.store';

describe('ChatResponseWorkerService', () => {
  const payload = {
    turnId: 'turn_1',
    backgroundJobId: 'job_1',
    inputHash: `sha256:${'a'.repeat(64)}`,
    budgetPolicyVersion: 'chat-budget-v1',
  } as const;

  it('claims, generates, and atomically records the assistant response', async () => {
    const harness = createHarness();

    await harness.service.process(createJob());

    expect(harness.state.turn.status).toBe('SUCCEEDED');
    expect(harness.state.turn.responseMessageId).toMatch(/^chat-response-/);
    expect(harness.state.backgroundJob.status).toBe('SUCCEEDED');
    expect(harness.state.messages.at(-1)?.role).toBe('ASSISTANT');
    expect(harness.state.messages.at(-1)?.content).toBe('generated answer');
    expect(harness.state.outbox.at(-1)).toMatchObject({
      create: expect.objectContaining({
        type: CHAT_RESPONSE_COMPLETED_EVENT,
        aggregateId: payload.turnId,
      }),
    });
    expect(harness.generator.generate).toHaveBeenCalledTimes(1);
  });

  it('reserves and settles the Worker stage when a durable budget is available', async () => {
    const budget = createBudgetMock();
    const harness = createHarness(undefined, undefined, budget);

    await harness.service.process(createJob());

    expect(budget.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: payload.turnId, stage: 'WORKER' }),
    );
    expect(budget.dispatch).toHaveBeenCalledTimes(1);
    expect(budget.settle).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ costMicros: 0 }),
    );
    expect(budget.uncertain).not.toHaveBeenCalled();
  });

  it('publishes ordered non-terminal events and only then publishes the terminal event', async () => {
    const stream = createStreamMock();
    const harness = createHarness(undefined, stream);

    await harness.service.process(createJob());

    expect(stream.append).toHaveBeenCalledTimes(3);
    expect(stream.append.mock.calls.map((call) => call[2]?.type)).toEqual([
      'response_started',
      'text_delta',
      'response_completed',
    ]);
    expect(stream.append.mock.invocationCallOrder[2]).toBeGreaterThan(
      harness.transaction.outboxEvent.upsert.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('publishes a failed terminal event after the durable failure transaction', async () => {
    const error = new ChatResponseWorkerError('OUTPUT_INVALID', false, 'bad');
    const stream = createStreamMock();
    const harness = createHarness(error, stream);

    await harness.service.process(createJob(2));

    expect(stream.append.mock.calls.map((call) => call[2]?.type)).toEqual([
      'response_started',
      'response_failed',
    ]);
    expect(stream.append.mock.invocationCallOrder[1]).toBeGreaterThan(
      harness.transaction.outboxEvent.upsert.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not call the generator again after a terminal success', async () => {
    const budget = createBudgetMock();
    const harness = createHarness(undefined, undefined, budget);
    harness.state.turn = {
      ...harness.state.turn,
      status: 'SUCCEEDED',
      responseMessageId: 'existing-response',
      startedAt: new Date('2026-08-28T00:00:01.000Z'),
      finishedAt: new Date('2026-08-28T00:00:02.000Z'),
    } as ChatTurn;
    harness.state.backgroundJob = {
      ...harness.state.backgroundJob,
      status: 'SUCCEEDED',
    } as BackgroundJob;

    await harness.service.process(createJob());

    expect(harness.generator.generate).not.toHaveBeenCalled();
    expect(harness.job.discard).not.toHaveBeenCalled();
    expect(budget.reconcileTerminal).toHaveBeenCalledWith(
      'user_1',
      payload.turnId,
    );
  });

  it('recovers a post-commit reconciliation failure without publishing a false failure', async () => {
    const budget = createBudgetMock();
    const stream = createStreamMock();
    const harness = createHarness(undefined, stream, budget);
    const error = new Error('budget temporarily unavailable');
    budget.reconcileTerminal.mockRejectedValueOnce(error);

    await expect(harness.service.process(createJob())).rejects.toBe(error);
    expect(harness.state.turn.status).toBe('SUCCEEDED');
    expect(harness.state.backgroundJob.status).toBe('SUCCEEDED');
    expect(stream.append.mock.calls.map((call) => call[2]?.type)).not.toContain(
      'response_failed',
    );
    expect(budget.uncertain).not.toHaveBeenCalled();
    await harness.service.process(createJob(1));
    expect(budget.reconcileTerminal).toHaveBeenCalledTimes(2);
    expect(harness.generator.generate).toHaveBeenCalledTimes(1);
  });

  it('does not fail the winning job when a duplicate delivery loses the dispatch permit', async () => {
    const budget = createBudgetMock();
    const harness = createHarness(undefined, undefined, budget);
    const started = deferred<void>();
    const finish = deferred<ChatResponseGeneratorResult>();
    harness.generator.generate.mockImplementationOnce(() => {
      started.resolve();
      return finish.promise;
    });
    budget.dispatch
      .mockResolvedValueOnce({ kind: 'updated' })
      .mockResolvedValue({
        kind: 'conflict',
        reservation: { status: 'DISPATCHED' },
      });
    const winning = harness.service.process(createJob());
    try {
      await started.promise;
      await expect(harness.service.process(createJob())).rejects.toThrow(
        'already dispatched',
      );
      expect(harness.state.turn.status).toBe('ACTIVE');
      expect(harness.state.backgroundJob.status).toBe('ACTIVE');
      expect(harness.generator.generate).toHaveBeenCalledTimes(1);
      expect(budget.release).not.toHaveBeenCalled();
    } finally {
      finish.resolve({
        content: 'generated answer',
        generator: 'test-generator',
      });
      await winning;
    }
    expect(harness.state.turn.status).toBe('SUCCEEDED');
  });

  it('publishes the durable winner when another attempt fails after completion', async () => {
    const stream = createStreamMock();
    const harness = createHarness(undefined, stream);
    harness.generator.generate.mockImplementationOnce(async () => {
      harness.state.turn = {
        ...harness.state.turn,
        status: 'SUCCEEDED',
        responseMessageId: 'winner-response',
        finishedAt: new Date('2026-08-28T00:00:04.000Z'),
      };
      harness.state.backgroundJob = {
        ...harness.state.backgroundJob,
        status: 'SUCCEEDED',
      };
      throw new ChatResponseWorkerError(
        'OUTPUT_INVALID',
        false,
        'losing attempt failed',
      );
    });
    await harness.service.process(createJob(2));
    const events = stream.append.mock.calls.map((call) => call[2]?.type);
    expect(events).toContain('response_completed');
    expect(events).not.toContain('response_failed');
  });

  it('returns a retryable generation failure to Bull while re-queuing the job', async () => {
    const error = new ChatResponseWorkerError(
      'PROVIDER_FAILURE',
      true,
      'provider unavailable',
    );
    const harness = createHarness(error);

    await expect(harness.service.process(createJob())).rejects.toBe(error);

    expect(harness.state.turn.status).toBe('ACTIVE');
    expect(harness.state.backgroundJob.status).toBe('QUEUED');
    expect(harness.state.backgroundJob.attempt).toBe(1);
    expect(harness.state.backgroundJob.errorCode).toBe('PROVIDER_FAILURE');
    expect(harness.state.outbox).toHaveLength(0);
  });

  it('finishes a non-retryable failure and emits one failed event', async () => {
    const error = new ChatResponseWorkerError(
      'OUTPUT_INVALID',
      false,
      'invalid output',
    );
    const harness = createHarness(error);
    const job = createJob(2);

    await harness.service.process(job);

    expect(harness.state.turn.status).toBe('FAILED');
    expect(harness.state.turn.errorCode).toBe('OUTPUT_INVALID');
    expect(harness.state.backgroundJob.status).toBe('FAILED');
    expect(harness.state.outbox.at(-1)).toMatchObject({
      create: expect.objectContaining({ type: CHAT_RESPONSE_FAILED_EVENT }),
    });
    expect(job.discard).toHaveBeenCalledTimes(1);
  });

  it('discards malformed Bull payloads before opening a database transaction', async () => {
    const harness = createHarness();
    const job = createJob();
    (job as unknown as { data: unknown }).data = {
      ...payload,
      prompt: 'must not be accepted',
    };

    await expect(harness.service.process(job)).rejects.toMatchObject({
      code: 'INTERNAL_FAILURE',
    });
    expect(job.discard).toHaveBeenCalledTimes(1);
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a Bull job bound to a different database owner or route', async () => {
    const harness = createHarness();
    harness.state.backgroundJob = {
      ...harness.state.backgroundJob,
      queueName: 'other-queue',
    } as BackgroundJob;

    await expect(harness.service.process(createJob())).rejects.toMatchObject({
      code: 'INTERNAL_FAILURE',
    });
    expect(harness.generator.generate).not.toHaveBeenCalled();
  });

  it('rejects a Bull job whose id is not the durable BackgroundJob id', async () => {
    const harness = createHarness();
    const job = createJob();
    (job as unknown as { id: string }).id = 'forged-bull-job';

    await expect(harness.service.process(job)).rejects.toMatchObject({
      code: 'INTERNAL_FAILURE',
    });
    expect(harness.generator.generate).not.toHaveBeenCalled();
  });

  it('fails closed when the BackgroundJob claim is won by another Bull job', async () => {
    const harness = createHarness();
    let backgroundFindCalls = 0;
    harness.transaction.backgroundJob.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    harness.transaction.backgroundJob.findUnique.mockImplementation(
      async () => {
        backgroundFindCalls += 1;
        return backgroundFindCalls === 2
          ? ({
              ...harness.state.backgroundJob,
              status: 'ACTIVE',
              bullJobId: 'other-bull-job',
            } as BackgroundJob)
          : harness.state.backgroundJob;
      },
    );

    await expect(harness.service.process(createJob())).rejects.toMatchObject({
      code: 'INTERNAL_FAILURE',
    });
    expect(harness.generator.generate).not.toHaveBeenCalled();
  });

  it('reconciles a cancelled turn before generation when its job is still queued', async () => {
    const harness = createHarness();
    harness.state.turn = {
      ...harness.state.turn,
      status: 'CANCELLED',
      errorCode: 'CANCELLED_BY_USER',
      finishedAt: new Date('2026-08-28T00:00:02.000Z'),
    } as ChatTurn;

    await harness.service.process(createJob());

    expect(harness.generator.generate).not.toHaveBeenCalled();
    expect(harness.state.backgroundJob.status).toBe('CANCELLED');
    expect(harness.state.backgroundJob.errorCode).toBe('CANCELLED_BY_USER');
  });

  it('does not silently accept a lost BackgroundJob completion CAS', async () => {
    const harness = createHarness();
    let updateCalls = 0;
    let backgroundFindCalls = 0;
    harness.transaction.backgroundJob.updateMany.mockImplementation(
      async ({ data }: { data: Partial<BackgroundJob> }) => {
        updateCalls += 1;
        if (updateCalls === 2) return { count: 0 };
        harness.state.backgroundJob = {
          ...harness.state.backgroundJob,
          ...data,
        } as BackgroundJob;
        return { count: 1 };
      },
    );
    harness.transaction.backgroundJob.findUnique.mockImplementation(
      async () => {
        backgroundFindCalls += 1;
        return backgroundFindCalls >= 4
          ? ({
              ...harness.state.backgroundJob,
              status: 'FAILED',
              errorCode: 'OUTPUT_INVALID',
            } as BackgroundJob)
          : harness.state.backgroundJob;
      },
    );

    await expect(harness.service.process(createJob())).rejects.toMatchObject({
      code: 'INTERNAL_FAILURE',
    });
  });

  function createHarness(
    generatorError?: Error,
    stream?: ReturnType<typeof createStreamMock>,
    budget?: ReturnType<typeof createBudgetMock>,
  ) {
    const state = {
      turn: makeTurn(),
      backgroundJob: makeBackgroundJob(),
      messages: [makeUserMessage()],
      outbox: [] as unknown[],
    };
    const generator: jest.Mocked<ChatResponseGenerator> = {
      generate: jest.fn<
        Promise<ChatResponseGeneratorResult>,
        Parameters<ChatResponseGenerator['generate']>
      >(),
    };
    if (generatorError) generator.generate.mockRejectedValue(generatorError);
    else {
      generator.generate.mockResolvedValue({
        content: 'generated answer',
        generator: 'test-generator',
      });
    }

    const db = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ now: new Date('2026-08-28T00:00:03.000Z') }]),
      chatTurn: {
        findUnique: jest.fn(async () => state.turn),
        updateMany: jest.fn(async ({ data }: { data: Partial<ChatTurn> }) => {
          state.turn = { ...state.turn, ...data } as ChatTurn;
          return { count: 1 };
        }),
      },
      backgroundJob: {
        findUnique: jest.fn(async () => state.backgroundJob),
        updateMany: jest.fn(
          async ({ data }: { data: Partial<BackgroundJob> }) => {
            state.backgroundJob = {
              ...state.backgroundJob,
              ...data,
            } as BackgroundJob;
            return { count: 1 };
          },
        ),
      },
      chatMessage: {
        findMany: jest.fn(async () => state.messages),
        findFirst: jest.fn(async () => state.messages.at(-1) ?? null),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Partial<ChatMessage> }) => {
          const message = {
            ...makeAssistantMessage(),
            ...data,
          } as ChatMessage;
          state.messages.push(message);
          return message;
        }),
      },
      outboxEvent: {
        upsert: jest.fn(async (input: unknown) => {
          state.outbox.push(input);
          return input;
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async <T>(operation: (tx: typeof db) => Promise<T>) => operation(db),
      ),
      chatMessage: db.chatMessage,
    };
    const service = new ChatResponseWorkerService(
      prisma as never,
      generator,
      stream as never,
      budget as never,
    );
    return {
      service,
      generator,
      state,
      prisma,
      transaction: db,
      job: createJob(),
    };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  function createBudgetMock() {
    return {
      findLedger: jest.fn().mockResolvedValue({
        id: 'ledger_1',
        maxInputTokens: 10_000,
        maxOutputTokens: 2_800,
        maxCostMicros: 100_000,
      }),
      reserve: jest.fn().mockResolvedValue({ id: 'reservation_1' }),
      dispatch: jest.fn().mockResolvedValue({ kind: 'updated' }),
      settle: jest.fn().mockResolvedValue({ kind: 'updated' }),
      uncertain: jest.fn().mockResolvedValue({ kind: 'updated' }),
      release: jest.fn().mockResolvedValue({ kind: 'updated' }),
      reconcileTerminal: jest.fn().mockResolvedValue(null),
    };
  }

  function createStreamMock() {
    return {
      append: jest
        .fn<
          ReturnType<ChatStreamStore['append']>,
          Parameters<ChatStreamStore['append']>
        >()
        .mockResolvedValue({ disposition: 'appended', cursor: '1-0' }),
    };
  }

  function createJob(attemptsMade = 0) {
    return {
      id: payload.backgroundJobId,
      data: payload,
      attemptsMade,
      opts: { attempts: 3 },
      discard: jest.fn(),
    } as unknown as Job<unknown>;
  }

  function makeTurn() {
    return {
      id: payload.turnId,
      userId: 'user_1',
      conversationId: 'conversation_1',
      clientRequestId: 'request_1',
      status: 'QUEUED',
      inputHash: payload.inputHash,
      inputMessageIds: ['message_1'],
      budgetPolicyVersion: payload.budgetPolicyVersion,
      responseMessageId: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
      updatedAt: new Date('2026-08-28T00:00:00.000Z'),
    } as unknown as ChatTurn;
  }

  function makeBackgroundJob() {
    return {
      id: payload.backgroundJobId,
      userId: 'user_1',
      scope: 'ACCOUNT',
      queueName: CHAT_RESPONSE_QUEUE,
      jobName: CHAT_RESPONSE_JOB,
      bullJobId: payload.backgroundJobId,
      status: 'QUEUED',
      resourceType: CHAT_RESPONSE_RESOURCE_TYPE,
      resourceId: payload.turnId,
      maxAttempts: 3,
      attempt: 0,
      progress: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    } as unknown as BackgroundJob;
  }

  function makeUserMessage() {
    return {
      id: 'message_1',
      userId: 'user_1',
      conversationId: 'conversation_1',
      role: 'USER',
      content: 'What is a vector?',
      order: 1,
    } as unknown as ChatMessage;
  }

  function makeAssistantMessage() {
    return {
      id: 'placeholder',
      userId: 'user_1',
      conversationId: 'conversation_1',
      role: 'ASSISTANT',
      content: '',
      order: 2,
    } as unknown as ChatMessage;
  }
});
