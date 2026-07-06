import type { JobsService } from './jobs.service';
import {
  FULL_PIPELINE,
  JobsScheduler,
  PLAYER_STATUS_PIPELINE,
  RATINGS_PIPELINE,
  REFRESH_PIPELINE,
} from './jobs.scheduler';

/** Each cron slot delegates to JobsService.runPipeline with its label + pipeline. */
describe('JobsScheduler', () => {
  const makeJobs = () => ({
    runPipeline: jest.fn().mockResolvedValue({ started: true, results: [] }),
  });

  it('02:00 slot delegates the ratings pipeline (player before team)', async () => {
    const jobs = makeJobs();
    await new JobsScheduler(jobs as unknown as JobsService).runRatings();
    expect(jobs.runPipeline).toHaveBeenCalledWith('ratings', RATINGS_PIPELINE);
    // Team score reads the squad's player scores, so player ratings must run first.
    expect(RATINGS_PIPELINE).toEqual(['GENERATE_PLAYER_RATINGS', 'GENERATE_TEAM_RATINGS']);
  });

  it('04:00 slot delegates the full pipeline in order', async () => {
    const jobs = makeJobs();
    await new JobsScheduler(jobs as unknown as JobsService).runFullPipeline();
    expect(jobs.runPipeline).toHaveBeenCalledWith('full', FULL_PIPELINE);
    // Guard against silent reordering of the 04:00 pipeline. Player/team ratings are
    // NOT here — they run at 02:00 so champion predictions rank by fresh team scores.
    expect(FULL_PIPELINE).toEqual([
      'SYNC_TEAMS',
      'SYNC_PLAYERS',
      'SYNC_FIXTURES',
      'SYNC_RESULTS',
      'FETCH_NEWS',
      'GENERATE_NEWS_SUMMARY',
      'GENERATE_NEWS_IMPACT',
      'GENERATE_MATCH_ANALYSIS',
      'GENERATE_CHAMPION_PREDICTIONS',
      'SCORE_PREDICTIONS',
    ]);
    expect(FULL_PIPELINE).not.toContain('GENERATE_PLAYER_RATINGS');
    expect(FULL_PIPELINE).not.toContain('GENERATE_TEAM_RATINGS');
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
