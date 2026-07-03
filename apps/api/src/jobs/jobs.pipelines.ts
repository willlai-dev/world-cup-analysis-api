import { JobType } from '@prisma/client';

/**
 * Named job sequences an admin can trigger manually (see AdminJobsController).
 * Separate from the cron slots in jobs.scheduler.ts: the cron pipeline is split
 * across time slots (02:00 team ratings, 06:00 player status) to avoid hammering
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
    JobType.GENERATE_CHAMPION_PREDICTIONS,
  ],
  /** Data only — refresh external sources without spending AI budget. */
  SYNC: [
    JobType.SYNC_TEAMS,
    JobType.SYNC_PLAYERS,
    JobType.SYNC_FIXTURES,
    JobType.SYNC_RESULTS,
    JobType.FETCH_NEWS,
  ],
  /** AI only — (re)generate ratings/analysis over already-synced data. */
  GENERATE: [
    JobType.GENERATE_NEWS_SUMMARY,
    JobType.GENERATE_NEWS_IMPACT,
    JobType.GENERATE_PLAYER_RATINGS,
    JobType.GENERATE_TEAM_RATINGS,
    JobType.GENERATE_PLAYER_STATUS,
    JobType.GENERATE_MATCH_ANALYSIS,
    JobType.GENERATE_CHAMPION_PREDICTIONS,
  ],
} as const satisfies Record<string, JobType[]>;

export type PipelinePreset = keyof typeof PIPELINE_PRESETS;

export const PIPELINE_PRESET_NAMES = Object.keys(PIPELINE_PRESETS) as PipelinePreset[];
