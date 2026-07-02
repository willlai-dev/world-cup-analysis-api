import { Injectable } from '@nestjs/common';
import type { ChatAnswerDto, ChatTurn } from '../common/dto/contracts';
import { AppConfigService } from '../config/app-config.service';
import { AiRouterService } from './ai-router.service';
import { GeneralChatContextService } from './general-chat/general-chat-context.service';

/** Keep only the last 3 Q&A pairs (6 turns) of client-supplied history. */
const MAX_HISTORY_TURNS = 6;

@Injectable()
export class AiService {
  constructor(
    private readonly router: AiRouterService,
    private readonly config: AppConfigService,
    private readonly context: GeneralChatContextService,
  ) {}

  /**
   * General AI chat. Mock mode keeps the deterministic PROGRAM_RULE answer with
   * zero DB/AI work (history ignored). Real mode builds a grounded DB context
   * from the question — using recent user turns to resolve references like
   * 「他/這隊」 — and forwards the trimmed history so the model can follow the
   * conversation, with the current question flagged as 【本次提問】
   * (spec §"接入現有 AiService").
   */
  async generalChat(
    userId: string,
    question: string,
    history?: ChatTurn[],
  ): Promise<ChatAnswerDto> {
    if (this.config.aiMockMode) {
      return this.router.runChat({
        taskType: 'GENERAL_CHAT',
        userId,
        question,
        scope: '一般問答',
      });
    }

    const turns = (history ?? []).slice(-MAX_HISTORY_TURNS);
    const priorUserText = turns
      .filter((t) => t.role === 'user')
      .map((t) => t.content)
      .join(' ');

    const built = await this.context.build(question, priorUserText);
    return this.router.runChat({
      taskType: 'GENERAL_CHAT',
      userId,
      question,
      scope: built.scope,
      context: built.context,
      sourceUpdatedAt: built.sourceUpdatedAt,
      history: turns,
    });
  }
}
