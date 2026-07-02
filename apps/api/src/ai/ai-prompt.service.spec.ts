import type { ChatTurn } from '../common/dto/contracts';
import { AiPromptService } from './ai-prompt.service';

describe('AiPromptService history assembly', () => {
  const prompt = new AiPromptService();

  it('no history: emits [system, user] with the bare question (unchanged behavior)', () => {
    const msgs = prompt.build({ taskType: 'GENERAL_CHAT', userPrompt: '誰是奪冠熱門？' });

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: '誰是奪冠熱門？' });
  });

  it('with history: [system(+note), ...turns, {user: 【本次提問】…}]', () => {
    const history: ChatTurn[] = [
      { role: 'user', content: 'Mbappé 是誰？' },
      { role: 'assistant', content: '他是法國前鋒。' },
    ];

    const msgs = prompt.build({
      taskType: 'GENERAL_CHAT',
      userPrompt: '他狀態如何？',
      history,
    });

    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('【本次提問】');
    expect(msgs[1]).toEqual({ role: 'user', content: 'Mbappé 是誰？' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: '他是法國前鋒。' });
    expect(msgs[3]).toEqual({ role: 'user', content: '【本次提問】\n他狀態如何？' });
  });

  it('filters out empty/invalid turns', () => {
    const history = [
      { role: 'user', content: '   ' },
      { role: 'system', content: 'nope' },
      { role: 'user', content: '真的問題' },
    ] as unknown as ChatTurn[];

    const msgs = prompt.build({ taskType: 'GENERAL_CHAT', userPrompt: 'q', history });

    // only the one valid prior turn survives → system + 1 turn + current
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({ role: 'user', content: '真的問題' });
  });
});
