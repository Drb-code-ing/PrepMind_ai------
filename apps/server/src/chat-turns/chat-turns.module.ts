import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackgroundJobsModule } from '../background-jobs/background-jobs.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule as AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { ChatRunBudgetModule } from '../chat-run-budget/chat-run-budget.module';
import type { ServerEnv } from '../config/env';
import { shouldRegisterWorkers } from '../jobs/worker-role';
import { OutboxModule } from '../outbox/outbox.module';
import { ChatResponseProcessor } from './chat-response.processor';
import { ChatResponseQueueModule } from './chat-response-queue.module';
import { ChatTurnsController } from './chat-turns.controller';
import { ChatTurnsQueryService } from './chat-turns.query.service';
import {
  CHAT_STREAM_OPTIONS,
  ChatStreamStore,
  type ChatStreamStoreOptions,
} from './chat-stream.store';
import {
  CHAT_RESPONSE_GENERATOR,
  ChatResponseWorkerService,
  DeterministicChatResponseGenerator,
} from './chat-response-worker.service';
import { ChatTurnEnqueueService } from './chat-turn-enqueue.service';
import { ChatTurnsRepository } from './chat-turns.repository';
import { ChatRunBudgetRepository } from '../chat-run-budget/chat-run-budget.repository';
import { ChatRunBudgetStageRunner } from './chat-run-budget-stage-runner';

export function createChatResponseWorkerProviders(
  role: ServerEnv['SERVER_ROLE'],
): Provider[] {
  return shouldRegisterWorkers(role) ? [ChatResponseProcessor] : [];
}

const chatResponseWorkerProviders = createChatResponseWorkerProviders(
  (process.env.SERVER_ROLE ?? 'both') as ServerEnv['SERVER_ROLE'],
);

@Module({
  imports: [
    AppConfigModule,
    ChatRunBudgetModule,
    AuthModule,
    BackgroundJobsModule,
    DatabaseModule,
    OutboxModule,
    ChatResponseQueueModule,
  ],
  controllers: [ChatTurnsController],
  providers: [
    {
      provide: CHAT_STREAM_OPTIONS,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<ServerEnv, true>,
      ): ChatStreamStoreOptions => ({
        prefix: config.get('BULLMQ_PREFIX', { infer: true }),
        maxEvents: config.get('CHAT_STREAM_MAX_EVENTS', { infer: true }),
        maxBytes: config.get('CHAT_STREAM_MAX_BYTES', { infer: true }),
        ttlSeconds: config.get('CHAT_STREAM_TTL_SECONDS', { infer: true }),
        operationTimeoutMs: config.get('CHAT_STREAM_OPERATION_TIMEOUT_MS', {
          infer: true,
        }),
      }),
    },
    ChatStreamStore,
    ChatTurnsRepository,
    ChatTurnEnqueueService,
    ChatTurnsQueryService,
    ChatResponseWorkerService,
    ChatRunBudgetStageRunner,
    DeterministicChatResponseGenerator,
    {
      provide: CHAT_RESPONSE_GENERATOR,
      useExisting: DeterministicChatResponseGenerator,
    },
    ...chatResponseWorkerProviders,
  ],
  exports: [
    ChatTurnsRepository,
    ChatTurnEnqueueService,
    ChatRunBudgetRepository,
  ],
})
export class ChatTurnsModule {}
