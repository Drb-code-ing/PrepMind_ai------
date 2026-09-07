import { MODULE_METADATA } from '@nestjs/common/constants';
import { ChatResponseProcessor } from './chat-response.processor';
import {
  ChatTurnsModule,
  createChatResponseWorkerProviders,
} from './chat-turns.module';
import { ChatRunBudgetStageRunner } from './chat-run-budget-stage-runner';
import {
  CHAT_RESPONSE_GENERATOR,
  DeterministicChatResponseGenerator,
} from './chat-response-worker.service';

describe('ChatTurnsModule worker registration', () => {
  it('injects the shared stage runner without changing the deterministic generator', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      ChatTurnsModule,
    ) as unknown[];
    expect(providers).toContain(ChatRunBudgetStageRunner);
    expect(providers).toContainEqual({
      provide: CHAT_RESPONSE_GENERATOR,
      useExisting: DeterministicChatResponseGenerator,
    });
  });
  it.each([
    ['api', false],
    ['worker', true],
    ['both', true],
  ] as const)(
    'registers the response processor for %s=%s',
    (role, expected) => {
      const providers = createChatResponseWorkerProviders(role);

      expect(providers.includes(ChatResponseProcessor)).toBe(expected);
    },
  );
});
