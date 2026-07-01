import { Injectable } from '@nestjs/common';
import type { ChatAnswerDto } from '../common/dto/contracts';
import { AppConfigService } from '../config/app-config.service';
import { AiRouterService } from './ai-router.service';
import { GeneralChatContextService } from './general-chat/general-chat-context.service';

@Injectable()
export class AiService {
  constructor(
    private readonly router: AiRouterService,
    private readonly config: AppConfigService,
    private readonly context: GeneralChatContextService,
  ) {}

  /**
   * General AI chat. Mock mode keeps the deterministic PROGRAM_RULE answer with
   * zero DB/AI work. Real mode first builds a grounded DB context from the
   * question (intent → entity match → per-category query) and hands it to the
   * router, so answers stay grounded in the database (spec §"接入現有 AiService").
   */
  async generalChat(userId: string, question: string): Promise<ChatAnswerDto> {
    if (this.config.aiMockMode) {
      return this.router.runChat({
        taskType: 'GENERAL_CHAT',
        userId,
        question,
        scope: '一般問答',
      });
    }

    const built = await this.context.build(question);
    return this.router.runChat({
      taskType: 'GENERAL_CHAT',
      userId,
      question,
      scope: built.scope,
      context: built.context,
      sourceUpdatedAt: built.sourceUpdatedAt,
    });
  }
}
