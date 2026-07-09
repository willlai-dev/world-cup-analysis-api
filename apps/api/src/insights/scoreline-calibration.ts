/**
 * Program-rule calibration of AI scoreline probabilities — pure functions.
 *
 * Two steps applied per prediction:
 * 1. Confidence recalibration — intercept-only logistic recalibration
 *    p' = σ(logit(p) + b), with b fitted by maximizing the Bernoulli
 *    likelihood of historical (claimed probability, hit) pairs across the
 *    up-to-3 ranked scorelines of settled REAL pre-kickoff predictions.
 * 2. Outcome consistency — each scoreline is rescaled by the ratio of the
 *    calibrated to the raw probability of its tendency bucket (home win /
 *    draw / away win), so scoreline probabilities agree with the calibrated
 *    1X2 numbers, and is capped at its bucket's calibrated probability.
 */

import {
  parseScoreline,
  tendencyFromScore,
  type Tendency,
} from '../matches/prediction-scoring';

/** ≈ 5 settled real matches × 3 ranked scorelines. */
export const SCORELINE_MIN_SAMPLE = 15;
const INTERCEPT_MIN = -3;
const INTERCEPT_MAX = 3;
const INTERCEPT_STEP = 0.01;
/** Claimed probabilities are clamped into (0,1) before logit. */
const CLAIM_MIN = 0.001;
const CLAIM_MAX = 0.99;

export type ScorelineHitSample = {
  /** Claimed probability, 0-100 scale as stored. */
  claimed: number;
  hit: boolean;
};

export type ScorelineCalibrationParams = {
  sampleSize: number;
  /** Log-odds intercept b; 0 while not applied. */
  intercept: number;
  applied: boolean;
};

type OutcomeScorelineRow = {
  likelyScorelines: unknown;
  actualHomeScore: number;
  actualAwayScore: number;
};

/**
 * Expands settled outcome rows into one binary sample per ranked scoreline.
 * likelyScorelines is stored JSON whose shape may drift across prompt
 * versions — parse defensively and skip anything malformed.
 */
export function extractScorelineSamples(
  rows: OutcomeScorelineRow[],
): ScorelineHitSample[] {
  const samples: ScorelineHitSample[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.likelyScorelines)) continue;
    for (const item of row.likelyScorelines) {
      if (!item || typeof item !== 'object') continue;
      const { score, probability } = item as Record<string, unknown>;
      if (typeof score !== 'string') continue;
      if (typeof probability !== 'number' || !Number.isFinite(probability)) continue;
      const parsed = parseScoreline(score);
      if (!parsed) continue;
      samples.push({
        claimed: probability,
        hit:
          parsed.home === row.actualHomeScore &&
          parsed.away === row.actualAwayScore,
      });
    }
  }
  return samples;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function clampClaim(probability: number): number {
  return Math.min(CLAIM_MAX, Math.max(CLAIM_MIN, probability / 100));
}

/** Claimed probability (0-100) → intercept-recalibrated probability (0-1). */
export function recalibrateClaim(
  probability: number,
  params: ScorelineCalibrationParams | null,
): number {
  const p = clampClaim(probability);
  if (!params?.applied || params.intercept === 0) return p;
  return sigmoid(logit(p) + params.intercept);
}

/**
 * Fits the intercept b by grid search maximizing Σ Bernoulli log-likelihood.
 * b < 0 → claimed scoreline probabilities have been too high overall.
 */
export function fitScorelineIntercept(
  samples: ScorelineHitSample[],
): ScorelineCalibrationParams | null {
  if (samples.length === 0) return null;
  if (samples.length < SCORELINE_MIN_SAMPLE) {
    return { sampleSize: samples.length, intercept: 0, applied: false };
  }
  const logits = samples.map((s) => logit(clampClaim(s.claimed)));
  let bestB = 0;
  let bestLl = Number.NEGATIVE_INFINITY;
  for (let b = INTERCEPT_MIN; b <= INTERCEPT_MAX + 1e-9; b += INTERCEPT_STEP) {
    const B = Math.round(b * 100) / 100;
    let ll = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const p = sigmoid(logits[i] + B);
      ll += Math.log(samples[i].hit ? p : 1 - p);
    }
    const better =
      ll > bestLl + 1e-12 ||
      (Math.abs(ll - bestLl) <= 1e-12 && Math.abs(B) < Math.abs(bestB));
    if (better) {
      bestLl = ll;
      bestB = B;
    }
  }
  return { sampleSize: samples.length, intercept: bestB, applied: true };
}

export type OutcomeProbabilities = {
  /** 0-100 each. */
  home: number;
  draw: number;
  away: number;
};

export function bucketOf(outcome: OutcomeProbabilities, tendency: Tendency): number {
  if (tendency === 'HOME') return outcome.home;
  if (tendency === 'AWAY') return outcome.away;
  return outcome.draw;
}

/**
 * Calibrates one prediction's scorelines against its calibrated 1X2
 * probabilities. Works without fitted params too (b = 0) — consistency with
 * the calibrated tendency probabilities always applies: the scorelines of one
 * tendency bucket never sum past that bucket's calibrated probability (so the
 * whole list can never exceed 100 either). Malformed entries are dropped;
 * returns null when nothing survives.
 */
export function calibrateScorelines(
  raw: { score: string; probability: number | null }[],
  rawOutcome: OutcomeProbabilities | null,
  calibratedOutcome: OutcomeProbabilities,
  params: ScorelineCalibrationParams | null,
): { score: string; probability: number }[] | null {
  const entries: { score: string; tendency: Tendency; p: number }[] = [];
  for (const item of raw) {
    if (item.probability === null || !Number.isFinite(item.probability)) continue;
    const parsed = parseScoreline(item.score);
    if (!parsed) continue;
    const tendency = tendencyFromScore(parsed.home, parsed.away);

    // 1. Confidence recalibration on the claimed probability.
    const recalibrated = recalibrateClaim(item.probability, params);

    // 2. Rescale into the calibrated tendency bucket — keeps P(score | bucket)
    //    shape while aligning the margins with the calibrated 1X2.
    const rawBucket = rawOutcome ? bucketOf(rawOutcome, tendency) : 0;
    const calBucket = bucketOf(calibratedOutcome, tendency);
    const factor = rawBucket > 0 ? calBucket / rawBucket : 1;
    entries.push({ score: item.score, tendency, p: recalibrated * factor });
  }
  if (entries.length === 0) return null;
  return applyBucketCap(entries, calibratedOutcome);
}

/**
 * Bucket-level cap: if a tendency bucket's scorelines sum past its calibrated
 * probability, scale them down proportionally (preserves their relative shape
 * and implies each single scoreline stays ≤ its bucket too). Returns the
 * 0-100 rounded list, probability-descending.
 */
export function applyBucketCap(
  entries: { score: string; tendency: Tendency; p: number }[],
  calibratedOutcome: OutcomeProbabilities,
): { score: string; probability: number }[] {
  const bucketSums = new Map<Tendency, number>();
  for (const e of entries) {
    bucketSums.set(e.tendency, (bucketSums.get(e.tendency) ?? 0) + e.p);
  }
  return entries
    .map((e) => {
      const calBucket = bucketOf(calibratedOutcome, e.tendency) / 100;
      const sum = bucketSums.get(e.tendency)!;
      const scale = sum > calBucket && sum > 0 ? calBucket / sum : 1;
      return { score: e.score, probability: round1(e.p * scale * 100) };
    })
    .sort((a, b) => b.probability - a.probability);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
