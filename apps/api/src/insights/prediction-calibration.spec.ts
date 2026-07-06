import {
  applyCalibration,
  CALIBRATION_MIN_SAMPLE,
  computeCalibration,
} from './prediction-calibration';

const sample = (hit: boolean, leans: [number, number, number] = [60, 25, 15]) => ({
  homeWinLean: leans[0],
  drawLean: leans[1],
  awayWinLean: leans[2],
  tendencyHit: hit,
});

describe('computeCalibration', () => {
  it('returns null with no scoreable samples', () => {
    expect(computeCalibration([])).toBeNull();
    expect(
      computeCalibration([{ homeWinLean: null, drawLean: null, awayWinLean: null, tendencyHit: false }]),
    ).toBeNull();
  });

  it('stays un-applied below the minimum sample', () => {
    const params = computeCalibration(Array.from({ length: CALIBRATION_MIN_SAMPLE - 1 }, () => sample(true)));
    expect(params).toMatchObject({ sampleSize: CALIBRATION_MIN_SAMPLE - 1, applied: false });
  });

  it('measures overconfidence: λ < 1 when confidence beats the hit rate', () => {
    // Model always 60% confident but hits only half the time → λ = 0.5/0.6.
    const samples = Array.from({ length: 20 }, (_, i) => sample(i % 2 === 0));
    const params = computeCalibration(samples)!;
    expect(params.applied).toBe(true);
    expect(params.avgConfidence).toBeCloseTo(0.6);
    expect(params.tendencyHitRate).toBeCloseTo(0.5);
    expect(params.lambda).toBeCloseTo(0.5 / 0.6);
  });

  it('clamps λ into [0.5, 1.5]', () => {
    const allHit = computeCalibration(Array.from({ length: 20 }, () => sample(true, [40, 30, 30])))!;
    expect(allHit.lambda).toBeLessThanOrEqual(1.5); // 1/0.4 = 2.5 → clamped
    const allMiss = computeCalibration(Array.from({ length: 20 }, () => sample(false)))!;
    expect(allMiss.lambda).toBe(0.5); // 0/0.6 → clamped up to 0.5
  });
});

describe('applyCalibration', () => {
  const params = {
    sampleSize: 20,
    avgConfidence: 0.6,
    tendencyHitRate: 0.45,
    lambda: 0.75,
    applied: true,
  };

  it('pulls probabilities toward uniform for λ < 1 and keeps the sum at 100', () => {
    const c = applyCalibration(params, 60, 25, 15)!;
    expect(c.homeWinProbability).toBeLessThan(60);
    expect(c.homeWinProbability).toBeGreaterThan(100 / 3);
    expect(c.awayWinProbability).toBeGreaterThan(15);
    expect(c.homeWinProbability + c.drawProbability + c.awayWinProbability).toBeCloseTo(100, 0);
    // Order is preserved — calibration rescales, never reorders.
    expect(c.homeWinProbability).toBeGreaterThan(c.drawProbability);
    expect(c.drawProbability).toBeGreaterThan(c.awayWinProbability);
  });

  it('floors extreme probabilities instead of going negative for λ > 1', () => {
    const sharp = { ...params, lambda: 1.5 };
    const c = applyCalibration(sharp, 90, 8, 2)!;
    expect(c.awayWinProbability).toBeGreaterThan(0);
    expect(c.homeWinProbability + c.drawProbability + c.awayWinProbability).toBeCloseTo(100, 0);
  });

  it('returns null when un-applied or leans are missing', () => {
    expect(applyCalibration(null, 60, 25, 15)).toBeNull();
    expect(applyCalibration({ ...params, applied: false }, 60, 25, 15)).toBeNull();
    expect(applyCalibration(params, null, null, null)).toBeNull();
    expect(applyCalibration(params, 0, 0, 0)).toBeNull();
  });
});
