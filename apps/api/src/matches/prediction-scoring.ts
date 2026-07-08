/**
 * Program-rule settlement of a match prediction against the final score —
 * pure functions only (no I/O) so the SCORE_PREDICTIONS job stays trivially
 * testable. Works on the `structuredJson` produced by MATCH_ANALYSIS /
 * RETRO_MATCH_ANALYSIS reports (MatchAnalysisOutputSchema shape), parsed
 * defensively because report shapes may drift across prompt versions.
 */

export type Tendency = 'HOME' | 'DRAW' | 'AWAY';

export type PredictionSnapshot = {
  homeWinLean: number | null;
  drawLean: number | null;
  awayWinLean: number | null;
  likelyScorelines: { score: string; probability: number | null }[];
};

export type PredictionMetrics = {
  tendencyPredicted: Tendency | null;
  tendencyActual: Tendency;
  tendencyHit: boolean;
  /** Top-1 (highest-probability) scoreline equals the actual score. */
  exactScoreHit: boolean;
  /** Any of the (up to 3) likely scorelines equals the actual score. */
  top3ScoreHit: boolean;
  /** Multi-class Brier over normalized leans; 0 best, 2 worst; null without leans. */
  brierScore: number | null;
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Defensive parse of AiReport.structuredJson for settlement. Returns null when
 * there is nothing scoreable: no usable leans (missing or all-zero — schema
 * defaults fill 0s when the model omits the field) and no scorelines.
 */
export function parsePredictionSnapshot(structuredJson: unknown): PredictionSnapshot | null {
  if (!structuredJson || typeof structuredJson !== 'object') return null;
  const root = structuredJson as Record<string, unknown>;
  const prediction = (root.prediction ?? null) as Record<string, unknown> | null;

  let homeWinLean = finiteOrNull(prediction?.homeWinLean);
  let drawLean = finiteOrNull(prediction?.drawLean);
  let awayWinLean = finiteOrNull(prediction?.awayWinLean);
  const leanSum = (homeWinLean ?? 0) + (drawLean ?? 0) + (awayWinLean ?? 0);
  if (leanSum <= 0) {
    homeWinLean = null;
    drawLean = null;
    awayWinLean = null;
  }

  const rawScorelines = Array.isArray(root.likelyScorelines) ? root.likelyScorelines : [];
  const likelyScorelines = rawScorelines
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s, idx) => ({
      idx,
      score: typeof s.score === 'string' ? s.score : '',
      probability: finiteOrNull(s.probability),
    }))
    .filter((s) => s.score.length > 0)
    // The schema asks for probability-descending but doesn't enforce it — sort
    // defensively (nulls last, stable via idx) so top-1/top-3 mean what they say.
    .sort(
      (a, b) =>
        (b.probability ?? Number.NEGATIVE_INFINITY) - (a.probability ?? Number.NEGATIVE_INFINITY) || a.idx - b.idx,
    )
    .slice(0, 3)
    .map(({ idx, ...rest }) => rest);

  if (homeWinLean === null && drawLean === null && awayWinLean === null && likelyScorelines.length === 0) {
    return null;
  }
  return { homeWinLean, drawLean, awayWinLean, likelyScorelines };
}

/**
 * NOTE: the stored score is the data source's final score. Knockout matches
 * decided on penalties can settle as DRAW here even though a winner advanced —
 * tendency measures the 90/120-minute result, which is what the leans predict.
 */
export function tendencyFromScore(home: number, away: number): Tendency {
  if (home > away) return 'HOME';
  if (home < away) return 'AWAY';
  return 'DRAW';
}

/** Argmax of the leans; ties resolve HOME → DRAW → AWAY; null when all absent. */
export function tendencyFromLeans(
  home: number | null,
  draw: number | null,
  away: number | null,
): Tendency | null {
  if (home === null && draw === null && away === null) return null;
  const entries: [Tendency, number][] = [
    ['HOME', home ?? Number.NEGATIVE_INFINITY],
    ['DRAW', draw ?? Number.NEGATIVE_INFINITY],
    ['AWAY', away ?? Number.NEGATIVE_INFINITY],
  ];
  let best = entries[0];
  for (const e of entries) {
    if (e[1] > best[1]) best = e;
  }
  return best[0];
}

/** Parse a "home-away" scoreline ("2-1"; tolerates "2 : 1" etc). Null if malformed. */
export function parseScoreline(score: string): { home: number; away: number } | null {
  const m = score.trim().match(/^(\d+)\s*[-:：]\s*(\d+)$/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

/** Multi-class Brier score over leans normalized to probabilities. */
export function brierScore(
  home: number | null,
  draw: number | null,
  away: number | null,
  actual: Tendency,
): number | null {
  const h = home ?? 0;
  const d = draw ?? 0;
  const a = away ?? 0;
  const sum = h + d + a;
  if (sum <= 0) return null;
  const p = { HOME: h / sum, DRAW: d / sum, AWAY: a / sum };
  const o = { HOME: actual === 'HOME' ? 1 : 0, DRAW: actual === 'DRAW' ? 1 : 0, AWAY: actual === 'AWAY' ? 1 : 0 };
  return (
    (p.HOME - o.HOME) ** 2 + (p.DRAW - o.DRAW) ** 2 + (p.AWAY - o.AWAY) ** 2
  );
}

/** Settle one prediction snapshot against the final score. */
export function scorePrediction(
  snapshot: PredictionSnapshot,
  actualHome: number,
  actualAway: number,
): PredictionMetrics {
  const tendencyActual = tendencyFromScore(actualHome, actualAway);
  const tendencyPredicted = tendencyFromLeans(
    snapshot.homeWinLean,
    snapshot.drawLean,
    snapshot.awayWinLean,
  );

  const parsed = snapshot.likelyScorelines
    .map((s) => parseScoreline(s.score))
    .filter((s): s is { home: number; away: number } => s !== null);
  const matches = (s: { home: number; away: number }) =>
    s.home === actualHome && s.away === actualAway;

  return {
    tendencyPredicted,
    tendencyActual,
    tendencyHit: tendencyPredicted !== null && tendencyPredicted === tendencyActual,
    exactScoreHit: parsed.length > 0 && matches(parsed[0]),
    top3ScoreHit: parsed.some(matches),
    brierScore: brierScore(snapshot.homeWinLean, snapshot.drawLean, snapshot.awayWinLean, tendencyActual),
  };
}
