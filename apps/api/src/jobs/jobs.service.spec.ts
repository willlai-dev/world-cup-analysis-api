import type { JobType } from '@prisma/client';
import { type JobResult, JobsService } from './jobs.service';

/** Build the service with a prisma stub; other deps are unused by these paths. */
function makeService(prisma: unknown = {}): JobsService {
  const u = undefined as never;
  return new JobsService(prisma as never, u, u, u, u, u, u, u, u, u);
}

const doneResult = (jobType: string): JobResult => ({
  jobRunId: 'run-id',
  jobType: jobType as JobType,
  status: 'DONE' as JobResult['status'],
  startedAt: null,
  completedAt: null,
  metadata: null,
});

describe('JobsService.runPipeline', () => {
  it('runs jobs sequentially in order and reports results', async () => {
    const service = makeService();
    const order: string[] = [];
    jest.spyOn(service, 'run').mockImplementation(async (jt) => {
      order.push(jt);
      return doneResult(jt);
    });

    const pipeline = ['SYNC_TEAMS', 'SYNC_PLAYERS', 'FETCH_NEWS'] as JobType[];
    const res = await service.runPipeline('full', pipeline);

    expect(order).toEqual(['SYNC_TEAMS', 'SYNC_PLAYERS', 'FETCH_NEWS']);
    expect(res.started).toBe(true);
    expect(res.label).toBe('full');
    expect(res.results).toHaveLength(3);
    expect(service.pipelineInProgress).toBe(false);
  });

  it('continues the pipeline even if one job throws', async () => {
    const service = makeService();
    const run = jest
      .spyOn(service, 'run')
      .mockResolvedValueOnce(doneResult('SYNC_TEAMS'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(doneResult('FETCH_NEWS'));

    const res = await service.runPipeline(
      'full',
      ['SYNC_TEAMS', 'SYNC_PLAYERS', 'FETCH_NEWS'] as JobType[],
    );

    expect(run).toHaveBeenCalledTimes(3);
    expect(res.started).toBe(true);
    // Only the two successful jobs land in results (the thrown one is skipped).
    expect(res.results).toHaveLength(2);
  });

  it('skips a concurrent run while one is already in progress (shared guard)', async () => {
    const service = makeService();
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    jest.spyOn(service, 'run').mockImplementation(async (jt) => {
      await gate;
      return doneResult(jt);
    });

    const first = service.runPipeline('full', ['SYNC_TEAMS'] as JobType[]);
    expect(service.pipelineInProgress).toBe(true);

    const second = await service.runPipeline('midday-refresh', ['FETCH_NEWS'] as JobType[]);
    expect(second.started).toBe(false);
    expect(second.results).toHaveLength(0);

    release();
    await first;
    expect(service.pipelineInProgress).toBe(false);
  });
});

describe('JobsService.startPipeline', () => {
  it('starts in the background and returns started=true', () => {
    const service = makeService();
    const spy = jest
      .spyOn(service, 'runPipeline')
      .mockResolvedValue({ label: 'manual-full', started: true, results: [] });

    const res = service.startPipeline('manual-full', ['SYNC_TEAMS'] as JobType[]);

    expect(res).toEqual({ started: true, jobTypes: ['SYNC_TEAMS'] });
    expect(spy).toHaveBeenCalledWith('manual-full', ['SYNC_TEAMS']);
  });

  it('returns started=false when a pipeline is already running', async () => {
    const service = makeService();
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => {
      release = res;
    });
    jest.spyOn(service, 'run').mockImplementation(async (jt) => {
      await gate;
      return doneResult(jt);
    });

    const first = service.runPipeline('full', ['SYNC_TEAMS'] as JobType[]);
    const res = service.startPipeline('manual-full', ['FETCH_NEWS'] as JobType[]);

    expect(res.started).toBe(false);
    release();
    await first;
  });
});

describe('JobsService.listRuns', () => {
  it('maps rows to JobResult and filters by jobType', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'r1',
        jobType: 'SYNC_TEAMS',
        status: 'DONE',
        startedAt: new Date('2026-07-03T00:00:00Z'),
        completedAt: new Date('2026-07-03T00:01:00Z'),
        metadata: { fetched: 48 },
      },
    ]);
    const service = makeService({ jobRun: { findMany } });

    const out = await service.listRuns(10, 'SYNC_TEAMS' as JobType);

    expect(findMany).toHaveBeenCalledWith({
      where: { jobType: 'SYNC_TEAMS' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(out[0]).toEqual({
      jobRunId: 'r1',
      jobType: 'SYNC_TEAMS',
      status: 'DONE',
      startedAt: '2026-07-03T00:00:00.000Z',
      completedAt: '2026-07-03T00:01:00.000Z',
      metadata: { fetched: 48 },
    });
  });

  it('omits the where filter when no jobType is given', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = makeService({ jobRun: { findMany } });

    await service.listRuns(50);

    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
});
