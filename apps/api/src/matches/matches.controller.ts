import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import {
  buildPaginationMeta,
  Paginated,
} from "../common/dto/api-response.types";
import { ChatQuestionDto } from "../common/dto/chat.dto";
import type {
  AiReportDto,
  ChatAnswerDto,
  MatchPredictionDto,
  MatchSummary,
} from "../common/dto/contracts";
import { NonAdminUserGuard } from "../common/guards/non-admin-user.guard";
import { PremiumOnlyGuard } from "../common/guards/premium-only.guard";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { AiQuota } from "../ai/quota/ai-quota.decorator";
import { QuotaGuard } from "../ai/quota/quota.guard";
import { MatchRefreshService } from "./match-refresh.service";
import { ListMatchesQueryDto } from "./dto/list-matches-query.dto";
import { type MatchDetailDto, MatchesService } from "./matches.service";

@ApiTags("matches")
@Controller("matches")
@UseGuards(NonAdminUserGuard)
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly matchRefresh: MatchRefreshService,
  ) {}

  @Get()
  async list(
    @Query() query: ListMatchesQueryDto,
  ): Promise<Paginated<MatchSummary[]>> {
    const { items, total } = await this.matches.list(query);
    return new Paginated(
      items,
      buildPaginationMeta(query.page, query.pageSize, total),
    );
  }

  @Get("today")
  today(): Promise<MatchSummary[]> {
    return this.matches.today();
  }

  @Get(":matchId")
  getOne(@Param("matchId") matchId: string): Promise<MatchDetailDto> {
    return this.matches.getById(matchId);
  }

  @Get(":matchId/analysis")
  getAnalysis(@Param("matchId") matchId: string): Promise<AiReportDto | null> {
    return this.matches.getAnalysis(matchId);
  }

  @Get(":matchId/prediction")
  getPrediction(
    @Param("matchId") matchId: string,
  ): Promise<MatchPredictionDto> {
    return this.matches.getPrediction(matchId);
  }

  @Get(":matchId/post-match-report")
  getPostMatch(@Param("matchId") matchId: string): Promise<AiReportDto | null> {
    return this.matches.getPostMatchReport(matchId);
  }

  /**
   * POST /matches/:matchId/refresh
   *
   * User-facing single-match lightweight refresh.
   * Requires login; USER and PREMIUM may call; ADMIN is blocked (403) by
   * the class-level NonAdminUserGuard.
   * Does NOT require cron-secret or premium tier.
   */
  @Post(":matchId/refresh")
  refresh(
    @Param("matchId") matchId: string,
  ): Promise<Paginated<MatchDetailDto>> {
    return this.matchRefresh.refresh(matchId);
  }

  @Post(":matchId/deep-chat")
  @UseGuards(PremiumOnlyGuard, QuotaGuard)
  @AiQuota("DEEP_CHAT")
  deepChat(
    @CurrentUser() user: AuthenticatedUser,
    @Param("matchId") matchId: string,
    @Body() dto: ChatQuestionDto,
  ): Promise<ChatAnswerDto> {
    return this.matches.deepChat(matchId, user.id, dto.question);
  }
}
