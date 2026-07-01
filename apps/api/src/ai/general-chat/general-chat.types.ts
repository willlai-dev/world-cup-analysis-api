/**
 * Shared types for the general-chat DB retrieval layer (Phase 2C). The general
 * floating chat resolves the question to an {@link GeneralChatIntent}, matches
 * DB entities, and builds a grounded context snapshot for the AI router.
 */

/** Concrete data category a general-chat question can touch. */
export type GeneralChatCategory = 'MATCH' | 'TEAM' | 'PLAYER' | 'NEWS' | 'CHAMPION';

/** Collapsed intent label (spec §"Intent 判斷"). */
export type GeneralChatIntent =
  | 'MATCH_QUERY'
  | 'TEAM_QUERY'
  | 'PLAYER_QUERY'
  | 'NEWS_QUERY'
  | 'CHAMPION_QUERY'
  | 'MIXED_QUERY'
  | 'UNKNOWN';

export type IntentResolution = {
  /** Single collapsed label: one category → *_QUERY, many → MIXED, none → UNKNOWN. */
  intent: GeneralChatIntent;
  /** Every category with at least one keyword hit, in priority order. */
  categories: GeneralChatCategory[];
};

export type MatchedTeam = {
  id: string;
  nameEn: string;
  nameZh: string | null;
  fifaCode: string | null;
};

export type MatchedPlayer = {
  id: string;
  nameEn: string;
  nameZh: string | null;
  teamId: string;
};

export type EntityMatchResult = {
  teams: MatchedTeam[];
  players: MatchedPlayer[];
};

/** Output of {@link GeneralChatContextService.build}. */
export type GeneralChatContext = {
  /** Short scope label surfaced to the prompt, e.g. "一般問答（法國、球員）". */
  scope: string;
  /** DB snapshot the answer must be grounded in; `undefined` when nothing relevant found. */
  context: Record<string, unknown> | undefined;
  /** ISO timestamp of the newest included datum, or null. */
  sourceUpdatedAt: string | null;
};
