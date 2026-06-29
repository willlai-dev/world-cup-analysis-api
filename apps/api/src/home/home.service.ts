import { Injectable } from '@nestjs/common';
import type { HomeHighlightsResponse } from '../common/dto/contracts';
import {
  toChampionEntrySummary,
  toMatchSummary,
  toNewsSummary,
  toPlayerSummary,
  toTeamSummary,
} from '../mappers';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getHighlights(): Promise<HomeHighlightsResponse> {
    const [featuredMatches, championRun, featuredTeams, featuredPlayers, news] = await Promise.all([
      this.prisma.match.findMany({
        take: 5,
        orderBy: { kickoffAt: 'asc' },
        include: { homeTeam: true, awayTeam: true },
      }),
      this.prisma.championPredictionRun.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { entries: { include: { team: true }, orderBy: { rank: 'asc' }, take: 5 } },
      }),
      this.prisma.team.findMany({ take: 6, orderBy: { championScore: 'desc' } }),
      this.prisma.player.findMany({
        take: 6,
        orderBy: { overallScore: 'desc' },
        include: { team: true },
      }),
      this.prisma.newsArticle.findMany({
        take: 5,
        orderBy: { publishedAt: 'desc' },
        include: { tags: { include: { newsTag: true } } },
      }),
    ]);

    return {
      featuredMatches: featuredMatches.map((m) => toMatchSummary(m)),
      championSummary: championRun ? championRun.entries.map(toChampionEntrySummary) : [],
      featuredTeams: featuredTeams.map(toTeamSummary),
      featuredPlayers: featuredPlayers.map((p) => toPlayerSummary(p)),
      newsHighlights: news.map((n) => toNewsSummary(n)),
    };
  }
}
