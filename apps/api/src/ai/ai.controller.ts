import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatQuestionDto } from '../common/dto/chat.dto';
import type { ChatAnswerDto } from '../common/dto/contracts';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AiService } from './ai.service';

@ApiTags('ai')
@Controller('ai')
@UseGuards(NonAdminUserGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('chat')
  chat(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChatQuestionDto,
  ): Promise<ChatAnswerDto> {
    return this.ai.generalChat(user.id, dto.question, dto.history);
  }
}
