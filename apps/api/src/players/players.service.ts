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
import type {
  AiReportDto,
  ChatAnswerDto,
  PlayerSummary,
} from "../common/dto/contracts";
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
    }

    return { scope: "players", scanned, generated, skipped, failed };
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
