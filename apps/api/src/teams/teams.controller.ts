import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildPaginationMeta, Paginated } from '../common/dto/api-response.types';
import { ChatQuestionDto } from '../common/dto/chat.dto';
import type {
  AiReportDto,
  ChatAnswerDto,
  MatchSummary,
  PlayerSummary,
  TeamSummary,
} from '../common/dto/contracts';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import { PremiumOnlyGuard } from '../common/guards/premium-only.guard';
import { buildMockChatAnswer } from '../common/utils/ai-mock.util';
import { ListTeamsQueryDto } from './dto/list-teams-query.dto';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@Controller('teams')
@UseGuards(NonAdminUserGuard)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  async list(@Query() query: ListTeamsQueryDto): Promise<Paginated<TeamSummary[]>> {
    const { items, total } = await this.teams.list(query);
    return new Paginated(items, buildPaginationMeta(query.page, query.pageSize, total));
  }

  @Get(':teamId')
  getOne(@Param('teamId') teamId: string): Promise<TeamSummary> {
    return this.teams.getById(teamId);
  }

  @Get(':teamId/players')
  getPlayers(@Param('teamId') teamId: string): Promise<PlayerSummary[]> {
    return this.teams.getPlayers(teamId);
  }

  @Get(':teamId/matches')
  getMatches(@Param('teamId') teamId: string): Promise<MatchSummary[]> {
    return this.teams.getMatches(teamId);
  }

  @Get(':teamId/analysis')
  getAnalysis(@Param('teamId') teamId: string): Promise<AiReportDto | null> {
    return this.teams.getAnalysis(teamId);
  }

  @Post(':teamId/deep-chat')
  @UseGuards(PremiumOnlyGuard)
  async deepChat(
    @Param('teamId') teamId: string,
    @Body() dto: ChatQuestionDto,
  ): Promise<ChatAnswerDto> {
    const team = await this.teams.getById(teamId);
    return buildMockChatAnswer(dto.question, { scope: `國家隊：${team.nameEn}` });
  }
}
