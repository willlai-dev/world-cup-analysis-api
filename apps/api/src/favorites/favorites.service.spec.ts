import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  let prisma: {
    favoriteTeam: { upsert: jest.Mock; deleteMany: jest.Mock };
    favoritePlayer: { upsert: jest.Mock; deleteMany: jest.Mock };
    team: { findUnique: jest.Mock };
    player: { findUnique: jest.Mock };
  };
  let service: FavoritesService;

  beforeEach(() => {
    prisma = {
      favoriteTeam: { upsert: jest.fn(), deleteMany: jest.fn() },
      favoritePlayer: { upsert: jest.fn(), deleteMany: jest.fn() },
      team: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
      player: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }) },
    };
    service = new FavoritesService(prisma as unknown as PrismaService);
  });

  it('adds a team favorite via idempotent upsert (not create)', async () => {
    prisma.favoriteTeam.upsert.mockResolvedValue({});
    await expect(service.addTeam('u1', 't1')).resolves.toEqual({ success: true });
    expect(prisma.favoriteTeam.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_teamId: { userId: 'u1', teamId: 't1' } } }),
    );
  });

  it('re-adding does not create a duplicate (upsert update is a no-op)', async () => {
    prisma.favoriteTeam.upsert.mockResolvedValue({});
    await service.addTeam('u1', 't1');
    await service.addTeam('u1', 't1');
    expect(prisma.favoriteTeam.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.favoriteTeam.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });

  it('removes a team favorite idempotently', async () => {
    prisma.favoriteTeam.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.removeTeam('u1', 't1')).resolves.toEqual({ success: true });
    expect(prisma.favoriteTeam.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', teamId: 't1' },
    });
  });

  it('adds a player favorite', async () => {
    prisma.favoritePlayer.upsert.mockResolvedValue({});
    await expect(service.addPlayer('u1', 'p1')).resolves.toEqual({ success: true });
  });

  it('throws 404 when favoriting a missing team', async () => {
    prisma.team.findUnique.mockResolvedValue(null);
    await expect(service.addTeam('u1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
