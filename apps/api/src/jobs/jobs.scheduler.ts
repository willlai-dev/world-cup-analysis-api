import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobType } from '@prisma/client';
import { JobsService } from './jobs.service';

/** 04:00 full pipeline: refresh all external data, then (re)generate all AI analysis. */
const FULL_PIPELINE: JobType[] = [
  JobType.SYNC_TEAMS,
  JobType.SYNC_PLAYERS,
  JobType.SYNC_FIXTURES,
  JobType.SYNC_RESULTS,
  JobType.FETCH_NEWS,
  JobType.GENERATE_NEWS_SUMMARY,
  JobType.GENERATE_PLAYER_RATINGS,
  JobType.GENERATE_MATCH_ANALYSIS,
  JobType.GENERATE_CHAMPION_PREDICTIONS,
];

/**
 * 12:00 midday refresh: catch data that arrived late (finished scores, advancing
 * bracket) and refresh the affected predictions. Skips the stable/expensive
 * team+player sync and player ratings.
 */
const REFRESH_PIPELINE: JobType[] = [
  JobType.SYNC_FIXTURES,
  JobType.SYNC_RESULTS,
  JobType.FETCH_NEWS,
  JobType.GENERATE_NEWS_SUMMARY,
  JobType.GENERATE_MATCH_ANALYSIS,
  JobType.GENERATE_CHAMPION_PREDICTIONS,
];

/**
 * Runs the sync + generate pipeline on a schedule. Two slots (04:00 full,
 * 12:00 refresh) because source data can lag. Each step goes through JobsService
 * (records a JobRun, skips on missing keys, and only re-analyzes changed entities
 * via sourceSnapshotHash). A reentrancy guard prevents overlapping runs.
 */
@Injectable()
export class JobsScheduler {
  private readonly logger = new Logger(JobsScheduler.name);
  private running = false;

  constructor(private readonly jobs: JobsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  runFullPipeline(): Promise<void> {
    return this.runPipeline('full', FULL_PIPELINE);
  }

  @Cron('0 12 * * *')
  runMiddayRefresh(): Promise<void> {
    return this.runPipeline('midday-refresh', REFRESH_PIPELINE);
  }

  private async runPipeline(label: string, pipeline: JobType[]): Promise<void> {
    if (this.running) {
      this.logger.warn(`Pipeline still running; skipping ${label}.`);
      return;
    }
    this.running = true;
    this.logger.log(`Pipeline "${label}" started.`);
    try {
      for (const jobType of pipeline) {
        try {
          const result = await this.jobs.run(jobType);
          this.logger.log(`[${label}] ${jobType} -> ${result.status}`);
        } catch (err) {
          this.logger.error(`[${label}] ${jobType} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
      this.logger.log(`Pipeline "${label}" finished.`);
    }
  }
}
