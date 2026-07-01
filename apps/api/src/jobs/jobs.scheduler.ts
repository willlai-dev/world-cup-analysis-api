import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobType } from '@prisma/client';
import { JobsService } from './jobs.service';

/** Daily pipeline order: refresh external data, then (re)generate AI analysis. */
const DAILY_PIPELINE: JobType[] = [
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
 * Runs the sync + generate pipeline on a daily schedule. Each step goes through
 * JobsService (so it still records a JobRun, skips when keys are missing, and —
 * via sourceSnapshotHash — only re-analyzes new/changed entities). A reentrancy
 * guard prevents a long run from overlapping the next tick.
 */
@Injectable()
export class JobsScheduler {
  private readonly logger = new Logger(JobsScheduler.name);
  private running = false;

  constructor(private readonly jobs: JobsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async runDailyPipeline(): Promise<void> {
    if (this.running) {
      this.logger.warn('Daily pipeline still running; skipping this tick.');
      return;
    }
    this.running = true;
    this.logger.log('Daily pipeline started.');
    try {
      for (const jobType of DAILY_PIPELINE) {
        try {
          const result = await this.jobs.run(jobType);
          this.logger.log(`${jobType} -> ${result.status}`);
        } catch (err) {
          this.logger.error(`${jobType} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
      this.logger.log('Daily pipeline finished.');
    }
  }
}
