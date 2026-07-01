import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AiEntityType,
  AiReportStatus,
  MatchStatus,
  type Prisma,
} from "@prisma/client";
import {
  type GenerationResult,
  MAX_GENERATIONS_PER_RUN,
} from "../ai/generation-result";
import { AiRouterService } from "../ai/ai-router.service";
import {
  type MatchAnalysisOutput,
  MatchAnalysisOutputSchema,
} from "../ai/schemas/match-analysis.schema";
import type {
  AiReportDto,
  ChatAnswerDto,
  MatchPredictionDto,
  MatchSummary,
} from "../common/dto/contracts";
import { toAiReportDto, toMatchSummary } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import type { ListMatchesQueryDto } from "./dto/list-matches-query.dto";

// Bump when the match-analysis prompt/schema changes so runReportIfChanged
// regenerates existing analyses (the context hash changes with it).
const MATCH_ANALYSIS_VERSION = 2;

const MATCH_MOCK: MatchAnalysisOutput = {
  title: "【AI_MOCK_MODE】賽事分析示範",
  summary: "示範模式，尚未串接真實模型。",
  keyFactors: [],
  keyPlayers: [],
  prediction: {
    homeWinLean: 0,
    drawLean: 0,
    awayWinLean: 0,
    explanation: "示範",
  },
  likelyScorelines: [],
  risks: [],
  dataLimitations: ["示範模式"],
};

export type MatchEventDto = {
  id: string;
  minute: number | null;
  extraMinute: number | null;
  eventType: string;
  teamId: string | null;
  playerId: string | null;
  description: string | null;
};

export type MatchDetailDto = MatchSummary & { events: MatchEventDto[] };

const matchInclude = {
  homeTeam: true,
  awayTeam: true,
} satisfies Prisma.MatchInclude;

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: AiRouterService,
  ) {}

  async list(
    query: ListMatchesQueryDto,
  ): Promise<{ items: MatchSummary[]; total: number }> {
    const where: Prisma.MatchWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.stage) {
      where.stage = query.stage;
    }
    if (query.groupName) {
      where.groupName = query.groupName;
    }
    if (query.teamId) {
      where.OR = [{ homeTeamId: query.teamId }, { awayTeamId: query.teamId }];
    }
    if (query.dateFrom || query.dateTo) {
      where.kickoffAt = {};
      if (query.dateFrom) {
        where.kickoffAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.kickoffAt.lte = new Date(query.dateTo);
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ kickoffAt: "asc" }, { id: "asc" }],
        include: matchInclude,
      }),
      this.prisma.match.count({ where }),
    ]);
    return { items: items.map((m) => toMatchSummary(m)), total };
  }

  async today(): Promise<MatchSummary[]> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const matches = await this.prisma.match.findMany({
      where: { kickoffAt: { gte: start, lt: end } },
      orderBy: { kickoffAt: "asc" },
      include: matchInclude,
    });
    return matches.map((m) => toMatchSummary(m));
  }

  async getById(matchId: string): Promise<MatchDetailDto> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        ...matchInclude,
        events: { orderBy: [{ minute: "asc" }, { id: "asc" }] },
      },
    });
    if (!match) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Match not found",
      });
    }
    return {
      ...toMatchSummary(match),
      events: match.events.map((e) => ({
        id: e.id,
        minute: e.minute,
        extraMinute: e.extraMinute,
        eventType: e.eventType,
        teamId: e.teamId,
        playerId: e.playerId,
        description: e.description,
      })),
    };
  }

  async deepChat(
    matchId: string,
    userId: string,
    question: string,
  ): Promise<ChatAnswerDto> {
    const match = await this.getById(matchId);
    return this.router.runChat({
      taskType: "DEEP_MATCH_CHAT",
      userId,
      entityId: matchId,
      question,
      scope: `賽事：${match.homeTeam.nameEn} vs ${match.awayTeam.nameEn}`,
      sourceUpdatedAt: match.sourceUpdatedAt,
      context: match,
    });
  }

  /**
   * Job: AI pre-match analysis (feeds GET .../analysis and .../prediction).
   * Only upcoming (not-yet-started) matches — finished matches don't need a
   * pre-match prediction.
   */
  async generateAnalyses(): Promise<GenerationResult> {
    const matches = await this.prisma.match.findMany({
      where: { status: MatchStatus.SCHEDULED },
      orderBy: { kickoffAt: "asc" },
      include: matchInclude,
    });
    let scanned = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const m of matches) {
      if (generated >= MAX_GENERATIONS_PER_RUN) break;
      scanned += 1;
      const context = {
        v: MATCH_ANALYSIS_VERSION,
        home: m.homeTeam.nameEn,
        away: m.awayTeam.nameEn,
        stage: m.stage,
        status: m.status,
        group: m.groupName,
        kickoffAt: m.kickoffAt.toISOString(),
        homeScore: m.homeScore,
        awayScore: m.awayScore,
      };
      const report = await this.router.runReportIfChanged<MatchAnalysisOutput>({
        taskType: "MATCH_ANALYSIS",
        entityId: m.id,
        reportType: "MATCH_ANALYSIS",
        instruction:
          "請依雙方國家隊資料分析此場賽事。只輸出 JSON,欄位:title、summary、keyFactors[]、" +
          "keyPlayers[{playerName,teamName,reason}]、prediction{homeWinLean,drawLean,awayWinLean(0-100),explanation}、" +
          'likelyScorelines(最可能的三種比分,格式 [{score:"主-客" 例如 "2-1", probability:0-100}],三筆機率遞減)、' +
          "risks[]、dataLimitations[]。勝負只能表述為傾向,不可保證。",
        context,
        scope: `賽事：${m.homeTeam.nameEn} vs ${m.awayTeam.nameEn}`,
        schema: MatchAnalysisOutputSchema,
        mockData: MATCH_MOCK,
        allowModelKnowledge: true,
      });

      if (report.skipped) skipped += 1;
      else if (report.ok) generated += 1;
      else failed += 1;
    }

    return { scope: "matches", scanned, generated, skipped, failed };
  }

  async getAnalysis(matchId: string): Promise<AiReportDto | null> {
    await this.ensureExists(matchId);
    return this.latestReport(matchId, ["MATCH_ANALYSIS"]);
  }

  async getPostMatchReport(matchId: string): Promise<AiReportDto | null> {
    await this.ensureExists(matchId);
    return this.latestReport(matchId, ["POST_MATCH_REPORT", "MATCH_ANALYSIS"]);
  }

  async getPrediction(matchId: string): Promise<MatchPredictionDto> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Match not found",
      });
    }
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.MATCH,
        entityId: matchId,
        status: AiReportStatus.DONE,
        reportType: { in: ["MATCH_PREDICTION", "MATCH_ANALYSIS"] },
      },
      orderBy: { createdAt: "desc" },
    });
    const structured = (report?.structuredJson ?? null) as {
      prediction?: {
        homeWinLean?: number;
        drawLean?: number;
        awayWinLean?: number;
      };
      likelyScorelines?: { score?: string; probability?: number }[];
      keyFactors?: string[];
      risks?: string[];
    } | null;
    const likelyScorelines = (structured?.likelyScorelines ?? [])
      .filter((s): s is { score: string; probability?: number } =>
        Boolean(s?.score),
      )
      .slice(0, 3)
      .map((s) => ({ score: s.score, probability: s.probability ?? null }));
    return {
      matchId,
      homeWinProbability: structured?.prediction?.homeWinLean ?? null,
      drawProbability: structured?.prediction?.drawLean ?? null,
      awayWinProbability: structured?.prediction?.awayWinLean ?? null,
      likelyScorelines,
      keyFactors: structured?.keyFactors ?? [],
      riskNotes: structured?.risks ?? [],
      report: report ? toAiReportDto(report) : null,
      sourceUpdatedAt: match.sourceUpdatedAt
        ? match.sourceUpdatedAt.toISOString()
        : null,
    };
  }

  private async ensureExists(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });
    if (!match) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Match not found",
      });
    }
  }

  private async latestReport(
    matchId: string,
    reportTypes: string[],
  ): Promise<AiReportDto | null> {
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.MATCH,
        entityId: matchId,
        status: AiReportStatus.DONE,
        reportType: { in: reportTypes },
      },
      orderBy: { createdAt: "desc" },
    });
    return report ? toAiReportDto(report) : null;
  }
}
