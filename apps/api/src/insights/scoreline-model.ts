/**
 * Program scoreline model — pure functions.
 *
 * Football scores are highly structured (1-0 / 2-1 / 1-1 / 2-0 / 0-0 dominate),
 * which a free-form AI top-3 doesn't always respect. This module:
 *
 * 1. Fits Poisson goal rates (λ_home, λ_away) to the calibrated 1X2
 *    probabilities and expands them into a full score grid — the structural
 *    prior over scorelines.
 * 2. Blends the AI's (intercept-recalibrated, bucket-consistent) scorelines
 *    with that grid: p(s) = w·p_AI(s) + (1−w)·p_grid(s), re-ranking the top 3.
 *    The AI keeps its say where it has signal; exotic picks get displaced by
 *    modal scores.
 * 3. Fits the blend weight w on settled REAL pre-kickoff outcomes by
 *    maximizing the log-likelihood of the actual scores — if the AI list
 *    settles better than the grid, w drifts toward 1 automatically.
 */

import {
  parseScoreline,
  tendencyFromScore,
  type Tendency,
} from '../matches/prediction-scoring';
import {
  applyBucketCap,
  bucketOf,
  calibrateScorelines,
  recalibrateClaim,
  type OutcomeProbabilities,
  type ScorelineCalibrationParams,
} from './scoreline-calibration';

/** Score grid covers 0..6 goals per side, then normalizes the truncated mass. */
export const POISSON_MAX_GOALS = 6;
/** AI weight while the blend is unfitted (small samples). */
export const BLEND_WEIGHT_DEFAULT = 0.5;
export const BLEND_MIN_SAMPLE = 10;
const PROGRAM_TOP_K = 3;
const LAMBDA_MIN = 0.2;
const LAMBDA_MAX = 3.2;
const LAMBDA_STEP = 0.05;
/** World Cup matches average ~2.6 total goals; regularizes the λ fit, since
 * 1X2 probabilities alone don't pin down the total-goals level. */
const TOTAL_GOALS_ANCHOR = 2.6;
const TOTAL_GOALS_REG = 0.02;
const WEIGHT_STEP = 0.05;
const BLEND_PROB_FLOOR = 1e-6;

/** P(X = 0..maxGoals) for X ~ Poisson(λ), computed iteratively. */
function poissonPmf(lambda: number, maxGoals: number): number[] {
  const pmf: number[] = [Math.exp(-lambda)];
  for (let k = 1; k <= maxGoals; k += 1) {
    pmf.push((pmf[k - 1] * lambda) / k);
  }
  return pmf;
}

/** 1X2 probabilities (0-1, normalized over the truncated grid). */
function outcomeFromPmfs(
  home: number[],
  away: number[],
): { home: number; draw: number; away: number } {
  let h = 0;
  let d = 0;
  let a = 0;
  for (let i = 0; i < home.length; i += 1) {
    for (let j = 0; j < away.length; j += 1) {
      const p = home[i] * away[j];
      if (i > j) h += p;
      else if (i < j) a += p;
      else d += p;
    }
  }
  const total = h + d + a;
  return { home: h / total, draw: d / total, away: a / total };
}

/**
 * Fits (λ_home, λ_away) to target 1X2 probabilities (0-100) by grid search:
 * squared error on the grid-implied 1X2 plus a mild pull of the total-goals
 * level toward the World Cup average. Deterministic; ~3.7k candidates.
 */
export function fitPoissonRates(target: OutcomeProbabilities): {
  lambdaHome: number;
  lambdaAway: number;
} {
  const sum = target.home + target.draw + target.away;
  const t =
    sum > 0
      ? { home: target.home / sum, draw: target.draw / sum, away: target.away / sum }
      : { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };

  const lambdas: number[] = [];
  for (let l = LAMBDA_MIN; l <= LAMBDA_MAX + 1e-9; l += LAMBDA_STEP) {
    lambdas.push(Math.round(l * 100) / 100);
  }
  const pmfs = lambdas.map((l) => poissonPmf(l, POISSON_MAX_GOALS));

  let best = { lambdaHome: 1.3, lambdaAway: 1.3 };
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let i = 0; i < lambdas.length; i += 1) {
    for (let j = 0; j < lambdas.length; j += 1) {
      const o = outcomeFromPmfs(pmfs[i], pmfs[j]);
      const mu = lambdas[i] + lambdas[j];
      const loss =
        (o.home - t.home) ** 2 +
        (o.draw - t.draw) ** 2 +
        (o.away - t.away) ** 2 +
        TOTAL_GOALS_REG * (mu - TOTAL_GOALS_ANCHOR) ** 2;
      if (loss < bestLoss - 1e-12) {
        bestLoss = loss;
        best = { lambdaHome: lambdas[i], lambdaAway: lambdas[j] };
      }
    }
  }
  return best;
}

/** Truncated, normalized score grid: "h-a" → probability (0-1). */
export function poissonScoreGrid(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals = POISSON_MAX_GOALS,
): Map<string, number> {
  const home = poissonPmf(lambdaHome, maxGoals);
  const away = poissonPmf(lambdaAway, maxGoals);
  let total = 0;
  for (let i = 0; i <= maxGoals; i += 1) {
    for (let j = 0; j <= maxGoals; j += 1) total += home[i] * away[j];
  }
  const grid = new Map<string, number>();
  for (let i = 0; i <= maxGoals; i += 1) {
    for (let j = 0; j <= maxGoals; j += 1) {
      grid.set(`${i}-${j}`, (home[i] * away[j]) / total);
    }
  }
  return grid;
}

/** AI scorelines → absolute probabilities (0-1): intercept recalibration plus
 * consistency rescale into the target's tendency buckets. */
function aiScorelineProbabilities(
  aiScorelines: { score: string; probability: number | null }[],
  rawOutcome: OutcomeProbabilities | null,
  targetOutcome: OutcomeProbabilities,
  interceptParams: ScorelineCalibrationParams | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of aiScorelines) {
    if (item.probability === null || !Number.isFinite(item.probability)) continue;
    const parsed = parseScoreline(item.score);
    if (parsed === null) continue;
    const tendency = tendencyFromScore(parsed.home, parsed.away);
    const rawBucket = rawOutcome ? bucketOf(rawOutcome, tendency) : 0;
    const factor = rawBucket > 0 ? bucketOf(targetOutcome, tendency) / rawBucket : 1;
    // Normalize the score key so grid entries ("2-1") and AI variants ("2 : 1")
    // merge instead of competing.
    out.set(
      `${parsed.home}-${parsed.away}`,
      recalibrateClaim(item.probability, interceptParams) * factor,
    );
  }
  return out;
}

export type BlendParams = {
  /** Weight on the AI scorelines; 1−weight goes to the Poisson grid. */
  weight: number;
  sampleSize: number;
  applied: boolean;
};

export type BlendSample = {
  homeWinLean: number | null;
  drawLean: number | null;
  awayWinLean: number | null;
  likelyScorelines: unknown;
  actualHomeScore: number;
  actualAwayScore: number;
};

function normalizeOutcome(
  home: number | null,
  draw: number | null,
  away: number | null,
): OutcomeProbabilities | null {
  const h = home ?? 0;
  const d = draw ?? 0;
  const a = away ?? 0;
  const sum = h + d + a;
  if (sum <= 0) return null;
  return { home: (h / sum) * 100, draw: (d / sum) * 100, away: (a / sum) * 100 };
}

/** Temperature-scaled outcome (0-100). Team-bias tilts are deliberately left
 * out here — fitting samples would need team lookups for marginal gain. */
function temperedOutcome(
  raw: OutcomeProbabilities,
  temperature: number,
): OutcomeProbabilities {
  const invT = 1 / temperature;
  const h = Math.max(raw.home / 100, 1e-9) ** invT;
  const d = Math.max(raw.draw / 100, 1e-9) ** invT;
  const a = Math.max(raw.away / 100, 1e-9) ** invT;
  const sum = h + d + a;
  return { home: (h / sum) * 100, draw: (d / sum) * 100, away: (a / sum) * 100 };
}

/** Defensive parse of a stored likelyScorelines JSON blob. */
function parseStoredScorelines(
  json: unknown,
): { score: string; probability: number | null }[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      score: typeof s.score === 'string' ? s.score : '',
      probability:
        typeof s.probability === 'number' && Number.isFinite(s.probability)
          ? s.probability
          : null,
    }))
    .filter((s) => s.score.length > 0);
}

/**
 * Fits the AI-vs-grid blend weight by grid search maximizing the Bernoulli-free
 * log-likelihood Σ log p_blend(actual score) over settled samples. Near-ties
 * resolve toward the default weight.
 */
export function fitBlendWeight(
  samples: BlendSample[],
  temperature: number,
  interceptParams: ScorelineCalibrationParams | null,
): BlendParams | null {
  // Precompute per-sample (aiProbs, grid, actual key) once; then scan w.
  const prepared: {
    ai: Map<string, number>;
    grid: Map<string, number>;
    actual: string;
  }[] = [];
  for (const s of samples) {
    const raw = normalizeOutcome(s.homeWinLean, s.drawLean, s.awayWinLean);
    if (!raw) continue;
    const target = temperedOutcome(raw, temperature);
    const { lambdaHome, lambdaAway } = fitPoissonRates(target);
    prepared.push({
      ai: aiScorelineProbabilities(
        parseStoredScorelines(s.likelyScorelines),
        raw,
        target,
        interceptParams,
      ),
      grid: poissonScoreGrid(lambdaHome, lambdaAway),
      actual: `${s.actualHomeScore}-${s.actualAwayScore}`,
    });
  }
  if (prepared.length === 0) return null;
  if (prepared.length < BLEND_MIN_SAMPLE) {
    return {
      weight: BLEND_WEIGHT_DEFAULT,
      sampleSize: prepared.length,
      applied: false,
    };
  }

  let bestW = BLEND_WEIGHT_DEFAULT;
  let bestLl = Number.NEGATIVE_INFINITY;
  for (let w = 0; w <= 1 + 1e-9; w += WEIGHT_STEP) {
    const W = Math.round(w * 100) / 100;
    let ll = 0;
    for (const p of prepared) {
      const blended =
        W * (p.ai.get(p.actual) ?? 0) + (1 - W) * (p.grid.get(p.actual) ?? 0);
      ll += Math.log(Math.max(blended, BLEND_PROB_FLOOR));
    }
    const better =
      ll > bestLl + 1e-12 ||
      (Math.abs(ll - bestLl) <= 1e-12 &&
        Math.abs(W - BLEND_WEIGHT_DEFAULT) < Math.abs(bestW - BLEND_WEIGHT_DEFAULT));
    if (better) {
      bestLl = ll;
      bestW = W;
    }
  }
  return { weight: bestW, sampleSize: prepared.length, applied: true };
}

/**
 * Program scorelines for one prediction: blend the AI's recalibrated top-3
 * with the Poisson grid fitted to the calibrated 1X2, take the top 3 and cap
 * them per tendency bucket. Without usable leans there is no grid — falls
 * back to the AI-only calibrated list.
 */
export function buildProgramScorelines(
  aiScorelines: { score: string; probability: number | null }[],
  rawOutcome: OutcomeProbabilities | null,
  calibratedOutcome: OutcomeProbabilities,
  interceptParams: ScorelineCalibrationParams | null,
  blend: BlendParams | null,
): { score: string; probability: number }[] | null {
  if (!rawOutcome) {
    return calibrateScorelines(aiScorelines, rawOutcome, calibratedOutcome, interceptParams);
  }

  const weight = blend?.weight ?? BLEND_WEIGHT_DEFAULT;
  const ai = aiScorelineProbabilities(
    aiScorelines,
    rawOutcome,
    calibratedOutcome,
    interceptParams,
  );
  const { lambdaHome, lambdaAway } = fitPoissonRates(calibratedOutcome);
  const grid = poissonScoreGrid(lambdaHome, lambdaAway);

  const candidates = new Map<string, number>();
  for (const [score, p] of grid) candidates.set(score, (1 - weight) * p);
  for (const [score, p] of ai) {
    candidates.set(score, (candidates.get(score) ?? 0) + weight * p);
  }

  const top = [...candidates.entries()]
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PROGRAM_TOP_K)
    .map(([score, p]) => {
      const parsed = parseScoreline(score)!;
      return { score, tendency: tendencyFromScore(parsed.home, parsed.away), p };
    });
  if (top.length === 0) return null;
  return applyBucketCap(top, calibratedOutcome);
}
