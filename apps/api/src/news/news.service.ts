import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma, TranslationStatus } from '@prisma/client';
import type { NewsSummary } from '../common/dto/contracts';
import { toNewsSummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';
import type { ListNewsQueryDto } from './dto/list-news-query.dto';

export type NewsDetailDto = NewsSummary & {
  contentSnippet: string | null;
  translatedContentZh: string | null;
  language: string | null;
  fetchedAt: string | null;
};

const withTags = {
  tags: { include: { newsTag: true } },
} satisfies Prisma.NewsArticleInclude;

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListNewsQueryDto): Promise<{ items: NewsSummary[]; total: number }> {
    const where: Prisma.NewsArticleWhereInput = {};
    if (query.category) {
      where.category = query.category;
    }
    if (query.sourceName) {
      where.sourceName = { contains: query.sourceName, mode: 'insensitive' };
    }
    if (query.dateFrom || query.dateTo) {
      where.publishedAt = {};
      if (query.dateFrom) {
        where.publishedAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.publishedAt.lte = new Date(query.dateTo);
      }
    }

    const tagNames = await this.resolveTagNames(query);
    if (tagNames.length > 0) {
      where.tags = { some: { newsTag: { name: { in: tagNames } } } };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.newsArticle.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { publishedAt: 'desc' },
        include: withTags,
      }),
      this.prisma.newsArticle.count({ where }),
    ]);
    return { items: items.map((n) => toNewsSummary(n)), total };
  }

  async getById(newsId: string): Promise<NewsDetailDto> {
    const news = await this.prisma.newsArticle.findUnique({
      where: { id: newsId },
      include: withTags,
    });
    if (!news) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'News article not found' });
    }
    return {
      ...toNewsSummary(news),
      contentSnippet: news.contentSnippet,
      translatedContentZh: news.translatedContentZh,
      language: news.language,
      fetchedAt: news.fetchedAt ? news.fetchedAt.toISOString() : null,
    };
  }

  /** Phase 1 mock translation (real Qwen translation arrives in Phase 2). */
  async translate(newsId: string): Promise<NewsDetailDto> {
    const news = await this.prisma.newsArticle.findUnique({ where: { id: newsId } });
    if (!news) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'News article not found' });
    }
    const source = news.contentSnippet ?? news.summaryEn ?? news.titleEn;
    const updated = await this.prisma.newsArticle.update({
      where: { id: newsId },
      data: {
        translationStatus: TranslationStatus.DONE,
        titleZh: news.titleZh ?? `【譯】${news.titleEn}`,
        translatedContentZh: `【AI_MOCK_MODE 翻譯】${source}`,
      },
      include: withTags,
    });
    return {
      ...toNewsSummary(updated),
      contentSnippet: updated.contentSnippet,
      translatedContentZh: updated.translatedContentZh,
      language: updated.language,
      fetchedAt: updated.fetchedAt ? updated.fetchedAt.toISOString() : null,
    };
  }

  private async resolveTagNames(query: ListNewsQueryDto): Promise<string[]> {
    const names: string[] = [];
    if (query.tag) {
      names.push(query.tag);
    }
    if (query.teamId) {
      const team = await this.prisma.team.findUnique({
        where: { id: query.teamId },
        select: { nameEn: true, nameZh: true },
      });
      if (team) {
        names.push(team.nameEn);
        if (team.nameZh) {
          names.push(team.nameZh);
        }
      }
    }
    if (query.playerId) {
      const player = await this.prisma.player.findUnique({
        where: { id: query.playerId },
        select: { nameEn: true, nameZh: true },
      });
      if (player) {
        names.push(player.nameEn);
        if (player.nameZh) {
          names.push(player.nameZh);
        }
      }
    }
    return names;
  }
}
