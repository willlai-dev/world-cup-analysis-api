import {
  applyTendencyCalibration,
  CALIBRATION_MIN_SAMPLE,
  computeTeamBiasShifts,
  computeTendencyCalibration,
  fitTemperature,
  TEAM_BIAS_LOGIT_MAX,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  type CalibrationSample,
  type Tendency,
} from './prediction-calibration';

function sample(
  actual: Tendency,
  leans: [number, number, number] = [70, 20, 10],
): CalibrationSample {
  return {
    homeWinLean: leans[0],
    drawLean: leans[1],
    awayWinLean: leans[2],
    tendencyActual: actual,
    tendencyHit: actual === 'HOME', // leans above always predict HOME
  };
}

/** 20 samples with 70% confidence on HOME but only a 40% hit rate. */
function overconfidentSamples(): CalibrationSample[] {
  return [
    ...Array.from({ length: 8 }, () => sample('HOME')),
    ...Array.from({ length: 6 }, () => sample('DRAW')),
    ...Array.from({ length: 6 }, () => sample('AWAY')),
  ];
}

describe('fitTemperature', () => {
  it('returns 1 with no samples', () => {
    expect(fitTemperature([], [])).toBe(1);
  });

  it('fits T > 1 (flatten) for overconfident predictions', () => {
    const probs = Array.from({ length: 20 }, () => [0.7, 0.2, 0.1] as [number, number, number]);
    const actuals: Tendency[] = [
      ...Array.from({ length: 8 }, () => 'HOME' as const),
      ...Array.from({ length: 6 }, () => 'DRAW' as const),
      ...Array.from({ length: 6 }, () => 'AWAY' as const),
    ];
    expect(fitTemperature(probs, actuals)).toBeGreaterThan(1);
  });

  it('fits T < 1 (sharpen) for underconfident always-right predictions', () => {
    const probs = Array.from({ length: 20 }, () => [0.4, 0.3, 0.3] as [number, number, number]);
    const actuals = Array.from({ length: 20 }, () => 'HOME' as const);
    const t = fitTemperature(probs, actuals);
    expect(t).toBeLessThan(1);
    expect(t).toBeGreaterThanOrEqual(TEMPERATURE_MIN);
  });

  it('clamps at the grid bounds for extreme samples', () => {
    const confident = Array.from({ length: 10 }, () => [0.9, 0.05, 0.05] as [number, number, number]);
    expect(fitTemperature(confident, Array.from({ length: 10 }, () => 'HOME' as const))).toBe(
      TEMPERATURE_MIN,
    );
    expect(fitTemperature(confident, Array.from({ length: 10 }, () => 'AWAY' as const))).toBe(
      TEMPERATURE_MAX,
    );
  });
});

describe('computeTendencyCalibration', () => {
  it('returns null with no usable samples', () => {
    expect(computeTendencyCalibration([])).toBeNull();
    expect(
      computeTendencyCalibration([
        { homeWinLean: null, drawLean: null, awayWinLean: null, tendencyActual: 'HOME', tendencyHit: false },
        { homeWinLean: 0, drawLean: 0, awayWinLean: 0, tendencyActual: 'HOME', tendencyHit: false },
      ]),
    ).toBeNull();
  });

  it('is not applied below the minimum sample size', () => {
    const params = computeTendencyCalibration(
      Array.from({ length: CALIBRATION_MIN_SAMPLE - 1 }, () => sample('HOME')),
    )!;
    expect(params.applied).toBe(false);
    expect(params.sampleSize).toBe(CALIBRATION_MIN_SAMPLE - 1);
  });

  it('improves the in-sample Brier score on overconfident data', () => {
    const params = computeTendencyCalibration(overconfidentSamples())!;
    expect(params.applied).toBe(true);
    expect(params.temperature).toBeGreaterThan(1);
    expect(params.avgConfidence).toBeCloseTo(0.7, 5);
    expect(params.tendencyHitRate).toBeCloseTo(0.4, 5);
    expect(params.calibratedBrier).toBeLessThan(params.baselineBrier);
  });
});

describe('computeTeamBiasShifts', () => {
  const overPerformRow = {
    // Predicted AWAY win but HOME won: home side over-performed (+2),
    // away side under-performed (−2).
    tendencyPredicted: 'AWAY' as Tendency,
    tendencyActual: 'HOME' as Tendency,
    homeTeamId: 'team-over',
    awayTeamId: 'team-under',
  };

  it('gives a shrunk positive shift to an over-performing team', () => {
    const shifts = computeTeamBiasShifts(Array.from({ length: 4 }, () => overPerformRow));
    // mean bias 2, shrunk by 4/(4+6)=0.4 → 0.8, ×0.25 → 0.2.
    expect(shifts.get('team-over')).toBeCloseTo(0.2, 5);
    expect(shifts.get('team-under')).toBeCloseTo(-0.2, 5);
  });

  it('caps the shift for large consistent bias', () => {
    const shifts = computeTeamBiasShifts(Array.from({ length: 20 }, () => overPerformRow));
    expect(shifts.get('team-over')).toBe(TEAM_BIAS_LOGIT_MAX);
    expect(shifts.get('team-under')).toBe(-TEAM_BIAS_LOGIT_MAX);
  });

  it('shrinks a single-sample bias to a tiny shift', () => {
    const shifts = computeTeamBiasShifts([overPerformRow]);
    // mean 2 × 1/7 × 0.25 ≈ 0.071 — far below the unshrunk 0.5.
    expect(shifts.get('team-over')!).toBeLessThan(0.1);
    expect(shifts.get('team-over')!).toBeGreaterThan(0);
  });

  it('omits balanced teams and skips rows without a predicted tendency', () => {
    const underRow = {
      ...overPerformRow,
      tendencyPredicted: 'HOME' as Tendency,
      tendencyActual: 'AWAY' as Tendency,
    };
    const shifts = computeTeamBiasShifts([
      overPerformRow,
      underRow, // cancels out for both teams
      { ...overPerformRow, tendencyPredicted: null },
    ]);
    expect(shifts.size).toBe(0);
  });
});

describe('applyTendencyCalibration', () => {
  const params = computeTendencyCalibration(overconfidentSamples())!;

  it('returns null without applied params or usable leans', () => {
    expect(applyTendencyCalibration(null, 60, 25, 15)).toBeNull();
    expect(applyTendencyCalibration({ ...params, applied: false }, 60, 25, 15)).toBeNull();
    expect(applyTendencyCalibration(params, null, null, null)).toBeNull();
    expect(applyTendencyCalibration(params, 0, 0, 0)).toBeNull();
  });

  it('sums to ~100 and flattens overconfident probabilities toward uniform', () => {
    const c = applyTendencyCalibration(params, 70, 20, 10)!;
    const sum = c.homeWinProbability + c.drawProbability + c.awayWinProbability;
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.2);
    // T > 1 pulls the top probability down and the tail up, keeping the order.
    expect(c.homeWinProbability).toBeLessThan(70);
    expect(c.awayWinProbability).toBeGreaterThan(10);
    expect(c.homeWinProbability).toBeGreaterThan(c.drawProbability);
    expect(c.drawProbability).toBeGreaterThan(c.awayWinProbability);
  });

  it('applies team-bias tilts in the right direction', () => {
    const base = applyTendencyCalibration(params, 50, 30, 20)!;
    const tilted = applyTendencyCalibration(params, 50, 30, 20, 0.3, -0.3)!;
    expect(tilted.homeWinProbability).toBeGreaterThan(base.homeWinProbability);
    expect(tilted.awayWinProbability).toBeLessThan(base.awayWinProbability);
  });

  it('floors extreme probabilities away from zero', () => {
    const c = applyTendencyCalibration(params, 100, 0, 0)!;
    expect(c.drawProbability).toBeGreaterThanOrEqual(0.9);
    expect(c.awayWinProbability).toBeGreaterThanOrEqual(0.9);
  });
});
