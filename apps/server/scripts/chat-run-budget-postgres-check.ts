import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import type { ChatRunBudgetReservationRequest } from '@repo/types';

import { ChatRunBudgetRepository } from '../src/chat-run-budget/chat-run-budget.repository';
import { ChatRunBudgetStageRunner } from '../src/chat-turns/chat-run-budget-stage-runner';
import type { PrismaService } from '../src/database/prisma.service';

const fixtureName = 'chat_budget_test';
const repository = (client: PrismaClient) =>
  new ChatRunBudgetRepository(client as PrismaService);

function docker(args: string[], input?: string) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`isolated database command failed: ${args[0]}`);
  return result.stdout.trim();
}

async function crashChild() {
  const url = new URL(process.env.CHAT_BUDGET_TEST_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, `/${fixtureName}`);
  assert.equal(url.username, fixtureName);
  const client = new PrismaClient({ datasourceUrl: url.toString() });
  const input = JSON.parse(process.argv[3]) as ChatRunBudgetReservationRequest;
  const budget = repository(client);
  await budget.reserve(input);
  if (process.argv[2] === 'crash-after-dispatch') {
    assert.equal(
      (await budget.dispatch(input.ownerId, input.reservationId)).kind,
      'updated',
    );
  }
  // Deliberately leave without disconnect/settle/reconcile after the durable commit.
  process.exit(73);
}

async function checkIsolatedPostgres() {
  assert.equal(
    process.argv[2],
    '--run-isolated',
    'use --run-isolated to run Docker-backed checks',
  );
  const name = `prepmind-budget-check-${randomUUID().slice(0, 8)}`;
  let containerId: string | undefined;
  const clients: PrismaClient[] = [];
  try {
    containerId = docker([
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--label',
      'prepmind.test=chat-budget',
      '--tmpfs',
      '/var/lib/postgresql/data',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      `POSTGRES_USER=${fixtureName}`,
      '--env',
      `POSTGRES_DB=${fixtureName}`,
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      'pgvector/pgvector:pg16',
    ]);
    assert.match(containerId, /^[a-f0-9]{64}$/);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const probe = spawnSync(
        'docker',
        ['exec', containerId, 'pg_isready', '-U', fixtureName],
        {
          stdio: 'ignore',
          timeout: 5_000,
          windowsHide: true,
        },
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await delay(500);
    }
    assert.ok(ready, 'isolated PostgreSQL did not become ready');
    const migrations = resolve(
      __dirname,
      '../../../packages/database/prisma/migrations',
    );
    const migrationNames = readdirSync(migrations, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrationNames) {
      docker(
        [
          'exec',
          '-i',
          containerId,
          'psql',
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          fixtureName,
          '-d',
          fixtureName,
        ],
        readFileSync(resolve(migrations, migration, 'migration.sql'), 'utf8'),
      );
    }
    const ports = JSON.parse(
      docker([
        'inspect',
        '--format',
        '{{json .NetworkSettings.Ports}}',
        containerId,
      ]),
    ) as Record<string, { HostPort: string }[]>;
    const url = `postgresql://${fixtureName}@127.0.0.1:${ports['5432/tcp'][0].HostPort}/${fixtureName}`;
    const connect = () => {
      const client = new PrismaClient({ datasourceUrl: url });
      clients.push(client);
      return client;
    };
    const a = connect();
    const b = connect();
    const first = repository(a);
    const second = repository(b);
    const ownerId = randomUUID();
    await a.user.create({
      data: {
        id: ownerId,
        email: `${ownerId}@example.invalid`,
        passwordHash: 'synthetic-only',
      },
    });
    const conversation = await a.conversation.create({
      data: { userId: ownerId },
    });
    let order = 0;
    async function fixture(maxCalls = 5) {
      const message = await a.chatMessage.create({
        data: {
          userId: ownerId,
          conversationId: conversation.id,
          role: 'USER',
          content: 'synthetic budget fixture',
          order: ++order,
        },
      });
      const turn = await a.chatTurn.create({
        data: {
          userId: ownerId,
          conversationId: conversation.id,
          clientRequestId: randomUUID(),
          inputHash: `sha256:${'0'.repeat(64)}`,
          inputMessageIds: [message.id],
          budgetPolicyVersion: 'chat-v1',
        },
      });
      const ledger = await first.createLedger(ownerId, turn.id, {
        policyVersion: 'chat-v1',
        maxCalls,
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        maxCostMicros: 1000,
      });
      const request: ChatRunBudgetReservationRequest = {
        ownerId,
        turnId: turn.id,
        ledgerId: ledger.id,
        reservationId: randomUUID(),
        stage: 'ROUTER',
        inputTokens: 100,
        outputTokens: 100,
        costMicros: 100,
      };
      return request;
    }
    const cap = await fixture(1);
    const contenders = await Promise.allSettled([
      first.reserve(cap),
      second.reserve({
        ...cap,
        stage: 'FINAL_RESPONSE',
        reservationId: randomUUID(),
      }),
    ]);
    assert.equal(
      contenders.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      contenders.filter((result) => result.status === 'rejected').length,
      1,
    );
    assert.equal((await first.findLedger(ownerId, cap.turnId))?.heldCalls, 1);

    const stageFixture = await fixture(1);
    const scopes = await Promise.all(
      [first, second].map((budget) =>
        new ChatRunBudgetStageRunner(budget).forTurn(
          ownerId,
          stageFixture.turnId,
          'chat-v1',
          1,
        ),
      ),
    );
    const stages = ['ROUTER', 'VERIFIER'] as const;
    const reservation = {
      inputTokens: 100,
      outputTokens: 100,
      costMicros: 100,
    };
    let executions = 0;
    const execute = async () => {
      executions += 1;
      return {
        value: 'synthetic',
        usage: { inputTokens: 80, outputTokens: 70, costMicros: 60 },
      };
    };
    const results = await Promise.allSettled(
      stages.map((stage, index) =>
        scopes[index].run(stage, reservation, execute),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === 'rejected').length,
      1,
    );
    assert.equal(executions, 1);
    const stageLedger = await first.findLedger(ownerId, stageFixture.turnId);
    assert.equal(stageLedger?.usedCalls, 1);
    assert.equal(stageLedger?.heldCalls, 0);
    assert.equal(stageLedger?.usedCostMicros, 60);
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    await assert.rejects(
      scopes[winner].run(stages[winner], reservation, execute),
      /already dispatched/,
    );
    assert.equal(executions, 1);

    const duplicate = await fixture();
    await Promise.all([first.reserve(duplicate), second.reserve(duplicate)]);
    const permits = await Promise.all([
      first.dispatch(ownerId, duplicate.reservationId),
      second.dispatch(ownerId, duplicate.reservationId),
    ]);
    assert.equal(
      permits.filter((result) => result.kind === 'updated').length,
      1,
    );
    assert.equal(
      permits.filter((result) => result.kind === 'conflict').length,
      1,
    );
    assert.equal(
      await a.chatRunBudgetEvent.count({
        where: { reservationId: duplicate.reservationId, type: 'DISPATCHED' },
      }),
      1,
    );
    assert.equal(
      (await second.dispatch('foreign-owner', duplicate.reservationId)).kind,
      'not-found',
    );

    const cancelled = await fixture();
    await first.reserve(cancelled);
    await Promise.all([
      first.cancel(ownerId, cancelled.ledgerId),
      second.dispatch(ownerId, cancelled.reservationId),
    ]);
    assert.equal(
      (await first.dispatch(ownerId, cancelled.reservationId)).kind,
      'conflict',
    );
    await assert.rejects(
      first.reserve({ ...cancelled, reservationId: randomUUID() }),
      /unavailable/,
    );

    const active = await fixture();
    await first.reserve(active);
    await assert.rejects(
      first.reconcileTerminal(ownerId, active.turnId),
      /not terminal/,
    );
    assert.equal(
      (await first.findLedger(ownerId, active.turnId))?.heldCalls,
      1,
    );

    function crash(mode: string, request: ChatRunBudgetReservationRequest) {
      const child = spawnSync(
        process.execPath,
        ['--no-env-file', __filename, mode, JSON.stringify(request)],
        {
          env: { ...process.env, CHAT_BUDGET_TEST_URL: url },
          encoding: 'utf8',
          timeout: 30_000,
          windowsHide: true,
        },
      );
      assert.equal(
        child.status,
        73,
        'child must exit at the requested post-commit boundary',
      );
    }
    async function terminal(request: ChatRunBudgetReservationRequest) {
      await a.chatTurn.update({
        where: { id: request.turnId },
        data: {
          status: 'CANCELLED',
          errorCode: 'CANCELLED_BY_USER',
          finishedAt: new Date(),
        },
      });
    }
    const reservedCrash = await fixture();
    crash('crash-after-reserve', reservedCrash);
    await terminal(reservedCrash);
    const recovered = repository(connect());
    await recovered.reconcileTerminal(ownerId, reservedCrash.turnId);
    await recovered.reconcileTerminal(ownerId, reservedCrash.turnId);
    assert.equal(
      (await recovered.findLedger(ownerId, reservedCrash.turnId))?.heldCalls,
      0,
    );
    assert.equal(
      await a.chatRunBudgetEvent.count({
        where: { reservationId: reservedCrash.reservationId, type: 'RELEASED' },
      }),
      1,
    );
    await assert.rejects(
      recovered.reserve({ ...reservedCrash, reservationId: randomUUID() }),
      /unavailable/,
    );
    assert.equal(
      (await recovered.dispatch(ownerId, reservedCrash.reservationId)).kind,
      'conflict',
    );

    const dispatchedCrash = await fixture();
    crash('crash-after-dispatch', dispatchedCrash);
    await terminal(dispatchedCrash);
    await recovered.reconcileTerminal(ownerId, dispatchedCrash.turnId);
    assert.equal(
      (await recovered.findLedger(ownerId, dispatchedCrash.turnId))?.heldCalls,
      1,
    );
    assert.equal(
      (await recovered.release(ownerId, dispatchedCrash.reservationId)).kind,
      'conflict',
    );
    assert.equal(
      (await recovered.dispatch(ownerId, dispatchedCrash.reservationId)).kind,
      'conflict',
    );
    await recovered.uncertain(ownerId, dispatchedCrash.reservationId);
    const usage = { inputTokens: 80, outputTokens: 70, costMicros: 60 };
    await Promise.all([
      recovered.settleUncertain(ownerId, dispatchedCrash.reservationId, usage),
      second.settleUncertain(ownerId, dispatchedCrash.reservationId, usage),
    ]);
    const settled = await recovered.findLedger(ownerId, dispatchedCrash.turnId);
    assert.equal(settled?.heldCalls, 0);
    assert.equal(settled?.usedCalls, 1);
    assert.equal(settled?.usedCostMicros, 60);
    assert.equal(
      await a.chatRunBudgetEvent.count({
        where: {
          reservationId: dispatchedCrash.reservationId,
          type: 'SETTLED',
        },
      }),
      1,
    );
    console.log(
      JSON.stringify({
        passed: true,
        migrations: migrationNames.length,
        providerCalls: 0,
        checks: [
          'cross-stage-cap',
          'stage-runner-shared-cap',
          'stage-runner-duplicate-no-execute',
          'single-dispatch-winner',
          'owner-isolation',
          'cancel-race',
          'active-turn-guard',
          'reserve-crash-terminal-replay',
          'dispatch-crash-held',
          'recovery-settles-once',
        ],
      }),
    );
  } finally {
    for (const client of clients) await client.$disconnect();
    if (containerId) {
      assert.equal(
        docker([
          'inspect',
          '--format',
          '{{index .Config.Labels "prepmind.test"}}',
          containerId,
        ]),
        'chat-budget',
      );
      docker(['stop', containerId]);
      console.log(
        'isolated container stopped; tmpfs discarded; project containers and volumes untouched',
      );
    }
  }
}

const operation = process.argv[2]?.startsWith('crash-after-')
  ? crashChild
  : checkIsolatedPostgres;
void operation().catch(() => {
  console.error(
    'chat budget isolated PostgreSQL check failed (raw error suppressed)',
  );
  process.exitCode = 1;
});
