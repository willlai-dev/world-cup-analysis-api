import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AiEntityType,
  AiProvider,
  AiReportStatus,
  type Prisma,
  type TeamRatingTier,
} from "@prisma/client";
import { AiRouterService } from "../ai/ai-router.service";
import {
  type GenerationResult,
  MAX_GENERATIONS_PER_RUN,
} from "../ai/generation-result";
import {
  type TeamSquadOutput,
  TeamSquadOutputSchema,
} from "../ai/schemas/team-squad.schema";
import type {
  AiReportDto,
  ChatAnswerDto,
  MatchSummary,
  PlayerSummary,
  TeamSummary,
} from "../common/dto/contracts";
import { sleep } from "../common/utils/sleep.util";
import { AppConfigService } from "../config/app-config.service";
import {
  toAiReportDto,
  toMatchSummary,
  toPlayerSummary,
  toTeamSummary,
} from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import type { ListTeamsQueryDto } from "./dto/list-teams-query.dto";

const TEAM_SQUAD_MOCK: TeamSquadOutput = {
  championScore: 0,
  formScore: 0,
  attackScore: 0,
  midfieldScore: 0,
  defenseScore: 0,
  statusScore: 0,
  ratingTier: "UNKNOWN",
  strengths: [],
  risks: [],
  summary: "【AI_MOCK_MODE】球隊評分示範（推估）。",
  dataLimitations: ["示範模式"],
};

const TEAM_SORT_FIELDS = [
  "championScore",
  "formScore",
  "worldRanking",
  "nameEn",
  "ratingTier",
  "createdAt",
] as const;

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: AiRouterService,
    private readonly config: AppConfigService,
  ) {}

  async list(
    query: ListTeamsQueryDto,
  ): Promise<{ items: TeamSummary[]; total: number }> {
    const where: Prisma.TeamWhereInput = {};
    if (query.continent) {
      where.continent = query.continent;
    }
    if (query.ratingTier) {
      where.ratingTier = query.ratingTier;
    }
    if (query.eliminated !== undefined) {
      where.isEliminated = query.eliminated;
    }
    if (query.search) {
      where.OR = [
        { nameEn: { contains: query.search, mode: "insensitive" } },
        { nameZh: { contains: query.search, mode: "insensitive" } },
        { fifaCode: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const sortBy = (TEAM_SORT_FIELDS as readonly string[]).includes(
      query.sortBy ?? "",
    )
      ? (query.sortBy as string)
      : "championScore";
    const sortOrder: Prisma.SortOrder =
      query.sortOrder === "asc" ? "asc" : "desc";

    const [items, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
      }),
      this.prisma.team.count({ where }),
    ]);
    return { items: items.map(toTeamSummary), total };
  }

  async getById(teamId: string): Promise<TeamSummary> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Team not found",
      });
    }
    return toTeamSummary(team);
  }

  async deepChat(
    teamId: string,
    userId: string,
    question: string,
  ): Promise<ChatAnswerDto> {
    const team = await this.getById(teamId);
    const players = await this.getPlayers(teamId);
    return this.router.runChat({
      taskType: "DEEP_TEAM_CHAT",
      userId,
      entityId: teamId,
      question,
      scope: `國家隊：${team.nameEn}`,
      context: { team, players },
    });
  }

  async getPlayers(teamId: string): Promise<PlayerSummary[]> {
    await this.getById(teamId);
    const players = await this.prisma.player.findMany({
      where: { teamId },
      orderBy: [{ overallScore: "desc" }, { nameEn: "asc" }],
    });
    return players.map((p) => toPlayerSummary(p));
  }

  async getMatches(teamId: string): Promise<MatchSummary[]> {
    await this.getById(teamId);
    const matches = await this.prisma.match.findMany({
      where: { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoffAt: "asc" },
    });
    return matches.map((m) => toMatchSummary(m));
  }

  /**
   * Job: team-level strength scores for every team. The DB only seeds scores
   * for a handful of teams, so this fills in the rest (attack/midfield/defense/
   * status/champion/form + tier) via TEAM_SQUAD_ANALYSIS, grounded in the
   * squad's player ratings + recent results. `runReportIfChanged` skips teams
   * whose squad/results haven't moved since the last run.
   */
  async generateRatings(opts?: { teamId?: string }): Promise<GenerationResult> {
    // Still-in-tournament teams first (isEliminated=false sorts before true), so
    // when the per-run cap is hit the live contenders get scored, not knocked-out
    // sides. Eliminated teams are still refreshed with whatever budget remains.
    // `opts.teamId` scopes the run to a single country (admin "分析這個國家").
    const teams = await this.prisma.team.findMany({
      where: opts?.teamId ? { id: opts.teamId } : undefined,
      orderBy: [{ isEliminated: "asc" }, { id: "asc" }],
      select: {
        id: true,
        nameEn: true,
        nameZh: true,
        fifaCode: true,
        continent: true,
        groupName: true,
        worldRanking: true,
        isEliminated: true,
      },
    });

    let scanned = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const team of teams) {
      if (generated >= MAX_GENERATIONS_PER_RUN) break;
      scanned += 1;

      const [squad, recentMatches] = await Promise.all([
        this.prisma.player.findMany({
          where: { teamId: team.id },
          orderBy: [{ overallScore: "desc" }, { id: "asc" }],
          take: 15,
          select: {
            nameEn: true,
            position: true,
            overallScore: true,
            attackScore: true,
            defenseScore: true,
          },
        }),
        this.prisma.match.findMany({
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
        }),
      ]);

      const report = await this.router.runReportIfChanged<TeamSquadOutput>({
        taskType: "TEAM_SQUAD_ANALYSIS",
        entityId: team.id,
        reportType: "TEAM_SQUAD_ANALYSIS",
        instruction:
          "請評估這支國家隊的整體實力。優先參考提供的球員名單評分與近期賽果；" +
          "資料庫缺實力數據時可用公開足球知識並在文字中標註「推估」。只輸出 JSON，欄位：" +
          '{ "championScore": number, "formScore": number, "attackScore": number, ' +
          '"midfieldScore": number, "defenseScore": number, "statusScore": number（皆 0-100）, ' +
          '"ratingTier": "S"|"A"|"B"|"C"|"UNKNOWN", "strengths": string[], "risks": string[], ' +
          '"summary": string, "dataLimitations": string[] }。',
        context: {
          team: {
            name: team.nameEn,
            nameZh: team.nameZh,
            fifaCode: team.fifaCode,
            continent: team.continent,
            groupName: team.groupName,
            worldRanking: team.worldRanking,
            isEliminated: team.isEliminated,
          },
          squad: squad.map((p) => ({
            name: p.nameEn,
            position: p.position,
            overallScore: p.overallScore,
            attackScore: p.attackScore,
            defenseScore: p.defenseScore,
          })),
          recentMatches: recentMatches.map((m) => ({
            kickoffAt: m.kickoffAt?.toISOString() ?? null,
            home: m.homeTeam.nameEn,
            away: m.awayTeam.nameEn,
            score: `${m.homeScore ?? "-"}:${m.awayScore ?? "-"}`,
            teamWon: m.winnerTeamId === team.id,
          })),
        },
        scope: `國家隊：${team.nameEn}`,
        schema: TeamSquadOutputSchema,
        mockData: TEAM_SQUAD_MOCK,
        allowModelKnowledge: true,
      });

      if (report.skipped) {
        skipped += 1;
      } else if (report.ok && report.data) {
        // Never persist mock zeros — only real provider output writes scores back.
        if (report.provider && report.provider !== AiProvider.PROGRAM_RULE) {
          await this.applySquad(team.id, report.data);
        }
        generated += 1;
      } else {
        failed += 1;
      }
      if (!report.skipped && !this.config.aiMockMode) {
        await sleep(this.config.aiGenerationDelayMs);
      }
    }

    return { scope: "teams", scanned, generated, skipped, failed };
  }

  private async applySquad(
    teamId: string,
    d: TeamSquadOutput,
  ): Promise<void> {
    await this.prisma.team.update({
      where: { id: teamId },
      data: {
        championScore: d.championScore,
        formScore: d.formScore,
        attackScore: d.attackScore,
        midfieldScore: d.midfieldScore,
        defenseScore: d.defenseScore,
        statusScore: d.statusScore,
        ratingTier: d.ratingTier as TeamRatingTier,
      },
    });
  }

  async getAnalysis(teamId: string): Promise<AiReportDto | null> {
    await this.getById(teamId);
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.TEAM,
        entityId: teamId,
        status: AiReportStatus.DONE,
      },
      orderBy: { createdAt: "desc" },
    });
    return report ? toAiReportDto(report) : null;
  }
}
