// Response DTO shapes the frontend depends on (doc 03). Backend may add fields
// but must not remove these.

export type UserDto = {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'PREMIUM' | 'ADMIN';
  status: 'ACTIVE' | 'DISABLED';
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

export type ChampionPredictionResponse = {
  runId: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  createdAt: string;
  completedAt?: string | null;
  entries: ChampionPredictionEntrySummary[];
  finalReport?: AiReportDto | null;
  nvidiaReport?: AiReportDto | null;
  qwenReport?: AiReportDto | null;
};

export type ChatAnswerDto = {
  answer: string;
  provider: 'NVIDIA' | 'QWEN' | 'PROGRAM_RULE';
  model?: string | null;
  sourceUpdatedAt?: string | null;
};

export type HomeHighlightsResponse = {
  featuredMatches: MatchSummary[];
  championSummary: ChampionPredictionEntrySummary[];
  featuredTeams: TeamSummary[];
  featuredPlayers: PlayerSummary[];
  newsHighlights: NewsSummary[];
};
