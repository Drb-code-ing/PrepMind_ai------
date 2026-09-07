import {
  ChatRouterStageService,
  createChatRouterStageRuntime,
} from './chat-router-stage';

describe('ChatRouterStageService', () => {
  it('keeps the default runtime deterministic and does not reserve a budget', async () => {
    const forTurn = jest.fn();
    const service = new ChatRouterStageService(
      { forTurn } as never,
      createChatRouterStageRuntime({
        AI_PROVIDER_MODE: 'mock',
        AI_ENABLE_LIVE_CALLS: false,
        ROUTER_MODEL_ENABLED: false,
      }),
    );

    const result = await service.run({
      ownerId: 'user-1',
      turnId: 'turn-1',
      policyVersion: 'v1',
      attempt: 1,
      text: '这道题怎么做？',
    });

    expect(result.route.name).toBe('tutor');
    expect(result.observation.attempted).toBe(false);
    expect(forTurn).not.toHaveBeenCalled();
  });

  it('only enables live runtime when all server gates and a credential are present', () => {
    expect(
      createChatRouterStageRuntime({
        AI_PROVIDER_MODE: 'live',
        AI_ENABLE_LIVE_CALLS: true,
        ROUTER_MODEL_ENABLED: true,
        DEEPSEEK_API_KEY: 'synthetic-key',
        AI_BASE_URL: 'https://api.deepseek.com/v1',
        AI_MODEL: 'deepseek-v4-pro',
      }).enabled,
    ).toBe(true);

    expect(
      createChatRouterStageRuntime({
        AI_PROVIDER_MODE: 'live',
        AI_ENABLE_LIVE_CALLS: true,
        ROUTER_MODEL_ENABLED: true,
      }).enabled,
    ).toBe(false);
  });

  it('does not accidentally construct a live runtime in the safe default', () => {
    const runtime = createChatRouterStageRuntime({});
    expect(runtime.enabled).toBe(false);
    expect(runtime.runtime).toBeDefined();
  });
});
