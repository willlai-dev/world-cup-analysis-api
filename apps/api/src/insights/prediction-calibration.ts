/**
 * Program-rule probability calibration — pure functions only.
 *
 * Idea: compare the model's average confidence (mean probability it put on its
 * predicted tendency) against how often that tendency actually hit, over REAL
 * pre-kickoff outcomes only (retro is contaminated). The ratio λ scales how
 * far probabilities deviate from uniform:
 *
 *   λ = clamp(hitRate / avgConfidence, 0.5, 1.5)
 *   p_cal = 1/3 + λ · (p − 1/3), floored then renormalized
 *
 * λ < 1 → the model has been overconfident → pull toward uniform.
 * λ > 1 → underconfident → sharpen. Small samples don't calibrate at all.
 */

export const CALIBRATION_MIN_SAMPLE = 10;
const LAMBDA_MIN = 0.5;
const LAMBDA_MAX = 1.5;
const PROB_FLOOR = 0.01;

export type CalibrationSample = {
  homeWinLean: number | null;
  drawLean: number | null;
  awayWinLean: number | null;
  tendencyHit: boolean;
};

export type CalibrationParams = {
  sampleSize: number;
  /** Mean normalized probability the model gave its own predicted tendency. */
  avgConfidence: number;
  tendencyHitRate: number;
  lambda: number;
  /** false while sampleSize < CALIBRATION_MIN_SAMPLE — params are FYI only. */
  applied: boolean;
};

export function computeCalibration(samples: CalibrationSample[]): CalibrationParams | null {
  const usable = samples.filter((s) => {
    const sum = (s.homeWinLean ?? 0) + (s.drawLean ?? 0) + (s.awayWinLean ?? 0);
    return sum > 0;
  });
  if (usable.length === 0) return null;

  let confidenceSum = 0;
  let hits = 0;
  for (const s of usable) {
    const h = s.homeWinLean ?? 0;
    const d = s.drawLean ?? 0;
    const a = s.awayWinLean ?? 0;
    confidenceSum += Math.max(h, d, a) / (h + d + a);
    if (s.tendencyHit) hits += 1;
  }
  const sampleSize = usable.length;
  const avgConfidence = confidenceSum / sampleSize;
  const tendencyHitRate = hits / sampleSize;
  const lambda = Math.min(
    LAMBDA_MAX,
    Math.max(LAMBDA_MIN, tendencyHitRate / avgConfidence),
  );
  return {
    sampleSize,
    avgConfidence,
    tendencyHitRate,
    lambda,
    applied: sampleSize >= CALIBRATION_MIN_SAMPLE,
  };
}

export type CalibratedProbabilities = {
  /** 0-100, same scale as the raw leans; the three sum to 100. */
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
};

/**
 * Scale one prediction's leans by λ. Returns null when the params aren't
 * applied yet (small sample) or the leans aren't scoreable.
 */
export function applyCalibration(
  params: CalibrationParams | null,
  homeWinLean: number | null,
  drawLean: number | null,
  awayWinLean: number | null,
): CalibratedProbabilities | null {
  if (!params || !params.applied) return null;
  const h = homeWinLean ?? 0;
  const d = drawLean ?? 0;
  const a = awayWinLean ?? 0;
  const sum = h + d + a;
  if (sum <= 0) return null;

  const scale = (p: number) =>
    Math.max(PROB_FLOOR, 1 / 3 + params.lambda * (p / sum - 1 / 3));
  const ch = scale(h);
  const cd = scale(d);
  const ca = scale(a);
  const total = ch + cd + ca;
  return {
    homeWinProbability: round1((ch / total) * 100),
    drawProbability: round1((cd / total) * 100),
    awayWinProbability: round1((ca / total) * 100),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
