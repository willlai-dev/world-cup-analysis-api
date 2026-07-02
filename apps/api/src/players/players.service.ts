import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AiEntityType,
  AiProvider,
  AiReportStatus,
  type Prisma,
  RatingTier,
  RiskLevel,
} from "@prisma/client";
import {
  type GenerationResult,
  MAX_GENERATIONS_PER_RUN,
} from "../ai/generation-result";
import { AiRouterService } from "../ai/ai-router.service";
import {
  type PlayerHexagonOutput,
  PlayerHexagonOutputSchema,
} from "../ai/schemas/player-hexagon.schema";
import {
  type PlayerStatusOutput,
  PlayerStatusOutputSchema,
} from "../ai/schemas/player-status.schema";
import type {
  AiReportDto,
  ChatAnswerDto,
  PlayerSummary,
} from "../common/dto/contracts";
import { sleep } from "../common/utils/sleep.util";
import { AppConfigService } from "../config/app-config.service";
import { toAiReportDto, toPlayerSummary } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import type { ListPlayersQueryDto } from "./dto/list-players-query.dto";

const PLAYER_MOCK: PlayerHexagonOutput = {
  overallScore: 0,
  ratingTier: "UNKNOWN",
  attackScore: 0,
  creativityScore: 0,
  techniqueScore: 0,
  defenseScore: 0,
  physicalScore: 0,
  formScore: 0,
  strengths: [],
  weaknesses: [],
  roleSummary: "【AI_MOCK_MODE】示範",
  injuryRiskLevel: "UNKNOWN",
  dataLimitations: ["示範模式"],
};

const PLAYER_STATUS_MOCK: PlayerStatusOutput = {
  statusSummaryZh: "【AI_MOCK_MODE】球員近況摘要示範（推論，僅供參考）。",
  injuryRiskLevel: "UNKNOWN",
  formScore: null,
  dataLimitations: ["示範模式"],
};

const PLAYER_SORT_FIELDS = [
  "overallScore",
  "attackScore",
  "creativityScore",
  "techniqueScore",
  "defenseScore",
  "physicalScore",
  "formScore",
  "nameEn",
  "createdAt",
] as const;

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: AiRouterService,
    private readonly config: AppConfigService,
  ) {}

  async list(
    query: ListPlayersQueryDto,
  ): Promise<{ items: PlayerSummary[]; total: number }> {
    const where: Prisma.PlayerWhereInput = {};
    if (query.teamId) {
      where.teamId = query.teamId;
    }
    if (query.position) {
      where.position = query.position;
    }
    if (query.ratingTier) {
      where.ratingTier = query.ratingTier;
    }
    if (query.eliminated !== undefined) {
      where.team = { isEliminated: query.eliminated };
    }
    if (query.search) {
      where.OR = [
        { nameEn: { contains: query.search, mode: "insensitive" } },
        { nameZh: { contains: query.search, mode: "insensitive" } },
        { clubName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const sortBy = (PLAYER_SORT_FIELDS as readonly string[]).includes(
      query.sortBy ?? "",
    )
      ? (query.sortBy as string)
      : "overallScore";
    const sortOrder: Prisma.SortOrder =
      query.sortOrder === "asc" ? "asc" : "desc";

    const [items, total] = await this.prisma.$transaction([
      this.prisma.player.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
        include: { team: true },
      }),
      this.prisma.player.count({ where }),
    ]);
    return { items: items.map((p) => toPlayerSummary(p)), total };
  }

  async getById(playerId: string): Promise<PlayerSummary> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { team: true },
    });
    if (!player) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Player not found",
      });
    }
    return toPlayerSummary(player);
  }

  async deepChat(
    playerId: string,
    userId: string,
    question: string,
  ): Promise<ChatAnswerDto> {
    const player = await this.getById(playerId);
    return this.router.runChat({
      taskType: "DEEP_PLAYER_CHAT",
      userId,
      entityId: playerId,
      question,
      scope: `球員：${player.nameEn}`,
      context: player,
    });
  }

  /** Job: hexagon rating per player — saves an AiReport and (real mode) writes scores back. */
  async generateRatings(): Promise<GenerationResult> {
    const players = await this.prisma.player.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        nameEn: true,
        position: true,
        clubName: true,
        shirtNumber: true,
        team: { select: { nameEn: true } },
      },
    });
    let scanned = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const p of players) {
      if (generated >= MAX_GENERATIONS_PER_RUN) break;
      scanned += 1;
      const context = {
        name: p.nameEn,
        position: p.position,
        club: p.clubName,
        shirtNumber: p.shirtNumber,
        team: p.team?.nameEn ?? null,
      };
      const report = await this.router.runReportIfChanged<PlayerHexagonOutput>({
        taskType: "PLAYER_HEXAGON_ANALYSIS",
        entityId: p.id,
        reportType: "PLAYER_HEXAGON_ANALYSIS",
        instruction:
          "請依球員資料輸出六邊形能力評估。只輸出 JSON,欄位:overallScore、attackScore、creativityScore、" +
          "techniqueScore、defenseScore、physicalScore、formScore(皆 0-100)、ratingTier(S|A_PLUS|A|B_PLUS|B|C|UNKNOWN)、" +
          "strengths[]、weaknesses[]、roleSummary、injuryRiskLevel(LOW|MEDIUM|HIGH|UNKNOWN)、dataLimitations[]。",
        context,
        scope: `球員：${p.nameEn}`,
        schema: PlayerHexagonOutputSchema,
        mockData: PLAYER_MOCK,
        allowModelKnowledge: true,
      });

      if (report.skipped) {
        skipped += 1;
      } else if (report.ok && report.data) {
        // Only write AI scores back to the row for real provider output (not mock zeros).
        if (report.provider && report.provider !== AiProvider.PROGRAM_RULE) {
          await this.applyHexagon(p.id, report.data);
        }
        generated += 1;
      } else {
        failed += 1;
      }
      if (!report.skipped && !this.config.aiMockMode) {
        await sleep(this.config.aiGenerationDelayMs);
      }
    }

    return { scope: "players", scanned, generated, skipped, failed };
  }

  /**
   * Job: daily form/injury summary for in-tournament players (top N per team
   * by overallScore — user-tuned cost cap). Material = recent news tagged with
   * the player's name + the team's recent finished matches; the source hash
   * skips players whose material hasn't changed since the last run.
   */
  async generateStatuses(): Promise<GenerationResult> {
    const { topN, newsDays } = this.config.playerStatus;
    const since = new Date();
    since.setDate(since.getDate() - newsDays);

    const teams = await this.prisma.team.findMany({
      where: { isEliminated: false },
      select: {
        id: true,
        nameEn: true,
        nameZh: true,
        players: {
          orderBy: [{ overallScore: "desc" }, { id: "asc" }],
          take: topN,
          select: {
            id: true,
            nameEn: true,
            nameZh: true,
            position: true,
            clubName: true,
          },
        },
      },
    });

    let scanned = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    outer: for (const team of teams) {
      const recentMatches = await this.prisma.match.findMany({
        where: {
          status: "FINISHED",
          OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
        },
        orderBy: { kickoffAt: "desc" },
        take: 5,
        select: {
          kickoffAt: true,
          homeScore: true,
          awayScore: true,
          winnerTeamId: true,
          homeTeam: { select: { id: true, nameEn: true } },
          awayTeam: { select: { id: true, nameEn: true } },
        },
      });
      const matchContext = recentMatches.map((m) => ({
        kickoffAt: m.kickoffAt?.toISOString() ?? null,
        home: m.homeTeam.nameEn,
        away: m.awayTeam.nameEn,
        score: `${m.homeScore ?? "-"}:${m.awayScore ?? "-"}`,
        teamWon: m.winnerTeamId === team.id,
      }));

      for (const p of team.players) {
        if (generated >= MAX_GENERATIONS_PER_RUN) break outer;
        scanned += 1;

        const names = [p.nameEn, p.nameZh].filter(
          (n): n is string => !!n && n.length > 0,
        );
        const recentNews = await this.prisma.newsArticle.findMany({
          where: {
            publishedAt: { gte: since },
            tags: { some: { newsTag: { name: { in: names } } } },
          },
          orderBy: { publishedAt: "desc" },
          take: 5,
          select: {
            titleEn: true,
            summaryZh: true,
            category: true,
            publishedAt: true,
          },
        });

        const report = await this.router.runReportIfChanged<PlayerStatusOutput>(
          {
            taskType: "PLAYER_STATUS_SUMMARY",
            entityId: p.id,
            reportType: "PLAYER_STATUS_SUMMARY",
            instruction:
              "請根據近期相關新聞與該隊近況比賽結果，輸出球員近況與身體狀況摘要。務必謹慎：" +
              "傷病與狀態判斷屬「推論」，需在文字中明確標示，不可斷言未經證實的傷情；" +
              "引用新聞時附上發布時間；資料不足時列入 dataLimitations 並將 injuryRiskLevel 設為 UNKNOWN。" +
              '只輸出 JSON，欄位：{ "statusSummaryZh": string, "injuryRiskLevel": "LOW"|"MEDIUM"|"HIGH"|"UNKNOWN", ' +
              '"formScore": number|null, "dataLimitations": string[] }。',
            context: {
              player: {
                name: p.nameEn,
                nameZh: p.nameZh,
                position: p.position,
                club: p.clubName,
              },
              team: { name: team.nameEn, nameZh: team.nameZh },
              recentNews: recentNews.map((n) => ({
                title: n.titleEn,
                summaryZh: n.summaryZh,
                category: n.category,
                publishedAt: n.publishedAt?.toISOString() ?? null,
              })),
              recentMatches: matchContext,
            },
            scope: `球員：${p.nameEn}`,
            schema: PlayerStatusOutputSchema,
            mockData: PLAYER_STATUS_MOCK,
          },
        );

        if (report.skipped) {
          skipped += 1;
          continue;
        }
        if (report.ok && report.data) {
          if (report.provider && report.provider !== AiProvider.PROGRAM_RULE) {
            await this.applyStatus(p.id, report.data);
          }
          generated += 1;
        } else {
          failed += 1;
        }
        if (!this.config.aiMockMode) {
          await sleep(this.config.aiGenerationDelayMs);
        }
      }
    }

    return { scope: "player-status", scanned, generated, skipped, failed };
  }

  private async applyStatus(
    playerId: string,
    d: PlayerStatusOutput,
  ): Promise<void> {
    await this.prisma.player.update({
      where: { id: playerId },
      data: {
        injuryRiskLevel: d.injuryRiskLevel as RiskLevel,
        ...(d.formScore !== null ? { formScore: d.formScore } : {}),
      },
    });
  }

  private async applyHexagon(
    playerId: string,
    d: PlayerHexagonOutput,
  ): Promise<void> {
    await this.prisma.player.update({
      where: { id: playerId },
      data: {
        overallScore: d.overallScore,
        attackScore: d.attackScore,
        creativityScore: d.creativityScore,
        techniqueScore: d.techniqueScore,
        defenseScore: d.defenseScore,
        physicalScore: d.physicalScore,
        formScore: d.formScore,
        ratingTier: d.ratingTier as RatingTier,
        injuryRiskLevel: d.injuryRiskLevel as RiskLevel,
      },
    });
  }

  async getReport(
    playerId: string,
    reportTypes: string[],
  ): Promise<AiReportDto | null> {
    await this.getById(playerId);
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.PLAYER,
        entityId: playerId,
        status: AiReportStatus.DONE,
        reportType: { in: reportTypes },
      },
      orderBy: { createdAt: "desc" },
    });
    return report ? toAiReportDto(report) : null;
  }
}
