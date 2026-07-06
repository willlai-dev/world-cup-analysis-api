import { Injectable } from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import type { HomeHighlightsResponse } from '../common/dto/contracts';
import {
  toChampionEntrySummary,
  toMatchSummary,
  toNewsSummary,
  toPlayerSummary,
  toTeamSummary,
} from '../mappers';
import { PrismaService } from '../prisma/prisma.service';

const FEATURED_MATCH_COUNT = 6;

@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getHighlights(): Promise<HomeHighlightsResponse> {
    const [finishedMatches, upcomingMatches, championRun, featuredTeams, featuredPlayers, news] =
      await Promise.all([
        // 熱門賽事：最近完賽的比賽優先（新 → 舊）…
        this.prisma.match.findMany({
          take: FEATURED_MATCH_COUNT,
          where: { status: MatchStatus.FINISHED },
          orderBy: { kickoffAt: 'desc' },
          include: { homeTeam: true, awayTeam: true },
        }),
        // …不足時補上進行中／即將開賽的比賽（近 → 遠）。
        this.prisma.match.findMany({
          take: FEATURED_MATCH_COUNT,
          where: { status: { in: [MatchStatus.LIVE, MatchStatus.SCHEDULED] } },
          orderBy: { kickoffAt: 'asc' },
          include: { homeTeam: true, awayTeam: true },
        }),
        this.prisma.championPredictionRun.findFirst({
          orderBy: { createdAt: 'desc' },
          include: { entries: { include: { team: true }, orderBy: { rank: 'asc' }, take: 5 } },
        }),
        // 焦點國家隊：只列仍在賽的球隊；championScore 可能為 null，排到最後。
        this.prisma.team.findMany({
          take: 8,
          where: { isEliminated: false },
          orderBy: [
            { championScore: { sort: 'desc', nulls: 'last' } },
            { worldRanking: { sort: 'asc', nulls: 'last' } },
          ],
        }),
        this.prisma.player.findMany({
          take: 8,
          orderBy: { overallScore: { sort: 'desc', nulls: 'last' } },
          include: { team: true },
        }),
        this.prisma.newsArticle.findMany({
          take: 6,
          orderBy: { publishedAt: 'desc' },
          include: { tags: { include: { newsTag: true } } },
        }),
      ]);

    const featuredMatches = [...finishedMatches, ...upcomingMatches].slice(
      0,
      FEATURED_MATCH_COUNT,
    );

    return {
      featuredMatches: featuredMatches.map((m) => toMatchSummary(m)),
      championSummary: championRun ? championRun.entries.map(toChampionEntrySummary) : [],
      featuredTeams: featuredTeams.map(toTeamSummary),
      featuredPlayers: featuredPlayers.map((p) => toPlayerSummary(p)),
      newsHighlights: news.map((n) => toNewsSummary(n)),
    };
  }
}
