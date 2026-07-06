import { JobType } from '@prisma/client';

/**
 * Named job sequences an admin can trigger manually (see AdminJobsController).
 * Separate from the cron slots in jobs.scheduler.ts: the cron pipeline is split
 * across time slots (02:00 player+team ratings, 06:00 player status) to avoid hammering
 * NVIDIA, whereas a manual run wants everything now, in dependency order.
 *
 * Order matters:
 *  - sync (teams → players → fixtures → results → news) before any generation,
 *  - GENERATE_PLAYER_RATINGS before GENERATE_TEAM_RATINGS (team score reads squad),
 *  - GENERATE_TEAM_RATINGS before GENERATE_CHAMPION_PREDICTIONS (ranks by championScore),
 *  - news summarised/tagged before GENERATE_PLAYER_STATUS (which reads tagged news).
 */
export const PIPELINE_PRESETS = {
  /** Full bootstrap: fetch every source, then (re)generate every rating/analysis. */
  FULL: [
    JobType.SYNC_TEAMS,
    JobType.SYNC_PLAYERS,
    JobType.SYNC_FIXTURES,
    JobType.SYNC_RESULTS,
    JobType.FETCH_NEWS,
    JobType.GENERATE_NEWS_SUMMARY,
    JobType.GENERATE_NEWS_IMPACT,
    JobType.GENERATE_PLAYER_RATINGS,
    JobType.GENERATE_TEAM_RATINGS,
    JobType.GENERATE_PLAYER_STATUS,
    JobType.GENERATE_MATCH_ANALYSIS,
    JobType.GENERATE_RETRO_ANALYSIS,
    JobType.GENERATE_CHAMPION_PREDICTIONS,
    JobType.SCORE_PREDICTIONS,
  ],
  /** Data only — refresh external sources without spending AI budget. */
  SYNC: [
    JobType.SYNC_TEAMS,
    JobType.SYNC_PLAYERS,
    JobType.SYNC_FIXTURES,
    JobType.SYNC_RESULTS,
    JobType.FETCH_NEWS,
  ],
  /** AI only — (re)generate every rating/analysis over already-synced data. */
  GENERATE: [
    JobType.GENERATE_NEWS_SUMMARY,
    JobType.GENERATE_NEWS_IMPACT,
    JobType.GENERATE_PLAYER_RATINGS,
    JobType.GENERATE_TEAM_RATINGS,
    JobType.GENERATE_PLAYER_STATUS,
    JobType.GENERATE_MATCH_ANALYSIS,
    JobType.GENERATE_RETRO_ANALYSIS,
    JobType.GENERATE_CHAMPION_PREDICTIONS,
    JobType.SCORE_PREDICTIONS,
  ],

  // ── Per-domain presets ────────────────────────────────────────────────────
  // One "update this domain" action = fetch that domain's data, then run its AI
  // analysis. Let the admin refresh 國家 / 球員 / 賽事 / 新聞 / 冠軍 independently
  // instead of the whole FULL pipeline. (For AI-only re-runs without re-fetching,
  // pass an explicit `jobs[]`, e.g. ["GENERATE_TEAM_RATINGS"].)

  /** 國家／球隊：抓球隊 → 球隊實力評分。 */
  TEAMS: [JobType.SYNC_TEAMS, JobType.GENERATE_TEAM_RATINGS],
  /** 球員：抓球員 → 六邊形評分 → 近況／傷病。 */
  PLAYERS: [
    JobType.SYNC_PLAYERS,
    JobType.GENERATE_PLAYER_RATINGS,
    JobType.GENERATE_PLAYER_STATUS,
  ],
  /** 賽事：抓賽程＋比分 → 賽前分析 → 預測結算。 */
  MATCHES: [
    JobType.SYNC_FIXTURES,
    JobType.SYNC_RESULTS,
    JobType.GENERATE_MATCH_ANALYSIS,
    JobType.SCORE_PREDICTIONS,
  ],
  /** 新聞：抓新聞 → 摘要／分類／標籤 → 影響分析。 */
  NEWS: [
    JobType.FETCH_NEWS,
    JobType.GENERATE_NEWS_SUMMARY,
    JobType.GENERATE_NEWS_IMPACT,
  ],
  /** 冠軍預測：以現有球隊評分產生 A/B/final run（建議先跑 TEAMS）。 */
  CHAMPION: [JobType.GENERATE_CHAMPION_PREDICTIONS],
  /** 回補：已完賽但無賽前分析的比賽 → 賽前視角回補 → 預測結算。 */
  RETRO: [JobType.GENERATE_RETRO_ANALYSIS, JobType.SCORE_PREDICTIONS],
} as const satisfies Record<string, JobType[]>;

export type PipelinePreset = keyof typeof PIPELINE_PRESETS;

export const PIPELINE_PRESET_NAMES = Object.keys(PIPELINE_PRESETS) as PipelinePreset[];
