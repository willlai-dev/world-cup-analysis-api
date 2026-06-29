import { Injectable, NotFoundException } from '@nestjs/common';
import type { PlayerSummary, TeamSummary } from '../common/dto/contracts';
import { toPlayerSummary, toTeamSummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async listFavorites(userId: string): Promise<{ teams: TeamSummary[]; players: PlayerSummary[] }> {
    const [teams, players] = await Promise.all([
      this.prisma.favoriteTeam.findMany({
        where: { userId },
        include: { team: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.favoritePlayer.findMany({
        where: { userId },
        include: { player: { include: { team: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      teams: teams.map((t) => toTeamSummary(t.team)),
      players: players.map((p) => toPlayerSummary(p.player)),
    };
  }

  /** Idempotent: re-adding an existing favorite does not create a duplicate. */
  async addTeam(userId: string, teamId: string): Promise<{ success: true }> {
    await this.ensureTeamExists(teamId);
    await this.prisma.favoriteTeam.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { userId, teamId },
      update: {},
    });
    return { success: true };
  }

  /** Idempotent: removing a non-existent favorite still succeeds. */
  async removeTeam(userId: string, teamId: string): Promise<{ success: true }> {
    await this.prisma.favoriteTeam.deleteMany({ where: { userId, teamId } });
    return { success: true };
  }

  async addPlayer(userId: string, playerId: string): Promise<{ success: true }> {
    await this.ensurePlayerExists(playerId);
    await this.prisma.favoritePlayer.upsert({
      where: { userId_playerId: { userId, playerId } },
      create: { userId, playerId },
      update: {},
    });
    return { success: true };
  }

  async removePlayer(userId: string, playerId: string): Promise<{ success: true }> {
    await this.prisma.favoritePlayer.deleteMany({ where: { userId, playerId } });
    return { success: true };
  }

  private async ensureTeamExists(teamId: string): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }
  }

  private async ensurePlayerExists(playerId: string): Promise<void> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true },
    });
    if (!player) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Player not found' });
    }
  }
}
