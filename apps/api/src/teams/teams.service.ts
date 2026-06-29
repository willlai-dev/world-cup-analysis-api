import { Injectable, NotFoundException } from '@nestjs/common';
import { AiEntityType, AiReportStatus, type Prisma } from '@prisma/client';
import type {
  AiReportDto,
  MatchSummary,
  PlayerSummary,
  TeamSummary,
} from '../common/dto/contracts';
import { toAiReportDto, toMatchSummary, toPlayerSummary, toTeamSummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';
import type { ListTeamsQueryDto } from './dto/list-teams-query.dto';

const TEAM_SORT_FIELDS = [
  'championScore',
  'formScore',
  'worldRanking',
  'nameEn',
  'ratingTier',
  'createdAt',
] as const;

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListTeamsQueryDto): Promise<{ items: TeamSummary[]; total: number }> {
    const where: Prisma.TeamWhereInput = {};
    if (query.continent) {
      where.continent = query.continent;
    }
    if (query.ratingTier) {
      where.ratingTier = query.ratingTier;
    }
    if (query.search) {
      where.OR = [
        { nameEn: { contains: query.search, mode: 'insensitive' } },
        { nameZh: { contains: query.search, mode: 'insensitive' } },
        { fifaCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const sortBy = (TEAM_SORT_FIELDS as readonly string[]).includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'championScore';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.team.count({ where }),
    ]);
    return { items: items.map(toTeamSummary), total };
  }

  async getById(teamId: string): Promise<TeamSummary> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }
    return toTeamSummary(team);
  }

  async getPlayers(teamId: string): Promise<PlayerSummary[]> {
    await this.getById(teamId);
    const players = await this.prisma.player.findMany({
      where: { teamId },
      orderBy: [{ overallScore: 'desc' }, { nameEn: 'asc' }],
    });
    return players.map((p) => toPlayerSummary(p));
  }

  async getMatches(teamId: string): Promise<MatchSummary[]> {
    await this.getById(teamId);
    const matches = await this.prisma.match.findMany({
      where: { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoffAt: 'asc' },
    });
    return matches.map((m) => toMatchSummary(m));
  }

  async getAnalysis(teamId: string): Promise<AiReportDto | null> {
    await this.getById(teamId);
    const report = await this.prisma.aiReport.findFirst({
      where: { entityType: AiEntityType.TEAM, entityId: teamId, status: AiReportStatus.DONE },
      orderBy: { createdAt: 'desc' },
    });
    return report ? toAiReportDto(report) : null;
  }
}
