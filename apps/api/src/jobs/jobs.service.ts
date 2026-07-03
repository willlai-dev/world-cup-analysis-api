import { Injectable, Logger } from '@nestjs/common';
import { type JobRun, JobStatus, JobType, Prisma } from '@prisma/client';
import { ChampionPredictionService } from '../champion-prediction/champion-prediction.service';
import { MatchesService } from '../matches/matches.service';
import { NewsService } from '../news/news.service';
import { PlayersService } from '../players/players.service';
import { PrismaService } from '../prisma/prisma.service';
import { MatchSyncService } from '../sources/football-data/match-sync.service';
import { PlayerSyncService } from '../sources/football-data/player-sync.service';
import { TeamSyncService } from '../sources/football-data/team-sync.service';
import { NewsSyncService } from '../sources/news/news-sync.service';
import { TeamsService } from '../teams/teams.service';

export type JobResult = {
  jobRunId: string;
  jobType: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Sync counts ({fetched,created,updated,failed}) or {skipped,reason} / {error}. */
  metadata: unknown;
};

/** Outcome of running a named sequence of jobs (see JobsService.runPipeline). */
export type PipelineResult = {
  label: string;
  /** false when another pipeline was already running, so this one was skipped. */
  started: boolean;
  /** Per-job results, in run order (empty when started=false). */
  results: JobResult[];
};

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** Shared reentrancy guard so cron slots and manual admin runs never overlap. */
  private pipelineRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly teamSync: TeamSyncService,
    private readonly playerSync: PlayerSyncService,
    private readonly matchSync: MatchSyncService,
    private readonly newsSync: NewsSyncService,
    private readonly news: NewsService,
    private readonly players: PlayersService,
    private readonly matches: MatchesService,
    private readonly champion: ChampionPredictionService,
    private readonly teams: TeamsService,
  ) {}

  /**
   * Records a JobRun (RUNNING -> DONE/FAILED) around the real handler for the
   * job type. Sync handlers short-circuit (skipped -> DONE) when their data
   * source key is not configured, so the endpoints stay 200 with no network.
   */
  async run(jobType: JobType): Promise<JobResult> {
    const started = await this.prisma.jobRun.create({
      data: { jobType, status: JobStatus.RUNNING, startedAt: new Date() },
    });

    let status: JobStatus = JobStatus.DONE;
    let metadata: Prisma.InputJsonValue;
    try {
      metadata = (await this.dispatch(jobType)) as unknown as Prisma.InputJsonValue;
    } catch (err) {
      status = JobStatus.FAILED;
      metadata = { error: (err as Error).message };
    }

    const done = await this.prisma.jobRun.update({
      where: { id: started.id },
      data: { status, completedAt: new Date(), metadata },
    });
    return this.toJobResult(done);
  }

  /** True while a pipeline (cron or manual) is in progress. */
  get pipelineInProgress(): boolean {
    return this.pipelineRunning;
  }

  /**
   * Runs `pipeline`'s jobs one at a time, recording a JobRun for each. A single
   * failing job is logged and the pipeline continues. Guarded so a second call
   * (another cron slot, or a manual admin trigger) is skipped while one is live.
   */
  async runPipeline(label: string, pipeline: JobType[]): Promise<PipelineResult> {
    if (this.pipelineRunning) {
      this.logger.warn(`Pipeline still running; skipping "${label}".`);
      return { label, started: false, results: [] };
    }
    this.pipelineRunning = true;
    this.logger.log(`Pipeline "${label}" started (${pipeline.length} jobs).`);
    const results: JobResult[] = [];
    try {
      for (const jobType of pipeline) {
        try {
          const result = await this.run(jobType);
          results.push(result);
          this.logger.log(`[${label}] ${jobType} -> ${result.status}`);
        } catch (err) {
          this.logger.error(`[${label}] ${jobType} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.pipelineRunning = false;
      this.logger.log(`Pipeline "${label}" finished.`);
    }
    return { label, started: true, results };
  }

  /**
   * Fire-and-forget wrapper for manual triggers: returns synchronously whether
   * the pipeline started (false if one was already running), then runs it in the
   * background. Callers (the admin endpoint) respond 202 without waiting for the
   * long sync + AI-generation work to finish.
   */
  startPipeline(label: string, pipeline: JobType[]): { started: boolean; jobTypes: JobType[] } {
    if (this.pipelineRunning) {
      return { started: false, jobTypes: pipeline };
    }
    // runPipeline flips the guard synchronously before its first await, so a
    // rapid second call sees pipelineRunning=true — no overlap.
    void this.runPipeline(label, pipeline).catch((err) =>
      this.logger.error(`Pipeline "${label}" crashed: ${(err as Error).message}`),
    );
    return { started: true, jobTypes: pipeline };
  }

  /** Recent JobRun rows (newest first) for admins to observe pipeline progress. */
  async listRuns(limit: number, jobType?: JobType): Promise<JobResult[]> {
    const rows = await this.prisma.jobRun.findMany({
      where: jobType ? { jobType } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toJobResult(row));
  }

  private toJobResult(row: JobRun): JobResult {
    return {
      jobRunId: row.id,
      jobType: row.jobType,
      status: row.status,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      metadata: row.metadata ?? null,
    };
  }

  private async dispatch(jobType: JobType): Promise<Record<string, unknown>> {
    switch (jobType) {
      case JobType.SYNC_TEAMS:
        return this.teamSync.run();
      case JobType.SYNC_PLAYERS:
        return this.playerSync.run();
      case JobType.SYNC_FIXTURES:
        return this.matchSync.syncFixtures();
      case JobType.SYNC_RESULTS:
        return this.matchSync.syncResults();
      case JobType.FETCH_NEWS:
        return this.newsSync.run();
      case JobType.GENERATE_NEWS_SUMMARY:
        return this.news.generateSummaries();
      case JobType.GENERATE_NEWS_IMPACT:
        return this.news.generateImpacts();
      case JobType.GENERATE_TEAM_RATINGS:
        return this.teams.generateRatings();
      case JobType.GENERATE_PLAYER_RATINGS:
        return this.players.generateRatings();
      case JobType.GENERATE_PLAYER_STATUS:
        return this.players.generateStatuses();
      case JobType.GENERATE_MATCH_ANALYSIS:
        return this.matches.generateAnalyses();
      case JobType.GENERATE_CHAMPION_PREDICTIONS:
        return this.champion.generateSystemRun();
      default:
        // Not implemented yet (other sync jobs land in later batches; generate-* later).
        return { note: `${jobType} not implemented yet`, stub: true };
    }
  }
}
