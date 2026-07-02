import { Injectable } from '@nestjs/common';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { ChampionPredictionService } from '../champion-prediction/champion-prediction.service';
import { MatchesService } from '../matches/matches.service';
import { NewsService } from '../news/news.service';
import { PlayersService } from '../players/players.service';
import { PrismaService } from '../prisma/prisma.service';
import { MatchSyncService } from '../sources/football-data/match-sync.service';
import { PlayerSyncService } from '../sources/football-data/player-sync.service';
import { TeamSyncService } from '../sources/football-data/team-sync.service';
import { NewsSyncService } from '../sources/news/news-sync.service';

export type JobResult = {
  jobRunId: string;
  jobType: JobType;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Sync counts ({fetched,created,updated,failed}) or {skipped,reason} / {error}. */
  metadata: unknown;
};

@Injectable()
export class JobsService {
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
    return {
      jobRunId: done.id,
      jobType: done.jobType,
      status: done.status,
      startedAt: done.startedAt ? done.startedAt.toISOString() : null,
      completedAt: done.completedAt ? done.completedAt.toISOString() : null,
      metadata: done.metadata ?? null,
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
