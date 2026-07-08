import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeTeamBiasShifts,
  computeTendencyCalibration,
  type Tendency,
  type TendencyCalibrationParams,
} from './prediction-calibration';
import {
  extractScorelineSamples,
  fitScorelineIntercept,
  type ScorelineCalibrationParams,
} from './scoreline-calibration';

// Outcomes only change when SCORE_PREDICTIONS runs (a few times a day), so a
// short in-memory cache keeps getPrediction from re-scanning per request.
const CACHE_MS = 5 * 60_000;

export type CalibrationBundle = {
  tendency: TendencyCalibrationParams | null;
  /** teamId → shrunk, capped log-odds shift for that team's win probability. */
  teamBias: Map<string, number>;
  scoreline: ScorelineCalibrationParams | null;
};

const EMPTY_BUNDLE: CalibrationBundle = {
  tendency: null,
  teamBias: new Map(),
  scoreline: null,
};

/**
 * Shared source of the current calibration parameters. Samples are REAL
 * pre-kickoff outcomes only — retro (backfilled) predictions may be
 * contaminated by the model's training data and never feed calibration.
 */
@Injectable()
export class CalibrationService {
  private cache: { at: number; bundle: CalibrationBundle } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getBundle(): Promise<CalibrationBundle> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.bundle;
    }
    const rows = await this.prisma.matchPredictionOutcome.findMany({
      where: { retro: false },
      select: {
        homeWinLean: true,
        drawLean: true,
        awayWinLean: true,
        tendencyPredicted: true,
        tendencyActual: true,
        tendencyHit: true,
        likelyScorelines: true,
        actualHomeScore: true,
        actualAwayScore: true,
        match: { select: { homeTeamId: true, awayTeamId: true } },
      },
    });

    const bundle: CalibrationBundle =
      rows.length === 0
        ? EMPTY_BUNDLE
        : {
            tendency: computeTendencyCalibration(
              rows.map((r) => ({
                homeWinLean: r.homeWinLean,
                drawLean: r.drawLean,
                awayWinLean: r.awayWinLean,
                tendencyActual: r.tendencyActual as Tendency,
                tendencyHit: r.tendencyHit,
              })),
            ),
            teamBias: computeTeamBiasShifts(
              rows.map((r) => ({
                tendencyPredicted: (r.tendencyPredicted as Tendency | null) ?? null,
                tendencyActual: r.tendencyActual as Tendency,
                homeTeamId: r.match.homeTeamId,
                awayTeamId: r.match.awayTeamId,
              })),
            ),
            scoreline: fitScorelineIntercept(extractScorelineSamples(rows)),
          };
    this.cache = { at: Date.now(), bundle };
    return bundle;
  }
}
