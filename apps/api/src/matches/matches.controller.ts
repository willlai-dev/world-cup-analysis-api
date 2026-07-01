import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildPaginationMeta, Paginated } from '../common/dto/api-response.types';
import { ChatQuestionDto } from '../common/dto/chat.dto';
import type {
  AiReportDto,
  ChatAnswerDto,
  MatchPredictionDto,
  MatchSummary,
} from '../common/dto/contracts';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import { PremiumOnlyGuard } from '../common/guards/premium-only.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ListMatchesQueryDto } from './dto/list-matches-query.dto';
import { type MatchDetailDto, MatchesService } from './matches.service';

@ApiTags('matches')
@Controller('matches')
@UseGuards(NonAdminUserGuard)
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  async list(@Query() query: ListMatchesQueryDto): Promise<Paginated<MatchSummary[]>> {
    const { items, total } = await this.matches.list(query);
    return new Paginated(items, buildPaginationMeta(query.page, query.pageSize, total));
  }

  @Get('today')
  today(): Promise<MatchSummary[]> {
    return this.matches.today();
  }

  @Get(':matchId')
  getOne(@Param('matchId') matchId: string): Promise<MatchDetailDto> {
    return this.matches.getById(matchId);
  }

  @Get(':matchId/analysis')
  getAnalysis(@Param('matchId') matchId: string): Promise<AiReportDto | null> {
    return this.matches.getAnalysis(matchId);
  }

  @Get(':matchId/prediction')
  getPrediction(@Param('matchId') matchId: string): Promise<MatchPredictionDto> {
    return this.matches.getPrediction(matchId);
  }

  @Get(':matchId/post-match-report')
  getPostMatch(@Param('matchId') matchId: string): Promise<AiReportDto | null> {
    return this.matches.getPostMatchReport(matchId);
  }

  @Post(':matchId/deep-chat')
  @UseGuards(PremiumOnlyGuard)
  deepChat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: ChatQuestionDto,
  ): Promise<ChatAnswerDto> {
    return this.matches.deepChat(matchId, user.id, dto.question);
  }
}
