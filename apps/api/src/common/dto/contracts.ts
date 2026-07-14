// Response DTO shapes the frontend depends on (doc 03). Backend may add fields
// but must not remove these.

export type UserDto = {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'PREMIUM' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
  /** false until the registration email-verification link is consumed. */
  emailVerified: boolean;
};

export type TeamSummary = {
  id: string;
  nameEn: string;
  nameZh?: string | null;
  fifaCode?: string | null;
  continent?: string | null;
  groupName?: string | null;
  coachName?: string | null;
  flagUrl?: string | null;
  worldRanking?: number | null;
  ratingTier?: 'S' | 'A' | 'B' | 'C' | 'UNKNOWN';
  championScore?: number | null;
  formScore?: number | null;
  attackScore?: number | null;
  midfieldScore?: number | null;
  defenseScore?: number | null;
  statusScore?: number | null;
  isEliminated: boolean;
};

export type PlayerSummary = {
  id: string;
  teamId: string;
  team?: TeamSummary;
  nameEn: string;
  nameZh?: string | null;
  position: 'GK' | 'DF' | 'MF' | 'FW' | 'UNKNOWN';
  clubName?: string | null;
  shirtNumber?: number | null;
  ratingTier?: 'S' | 'A_PLUS' | 'A' | 'B_PLUS' | 'B' | 'C' | 'UNKNOWN';
  overallScore?: number | null;
  attackScore?: number | null;
  creativityScore?: number | null;
  techniqueScore?: number | null;
  defenseScore?: number | null;
  physicalScore?: number | null;
  formScore?: number | null;
  role?: 'STARTER' | 'ROTATION' | 'SUBSTITUTE' | 'IMPACT_PLAYER' | 'UNKNOWN';
  injuryRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
};

export type MatchSummary = {
  id: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  stage: string;
  groupName?: string | null;
  stadium?: string | null;
  kickoffAt: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  homeScore?: number | null;
  awayScore?: number | null;
  sourceUpdatedAt?: string | null;
  aiSummary?: string | null;
};

export type AiReportDto = {
  id: string;
  entityType: string;
  entityId?: string | null;
  reportType: string;
  provider: 'NVIDIA' | 'QWEN' | 'PROGRAM_RULE';
  model?: string | null;
  language: string;
  title?: string | null;
  content?: string | null;
  structuredJson?: unknown;
  confidenceScore?: number | null;
  status: 'PENDING' | 'DONE' | 'FAILED';
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScoreLinePredictionDto = {
  /** Scoreline as "home-away", e.g. "2-1". */
  score: string;
  probability?: number | null;
};

export type MatchPredictionDto = {
  matchId: string;
  homeWinProbability?: number | null;
  drawProbability?: number | null;
  awayWinProbability?: number | null;
  /** Up to three most-likely scorelines with their probabilities. */
  likelyScorelines: ScoreLinePredictionDto[];
  keyFactors: string[];
  riskNotes: string[];
  report?: AiReportDto | null;
  sourceUpdatedAt?: string | null;
  /**
   * Program-rule calibrated probabilities (0-100, summing to 100): temperature
   * scaling fitted on past REAL pre-kickoff predictions, plus a shrunk
   * per-team bias tilt. null until enough settled samples exist. Raw values
   * above stay untouched.
   */
  calibrated?: {
    method: 'temperature+team-bias';
    homeWinProbability: number;
    drawProbability: number;
    awayWinProbability: number;
    /** Fitted softmax temperature; > 1 = model has been overconfident. */
    temperature: number;
    sampleSize: number;
    /** Applied log-odds shift on the home team's win probability; null when 0. */
    homeBiasAdjustment?: number | null;
    awayBiasAdjustment?: number | null;
    /** likelyScorelines re-scaled to agree with the calibrated 1X2 above. */
    scorelines?: { score: string; probability: number }[] | null;
  } | null;
};

export type NewsSummary = {
  id: string;
  sourceName: string;
  sourceUrl: string;
  titleEn: string;
  titleZh?: string | null;
  summaryEn?: string | null;
  summaryZh?: string | null;
  publishedAt?: string | null;
  category?: string | null;
  tags?: { id: string; name: string; type: string }[];
  translationStatus?: 'NONE' | 'PENDING' | 'DONE' | 'FAILED';
};

export type ChampionPredictionEntrySummary = {
  id: string;
  team: TeamSummary;
  rank: number;
  championScore: number;
  ratingTier?: 'S' | 'A' | 'B' | 'C' | 'UNKNOWN';
  probabilityText?: string | null;
  strengths: string[];
  risks: string[];
  aiComment?: string | null;
};

/** Per-team rank comparison between the NVIDIA and Qwen champion legs. */
export type ChampionDivergenceTeamDelta = {
  teamName: string;
  nvidiaRank?: number | null;
  qwenRank?: number | null;
  /** |nvidiaRank - qwenRank| when both models ranked the team. */
  rankDelta?: number | null;
};

/**
 * Program-computed NVIDIA-vs-Qwen divergence. `computable` is false for runs
 * whose A/B reports predate structured output (or mock runs, which skip the
 * per-model legs entirely).
 */
export type ChampionDivergence = {
  computable: boolean;
  summary: string;
  teamDeltas: ChampionDivergenceTeamDelta[];
};

export type ChampionPredictionResponse = {
  runId: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  createdAt: string;
  completedAt?: string | null;
  entries: ChampionPredictionEntrySummary[];
  finalReport?: AiReportDto | null;
  nvidiaReport?: AiReportDto | null;
  qwenReport?: AiReportDto | null;
  /** FINAL_REPORT_POLISH output (zh markdown); null for mock/legacy runs. */
  polishedReport?: AiReportDto | null;
  divergence?: ChampionDivergence;
};

/** Aggregated AiUsageLog statistics for GET /admin/ai-usage. */
export type AiUsageStatsDto = {
  from: string;
  to: string;
  totals: {
    calls: number;
    done: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
  };
  byTaskType: { taskType: string; calls: number }[];
  byProvider: { provider: string; calls: number }[];
  byStatus: { status: string; calls: number }[];
  byDay: { day: string; calls: number }[];
  topUsers: {
    userId: string;
    email: string | null;
    displayName: string | null;
    calls: number;
  }[];
};

export type ChatAnswerDto = {
  answer: string;
  provider: 'NVIDIA' | 'QWEN' | 'PROGRAM_RULE';
  model?: string | null;
  sourceUpdatedAt?: string | null;
};

/** One prior conversation turn supplied by the client for multi-turn chat. */
export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type HomeHighlightsResponse = {
  featuredMatches: MatchSummary[];
  championSummary: ChampionPredictionEntrySummary[];
  featuredTeams: TeamSummary[];
  featuredPlayers: PlayerSummary[];
  newsHighlights: NewsSummary[];
};

// ----- Prediction insights (PREMIUM) — GET /insights/predictions -----

export type PredictionTendency = 'HOME' | 'DRAW' | 'AWAY';

/** Hit-rate aggregate over a set of settled predictions. Rates are 0-1, null when total=0. */
export type PredictionInsightsBucketDto = {
  total: number;
  tendencyHits: number;
  tendencyHitRate: number | null;
  exactScoreHits: number;
  exactScoreHitRate: number | null;
  top3ScoreHits: number;
  top3ScoreHitRate: number | null;
  /** Mean multi-class Brier (0 best, 2 worst); null when no scored leans. */
  avgBrier: number | null;
  /** Program-blend (Poisson × AI) scoreline A/B — rows that carry program
   * metrics (rolling-parameter backtest). Rates over programTotal. */
  programTotal: number;
  programExactScoreHits: number;
  programExactScoreHitRate: number | null;
  programTop3ScoreHits: number;
  programTop3ScoreHitRate: number | null;
};

/** One settled prediction (MatchPredictionOutcome joined with its match). */
export type PredictionOutcomeItemDto = {
  matchId: string;
  stage: string;
  kickoffAt: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  actualHomeScore: number;
  actualAwayScore: number;
  /** true = prediction was backfilled after the match (knowledge-contamination risk). */
  retro: boolean;
  predictedAt: string;
  homeWinLean: number | null;
  drawLean: number | null;
  awayWinLean: number | null;
  likelyScorelines: ScoreLinePredictionDto[];
  tendencyPredicted: PredictionTendency | null;
  tendencyActual: PredictionTendency;
  tendencyHit: boolean;
  exactScoreHit: boolean;
  top3ScoreHit: boolean;
  brierScore: number | null;
  /** Program-blend scorelines settled alongside the AI list; null when the
   * snapshot's leans were unusable (no program prediction possible). */
  programScorelines: ScoreLinePredictionDto[] | null;
  programExactScoreHit: boolean | null;
  programTop3ScoreHit: boolean | null;
};

/** Per-team predicted-vs-actual bias (program rules; includes retro rows, counted). */
export type PredictionTeamBiasDto = {
  team: TeamSummary;
  /** Settled matches involving this team that carried a predicted tendency. */
  total: number;
  retroCount: number;
  tendencyHits: number;
  tendencyHitRate: number | null;
  /** Team did better than the predicted tendency (e.g. won when a loss was predicted). */
  overPerformed: number;
  /** Team did worse than the predicted tendency. */
  underPerformed: number;
};

export type PredictionInsightsDto = {
  summary: {
    overall: PredictionInsightsBucketDto;
    /** Predictions genuinely made before kickoff — the only honest accuracy signal. */
    real: PredictionInsightsBucketDto;
    /** Backfilled retro predictions — shown separately, never blended into `real`. */
    retro: PredictionInsightsBucketDto;
  };
  byStage: ({ stage: string } & PredictionInsightsBucketDto)[];
  /** Most-sampled teams first. */
  byTeam: PredictionTeamBiasDto[];
  /** Current program-rule calibration (real samples only); null when nothing settled. */
  calibration: {
    sampleSize: number;
    avgConfidence: number;
    tendencyHitRate: number;
    /** Fitted softmax temperature; > 1 = model has been overconfident. */
    temperature: number;
    applied: boolean;
    /** In-sample backtest: mean multi-class Brier before/after temperature scaling. */
    baselineBrier: number | null;
    calibratedBrier: number | null;
  } | null;
  /** Newest kickoff first. */
  items: PredictionOutcomeItemDto[];
};
