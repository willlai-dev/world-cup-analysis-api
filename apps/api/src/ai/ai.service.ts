import { Injectable } from '@nestjs/common';
import { AiEntityType, AiProvider, AiReportStatus } from '@prisma/client';
import type { ChatAnswerDto } from '../common/dto/contracts';
import { buildMockChatAnswer } from '../common/utils/ai-mock.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  /** Phase 1 mock general chat. Logs usage; real routing/providers come in Phase 2. */
  async generalChat(userId: string, question: string): Promise<ChatAnswerDto> {
    const answer = buildMockChatAnswer(question, { scope: '一般問答' });
    await this.prisma.aiUsageLog.create({
      data: {
        userId,
        provider: AiProvider.PROGRAM_RULE,
        model: 'mock',
        taskType: 'GENERAL_CHAT',
        entityType: AiEntityType.GENERAL_CHAT,
        requestStatus: AiReportStatus.DONE,
        latencyMs: 0,
      },
    });
    return answer;
  }
}
