import {
  BLEND_MIN_SAMPLE,
  BLEND_WEIGHT_DEFAULT,
  buildProgramScorelines,
  fitBlendWeight,
  fitPoissonRates,
  poissonScoreGrid,
  type BlendSample,
} from './scoreline-model';

const balanced = { home: 100 / 3, draw: 100 / 3, away: 100 / 3 };

function sample(overrides: Partial<BlendSample>): BlendSample {
  return {
    homeWinLean: 45,
    drawLean: 30,
    awayWinLean: 25,
    likelyScorelines: [
      { score: '3-2', probability: 40 },
      { score: '2-2', probability: 20 },
    ],
    actualHomeScore: 1,
    actualAwayScore: 1,
    ...overrides,
  };
}

describe('poissonScoreGrid', () => {
  it('normalizes to ~1 and is symmetric for equal rates', () => {
    const grid = poissonScoreGrid(1.3, 1.3);
    const total = [...grid.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(grid.get('1-0')).toBeCloseTo(grid.get('0-1')!, 9);
    expect(grid.get('2-1')).toBeCloseTo(grid.get('1-2')!, 9);
  });

  it('shifts mass toward higher scores as rates grow', () => {
    const low = poissonScoreGrid(1, 1);
    const high = poissonScoreGrid(2.5, 2.5);
    expect(high.get('3-3')!).toBeGreaterThan(low.get('3-3')!);
    expect(low.get('0-0')!).toBeGreaterThan(high.get('0-0')!);
  });
});

describe('fitPoissonRates', () => {
  it('gives the favoured side the higher rate and reproduces the target', () => {
    const target = { home: 60, draw: 25, away: 15 };
    const { lambdaHome, lambdaAway } = fitPoissonRates(target);
    expect(lambdaHome).toBeGreaterThan(lambdaAway);

    // Refit check: the grid's implied 1X2 should sit close to the target.
    const grid = poissonScoreGrid(lambdaHome, lambdaAway);
    let home = 0;
    let draw = 0;
    for (const [score, p] of grid) {
      const [h, a] = score.split('-').map(Number);
      if (h > a) home += p;
      else if (h === a) draw += p;
    }
    expect(home * 100).toBeCloseTo(target.home, -1); // within ~5
    expect(draw * 100).toBeCloseTo(target.draw, -1);
  });

  it('anchors the total-goals level near the World Cup average for a balanced target', () => {
    const { lambdaHome, lambdaAway } = fitPoissonRates(balanced);
    expect(lambdaHome).toBeCloseTo(lambdaAway, 9);
    const mu = lambdaHome + lambdaAway;
    expect(mu).toBeGreaterThanOrEqual(2.0);
    expect(mu).toBeLessThanOrEqual(3.0);
  });
});

describe('fitBlendWeight', () => {
  it('returns null with no usable samples and default weight below the minimum', () => {
    expect(fitBlendWeight([], 1, null)).toBeNull();
    expect(
      fitBlendWeight([sample({ homeWinLean: 0, drawLean: 0, awayWinLean: 0 })], 1, null),
    ).toBeNull();
    const few = fitBlendWeight(
      Array.from({ length: BLEND_MIN_SAMPLE - 1 }, () => sample({})),
      1,
      null,
    )!;
    expect(few).toEqual({
      weight: BLEND_WEIGHT_DEFAULT,
      sampleSize: BLEND_MIN_SAMPLE - 1,
      applied: false,
    });
  });

  it('pushes the weight toward the AI when its scorelines keep settling right', () => {
    const samples = Array.from({ length: 20 }, () =>
      sample({ actualHomeScore: 3, actualAwayScore: 2 }), // AI top pick hits
    );
    const params = fitBlendWeight(samples, 1, null)!;
    expect(params.applied).toBe(true);
    expect(params.weight).toBeGreaterThan(0.7);
  });

  it('pushes the weight toward the grid when modal scores beat the AI picks', () => {
    const samples = Array.from({ length: 20 }, () =>
      sample({ actualHomeScore: 1, actualAwayScore: 1 }), // never in the AI list
    );
    const params = fitBlendWeight(samples, 1, null)!;
    expect(params.applied).toBe(true);
    expect(params.weight).toBeLessThan(0.3);
  });
});

describe('buildProgramScorelines', () => {
  const aiList = [
    { score: '2-1', probability: 30 },
    { score: '1-1', probability: 25 },
  ];
  const outcome = { home: 50, draw: 30, away: 20 };

  it('falls back to the AI-only calibrated list without usable leans', () => {
    const out = buildProgramScorelines(
      [{ score: '0-2', probability: 20 }],
      null,
      outcome,
      null,
      null,
    )!;
    expect(out).toEqual([{ score: '0-2', probability: 20 }]);
  });

  it('reproduces the AI ranking at weight 1', () => {
    const out = buildProgramScorelines(aiList, outcome, outcome, null, {
      weight: 1,
      sampleSize: 20,
      applied: true,
    })!;
    expect(out.map((s) => s.score)).toEqual(['2-1', '1-1']);
    expect(out[0].probability).toBeCloseTo(30, 0);
  });

  it('promotes modal grid scores at weight 0', () => {
    const out = buildProgramScorelines(
      [{ score: '4-3', probability: 40 }], // exotic AI pick
      balanced,
      balanced,
      null,
      { weight: 0, sampleSize: 20, applied: true },
    )!;
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.score)).toContain('1-1');
    expect(out.map((s) => s.score)).not.toContain('4-3');
  });

  it('breaks probability ties deterministically by score key', () => {
    const out = buildProgramScorelines(
      [
        { score: '2-1', probability: 20 },
        { score: '1-0', probability: 20 }, // same bucket, same probability
      ],
      outcome,
      outcome,
      null,
      { weight: 1, sampleSize: 20, applied: true },
    )!;
    expect(out.map((s) => s.score)).toEqual(['1-0', '2-1']);
  });

  it('blends both sources, sorted descending and bucket-capped', () => {
    const out = buildProgramScorelines(aiList, outcome, outcome, null, {
      weight: 0.5,
      sampleSize: 20,
      applied: true,
    })!;
    expect(out).toHaveLength(3);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].probability).toBeLessThanOrEqual(out[i - 1].probability);
    }
    // Per-bucket sums stay within the calibrated bucket probabilities.
    const bucketTotals = { HOME: 0, DRAW: 0, AWAY: 0 };
    for (const s of out) {
      const [h, a] = s.score.split('-').map(Number);
      bucketTotals[h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW'] += s.probability;
    }
    expect(bucketTotals.HOME).toBeLessThanOrEqual(outcome.home + 0.1);
    expect(bucketTotals.DRAW).toBeLessThanOrEqual(outcome.draw + 0.1);
    expect(bucketTotals.AWAY).toBeLessThanOrEqual(outcome.away + 0.1);
  });
});
