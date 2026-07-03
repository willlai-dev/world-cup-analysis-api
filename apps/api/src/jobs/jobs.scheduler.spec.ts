import type { JobsService } from './jobs.service';
import {
  FULL_PIPELINE,
  JobsScheduler,
  PLAYER_STATUS_PIPELINE,
  REFRESH_PIPELINE,
  TEAM_RATINGS_PIPELINE,
} from './jobs.scheduler';

/** Each cron slot delegates to JobsService.runPipeline with its label + pipeline. */
describe('JobsScheduler', () => {
  const makeJobs = () => ({
    runPipeline: jest.fn().mockResolvedValue({ started: true, results: [] }),
  });

  it('02:00 slot delegates the team-ratings pipeline', async () => {
    const jobs = makeJobs();
    await new JobsScheduler(jobs as unknown as JobsService).runTeamRatings();
    expect(jobs.runPipeline).toHaveBeenCalledWith('team-ratings', TEAM_RATINGS_PIPELINE);
  });

  it('04:00 slot delegates the full pipeline in order', async () => {
    const jobs = makeJobs();
    await new JobsScheduler(jobs as unknown as JobsService).runFullPipeline();
    expect(jobs.runPipeline).toHaveBeenCalledWith('full', FULL_PIPELINE);
    // Guard against silent reordering of the 04:00 pipeline.
    expect(FULL_PIPELINE).toEqual([
      'SYNC_TEAMS',
      'SYNC_PLAYERS',
      'SYNC_FIXTURES',
      'SYNC_RESULTS',
      'FETCH_NEWS',
      'GENERATE_NEWS_SUMMARY',
      'GENERATE_NEWS_IMPACT',
      'GENERATE_PLAYER_RATINGS',
      'GENERATE_MATCH_ANALYSIS',
      'GENERATE_CHAMPION_PREDICTIONS',
    ]);
  });

  it('12:00 slot delegates the midday refresh (no player sync/ratings)', async () => {
    const jobs = makeJobs();
    await new JobsScheduler(jobs as unknown as JobsService).runMiddayRefresh();
    expect(jobs.runPipeline).toHaveBeenCalledWith('midday-refresh', REFRESH_PIPELINE);
    expect(REFRESH_PIPELINE).not.toContain('SYNC_PLAYERS');
    expect(REFRESH_PIPELINE).not.toContain('GENERATE_PLAYER_RATINGS');
  });

  it('06:00 slot delegates only the player-status pipeline', async () => {
    const jobs = makeJobs();
    await new JobsScheduler(jobs as unknown as JobsService).runPlayerStatus();
    expect(jobs.runPipeline).toHaveBeenCalledWith('player-status', PLAYER_STATUS_PIPELINE);
    expect(PLAYER_STATUS_PIPELINE).toEqual(['GENERATE_PLAYER_STATUS']);
  });
});
