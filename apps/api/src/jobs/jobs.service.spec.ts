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

describe('JobsService.listTeamsForPicker', () => {
  it('returns id + names + fifaCode, non-eliminated first then alphabetical', async () => {
    const rows = [
      { id: 'team-arg', nameEn: 'Argentina', nameZh: '阿根廷', fifaCode: 'ARG' },
      { id: 'team-fra', nameEn: 'France', nameZh: '法國', fifaCode: 'FRA' },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const service = makeService({ team: { findMany } });

    const result = await service.listTeamsForPicker();

    expect(result).toBe(rows);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, nameEn: true, nameZh: true, fifaCode: true },
      orderBy: [{ isEliminated: 'asc' }, { nameEn: 'asc' }],
    });
  });
});

describe('JobsService.reapOrphanRuns', () => {
  it('marks RUNNING/PENDING runs FAILED and returns the count', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = makeService({ jobRun: { updateMany } });

    const count = await service.reapOrphanRuns();

    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: { in: ['RUNNING', 'PENDING'] } });
    expect(arg.data.status).toBe('FAILED');
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  it('reaps orphans on module init', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = makeService({ jobRun: { updateMany } });

    await service.onModuleInit();

    expect(updateMany).toHaveBeenCalledTimes(1);
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

describe('JobsService.runTeamPipeline', () => {
  const gen = (scope: string) => ({ scope, scanned: 1, generated: 1, skipped: 0, failed: 0 });

  /** Build a service with just the deps a scoped team run touches + a JobRun stub. */
  function makeTeamService() {
    const rows = new Map<string, Record<string, unknown>>();
    const jobRun = {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `run-${rows.size}`;
        const row = { id, completedAt: null, metadata: null, ...data };
        rows.set(id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return row;
      }),
    };
    const playerSync = { run: jest.fn().mockResolvedValue({ source: 'football-data', fetched: 0 }) };
    const players = {
      generateRatings: jest.fn().mockResolvedValue(gen('players')),
      generateStatuses: jest.fn().mockResolvedValue(gen('player-status')),
    };
    const teams = { generateRatings: jest.fn().mockResolvedValue(gen('teams')) };
    const u = undefined as never;
    const service = new JobsService(
      { jobRun } as never, u, playerSync as never, u, u, u, players as never, u, u, teams as never,
    );
    return { service, playerSync, players, teams };
  }

  it('runs scoped squad sync → player ratings → team rating → player status', async () => {
    const { service, playerSync, players, teams } = makeTeamService();

    const res = await service.runTeamPipeline('team-1', { sync: true });

    expect(res.started).toBe(true);
    expect(res.results.map((r) => r.jobType)).toEqual([
      'SYNC_PLAYERS',
      'GENERATE_PLAYER_RATINGS',
      'GENERATE_TEAM_RATINGS',
      'GENERATE_PLAYER_STATUS',
    ]);
    // every step is scoped to the one team...
    expect(playerSync.run).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(players.generateRatings).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(teams.generateRatings).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(players.generateStatuses).toHaveBeenCalledWith({ teamId: 'team-1' });
    // ...and tagged with teamId in the JobRun metadata for listRuns
    expect((res.results[1].metadata as { teamId?: string }).teamId).toBe('team-1');
    expect(service.pipelineInProgress).toBe(false);
  });

  it('skips the squad sync when sync=false', async () => {
    const { service, playerSync } = makeTeamService();

    const res = await service.runTeamPipeline('team-1', { sync: false });

    expect(res.results.map((r) => r.jobType)).toEqual([
      'GENERATE_PLAYER_RATINGS',
      'GENERATE_TEAM_RATINGS',
      'GENERATE_PLAYER_STATUS',
    ]);
    expect(playerSync.run).not.toHaveBeenCalled();
  });

  it('does not start while another pipeline holds the shared guard', async () => {
    const { service, players } = makeTeamService();
    let release: () => void = () => {};
    jest
      .spyOn(service, 'run')
      .mockImplementation(() => new Promise((res) => {
        release = () => res({} as never);
      }));

    const first = service.runPipeline('full', ['SYNC_TEAMS'] as never);
    expect(service.pipelineInProgress).toBe(true);

    const res = await service.runTeamPipeline('team-1');
    expect(res.started).toBe(false);
    expect(res.results).toHaveLength(0);
    expect(players.generateRatings).not.toHaveBeenCalled();

    release();
    await first;
  });
});
