import { Injectable } from '@nestjs/common';
import type { MatchPredictionOutcome } from '@prisma/client';
import type {
  PredictionInsightsBucketDto,
  PredictionInsightsDto,
  PredictionOutcomeItemDto,
  PredictionTeamBiasDto,
  PredictionTendency,
  ScoreLinePredictionDto,
} from '../common/dto/contracts';
import { toTeamSummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';
import { CalibrationService } from './calibration.service';

/** A World Cup has ≤104 matches — one query, no pagination needed. */
const MAX_ITEMS = 200;

type TeamRow = Parameters<typeof toTeamSummary>[0] & { id: string };

type OutcomeWithMatch = MatchPredictionOutcome & {
  match: {
    stage: string;
    kickoffAt: Date;
    homeTeam: TeamRow;
    awayTeam: TeamRow;
  };
};

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calibration: CalibrationService,
  ) {}

  /**
   * Aggregated prediction accuracy for the PREMIUM insights page. `real`
   * (pre-kickoff predictions) and `retro` (backfilled) are aggregated
   * separately — retro predictions may be contaminated by the model's
   * training data and must never be read as genuine accuracy.
   */
  async getPredictionInsights(): Promise<PredictionInsightsDto> {
    const outcomes = (await this.prisma.matchPredictionOutcome.findMany({
      take: MAX_ITEMS,
      orderBy: { match: { kickoffAt: 'desc' } },
      include: {
        match: {
          select: {
            stage: true,
            kickoffAt: true,
            homeTeam: true,
            awayTeam: true,
          },
        },
      },
    })) as OutcomeWithMatch[];

    const byStageMap = new Map<string, OutcomeWithMatch[]>();
    for (const o of outcomes) {
      const list = byStageMap.get(o.match.stage) ?? [];
      list.push(o);
      byStageMap.set(o.match.stage, list);
    }

    const params = await this.calibration.getParams();

    return {
      summary: {
        overall: bucket(outcomes),
        real: bucket(outcomes.filter((o) => !o.retro)),
        retro: bucket(outcomes.filter((o) => o.retro)),
      },
      // Chronological stage order = order of each stage's earliest kickoff.
      byStage: [...byStageMap.entries()]
        .sort(
          (a, b) =>
            Math.min(...a[1].map((o) => o.match.kickoffAt.getTime())) -
            Math.min(...b[1].map((o) => o.match.kickoffAt.getTime())),
        )
        .map(([stage, list]) => ({ stage, ...bucket(list) })),
      byTeam: teamBias(outcomes),
      calibration: params
        ? {
            sampleSize: params.sampleSize,
            avgConfidence: params.avgConfidence,
            tendencyHitRate: params.tendencyHitRate,
            lambda: params.lambda,
            applied: params.applied,
          }
        : null,
      items: outcomes.map((o) => this.toItem(o)),
    };
  }

  private toItem(o: OutcomeWithMatch): PredictionOutcomeItemDto {
    return {
      matchId: o.matchId,
      stage: o.match.stage,
      kickoffAt: o.match.kickoffAt.toISOString(),
      homeTeam: toTeamSummary(o.match.homeTeam),
      awayTeam: toTeamSummary(o.match.awayTeam),
      actualHomeScore: o.actualHomeScore,
      actualAwayScore: o.actualAwayScore,
      retro: o.retro,
      predictedAt: o.predictedAt.toISOString(),
      homeWinLean: o.homeWinLean,
      drawLean: o.drawLean,
      awayWinLean: o.awayWinLean,
      likelyScorelines: parseScorelines(o.likelyScorelines),
      tendencyPredicted: (o.tendencyPredicted as PredictionTendency | null) ?? null,
      tendencyActual: o.tendencyActual as PredictionTendency,
      tendencyHit: o.tendencyHit,
      exactScoreHit: o.exactScoreHit,
      top3ScoreHit: o.top3ScoreHit,
      brierScore: o.brierScore,
    };
  }
}

function bucket(list: MatchPredictionOutcome[]): PredictionInsightsBucketDto {
  const total = list.length;
  const tendencyHits = list.filter((o) => o.tendencyHit).length;
  const exactScoreHits = list.filter((o) => o.exactScoreHit).length;
  const top3ScoreHits = list.filter((o) => o.top3ScoreHit).length;
  const briers = list
    .map((o) => o.brierScore)
    .filter((b): b is number => b !== null);
  const rate = (n: number) => (total > 0 ? n / total : null);
  return {
    total,
    tendencyHits,
    tendencyHitRate: rate(tendencyHits),
    exactScoreHits,
    exactScoreHitRate: rate(exactScoreHits),
    top3ScoreHits,
    top3ScoreHitRate: rate(top3ScoreHits),
    avgBrier: briers.length > 0 ? briers.reduce((a, b) => a + b, 0) / briers.length : null,
  };
}

/**
 * Per-team predicted-vs-actual bias. Rank map from the team's perspective:
 * win 2 / draw 1 / loss 0 — over-performed = actual rank beat the predicted
 * one. Only outcomes carrying a predicted tendency count; retro rows are
 * included as form feedback but surfaced via retroCount.
 */
function teamBias(outcomes: OutcomeWithMatch[]): PredictionTeamBiasDto[] {
  type Acc = { team: TeamRow; total: number; retroCount: number; hits: number; over: number; under: number };
  const acc = new Map<string, Acc>();
  const rankFor = (tendency: string, side: 'home' | 'away'): number => {
    if (tendency === 'DRAW') return 1;
    const won = side === 'home' ? tendency === 'HOME' : tendency === 'AWAY';
    return won ? 2 : 0;
  };
  for (const o of outcomes) {
    if (!o.tendencyPredicted) continue;
    for (const side of ['home', 'away'] as const) {
      const team = side === 'home' ? o.match.homeTeam : o.match.awayTeam;
      const entry = acc.get(team.id) ?? { team, total: 0, retroCount: 0, hits: 0, over: 0, under: 0 };
      entry.total += 1;
      if (o.retro) entry.retroCount += 1;
      if (o.tendencyHit) entry.hits += 1;
      const predicted = rankFor(o.tendencyPredicted, side);
      const actual = rankFor(o.tendencyActual, side);
      if (actual > predicted) entry.over += 1;
      else if (actual < predicted) entry.under += 1;
      acc.set(team.id, entry);
    }
  }
  return [...acc.values()]
    .sort((a, b) => b.total - a.total || a.team.nameEn.localeCompare(b.team.nameEn))
    .map((e) => ({
      team: toTeamSummary(e.team),
      total: e.total,
      retroCount: e.retroCount,
      tendencyHits: e.hits,
      tendencyHitRate: e.total > 0 ? e.hits / e.total : null,
      overPerformed: e.over,
      underPerformed: e.under,
    }));
}

/** likelyScorelines is stored as JSON — parse defensively for the DTO. */
function parseScorelines(json: unknown): ScoreLinePredictionDto[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      score: typeof s.score === 'string' ? s.score : '',
      probability: typeof s.probability === 'number' ? s.probability : null,
    }))
    .filter((s) => s.score.length > 0);
}
