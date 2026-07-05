import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobType } from '@prisma/client';
import { JobsService } from './jobs.service';

/**
 * 04:00 full pipeline: refresh all external data, then regenerate news, match and
 * champion analysis. Player + team ratings are generated earlier at 02:00 (so the
 * champion predictions here rank by fresh team scores), and player status runs at
 * 06:00 — see RATINGS_PIPELINE / PLAYER_STATUS_PIPELINE below.
 */
export const FULL_PIPELINE: JobType[] = [
  JobType.SYNC_TEAMS,
  JobType.SYNC_PLAYERS,
  JobType.SYNC_FIXTURES,
  JobType.SYNC_RESULTS,
  JobType.FETCH_NEWS,
  JobType.GENERATE_NEWS_SUMMARY,
  JobType.GENERATE_NEWS_IMPACT,
  JobType.GENERATE_MATCH_ANALYSIS,
  JobType.GENERATE_CHAMPION_PREDICTIONS,
];

/**
 * 12:00 midday refresh: catch data that arrived late (finished scores, advancing
 * bracket) and refresh the affected predictions. Skips the stable/expensive
 * team+player sync and player ratings.
 */
export const REFRESH_PIPELINE: JobType[] = [
  JobType.SYNC_FIXTURES,
  JobType.SYNC_RESULTS,
  JobType.FETCH_NEWS,
  JobType.GENERATE_NEWS_SUMMARY,
  JobType.GENERATE_NEWS_IMPACT,
  JobType.GENERATE_MATCH_ANALYSIS,
  JobType.GENERATE_CHAMPION_PREDICTIONS,
];

/**
 * 02:00 ratings pass — player ratings BEFORE team ratings (team scores read the
 * squad's player scores, TeamsService.generateRatings), and the whole slot runs
 * BEFORE the 04:00 pipeline so champion prediction (which ranks by championScore)
 * sees fresh team scores. Kept on its own slot to avoid piling onto NVIDIA during
 * the main 04:00 generate stage.
 */
export const RATINGS_PIPELINE: JobType[] = [
  JobType.GENERATE_PLAYER_RATINGS,
  JobType.GENERATE_TEAM_RATINGS,
];

/**
 * 06:00 player status/injury pass — deliberately staggered 2h after the 04:00
 * full pipeline so (a) the day's news is already fetched+tagged and (b) it
 * doesn't pile onto NVIDIA while the main pipeline is generating (503s).
 */
export const PLAYER_STATUS_PIPELINE: JobType[] = [JobType.GENERATE_PLAYER_STATUS];

/**
 * Fires the sync + generate pipeline on a schedule. Slots are staggered (02:00
 * player+team ratings, 04:00 full, 06:00 player status, 12:00 refresh) because
 * source data can lag and to avoid hammering NVIDIA. Each slot delegates to
 * JobsService.runPipeline, whose shared reentrancy guard also blocks manual
 * admin triggers from overlapping a cron run (and vice-versa).
 */
@Injectable()
export class JobsScheduler {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(private readonly jobs: JobsService) {}

  @Cron('0 2 * * *')
  async runRatings(): Promise<void> {
    await this.runSlot('ratings', RATINGS_PIPELINE);
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async runFullPipeline(): Promise<void> {
    await this.runSlot('full', FULL_PIPELINE);
  }

  @Cron('0 12 * * *')
  async runMiddayRefresh(): Promise<void> {
    await this.runSlot('midday-refresh', REFRESH_PIPELINE);
  }

  @Cron('0 6 * * *')
  async runPlayerStatus(): Promise<void> {
    await this.runSlot('player-status', PLAYER_STATUS_PIPELINE);
  }

  /**
   * Shared wrapper for every cron slot. Logs that the schedule fired (so the log
   * shows the daily trigger even when the reentrancy guard skips the run) and
   * catches any error — @nestjs/schedule swallows a rejected cron handler
   * silently, which would otherwise hide a broken nightly run. runPipeline logs
   * the per-job lines and the finish summary.
   */
  private async runSlot(label: string, pipeline: JobType[]): Promise<void> {
    this.logger.log(`⏰ Cron "${label}" fired.`);
    try {
      const result = await this.jobs.runPipeline(label, pipeline);
      if (!result.started) {
        this.logger.warn(`Cron "${label}" skipped — another pipeline was already running.`);
      }
    } catch (err) {
      this.logger.error(`Cron "${label}" crashed: ${(err as Error).message}`, (err as Error).stack);
    }
  }
}
