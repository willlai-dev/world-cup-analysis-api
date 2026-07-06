import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CalibrationParams,
  computeCalibration,
} from './prediction-calibration';

// Outcomes only change when SCORE_PREDICTIONS runs (a few times a day), so a
// short in-memory cache keeps getPrediction from re-scanning per request.
const CACHE_MS = 5 * 60_000;

/**
 * Shared source of the current calibration parameters. Samples are REAL
 * pre-kickoff outcomes only — retro (backfilled) predictions may be
 * contaminated by the model's training data and never feed calibration.
 */
@Injectable()
export class CalibrationService {
  private cache: { at: number; params: CalibrationParams | null } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getParams(): Promise<CalibrationParams | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.params;
    }
    const samples = await this.prisma.matchPredictionOutcome.findMany({
      where: { retro: false },
      select: {
        homeWinLean: true,
        drawLean: true,
        awayWinLean: true,
        tendencyHit: true,
      },
    });
    const params = computeCalibration(samples);
    this.cache = { at: Date.now(), params };
    return params;
  }
}
