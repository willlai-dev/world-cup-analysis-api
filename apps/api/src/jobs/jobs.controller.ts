import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { JobType } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { type JobResult, JobsService } from './jobs.service';

// @Public() skips the global JwtAuthGuard; CronSecretGuard is the only gate.
@ApiTags('jobs')
@ApiHeader({ name: 'x-cron-secret', required: true })
@Public()
@Controller('jobs')
@UseGuards(CronSecretGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post('sync-fixtures')
  @HttpCode(200)
  syncFixtures(): Promise<JobResult> {
    return this.jobs.run(JobType.SYNC_FIXTURES);
  }

  @Post('sync-results')
  @HttpCode(200)
  syncResults(): Promise<JobResult> {
    return this.jobs.run(JobType.SYNC_RESULTS);
  }

  @Post('sync-teams')
  @HttpCode(200)
  syncTeams(): Promise<JobResult> {
    return this.jobs.run(JobType.SYNC_TEAMS);
  }

  @Post('sync-players')
  @HttpCode(200)
  syncPlayers(): Promise<JobResult> {
    return this.jobs.run(JobType.SYNC_PLAYERS);
  }

  @Post('fetch-news')
  @HttpCode(200)
  fetchNews(): Promise<JobResult> {
    return this.jobs.run(JobType.FETCH_NEWS);
  }

  @Post('generate-news-summary')
  @HttpCode(200)
  generateNewsSummary(): Promise<JobResult> {
    return this.jobs.run(JobType.GENERATE_NEWS_SUMMARY);
  }

  @Post('generate-news-impact')
  @HttpCode(200)
  generateNewsImpact(): Promise<JobResult> {
    return this.jobs.run(JobType.GENERATE_NEWS_IMPACT);
  }

  @Post('generate-match-analysis')
  @HttpCode(200)
  generateMatchAnalysis(): Promise<JobResult> {
    return this.jobs.run(JobType.GENERATE_MATCH_ANALYSIS);
  }

  @Post('generate-player-ratings')
  @HttpCode(200)
  generatePlayerRatings(): Promise<JobResult> {
    return this.jobs.run(JobType.GENERATE_PLAYER_RATINGS);
  }

  @Post('generate-player-status')
  @HttpCode(200)
  generatePlayerStatus(): Promise<JobResult> {
    return this.jobs.run(JobType.GENERATE_PLAYER_STATUS);
  }

  @Post('generate-champion-predictions')
  @HttpCode(200)
  generateChampionPredictions(): Promise<JobResult> {
    return this.jobs.run(JobType.GENERATE_CHAMPION_PREDICTIONS);
  }
}
