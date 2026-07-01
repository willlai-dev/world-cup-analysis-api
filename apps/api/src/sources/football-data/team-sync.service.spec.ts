import type { PrismaService } from '../../prisma/prisma.service';
import type { FootballDataClient } from './football-data.client';
import { TeamSyncService } from './team-sync.service';

describe('TeamSyncService', () => {
  function build() {
    const prisma = {
      team: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const client = { hasKey: jest.fn(), getCompetitionTeams: jest.fn() };
    const service = new TeamSyncService(
      prisma as unknown as PrismaService,
      client as unknown as FootballDataClient,
    );
    return { service, prisma, client };
  }

  it('skips with no network when the API key is missing', async () => {
    const { service, client } = build();
    client.hasKey.mockReturnValue(false);

    const result = await service.run();

    expect(result).toMatchObject({ skipped: true });
    expect(client.getCompetitionTeams).not.toHaveBeenCalled();
  });

  it('creates a team when none matches by externalId or fifaCode', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    client.getCompetitionTeams.mockResolvedValue([
      { id: 764, name: 'Brazil', tla: 'BRA', crest: 'crest-url', coach: { name: 'Coach' } },
    ]);
    prisma.team.findFirst.mockResolvedValue(null);

    const result = await service.run();

    expect(prisma.team.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: '764',
        fifaCode: 'BRA',
        nameEn: 'Brazil',
        coachName: 'Coach',
        flagUrl: 'crest-url',
      }),
    });
    expect(prisma.team.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetched: 1, created: 1, updated: 0 });
  });

  it('updates the existing (seeded) team matched by fifaCode', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    client.getCompetitionTeams.mockResolvedValue([
      { id: 764, name: 'Brazil', tla: 'BRA', crest: null, coach: null },
    ]);
    prisma.team.findFirst.mockResolvedValue({ id: 'seed-team-bra' });

    const result = await service.run();

    expect(prisma.team.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'seed-team-bra' } }),
    );
    expect(prisma.team.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetched: 1, created: 0, updated: 1 });
  });
});
