import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { buildPaginationMeta, Paginated } from '../common/dto/api-response.types';
import { ChatQuestionDto } from '../common/dto/chat.dto';
import type { AiReportDto, ChatAnswerDto, PlayerSummary } from '../common/dto/contracts';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import { PremiumOnlyGuard } from '../common/guards/premium-only.guard';
import { buildMockChatAnswer } from '../common/utils/ai-mock.util';
import { ListPlayersQueryDto } from './dto/list-players-query.dto';
import { PlayersService } from './players.service';

@ApiTags('players')
@Controller('players')
@UseGuards(NonAdminUserGuard)
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  async list(@Query() query: ListPlayersQueryDto): Promise<Paginated<PlayerSummary[]>> {
    const { items, total } = await this.players.list(query);
    return new Paginated(items, buildPaginationMeta(query.page, query.pageSize, total));
  }

  @Get(':playerId')
  getOne(@Param('playerId') playerId: string): Promise<PlayerSummary> {
    return this.players.getById(playerId);
  }

  @Get(':playerId/rating')
  getRating(@Param('playerId') playerId: string): Promise<AiReportDto | null> {
    return this.players.getReport(playerId, ['PLAYER_RATING', 'PLAYER_HEXAGON_ANALYSIS']);
  }

  @Get(':playerId/analysis')
  getAnalysis(@Param('playerId') playerId: string): Promise<AiReportDto | null> {
    return this.players.getReport(playerId, ['PLAYER_STATUS_SUMMARY', 'PLAYER_HEXAGON_ANALYSIS']);
  }

  @Post(':playerId/deep-chat')
  @UseGuards(PremiumOnlyGuard)
  async deepChat(
    @Param('playerId') playerId: string,
    @Body() dto: ChatQuestionDto,
  ): Promise<ChatAnswerDto> {
    const player = await this.players.getById(playerId);
    return buildMockChatAnswer(dto.question, { scope: `球員：${player.nameEn}` });
  }
}
