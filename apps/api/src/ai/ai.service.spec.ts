import type { ChatTurn } from '../common/dto/contracts';
import type { AppConfigService } from '../config/app-config.service';
import type { AiRouterService } from './ai-router.service';
import { AiService } from './ai.service';
import type { GeneralChatContextService } from './general-chat/general-chat-context.service';

function build(aiMockMode: boolean) {
  const router = {
    runChat: jest.fn().mockResolvedValue({
      answer: 'ok',
      provider: 'NVIDIA',
      model: 'm',
      sourceUpdatedAt: null,
    }),
  };
  const config = { aiMockMode } as unknown as AppConfigService;
  const context = {
    build: jest.fn().mockResolvedValue({
      scope: '一般問答（冠軍預測）',
      context: { championPrediction: { entries: [] } },
      sourceUpdatedAt: '2026-07-02T10:00:00.000Z',
    }),
  };
  const service = new AiService(
    router as unknown as AiRouterService,
    config,
    context as unknown as GeneralChatContextService,
  );
  return { service, router, context };
}

describe('AiService.generalChat', () => {
  it('mock mode: keeps the fixed 一般問答 scope, builds no context, ignores history', async () => {
    const { service, router, context } = build(true);

    await service.generalChat('u1', '目前冠軍預測前三名是誰？', [
      { role: 'user', content: 'prev' },
    ]);

    expect(context.build).not.toHaveBeenCalled();
    expect(router.runChat).toHaveBeenCalledTimes(1);
    const arg = router.runChat.mock.calls[0][0];
    expect(arg).toMatchObject({ taskType: 'GENERAL_CHAT', userId: 'u1', scope: '一般問答' });
    expect(arg.context).toBeUndefined();
    expect(arg.history).toBeUndefined();
  });

  it('real mode (no history): builds DB context and passes it to the router', async () => {
    const { service, router, context } = build(false);

    await service.generalChat('u1', '目前冠軍預測前三名是誰？');

    expect(context.build).toHaveBeenCalledWith('目前冠軍預測前三名是誰？', '');
    const arg = router.runChat.mock.calls[0][0];
    expect(arg).toMatchObject({
      taskType: 'GENERAL_CHAT',
      userId: 'u1',
      scope: '一般問答（冠軍預測）',
      sourceUpdatedAt: '2026-07-02T10:00:00.000Z',
    });
    expect(arg.context).toEqual({ championPrediction: { entries: [] } });
    expect(arg.history).toEqual([]);
  });

  it('real mode: forwards trimmed history and uses prior user turns for context matching', async () => {
    const { service, router, context } = build(false);
    // 4 Q&A pairs (8 turns) — only the last 3 pairs (6 turns) should survive.
    const history: ChatTurn[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'u4' },
      { role: 'assistant', content: 'a4' },
    ];

    await service.generalChat('u1', '他狀態如何？', history);

    // priorText = user turns within the last 6 (u2, u3, u4)
    expect(context.build).toHaveBeenCalledWith('他狀態如何？', 'u2 u3 u4');
    const arg = router.runChat.mock.calls[0][0];
    expect(arg.history).toHaveLength(6);
    expect(arg.history[0]).toEqual({ role: 'user', content: 'u2' });
    expect(arg.history[5]).toEqual({ role: 'assistant', content: 'a4' });
  });
});
