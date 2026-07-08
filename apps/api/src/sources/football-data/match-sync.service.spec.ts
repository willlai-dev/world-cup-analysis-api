import { MatchStage, MatchStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FootballDataClient } from './football-data.client';
import { MatchSyncService } from './match-sync.service';

describe('MatchSyncService', () => {
  function build() {
    const prisma = {
      team: { findMany: jest.fn(), updateMany: jest.fn() },
      match: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    prisma.team.updateMany.mockResolvedValue({ count: 0 });
    const client = {
      hasKey: jest.fn(),
      getCompetitionMatches: jest.fn(),
      getMatch: jest.fn(),
    };
    const service = new MatchSyncService(
      prisma as unknown as PrismaService,
      client as unknown as FootballDataClient,
    );
    return { service, prisma, client };
  }

  it('skips with no network when the API key is missing', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(false);

    const result = await service.syncFixtures();

    expect(result).toMatchObject({ skipped: true });
    expect(prisma.team.findMany).not.toHaveBeenCalled();
  });

  it('upserts a fixture, resolving teams by tla and mapping status/stage', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    prisma.team.findMany.mockResolvedValue([
      { id: 'team-bra', externalId: '764', fifaCode: 'BRA' },
      { id: 'team-arg', externalId: '762', fifaCode: 'ARG' },
    ]);
    client.getCompetitionMatches.mockResolvedValue([
      {
        id: 5001,
        utcDate: '2026-06-20T18:00:00Z',
        status: 'FINISHED',
        stage: 'FINAL',
        group: null,
        homeTeam: { id: 764, tla: 'BRA' },
        awayTeam: { id: 762, tla: 'ARG' },
        score: { winner: 'HOME_TEAM', fullTime: { home: 2, away: 1 } },
        lastUpdated: '2026-06-20T20:00:00Z',
      },
    ]);
    prisma.match.findUnique.mockResolvedValue(null);
    // Recompute reads the full match table after the upsert loop.
    prisma.match.findMany.mockResolvedValue([
      {
        stage: MatchStage.FINAL,
        status: MatchStatus.FINISHED,
        homeTeamId: 'team-bra',
        awayTeamId: 'team-arg',
        winnerTeamId: 'team-bra',
      },
    ]);
    prisma.team.updateMany
      .mockResolvedValueOnce({ count: 1 }) // mark eliminated
      .mockResolvedValueOnce({ count: 0 }); // clear stale

    const result = await service.syncResults();

    expect(prisma.match.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: '5001' },
        create: expect.objectContaining({
          externalId: '5001',
          homeTeamId: 'team-bra',
          awayTeamId: 'team-arg',
          status: MatchStatus.FINISHED,
          stage: MatchStage.FINAL,
          homeScore: 2,
          awayScore: 1,
          winnerTeamId: 'team-bra',
        }),
      }),
    );
    expect(result).toMatchObject({
      fetched: 1,
      created: 1,
      failed: 0,
      eliminated: 1,
      reinstated: 0,
    });
    // FINAL loser (away/ARG) is marked eliminated; everyone else is cleared.
    expect(prisma.team.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ['team-arg'] }, isEliminated: false },
      data: { isEliminated: true },
    });
    expect(prisma.team.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { notIn: ['team-arg'] }, isEliminated: true },
      data: { isEliminated: false },
    });
  });

  it('derives the winner from penalties when full time is level', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    prisma.team.findMany.mockResolvedValue([
      { id: 'team-bra', externalId: '764', fifaCode: 'BRA' },
      { id: 'team-arg', externalId: '762', fifaCode: 'ARG' },
    ]);
    client.getCompetitionMatches.mockResolvedValue([
      {
        id: 5003,
        utcDate: '2026-07-05T18:00:00Z',
        status: 'FINISHED',
        stage: 'QUARTER_FINALS',
        homeTeam: { id: 764, tla: 'BRA' },
        awayTeam: { id: 762, tla: 'ARG' },
        score: {
          winner: null,
          duration: 'PENALTY_SHOOTOUT',
          fullTime: { home: 1, away: 1 },
          penalties: { home: 4, away: 3 },
        },
      },
    ]);
    prisma.match.findUnique.mockResolvedValue(null);

    await service.syncResults();

    expect(prisma.match.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          stage: MatchStage.QUARTER_FINAL,
          winnerTeamId: 'team-bra',
        }),
      }),
    );
  });

  it('counts a match as failed when a team cannot be resolved', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    prisma.team.findMany.mockResolvedValue([{ id: 'team-bra', externalId: '764', fifaCode: 'BRA' }]);
    client.getCompetitionMatches.mockResolvedValue([
      {
        id: 5002,
        utcDate: '2026-06-21T18:00:00Z',
        status: 'TIMED',
        stage: 'GROUP_STAGE',
        homeTeam: { id: 764, tla: 'BRA' },
        awayTeam: { id: 999, tla: 'ZZZ' }, // unknown team
        score: { winner: null, fullTime: { home: null, away: null } },
      },
    ]);

    const result = await service.syncFixtures();

    expect(prisma.match.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetched: 1, created: 0, failed: 1 });
  });

  it('recomputes eliminations when a manual refresh settles a match', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    client.getMatch.mockResolvedValue({
      id: 5004,
      utcDate: '2026-07-07T18:00:00Z',
      status: 'FINISHED',
      stage: 'SEMI_FINALS',
      homeTeam: { id: 764, tla: 'BRA' },
      awayTeam: { id: 762, tla: 'ARG' },
      score: { winner: 'AWAY_TEAM', fullTime: { home: 0, away: 2 } },
    });
    prisma.match.findMany.mockResolvedValue([
      {
        stage: MatchStage.SEMI_FINAL,
        status: MatchStatus.FINISHED,
        homeTeamId: 'team-bra',
        awayTeamId: 'team-arg',
        winnerTeamId: 'team-arg',
      },
    ]);

    const result = await service.refreshOneMatch({
      dbId: 'db-1',
      externalId: '5004',
      homeTeamId: 'team-bra',
      awayTeamId: 'team-arg',
    });

    expect(result).toEqual({ refreshed: true });
    expect(prisma.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ winnerTeamId: 'team-arg' }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.team.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ['team-bra'] }, isEliminated: false },
      data: { isEliminated: true },
    });
  });

  it('does not recompute eliminations when a refresh leaves the match unfinished', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    client.getMatch.mockResolvedValue({
      id: 5005,
      utcDate: '2026-07-08T18:00:00Z',
      status: 'IN_PLAY',
      stage: 'SEMI_FINALS',
      homeTeam: { id: 764, tla: 'BRA' },
      awayTeam: { id: 762, tla: 'ARG' },
      score: { winner: null, fullTime: { home: 0, away: 0 } },
    });

    const result = await service.refreshOneMatch({
      dbId: 'db-1',
      externalId: '5005',
      homeTeamId: 'team-bra',
      awayTeamId: 'team-arg',
    });

    expect(result).toEqual({ refreshed: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
