import { PlayerPosition } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FootballDataClient } from './football-data.client';
import { PlayerSyncService } from './player-sync.service';

describe('PlayerSyncService', () => {
  function build() {
    const prisma = {
      team: { findMany: jest.fn() },
      player: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const client = { hasKey: jest.fn(), getTeamSquad: jest.fn() };
    const service = new PlayerSyncService(
      prisma as unknown as PrismaService,
      client as unknown as FootballDataClient,
    );
    (service as unknown as { throttleMs: number }).throttleMs = 0; // no real delays in tests
    return { service, prisma, client };
  }

  it('skips with no network when the API key is missing', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(false);

    const result = await service.run();

    expect(result).toMatchObject({ skipped: true });
    expect(prisma.team.findMany).not.toHaveBeenCalled();
  });

  it('maps positions and upserts squad members for each synced team', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    prisma.team.findMany.mockResolvedValue([{ id: 'team-bra', externalId: '764' }]);
    client.getTeamSquad.mockResolvedValue([
      { id: 1, name: 'Alisson', position: 'Goalkeeper', shirtNumber: 1 },
      { id: 2, name: 'Casemiro', position: 'Defensive Midfield', shirtNumber: 5 },
    ]);
    prisma.player.findFirst.mockResolvedValue(null);

    const result = await service.run();

    expect(client.getTeamSquad).toHaveBeenCalledWith('764');
    expect(prisma.player.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ teamId: 'team-bra', externalId: '1', position: PlayerPosition.GK }),
    });
    expect(prisma.player.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalId: '2', position: PlayerPosition.MF }),
    });
    expect(result).toMatchObject({ created: 2, updated: 0, failed: 0 });
  });

  it('counts a team as failed and continues when its squad fetch throws', async () => {
    const { service, prisma, client } = build();
    client.hasKey.mockReturnValue(true);
    prisma.team.findMany.mockResolvedValue([
      { id: 'team-a', externalId: '1' },
      { id: 'team-b', externalId: '2' },
    ]);
    client.getTeamSquad
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ id: 9, name: 'Player', position: 'Centre-Back' }]);
    prisma.player.findFirst.mockResolvedValue(null);

    const result = await service.run();

    expect(result).toMatchObject({ failed: 1, created: 1 });
    expect(prisma.player.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ position: PlayerPosition.DF }),
    });
  });
});
