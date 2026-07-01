import { JobsScheduler } from './jobs.scheduler';
import type { JobsService } from './jobs.service';

describe('JobsScheduler', () => {
  it('runs the full sync + generate pipeline in order', async () => {
    const run = jest.fn().mockResolvedValue({ status: 'DONE' });
    const scheduler = new JobsScheduler({ run } as unknown as JobsService);

    await scheduler.runFullPipeline();

    const order = run.mock.calls.map((c) => c[0]);
    expect(order).toEqual([
      'SYNC_TEAMS',
      'SYNC_PLAYERS',
      'SYNC_FIXTURES',
      'SYNC_RESULTS',
      'FETCH_NEWS',
      'GENERATE_NEWS_SUMMARY',
      'GENERATE_PLAYER_RATINGS',
      'GENERATE_MATCH_ANALYSIS',
      'GENERATE_CHAMPION_PREDICTIONS',
    ]);
  });

  it('midday refresh syncs fixtures/results/news + regenerates match & champion (no player sync/ratings)', async () => {
    const run = jest.fn().mockResolvedValue({ status: 'DONE' });
    const scheduler = new JobsScheduler({ run } as unknown as JobsService);

    await scheduler.runMiddayRefresh();

    const order = run.mock.calls.map((c) => c[0]);
    expect(order).toEqual([
      'SYNC_FIXTURES',
      'SYNC_RESULTS',
      'FETCH_NEWS',
      'GENERATE_NEWS_SUMMARY',
      'GENERATE_MATCH_ANALYSIS',
      'GENERATE_CHAMPION_PREDICTIONS',
    ]);
    expect(order).not.toContain('SYNC_PLAYERS');
    expect(order).not.toContain('GENERATE_PLAYER_RATINGS');
  });

  it('continues the pipeline even if one job throws', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ status: 'DONE' }) // SYNC_TEAMS
      .mockRejectedValueOnce(new Error('boom')) // SYNC_PLAYERS
      .mockResolvedValue({ status: 'DONE' });
    const scheduler = new JobsScheduler({ run } as unknown as JobsService);

    await scheduler.runFullPipeline();

    expect(run).toHaveBeenCalledTimes(9);
  });

  it('skips a tick when a previous run is still in progress', async () => {
    let resolveFirst: () => void = () => {};
    const run = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((res) => {
          resolveFirst = () => res({ status: 'DONE' });
        }),
      )
      .mockResolvedValue({ status: 'DONE' });
    const scheduler = new JobsScheduler({ run } as unknown as JobsService);

    const first = scheduler.runFullPipeline(); // hangs on first job
    await scheduler.runFullPipeline(); // should skip (guard)
    expect(run).toHaveBeenCalledTimes(1);

    resolveFirst();
    await first;
  });
});
