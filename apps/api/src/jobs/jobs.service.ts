import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
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

/** Compact one-line rendering of a job's result metadata for the console log. */
function summarizeMetadata(metadata: Prisma.InputJsonValue): string {
  try {
    const json = JSON.stringify(metadata);
    if (!json || json === '{}') {
      return '';
    }
    return json.length > 300 ? `${json.slice(0, 300)}…` : json;
  } catch {
    return '';
  }
}

export type JobResult = {
  jobRunId: string;
  jobType: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Sync counts ({fetched,created,updated,failed}) or {skipped,reason} / {error}. */
  metadata: unknown;
};

/** Minimal team shape for the admin "single-country re-analysis" picker. */
export type TeamOption = {
  id: string;
  nameEn: string;
  nameZh: string | null;
  fifaCode: string | null;
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
export class JobsService implements OnModuleInit {
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

  /** On boot, clear any orphaned RUNNING/PENDING job runs left by a dead process. */
  async onModuleInit(): Promise<void> {
    await this.reapOrphanRuns();
  }

  /**
   * Marks every JobRun still RUNNING/PENDING as FAILED. At startup such rows can
   * only be orphans from a previous process that died mid-run (deploy, crash,
   * OOM) between the RUNNING insert and the DONE/FAILED update in {@link run}:
   * this process's in-memory {@link pipelineRunning} guard starts false and no
   * cron/manual run has fired yet, so nothing here owns them. Left alone they
   * stay RUNNING forever and the admin UI treats a lingering RUNNING run as
   * "active" and locks its trigger buttons (the client's 6h staleness heuristic
   * is only a fallback for this). Reaping is unconditional because this assumes a
   * single API instance (in-process cron + in-memory guard) — with horizontal
   * scaling this would need a per-row age/heartbeat threshold instead.
   */
  async reapOrphanRuns(): Promise<number> {
    const { count } = await this.prisma.jobRun.updateMany({
      where: { status: { in: [JobStatus.RUNNING, JobStatus.PENDING] } },
      data: {
        status: JobStatus.FAILED,
        completedAt: new Date(),
        errorMessage: 'Orphaned by a server restart — reaped at startup.',
        metadata: { reaped: true, reason: 'orphaned-by-restart' },
      },
    });
    if (count > 0) {
      this.logger.warn(
        `Reaped ${count} orphaned job run(s) (RUNNING/PENDING) left by a previous process.`,
      );
    }
    return count;
  }

  /**
   * Records a JobRun (RUNNING -> DONE/FAILED) around the real handler for the
   * job type. Sync handlers short-circuit (skipped -> DONE) when their data
   * source key is not configured, so the endpoints stay 200 with no network.
   */
  async run(jobType: JobType, logContext?: string): Promise<JobResult> {
    return this.record(jobType, () => this.dispatch(jobType), logContext);
  }

  /**
   * Records a JobRun (RUNNING -> DONE/FAILED) around an arbitrary handler. `run`
   * uses it for the whole-competition `dispatch`; the per-team pipeline uses it
   * for scoped handlers. Sync handlers short-circuit (skipped -> DONE) when their
   * data source key is not configured. `extraMeta` is merged into the stored
   * metadata (e.g. `{ teamId }`) so scoped runs are identifiable in `listRuns`.
   */
  private async record(
    jobType: JobType,
    handler: () => Promise<unknown>,
    logContext?: string,
    extraMeta?: Record<string, unknown>,
  ): Promise<JobResult> {
    const tag = logContext ? `[${logContext}] ` : '';
    const started = await this.prisma.jobRun.create({
      data: { jobType, status: JobStatus.RUNNING, startedAt: new Date() },
    });
    this.logger.log(`${tag}${jobType} started (run ${started.id}).`);
    const startedAtMs = Date.now();

    let status: JobStatus = JobStatus.DONE;
    let metadata: Prisma.InputJsonValue;
    try {
      const raw = await handler();
      metadata = (
        extraMeta && raw && typeof raw === 'object' ? { ...raw, ...extraMeta } : raw
      ) as unknown as Prisma.InputJsonValue;
    } catch (err) {
      status = JobStatus.FAILED;
      metadata = { error: (err as Error).message, ...extraMeta };
      // Background jobs are otherwise only observable by polling JobRun rows —
      // surface the failure (with stack) on the console right away.
      this.logger.error(`${tag}${jobType} FAILED: ${(err as Error).message}`, (err as Error).stack);
    }

    const done = await this.prisma.jobRun.update({
      where: { id: started.id },
      data: { status, completedAt: new Date(), metadata },
    });
    const ms = Date.now() - startedAtMs;
    if (status === JobStatus.DONE) {
      this.logger.log(`${tag}${jobType} -> DONE in ${ms}ms ${summarizeMetadata(metadata)}`);
    }
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
    const startedAtMs = Date.now();
    const results: JobResult[] = [];
    try {
      for (const jobType of pipeline) {
        try {
          // run() logs its own start/DONE/FAILED lines (with the label as context).
          results.push(await this.run(jobType, label));
        } catch (err) {
          // run() swallows handler errors into a FAILED result, so this only
          // fires if the JobRun bookkeeping itself (DB) throws.
          this.logger.error(`[${label}] ${jobType} crashed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.pipelineRunning = false;
      // One-glance execution status for the daily cron slots (which never hit the
      // HTTP access log): how many jobs succeeded/failed and how long it took.
      const sec = ((Date.now() - startedAtMs) / 1000).toFixed(1);
      const doneCount = results.filter((r) => r.status === JobStatus.DONE).length;
      const failedCount = results.filter((r) => r.status === JobStatus.FAILED).length;
      const summary = `Pipeline "${label}" finished in ${sec}s — ${doneCount} DONE, ${failedCount} FAILED (of ${pipeline.length}).`;
      if (failedCount > 0 || results.length < pipeline.length) {
        this.logger.warn(summary);
      } else {
        this.logger.log(summary);
      }
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
      this.logger.warn(
        `Manual pipeline "${label}" rejected — another pipeline is already running.`,
      );
      return { started: false, jobTypes: pipeline };
    }
    this.logger.log(
      `Manual pipeline "${label}" accepted (${pipeline.length} jobs): ${pipeline.join(', ')}`,
    );
    // runPipeline flips the guard synchronously before its first await, so a
    // rapid second call sees pipelineRunning=true — no overlap.
    void this.runPipeline(label, pipeline).catch((err) =>
      this.logger.error(`Pipeline "${label}" crashed: ${(err as Error).message}`),
    );
    return { started: true, jobTypes: pipeline };
  }

  /** Job types a single-country refresh runs, in dependency order (squad sync optional). */
  private teamPipelineJobTypes(sync: boolean): JobType[] {
    return [
      ...(sync ? [JobType.SYNC_PLAYERS] : []),
      JobType.GENERATE_PLAYER_RATINGS,
      JobType.GENERATE_TEAM_RATINGS,
      JobType.GENERATE_PLAYER_STATUS,
    ];
  }

  /** 404s if the team id is unknown; returns its id + name for the trigger ack. */
  async assertTeamExists(teamId: string): Promise<{ id: string; nameEn: string }> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, nameEn: true },
    });
    if (!team) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }
    return team;
  }

  /**
   * Lightweight team list for the admin "single-country re-analysis" picker.
   * This ADMIN-guarded lookup returns just what the dropdown needs (id + names +
   * FIFA code) without the pagination/detail payload of `/api/teams`.
   * Non-eliminated teams first, then alphabetical.
   */
  listTeamsForPicker(): Promise<TeamOption[]> {
    return this.prisma.team.findMany({
      select: { id: true, nameEn: true, nameZh: true, fifaCode: true },
      orderBy: [{ isEliminated: 'asc' }, { nameEn: 'asc' }],
    });
  }

  /**
   * Single-country refresh, scoped to one team: (optional squad sync →) that
   * team's player ratings → its team rating → its players' status. Player ratings
   * run before the team rating (team score reads the squad's scores). Uses the
   * same shared guard as {@link runPipeline}, so it won't overlap a cron slot or
   * another manual run. Each step is a JobRun tagged with `{ teamId }` in metadata.
   */
  async runTeamPipeline(teamId: string, opts: { sync?: boolean } = {}): Promise<PipelineResult> {
    const sync = opts.sync !== false;
    const label = `manual-team ${teamId}`;
    if (this.pipelineRunning) {
      this.logger.warn(`Team pipeline for ${teamId} skipped — another pipeline is already running.`);
      return { label, started: false, results: [] };
    }
    this.pipelineRunning = true;
    const jobTypes = this.teamPipelineJobTypes(sync);
    this.logger.log(`Team pipeline "${label}" started (${jobTypes.length} jobs).`);
    const startedAtMs = Date.now();
    const meta = { teamId };
    const results: JobResult[] = [];
    try {
      if (sync) {
        results.push(
          await this.record(JobType.SYNC_PLAYERS, () => this.playerSync.run({ teamId }), label, meta),
        );
      }
      results.push(
        await this.record(
          JobType.GENERATE_PLAYER_RATINGS,
          () => this.players.generateRatings({ teamId }),
          label,
          meta,
        ),
      );
      results.push(
        await this.record(
          JobType.GENERATE_TEAM_RATINGS,
          () => this.teams.generateRatings({ teamId }),
          label,
          meta,
        ),
      );
      results.push(
        await this.record(
          JobType.GENERATE_PLAYER_STATUS,
          () => this.players.generateStatuses({ teamId }),
          label,
          meta,
        ),
      );
    } finally {
      this.pipelineRunning = false;
      const sec = ((Date.now() - startedAtMs) / 1000).toFixed(1);
      const doneCount = results.filter((r) => r.status === JobStatus.DONE).length;
      const failedCount = results.filter((r) => r.status === JobStatus.FAILED).length;
      this.logger.log(`Team pipeline "${label}" finished in ${sec}s — ${doneCount} DONE, ${failedCount} FAILED.`);
    }
    return { label, started: true, results };
  }

  /** Fire-and-forget wrapper for the per-country admin trigger (mirrors {@link startPipeline}). */
  startTeamPipeline(
    teamId: string,
    opts: { sync?: boolean } = {},
  ): { started: boolean; jobTypes: JobType[] } {
    const jobTypes = this.teamPipelineJobTypes(opts.sync !== false);
    if (this.pipelineRunning) {
      this.logger.warn(`Team pipeline for ${teamId} rejected — another pipeline is already running.`);
      return { started: false, jobTypes };
    }
    this.logger.log(`Manual team pipeline for ${teamId} accepted (${jobTypes.length} jobs).`);
    void this.runTeamPipeline(teamId, opts).catch((err) =>
      this.logger.error(`Team pipeline for ${teamId} crashed: ${(err as Error).message}`),
    );
    return { started: true, jobTypes };
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
      case JobType.GENERATE_RETRO_ANALYSIS:
        return this.matches.generateRetroAnalyses();
      case JobType.SCORE_PREDICTIONS:
        return this.matches.scorePredictions();
      case JobType.GENERATE_CHAMPION_PREDICTIONS:
        return this.champion.generateSystemRun();
      default:
        // Not implemented yet (other sync jobs land in later batches; generate-* later).
        return { note: `${jobType} not implemented yet`, stub: true };
    }
  }
}
