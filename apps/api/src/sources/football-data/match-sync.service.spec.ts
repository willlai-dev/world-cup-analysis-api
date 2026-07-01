import { MatchStage, MatchStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FootballDataClient } from './football-data.client';
import { MatchSyncService } from './match-sync.service';

describe('MatchSyncService', () => {
  function build() {
    const prisma = {
      team: { findMany: jest.fn(), updateMany: jest.fn() },
      match: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    const client = { hasKey: jest.fn(), getCompetitionMatches: jest.fn() };
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
    expect(result).toMatchObject({ fetched: 1, created: 1, failed: 0, eliminated: 1 });
    // FINAL loser (away/ARG) is marked eliminated.
    expect(prisma.team.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['team-arg'] } },
      data: { isEliminated: true },
    });
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
});
