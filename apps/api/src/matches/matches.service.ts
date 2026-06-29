import { Injectable, NotFoundException } from '@nestjs/common';
import { AiEntityType, AiReportStatus, type Prisma } from '@prisma/client';
import type {
  AiReportDto,
  MatchPredictionDto,
  MatchSummary,
} from '../common/dto/contracts';
import { toAiReportDto, toMatchSummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';
import type { ListMatchesQueryDto } from './dto/list-matches-query.dto';

export type MatchEventDto = {
  id: string;
  minute: number | null;
  extraMinute: number | null;
  eventType: string;
  teamId: string | null;
  playerId: string | null;
  description: string | null;
};

export type MatchDetailDto = MatchSummary & { events: MatchEventDto[] };

const matchInclude = { homeTeam: true, awayTeam: true } satisfies Prisma.MatchInclude;

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListMatchesQueryDto): Promise<{ items: MatchSummary[]; total: number }> {
    const where: Prisma.MatchWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.stage) {
      where.stage = query.stage;
    }
    if (query.groupName) {
      where.groupName = query.groupName;
    }
    if (query.teamId) {
      where.OR = [{ homeTeamId: query.teamId }, { awayTeamId: query.teamId }];
    }
    if (query.dateFrom || query.dateTo) {
      where.kickoffAt = {};
      if (query.dateFrom) {
        where.kickoffAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.kickoffAt.lte = new Date(query.dateTo);
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { kickoffAt: 'asc' },
        include: matchInclude,
      }),
      this.prisma.match.count({ where }),
    ]);
    return { items: items.map((m) => toMatchSummary(m)), total };
  }

  async today(): Promise<MatchSummary[]> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const matches = await this.prisma.match.findMany({
      where: { kickoffAt: { gte: start, lt: end } },
      orderBy: { kickoffAt: 'asc' },
      include: matchInclude,
    });
    return matches.map((m) => toMatchSummary(m));
  }

  async getById(matchId: string): Promise<MatchDetailDto> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { ...matchInclude, events: { orderBy: [{ minute: 'asc' }, { id: 'asc' }] } },
    });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Match not found' });
    }
    return {
      ...toMatchSummary(match),
      events: match.events.map((e) => ({
        id: e.id,
        minute: e.minute,
        extraMinute: e.extraMinute,
        eventType: e.eventType,
        teamId: e.teamId,
        playerId: e.playerId,
        description: e.description,
      })),
    };
  }

  async getAnalysis(matchId: string): Promise<AiReportDto | null> {
    await this.ensureExists(matchId);
    return this.latestReport(matchId, ['MATCH_ANALYSIS']);
  }

  async getPostMatchReport(matchId: string): Promise<AiReportDto | null> {
    await this.ensureExists(matchId);
    return this.latestReport(matchId, ['POST_MATCH_REPORT', 'MATCH_ANALYSIS']);
  }

  async getPrediction(matchId: string): Promise<MatchPredictionDto> {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Match not found' });
    }
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.MATCH,
        entityId: matchId,
        status: AiReportStatus.DONE,
        reportType: { in: ['MATCH_PREDICTION', 'MATCH_ANALYSIS'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const structured = (report?.structuredJson ?? null) as {
      prediction?: { homeWinLean?: number; drawLean?: number; awayWinLean?: number };
      keyFactors?: string[];
      risks?: string[];
    } | null;
    return {
      matchId,
      homeWinProbability: structured?.prediction?.homeWinLean ?? null,
      drawProbability: structured?.prediction?.drawLean ?? null,
      awayWinProbability: structured?.prediction?.awayWinLean ?? null,
      keyFactors: structured?.keyFactors ?? [],
      riskNotes: structured?.risks ?? [],
      report: report ? toAiReportDto(report) : null,
      sourceUpdatedAt: match.sourceUpdatedAt ? match.sourceUpdatedAt.toISOString() : null,
    };
  }

  private async ensureExists(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Match not found' });
    }
  }

  private async latestReport(matchId: string, reportTypes: string[]): Promise<AiReportDto | null> {
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.MATCH,
        entityId: matchId,
        status: AiReportStatus.DONE,
        reportType: { in: reportTypes },
      },
      orderBy: { createdAt: 'desc' },
    });
    return report ? toAiReportDto(report) : null;
  }
}
