/**
 * Program-rule probability calibration — pure functions only.
 *
 * Two-stage pipeline over REAL pre-kickoff outcomes only (retro rows may be
 * contaminated by the model's training data and never feed calibration):
 *
 * 1. Temperature scaling — p_i ← p_i^(1/T) / Σ p_j^(1/T), with T fitted by
 *    minimizing multi-class log loss on settled samples. T > 1 means the
 *    model has been overconfident → probabilities are pulled toward uniform;
 *    T < 1 sharpens. Unlike the previous linear blend toward 1/3, this is a
 *    proper likelihood-fitted calibration and can never produce negative
 *    probabilities.
 *
 * 2. Per-team bias tilt — teams that systematically over/under-perform their
 *    predicted tendency get a small log-odds shift on their win probability.
 *    Per-team samples are tiny (≤ 8 matches), so the raw bias is shrunk
 *    empirical-Bayes style by n/(n+K) and hard-capped before use.
 */

import type { Tendency } from '../matches/prediction-scoring';

export type { Tendency };

export const CALIBRATION_MIN_SAMPLE = 10;
export const TEMPERATURE_MIN = 0.25;
export const TEMPERATURE_MAX = 4;
const TEMPERATURE_STEP = 0.01;
const PROB_FLOOR = 0.01;
const PROB_EPSILON = 1e-9;
/** Shrinkage: a team's mean bias is weighted by n/(n+K). */
export const TEAM_BIAS_SHRINK_K = 6;
/** Log-odds shift per 1.0 of shrunk mean rank bias (rank ∈ {0,1,2}). */
export const TEAM_BIAS_LOGIT_SCALE = 0.25;
/** Hard cap on a team's log-odds shift (exp(0.35) ≈ 1.42× tilt). */
export const TEAM_BIAS_LOGIT_MAX = 0.35;

export type CalibrationSample = {
  homeWinLean: number | null;
  drawLean: number | null;
  awayWinLean: number | null;
  tendencyActual: Tendency;
  tendencyHit: boolean;
};

export type TendencyCalibrationParams = {
  sampleSize: number;
  /** Mean normalized probability the model gave its own predicted tendency. */
  avgConfidence: number;
  tendencyHitRate: number;
  temperature: number;
  /** false while sampleSize < CALIBRATION_MIN_SAMPLE — params are FYI only. */
  applied: boolean;
  /** Mean multi-class Brier of the raw (normalized) probabilities. */
  baselineBrier: number;
  /** Same samples after temperature scaling — in-sample backtest evidence. */
  calibratedBrier: number;
};

type Triple = [number, number, number];

const TENDENCY_INDEX: Record<Tendency, number> = { HOME: 0, DRAW: 1, AWAY: 2 };

function normalizeTriple(
  home: number | null,
  draw: number | null,
  away: number | null,
): Triple | null {
  const h = home ?? 0;
  const d = draw ?? 0;
  const a = away ?? 0;
  const sum = h + d + a;
  if (sum <= 0) return null;
  return [h / sum, d / sum, a / sum];
}

function applyTemperature(p: Triple, temperature: number): Triple {
  const powed = p.map((v) =>
    Math.max(v, PROB_EPSILON) ** (1 / temperature),
  ) as Triple;
  const total = powed[0] + powed[1] + powed[2];
  return [powed[0] / total, powed[1] / total, powed[2] / total];
}

function meanBrier(probs: Triple[], actuals: Tendency[]): number {
  let sum = 0;
  for (let i = 0; i < probs.length; i += 1) {
    const target = TENDENCY_INDEX[actuals[i]];
    for (let j = 0; j < 3; j += 1) {
      const o = j === target ? 1 : 0;
      sum += (probs[i][j] - o) ** 2;
    }
  }
  return probs.length > 0 ? sum / probs.length : 0;
}

/**
 * Fits T by grid search minimizing the multi-class negative log-likelihood.
 * Deterministic and instant at this scale (≤ ~100 samples × 376 grid points).
 * Near-ties resolve to the T closest to 1 (no change).
 */
export function fitTemperature(probs: Triple[], actuals: Tendency[]): number {
  if (probs.length === 0) return 1;
  let bestT = 1;
  let bestNll = Number.POSITIVE_INFINITY;
  for (let t = TEMPERATURE_MIN; t <= TEMPERATURE_MAX + 1e-9; t += TEMPERATURE_STEP) {
    const T = Math.round(t * 100) / 100;
    let nll = 0;
    for (let i = 0; i < probs.length; i += 1) {
      const scaled = applyTemperature(probs[i], T);
      nll -= Math.log(Math.max(scaled[TENDENCY_INDEX[actuals[i]]], PROB_EPSILON));
    }
    nll /= probs.length;
    const better =
      nll < bestNll - 1e-12 ||
      (Math.abs(nll - bestNll) <= 1e-12 && Math.abs(T - 1) < Math.abs(bestT - 1));
    if (better) {
      bestNll = nll;
      bestT = T;
    }
  }
  return bestT;
}

export function computeTendencyCalibration(
  samples: CalibrationSample[],
): TendencyCalibrationParams | null {
  const probs: Triple[] = [];
  const actuals: Tendency[] = [];
  let confidenceSum = 0;
  let hits = 0;
  for (const s of samples) {
    const p = normalizeTriple(s.homeWinLean, s.drawLean, s.awayWinLean);
    if (!p) continue;
    probs.push(p);
    actuals.push(s.tendencyActual);
    confidenceSum += Math.max(p[0], p[1], p[2]);
    if (s.tendencyHit) hits += 1;
  }
  const sampleSize = probs.length;
  if (sampleSize === 0) return null;

  const temperature = fitTemperature(probs, actuals);
  return {
    sampleSize,
    avgConfidence: confidenceSum / sampleSize,
    tendencyHitRate: hits / sampleSize,
    temperature,
    applied: sampleSize >= CALIBRATION_MIN_SAMPLE,
    baselineBrier: meanBrier(probs, actuals),
    calibratedBrier: meanBrier(
      probs.map((p) => applyTemperature(p, temperature)),
      actuals,
    ),
  };
}

export type TeamBiasSampleRow = {
  tendencyPredicted: Tendency | null;
  tendencyActual: Tendency;
  homeTeamId: string;
  awayTeamId: string;
};

/** Rank from one team's perspective: win 2 / draw 1 / loss 0. */
function rankFor(tendency: Tendency, side: 'home' | 'away'): number {
  if (tendency === 'DRAW') return 1;
  const won = side === 'home' ? tendency === 'HOME' : tendency === 'AWAY';
  return won ? 2 : 0;
}

/**
 * teamId → shrunk, capped log-odds shift for that team's win probability.
 * Positive = the team has been under-rated by past predictions.
 */
export function computeTeamBiasShifts(
  rows: TeamBiasSampleRow[],
): Map<string, number> {
  const acc = new Map<string, { biasSum: number; n: number }>();
  for (const row of rows) {
    if (!row.tendencyPredicted) continue;
    for (const side of ['home', 'away'] as const) {
      const teamId = side === 'home' ? row.homeTeamId : row.awayTeamId;
      const entry = acc.get(teamId) ?? { biasSum: 0, n: 0 };
      entry.biasSum +=
        rankFor(row.tendencyActual, side) - rankFor(row.tendencyPredicted, side);
      entry.n += 1;
      acc.set(teamId, entry);
    }
  }
  const shifts = new Map<string, number>();
  for (const [teamId, { biasSum, n }] of acc) {
    const shrunkMean = (biasSum / n) * (n / (n + TEAM_BIAS_SHRINK_K));
    const shift = Math.max(
      -TEAM_BIAS_LOGIT_MAX,
      Math.min(TEAM_BIAS_LOGIT_MAX, shrunkMean * TEAM_BIAS_LOGIT_SCALE),
    );
    if (shift !== 0) shifts.set(teamId, shift);
  }
  return shifts;
}

export type CalibratedProbabilities = {
  /** 0-100, same scale as the raw leans; the three sum to 100. */
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
};

/**
 * Calibrates one prediction's leans: normalize → temperature → team-bias
 * tilt (multiplying a class by e^shift equals adding `shift` to its
 * log-odds under softmax) → floor → renormalize. Returns null when the
 * params aren't applied yet (small sample) or the leans aren't scoreable.
 */
export function applyTendencyCalibration(
  params: TendencyCalibrationParams | null,
  homeWinLean: number | null,
  drawLean: number | null,
  awayWinLean: number | null,
  homeBiasShift = 0,
  awayBiasShift = 0,
): CalibratedProbabilities | null {
  if (!params || !params.applied) return null;
  const normalized = normalizeTriple(homeWinLean, drawLean, awayWinLean);
  if (!normalized) return null;

  const tempered = applyTemperature(normalized, params.temperature);
  const tilted: Triple = [
    tempered[0] * Math.exp(homeBiasShift),
    tempered[1],
    tempered[2] * Math.exp(awayBiasShift),
  ];
  const tiltedSum = tilted[0] + tilted[1] + tilted[2];
  const floored = tilted.map((v) =>
    Math.max(PROB_FLOOR, v / tiltedSum),
  ) as Triple;
  const total = floored[0] + floored[1] + floored[2];
  return {
    homeWinProbability: round1((floored[0] / total) * 100),
    drawProbability: round1((floored[1] / total) * 100),
    awayWinProbability: round1((floored[2] / total) * 100),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
