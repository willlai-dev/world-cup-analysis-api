import { Injectable, NotFoundException } from '@nestjs/common';
import { AiEntityType, AiReportStatus, type Prisma } from '@prisma/client';
import type { AiReportDto, PlayerSummary } from '../common/dto/contracts';
import { toAiReportDto, toPlayerSummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';
import type { ListPlayersQueryDto } from './dto/list-players-query.dto';

const PLAYER_SORT_FIELDS = [
  'overallScore',
  'attackScore',
  'creativityScore',
  'techniqueScore',
  'defenseScore',
  'physicalScore',
  'formScore',
  'nameEn',
  'createdAt',
] as const;

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPlayersQueryDto): Promise<{ items: PlayerSummary[]; total: number }> {
    const where: Prisma.PlayerWhereInput = {};
    if (query.teamId) {
      where.teamId = query.teamId;
    }
    if (query.position) {
      where.position = query.position;
    }
    if (query.ratingTier) {
      where.ratingTier = query.ratingTier;
    }
    if (query.search) {
      where.OR = [
        { nameEn: { contains: query.search, mode: 'insensitive' } },
        { nameZh: { contains: query.search, mode: 'insensitive' } },
        { clubName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const sortBy = (PLAYER_SORT_FIELDS as readonly string[]).includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'overallScore';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.player.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { [sortBy]: sortOrder },
        include: { team: true },
      }),
      this.prisma.player.count({ where }),
    ]);
    return { items: items.map((p) => toPlayerSummary(p)), total };
  }

  async getById(playerId: string): Promise<PlayerSummary> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { team: true },
    });
    if (!player) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Player not found' });
    }
    return toPlayerSummary(player);
  }

  async getReport(playerId: string, reportTypes: string[]): Promise<AiReportDto | null> {
    await this.getById(playerId);
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.PLAYER,
        entityId: playerId,
        status: AiReportStatus.DONE,
        reportType: { in: reportTypes },
      },
      orderBy: { createdAt: 'desc' },
    });
    return report ? toAiReportDto(report) : null;
  }
}
