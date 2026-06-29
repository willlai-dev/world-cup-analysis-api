import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatQuestionDto } from '../common/dto/chat.dto';
import type { ChampionPredictionResponse, ChatAnswerDto } from '../common/dto/contracts';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import { PremiumOnlyGuard } from '../common/guards/premium-only.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { buildMockChatAnswer } from '../common/utils/ai-mock.util';
import { ChampionPredictionService } from './champion-prediction.service';

@ApiTags('champion-predictions')
@Controller('champion-predictions')
@UseGuards(NonAdminUserGuard)
export class ChampionPredictionController {
  constructor(private readonly champion: ChampionPredictionService) {}

  @Get()
  getAll(): Promise<ChampionPredictionResponse | null> {
    return this.champion.getLatest();
  }

  @Get('latest')
  getLatest(): Promise<ChampionPredictionResponse | null> {
    return this.champion.getLatest();
  }

  @Post('recalculate')
  @HttpCode(200)
  @UseGuards(PremiumOnlyGuard)
  recalculate(@CurrentUser() user: AuthenticatedUser): Promise<ChampionPredictionResponse> {
    return this.champion.recalculate(user.id);
  }

  @Post('deep-chat')
  @UseGuards(PremiumOnlyGuard)
  deepChat(@Body() dto: ChatQuestionDto): ChatAnswerDto {
    return buildMockChatAnswer(dto.question, { scope: '冠軍預測' });
  }
}
