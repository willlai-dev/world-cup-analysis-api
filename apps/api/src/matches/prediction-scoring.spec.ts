import {
  brierScore,
  parsePredictionSnapshot,
  parseScoreline,
  scorePrediction,
  tendencyFromLeans,
  tendencyFromScore,
} from './prediction-scoring';

describe('parsePredictionSnapshot', () => {
  it('extracts leans and up to 3 scorelines from a MATCH_ANALYSIS shape', () => {
    const snapshot = parsePredictionSnapshot({
      prediction: { homeWinLean: 55, drawLean: 25, awayWinLean: 20, explanation: 'x' },
      likelyScorelines: [
        { score: '2-1', probability: 30 },
        { score: '1-1', probability: 25 },
        { score: '1-0', probability: 20 },
        { score: '3-0', probability: 10 }, // 4th dropped
      ],
    });
    expect(snapshot).toEqual({
      homeWinLean: 55,
      drawLean: 25,
      awayWinLean: 20,
      likelyScorelines: [
        { score: '2-1', probability: 30 },
        { score: '1-1', probability: 25 },
        { score: '1-0', probability: 20 },
      ],
    });
  });

  it('treats all-zero leans as absent (schema defaults, not a prediction)', () => {
    const snapshot = parsePredictionSnapshot({
      prediction: { homeWinLean: 0, drawLean: 0, awayWinLean: 0 },
      likelyScorelines: [{ score: '2-1', probability: 30 }],
    });
    expect(snapshot).toMatchObject({ homeWinLean: null, drawLean: null, awayWinLean: null });
  });

  it('returns null when there is nothing scoreable', () => {
    expect(parsePredictionSnapshot(null)).toBeNull();
    expect(parsePredictionSnapshot('oops')).toBeNull();
    expect(parsePredictionSnapshot({})).toBeNull();
    expect(
      parsePredictionSnapshot({
        prediction: { homeWinLean: 0, drawLean: 0, awayWinLean: 0 },
        likelyScorelines: [],
      }),
    ).toBeNull();
  });
});

describe('tendency + scoreline helpers', () => {
  it('derives tendency from the final score', () => {
    expect(tendencyFromScore(2, 1)).toBe('HOME');
    expect(tendencyFromScore(0, 3)).toBe('AWAY');
    expect(tendencyFromScore(1, 1)).toBe('DRAW');
  });

  it('argmaxes leans with HOME→DRAW→AWAY tie-break', () => {
    expect(tendencyFromLeans(55, 25, 20)).toBe('HOME');
    expect(tendencyFromLeans(20, 30, 50)).toBe('AWAY');
    expect(tendencyFromLeans(40, 40, 20)).toBe('HOME'); // tie
    expect(tendencyFromLeans(null, null, null)).toBeNull();
  });

  it('parses scorelines defensively', () => {
    expect(parseScoreline('2-1')).toEqual({ home: 2, away: 1 });
    expect(parseScoreline(' 0 : 0 ')).toEqual({ home: 0, away: 0 });
    expect(parseScoreline('a-b')).toBeNull();
    expect(parseScoreline('2-1-0')).toBeNull();
  });

  it('computes the multi-class Brier over normalized leans', () => {
    // Certain and right → 0; certain and wrong → 2.
    expect(brierScore(100, 0, 0, 'HOME')).toBe(0);
    expect(brierScore(100, 0, 0, 'AWAY')).toBe(2);
    // Uniform → 2/3 regardless of the outcome.
    expect(brierScore(1, 1, 1, 'DRAW')).toBeCloseTo(2 / 3);
    expect(brierScore(null, null, null, 'HOME')).toBeNull();
  });
});

describe('scorePrediction', () => {
  const snapshot = {
    homeWinLean: 55,
    drawLean: 25,
    awayWinLean: 20,
    likelyScorelines: [
      { score: '2-1', probability: 30 },
      { score: '1-1', probability: 25 },
      { score: '1-0', probability: 20 },
    ],
  };

  it('settles a fully correct prediction', () => {
    const m = scorePrediction(snapshot, 2, 1);
    expect(m).toMatchObject({
      tendencyPredicted: 'HOME',
      tendencyActual: 'HOME',
      tendencyHit: true,
      exactScoreHit: true,
      top3ScoreHit: true,
    });
    expect(m.brierScore).toBeLessThan(2 / 3); // better than uniform
  });

  it('settles a top-3-only scoreline hit', () => {
    const m = scorePrediction(snapshot, 1, 0);
    expect(m).toMatchObject({ tendencyHit: true, exactScoreHit: false, top3ScoreHit: true });
  });

  it('settles a full miss', () => {
    const m = scorePrediction(snapshot, 0, 2);
    expect(m).toMatchObject({
      tendencyPredicted: 'HOME',
      tendencyActual: 'AWAY',
      tendencyHit: false,
      exactScoreHit: false,
      top3ScoreHit: false,
    });
    expect(m.brierScore).toBeGreaterThan(2 / 3); // worse than uniform
  });

  it('scoreline-only prediction settles score hits without a tendency', () => {
    const m = scorePrediction(
      { homeWinLean: null, drawLean: null, awayWinLean: null, likelyScorelines: snapshot.likelyScorelines },
      1,
      1,
    );
    expect(m).toMatchObject({
      tendencyPredicted: null,
      tendencyHit: false,
      top3ScoreHit: true,
      brierScore: null,
    });
  });
});
