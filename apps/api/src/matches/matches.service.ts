import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AiEntityType,
  AiReportStatus,
  MatchStatus,
  Prisma,
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
import { CalibrationService } from "../insights/calibration.service";
import { applyTendencyCalibration } from "../insights/prediction-calibration";
import { buildProgramScorelines } from "../insights/scoreline-model";
import { toAiReportDto, toMatchSummary } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import type { ListMatchesQueryDto } from "./dto/list-matches-query.dto";
import { parsePredictionSnapshot, scorePrediction } from "./prediction-scoring";

// Bump when the match-analysis prompt/schema changes so runReportIfChanged
// regenerates existing analyses (the context hash changes with it).
// v3: context gains predictionTrack (recent hit rate + per-team bias feedback).
// v4: scoreline guidance (anchor on common football scores) + exact-score
//     track record fed back via predictionTrack.recent.
const MATCH_ANALYSIS_VERSION = 4;

// Report types that count as a "real" pre-match prediction when settling.
const PRE_MATCH_REPORT_TYPES = ["MATCH_PREDICTION", "MATCH_ANALYSIS"];
// 賽後回補的賽前視角分析。Deliberately NOT in PRE_MATCH_REPORT_TYPES and not
// queried by getAnalysis/getPrediction — retro reports exist only for
// settlement + insights, never as the match page's displayed analysis.
const RETRO_REPORT_TYPE = "RETRO_MATCH_ANALYSIS";
const RETRO_ANALYSIS_VERSION = 1;

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

// Retro mock carries scoreable values (unlike MATCH_MOCK's all-zero leans,
// which settlement treats as "no prediction") so the retro → scoring flow can
// be exercised end-to-end in AI_MOCK_MODE.
const RETRO_MOCK: MatchAnalysisOutput = {
  title: "【AI_MOCK_MODE】回補賽前分析示範",
  summary: "示範模式，尚未串接真實模型。",
  keyFactors: [],
  keyPlayers: [],
  prediction: {
    homeWinLean: 55,
    drawLean: 25,
    awayWinLean: 20,
    explanation: "示範",
  },
  likelyScorelines: [
    { score: "2-1", probability: 30 },
    { score: "1-1", probability: 25 },
    { score: "1-0", probability: 20 },
  ],
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Raw leans normalized to 0-100 outcome probabilities; null when unusable. */
function normalizeLeans(
  home: number | null,
  draw: number | null,
  away: number | null,
): { home: number; draw: number; away: number } | null {
  const h = home ?? 0;
  const d = draw ?? 0;
  const a = away ?? 0;
  const sum = h + d + a;
  if (sum <= 0) return null;
  return { home: (h / sum) * 100, draw: (d / sum) * 100, away: (a / sum) * 100 };
}

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: AiRouterService,
    private readonly calibration: CalibrationService,
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

    // Phase 3: error feedback — recent real-prediction performance + per-team
    // predicted-vs-actual bias, computed once per run and fed to every prompt.
    const [bundle, teamTrack] = await Promise.all([
      this.calibration.getBundle(),
      this.buildTeamTrack(),
    ]);
    const calibration = bundle.tendency;
    const recentTrack = calibration
      ? {
          sampleSize: calibration.sampleSize,
          tendencyHitRate: round2(calibration.tendencyHitRate),
          avgConfidence: round2(calibration.avgConfidence),
          exactScoreHitRate: bundle.scoreTrack
            ? round2(bundle.scoreTrack.exactScoreHitRate)
            : null,
          top3ScoreHitRate: bundle.scoreTrack
            ? round2(bundle.scoreTrack.top3ScoreHitRate)
            : null,
        }
      : null;

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
        predictionTrack: {
          recent: recentTrack,
          home: teamTrack.get(m.homeTeamId) ?? null,
          away: teamTrack.get(m.awayTeamId) ?? null,
        },
      };
      const report = await this.router.runReportIfChanged<MatchAnalysisOutput>({
        taskType: "MATCH_ANALYSIS",
        entityId: m.id,
        reportType: "MATCH_ANALYSIS",
        instruction:
          "請依雙方國家隊資料分析此場賽事。只輸出 JSON,欄位:title、summary、keyFactors[]、" +
          "keyPlayers[{playerName,teamName,reason}]、prediction{homeWinLean,drawLean,awayWinLean(0-100),explanation}、" +
          'likelyScorelines(最可能的三種比分,格式 [{score:"主-客" 例如 "2-1", probability:0-100}],三筆機率遞減)、' +
          "risks[]、dataLimitations[]。勝負只能表述為傾向,不可保證。" +
          "比分預測請優先考慮足球常見比分(1-0、2-1、1-1、2-0、0-0),除非分析有強烈理由,不要給出總進球數 ≥ 4 的冷門比分。" +
          "context.predictionTrack 是本系統過往預測的表現回饋:recent.avgConfidence 高於 tendencyHitRate 代表近期預測過度自信,請把傾向數字收斂得更保守;" +
          "recent.exactScoreHitRate 是過往比分完全命中率,偏低代表比分預測應更貼近常見比分;" +
          "home/away 的 overPerformed/underPerformed 代表該隊過去實際表現優於/劣於預測的次數,請據此微調對該隊的評估。",
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

  /**
   * Per-team predicted-vs-actual track from settled outcomes (retro included —
   * it is form feedback for the prompt, not an accuracy claim). Rank map:
   * win 2 / draw 1 / loss 0 from the team's perspective; over-performed means
   * the actual rank beat the predicted one.
   */
  private async buildTeamTrack(): Promise<
    Map<string, { matches: number; tendencyHits: number; overPerformed: number; underPerformed: number }>
  > {
    const outcomes = await this.prisma.matchPredictionOutcome.findMany({
      where: { tendencyPredicted: { not: null } },
      select: {
        tendencyPredicted: true,
        tendencyActual: true,
        tendencyHit: true,
        match: { select: { homeTeamId: true, awayTeamId: true } },
      },
    });
    const track = new Map<
      string,
      { matches: number; tendencyHits: number; overPerformed: number; underPerformed: number }
    >();
    const rankFor = (tendency: string, side: "home" | "away"): number => {
      if (tendency === "DRAW") return 1;
      const won = side === "home" ? tendency === "HOME" : tendency === "AWAY";
      return won ? 2 : 0;
    };
    for (const o of outcomes) {
      for (const side of ["home", "away"] as const) {
        const teamId = side === "home" ? o.match.homeTeamId : o.match.awayTeamId;
        const entry =
          track.get(teamId) ?? { matches: 0, tendencyHits: 0, overPerformed: 0, underPerformed: 0 };
        entry.matches += 1;
        if (o.tendencyHit) entry.tendencyHits += 1;
        const predicted = rankFor(o.tendencyPredicted!, side);
        const actual = rankFor(o.tendencyActual, side);
        if (actual > predicted) entry.overPerformed += 1;
        else if (actual < predicted) entry.underPerformed += 1;
        track.set(teamId, entry);
      }
    }
    return track;
  }

  /**
   * Job: 賽後回補的「賽前視角」分析 — for FINISHED matches that never got a
   * real pre-kickoff MATCH_ANALYSIS (site went live mid-tournament). Context
   * is restricted to information knowable before kickoff (both sides' earlier
   * results); the actual score is never included, and the strict prompt
   * (allowModelKnowledge=false) keeps the model on the provided snapshot to
   * reduce knowledge contamination — the model's training data may contain
   * the real result, so these reports are flagged retro at settlement and
   * must never feed calibration.
   */
  async generateRetroAnalyses(): Promise<GenerationResult> {
    const matches = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.FINISHED,
        homeScore: { not: null },
        awayScore: { not: null },
      },
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

      // A real pre-kickoff analysis exists — settlement uses that one instead.
      const hasPreMatch = await this.prisma.aiReport.count({
        where: {
          entityType: AiEntityType.MATCH,
          entityId: m.id,
          status: AiReportStatus.DONE,
          reportType: { in: PRE_MATCH_REPORT_TYPES },
          createdAt: { lt: m.kickoffAt },
        },
      });
      if (hasPreMatch > 0) {
        skipped += 1;
        continue;
      }

      const [homeForm, awayForm] = await Promise.all([
        this.finishedResultsBefore(m.homeTeamId, m.kickoffAt),
        this.finishedResultsBefore(m.awayTeamId, m.kickoffAt),
      ]);
      const context = {
        v: RETRO_ANALYSIS_VERSION,
        retro: true,
        home: m.homeTeam.nameEn,
        away: m.awayTeam.nameEn,
        stage: m.stage,
        group: m.groupName,
        kickoffAt: m.kickoffAt.toISOString(),
        homeRecentResults: homeForm,
        awayRecentResults: awayForm,
      };
      const report = await this.router.runReportIfChanged<MatchAnalysisOutput>({
        taskType: "RETRO_MATCH_ANALYSIS",
        entityId: m.id,
        reportType: RETRO_REPORT_TYPE,
        instruction:
          "這是一場已結束賽事的「賽前視角」回補分析。你只能根據 context 提供的開賽前資訊" +
          "（雙方在開賽前的近期賽果、輪次、分組）進行分析與預測，" +
          "嚴禁使用或引用你可能記得的這場比賽實際結果或其後發生的任何事件。" +
          "只輸出 JSON,欄位:title、summary、keyFactors[]、" +
          "keyPlayers[{playerName,teamName,reason}]、prediction{homeWinLean,drawLean,awayWinLean(0-100),explanation}、" +
          'likelyScorelines(最可能的三種比分,格式 [{score:"主-客" 例如 "2-1", probability:0-100}],三筆機率遞減)、' +
          "risks[]、dataLimitations[]。勝負只能表述為傾向,不可保證。",
        context,
        scope: `回補賽前分析：${m.homeTeam.nameEn} vs ${m.awayTeam.nameEn}`,
        schema: MatchAnalysisOutputSchema,
        mockData: RETRO_MOCK,
        allowModelKnowledge: false,
      });

      if (report.skipped) skipped += 1;
      else if (report.ok) generated += 1;
      else failed += 1;
    }

    return { scope: "retro-analyses", scanned, generated, skipped, failed };
  }

  /** A team's finished results before `before` (as-of-kickoff form context). */
  private async finishedResultsBefore(
    teamId: string,
    before: Date,
    take = 5,
  ): Promise<{ date: string; fixture: string; stage: string }[]> {
    const rows = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.FINISHED,
        kickoffAt: { lt: before },
        homeScore: { not: null },
        awayScore: { not: null },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      orderBy: { kickoffAt: "desc" },
      take,
      select: {
        kickoffAt: true,
        homeScore: true,
        awayScore: true,
        stage: true,
        homeTeam: { select: { nameEn: true } },
        awayTeam: { select: { nameEn: true } },
      },
    });
    return rows.map((r) => ({
      date: r.kickoffAt.toISOString().slice(0, 10),
      fixture: `${r.homeTeam.nameEn} ${r.homeScore}-${r.awayScore} ${r.awayTeam.nameEn}`,
      stage: r.stage,
    }));
  }

  /**
   * Job: settle predictions against final scores (program rules — no AI, no
   * budget). For every FINISHED match: prefer the latest DONE report generated
   * BEFORE kickoff (a real prediction); fall back to a retro report, flagged
   * `retro`. Upserts one MatchPredictionOutcome per match; reruns are
   * idempotent and pick up newly finished matches / newly backfilled reports.
   */
  async scorePredictions(): Promise<Record<string, unknown>> {
    const matches = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.FINISHED,
        homeScore: { not: null },
        awayScore: { not: null },
      },
      orderBy: { kickoffAt: "asc" },
      select: { id: true, kickoffAt: true, homeScore: true, awayScore: true },
    });

    let scanned = 0;
    let scored = 0;
    let noPrediction = 0;
    let failed = 0;

    // Fitted once per run (not per match) — program scorelines below use the
    // params as of this settlement run.
    const bundle = await this.calibration.getBundle();

    for (const m of matches) {
      scanned += 1;
      try {
        const preMatch = await this.prisma.aiReport.findFirst({
          where: {
            entityType: AiEntityType.MATCH,
            entityId: m.id,
            status: AiReportStatus.DONE,
            reportType: { in: PRE_MATCH_REPORT_TYPES },
            createdAt: { lt: m.kickoffAt },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, createdAt: true, structuredJson: true },
        });
        // Prefer the real pre-kickoff report, but only if it is actually
        // scoreable — an unscoreable one (e.g. mock all-zero leans) falls
        // back to a retro report rather than leaving the match unsettled.
        let report = preMatch;
        let snapshot = preMatch
          ? parsePredictionSnapshot(preMatch.structuredJson)
          : null;
        let retro = false;
        if (!snapshot) {
          const retroReport = await this.prisma.aiReport.findFirst({
            where: {
              entityType: AiEntityType.MATCH,
              entityId: m.id,
              status: AiReportStatus.DONE,
              reportType: RETRO_REPORT_TYPE,
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, createdAt: true, structuredJson: true },
          });
          const retroSnapshot = retroReport
            ? parsePredictionSnapshot(retroReport.structuredJson)
            : null;
          if (retroSnapshot) {
            report = retroReport;
            snapshot = retroSnapshot;
            retro = true;
          }
        }
        if (!report || !snapshot) {
          noPrediction += 1;
          continue;
        }

        const metrics = scorePrediction(snapshot, m.homeScore!, m.awayScore!);

        // Program-blend scorelines, settled alongside the raw AI ones as an
        // A/B comparison. Rolling-parameter backtest: only pre-kickoff inputs,
        // but with the calibration params as fitted at settlement time.
        let programScorelines: Prisma.InputJsonValue | typeof Prisma.DbNull =
          Prisma.DbNull;
        let programExactScoreHit: boolean | null = null;
        let programTop3ScoreHit: boolean | null = null;
        const rawOutcome = normalizeLeans(
          snapshot.homeWinLean,
          snapshot.drawLean,
          snapshot.awayWinLean,
        );
        if (rawOutcome) {
          const tempered = applyTendencyCalibration(
            bundle.tendency,
            snapshot.homeWinLean,
            snapshot.drawLean,
            snapshot.awayWinLean,
          );
          const program = buildProgramScorelines(
            snapshot.likelyScorelines,
            rawOutcome,
            tempered
              ? {
                  home: tempered.homeWinProbability,
                  draw: tempered.drawProbability,
                  away: tempered.awayWinProbability,
                }
              : rawOutcome,
            bundle.scoreline,
            bundle.scorelineBlend,
          );
          if (program && program.length > 0) {
            const actualKey = `${m.homeScore!}-${m.awayScore!}`;
            programScorelines = program as unknown as Prisma.InputJsonValue;
            programExactScoreHit = program[0].score === actualKey;
            programTop3ScoreHit = program.some((s) => s.score === actualKey);
          }
        }

        const fields = {
          reportId: report.id,
          retro,
          predictedAt: report.createdAt,
          homeWinLean: snapshot.homeWinLean,
          drawLean: snapshot.drawLean,
          awayWinLean: snapshot.awayWinLean,
          likelyScorelines: snapshot.likelyScorelines as unknown as Prisma.InputJsonValue,
          actualHomeScore: m.homeScore!,
          actualAwayScore: m.awayScore!,
          tendencyPredicted: metrics.tendencyPredicted,
          tendencyActual: metrics.tendencyActual,
          tendencyHit: metrics.tendencyHit,
          exactScoreHit: metrics.exactScoreHit,
          top3ScoreHit: metrics.top3ScoreHit,
          brierScore: metrics.brierScore,
          programScorelines,
          programExactScoreHit,
          programTop3ScoreHit,
        };
        await this.prisma.matchPredictionOutcome.upsert({
          where: { matchId: m.id },
          create: { matchId: m.id, ...fields },
          update: fields,
        });
        scored += 1;
      } catch {
        failed += 1;
      }
    }

    return { scope: "prediction-scoring", scanned, scored, noPrediction, failed };
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

    // Calibrated probabilities: temperature scaling fitted on past real
    // predictions plus a shrunk per-team bias tilt. Raw leans stay untouched.
    const homeWinLean = structured?.prediction?.homeWinLean ?? null;
    const drawLean = structured?.prediction?.drawLean ?? null;
    const awayWinLean = structured?.prediction?.awayWinLean ?? null;
    const bundle = await this.calibration.getBundle();
    const homeShift = bundle.teamBias.get(match.homeTeamId) ?? 0;
    const awayShift = bundle.teamBias.get(match.awayTeamId) ?? 0;
    const scaled = applyTendencyCalibration(
      bundle.tendency,
      homeWinLean,
      drawLean,
      awayWinLean,
      homeShift,
      awayShift,
    );
    const calibratedScorelines = scaled
      ? buildProgramScorelines(
          likelyScorelines,
          normalizeLeans(homeWinLean, drawLean, awayWinLean),
          {
            home: scaled.homeWinProbability,
            draw: scaled.drawProbability,
            away: scaled.awayWinProbability,
          },
          bundle.scoreline,
          bundle.scorelineBlend,
        )
      : null;

    return {
      matchId,
      homeWinProbability: homeWinLean,
      drawProbability: drawLean,
      awayWinProbability: awayWinLean,
      likelyScorelines,
      keyFactors: structured?.keyFactors ?? [],
      riskNotes: structured?.risks ?? [],
      report: report ? toAiReportDto(report) : null,
      sourceUpdatedAt: match.sourceUpdatedAt
        ? match.sourceUpdatedAt.toISOString()
        : null,
      calibrated:
        scaled && bundle.tendency
          ? {
              method: "temperature+team-bias" as const,
              ...scaled,
              temperature: round2(bundle.tendency.temperature),
              sampleSize: bundle.tendency.sampleSize,
              homeBiasAdjustment: homeShift !== 0 ? round2(homeShift) : null,
              awayBiasAdjustment: awayShift !== 0 ? round2(awayShift) : null,
              scorelines: calibratedScorelines,
            }
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
