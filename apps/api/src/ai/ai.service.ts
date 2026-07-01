import { Injectable } from '@nestjs/common';
import type { ChatAnswerDto } from '../common/dto/contracts';
import { AiRouterService } from './ai-router.service';

@Injectable()
export class AiService {
  constructor(private readonly router: AiRouterService) {}

  /** General AI chat. Routes through AiRouterService (mock-mode short-circuits). */
  async generalChat(userId: string, question: string): Promise<ChatAnswerDto> {
    return this.router.runChat({
      taskType: 'GENERAL_CHAT',
      userId,
      question,
      scope: '一般問答',
    });
  }
}
