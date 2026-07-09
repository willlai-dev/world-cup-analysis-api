import {
  calibrateScorelines,
  extractScorelineSamples,
  fitScorelineIntercept,
  SCORELINE_MIN_SAMPLE,
  type ScorelineHitSample,
} from './scoreline-calibration';

const hitSamples = (n: number, claimed: number, hit: boolean): ScorelineHitSample[] =>
  Array.from({ length: n }, () => ({ claimed, hit }));

describe('extractScorelineSamples', () => {
  it('expands each ranked scoreline into one binary sample', () => {
    const samples = extractScorelineSamples([
      {
        likelyScorelines: [
          { score: '2-1', probability: 35 },
          { score: '1-1', probability: 25 },
          { score: '1-0', probability: 15 },
        ],
        actualHomeScore: 1,
        actualAwayScore: 1,
      },
    ]);
    expect(samples).toEqual([
      { claimed: 35, hit: false },
      { claimed: 25, hit: true },
      { claimed: 15, hit: false },
    ]);
  });

  it('skips malformed rows and entries defensively', () => {
    const samples = extractScorelineSamples([
      { likelyScorelines: 'not-an-array', actualHomeScore: 1, actualAwayScore: 0 },
      {
        likelyScorelines: [
          null,
          { score: 42, probability: 30 },
          { score: '2-1' }, // no probability
          { score: 'abc', probability: 30 }, // unparseable score
          { score: '3-0', probability: 10 },
        ],
        actualHomeScore: 3,
        actualAwayScore: 0,
      },
    ]);
    expect(samples).toEqual([{ claimed: 10, hit: true }]);
  });
});

describe('fitScorelineIntercept', () => {
  it('returns null with no samples and stays unapplied below the minimum', () => {
    expect(fitScorelineIntercept([])).toBeNull();
    const params = fitScorelineIntercept(hitSamples(SCORELINE_MIN_SAMPLE - 1, 30, false))!;
    expect(params).toEqual({
      sampleSize: SCORELINE_MIN_SAMPLE - 1,
      intercept: 0,
      applied: false,
    });
  });

  it('fits a negative intercept when claimed probabilities always miss', () => {
    const params = fitScorelineIntercept(hitSamples(20, 30, false))!;
    expect(params.applied).toBe(true);
    expect(params.intercept).toBeLessThan(0);
  });

  it('fits ~0 when the hit rate matches the claimed probability', () => {
    const params = fitScorelineIntercept([
      ...hitSamples(6, 30, true),
      ...hitSamples(14, 30, false),
    ])!;
    expect(params.applied).toBe(true);
    expect(Math.abs(params.intercept)).toBeLessThanOrEqual(0.05);
  });
});

describe('calibrateScorelines', () => {
  const rawOutcome = { home: 50, draw: 30, away: 20 };
  const calibratedOutcome = { home: 40, draw: 35, away: 25 };

  it('rescales each scoreline by its tendency bucket ratio', () => {
    const out = calibrateScorelines(
      [
        { score: '2-1', probability: 30 }, // HOME bucket: ×(40/50)
        { score: '1-1', probability: 20 }, // DRAW bucket: ×(35/30)
      ],
      rawOutcome,
      calibratedOutcome,
      null,
    )!;
    expect(out).toEqual([
      { score: '2-1', probability: 24 },
      { score: '1-1', probability: 23.3 },
    ]);
  });

  it('caps a scoreline at its bucket probability', () => {
    const out = calibrateScorelines(
      [{ score: '2-1', probability: 60 }],
      rawOutcome,
      calibratedOutcome,
      null,
    )!;
    // 60% × (40/50) = 48 > home bucket 40 → capped.
    expect(out).toEqual([{ score: '2-1', probability: 40 }]);
  });

  it('scales same-bucket scorelines proportionally so their sum stays within the bucket', () => {
    const out = calibrateScorelines(
      [
        { score: '2-1', probability: 40 }, // HOME
        { score: '1-0', probability: 30 }, // HOME
      ],
      rawOutcome,
      calibratedOutcome,
      null,
    )!;
    // ×(40/50): 32 + 24 = 56 > home bucket 40 → both ×(40/56).
    expect(out).toEqual([
      { score: '2-1', probability: 22.9 },
      { score: '1-0', probability: 17.1 },
    ]);
    const total = out.reduce((acc, s) => acc + s.probability, 0);
    expect(total).toBeLessThanOrEqual(calibratedOutcome.home);
    // Relative shape preserved (40:30 ratio).
    expect(out[0].probability / out[1].probability).toBeCloseTo(40 / 30, 1);
  });

  it('applies the fitted intercept before the consistency rescale', () => {
    const out = calibrateScorelines(
      [{ score: '2-1', probability: 30 }],
      rawOutcome,
      calibratedOutcome,
      { sampleSize: 20, intercept: -1, applied: true },
    )!;
    // σ(logit(0.3) − 1) ≈ 0.1364 → ×0.8 → ≈ 10.9%.
    expect(out[0].probability).toBeCloseTo(10.9, 1);
  });

  it('uses factor 1 when the raw outcome is unusable', () => {
    const out = calibrateScorelines(
      [{ score: '0-2', probability: 20 }],
      null,
      calibratedOutcome,
      null,
    )!;
    expect(out).toEqual([{ score: '0-2', probability: 20 }]);
  });

  it('drops malformed entries and sorts descending; null when nothing survives', () => {
    const out = calibrateScorelines(
      [
        { score: '1-1', probability: 10 },
        { score: 'n/a', probability: 40 },
        { score: '2-0', probability: null },
        { score: '2-1', probability: 25 },
      ],
      rawOutcome,
      calibratedOutcome,
      null,
    )!;
    expect(out.map((s) => s.score)).toEqual(['2-1', '1-1']);
    expect(out[0].probability).toBeGreaterThan(out[1].probability);

    expect(
      calibrateScorelines([{ score: 'n/a', probability: 40 }], rawOutcome, calibratedOutcome, null),
    ).toBeNull();
  });
});
