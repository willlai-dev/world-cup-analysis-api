import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AiReportStatus,
  NewsCategory,
  NewsTagType,
  type Prisma,
  TranslationStatus,
} from "@prisma/client";
import {
  type GenerationResult,
  MAX_GENERATIONS_PER_RUN,
} from "../ai/generation-result";
import { AiRouterService } from "../ai/ai-router.service";
import {
  type NewsClassificationOutput,
  NewsClassificationOutputSchema,
} from "../ai/schemas/news-classification.schema";
import type { ChatAnswerDto, NewsSummary } from "../common/dto/contracts";
import { toNewsSummary } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import type { ListNewsQueryDto } from "./dto/list-news-query.dto";

const NEWS_MOCK: NewsClassificationOutput = {
  summaryZh: "【AI_MOCK_MODE】新聞摘要示範（尚未串接真實模型）。",
  category: "OTHER",
  tags: [],
  relatedTeamNames: [],
  relatedPlayerNames: [],
  confidenceScore: 50,
  dataLimitations: ["示範模式"],
};

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: AiRouterService,
  ) {}

  async list(
    query: ListNewsQueryDto,
  ): Promise<{ items: NewsSummary[]; total: number }> {
    const where: Prisma.NewsArticleWhereInput = {};
    if (query.category) {
      where.category = query.category;
    }
    if (query.sourceName) {
      where.sourceName = { contains: query.sourceName, mode: "insensitive" };
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
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
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
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "News article not found",
      });
    }
    return {
      ...toNewsSummary(news),
      contentSnippet: news.contentSnippet,
      translatedContentZh: news.translatedContentZh,
      language: news.language,
      fetchedAt: news.fetchedAt ? news.fetchedAt.toISOString() : null,
    };
  }

  /** Translates a news article to zh-TW via the AI router (Qwen). */
  async translate(newsId: string, userId: string): Promise<NewsDetailDto> {
    const news = await this.prisma.newsArticle.findUnique({
      where: { id: newsId },
    });
    if (!news) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "News article not found",
      });
    }
    const source = news.contentSnippet ?? news.summaryEn ?? news.titleEn;
    const result = await this.router.runTranslation({
      userId,
      entityId: newsId,
      source,
      scope: `新聞：${news.titleEn}`,
    });
    const updated = await this.prisma.newsArticle.update({
      where: { id: newsId },
      data: {
        translationStatus: result.ok
          ? TranslationStatus.DONE
          : TranslationStatus.FAILED,
        titleZh: news.titleZh ?? `【譯】${news.titleEn}`,
        // Keep any previous translation if this attempt failed.
        translatedContentZh: result.ok
          ? result.content
          : news.translatedContentZh,
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

  async deepChat(
    newsId: string,
    userId: string,
    question: string,
  ): Promise<ChatAnswerDto> {
    const news = await this.getById(newsId);
    return this.router.runChat({
      taskType: "DEEP_NEWS_CHAT",
      userId,
      entityId: newsId,
      question,
      scope: `新聞：${news.titleEn}`,
      sourceUpdatedAt: news.publishedAt ?? null,
      context: news,
    });
  }

  /** Job: AI summary + classification (+ tags) for not-yet-processed articles. */
  async generateSummaries(): Promise<GenerationResult> {
    const articles = await this.prisma.newsArticle.findMany({
      // Include FAILED so a re-run retries articles whose summary failed before.
      where: {
        aiSummaryStatus: {
          in: [AiReportStatus.PENDING, AiReportStatus.FAILED],
        },
      },
      take: MAX_GENERATIONS_PER_RUN,
      orderBy: { publishedAt: "desc" },
    });
    let generated = 0;
    let failed = 0;

    for (const article of articles) {
      const context = {
        title: article.titleEn,
        summary: article.summaryEn,
        snippet: article.contentSnippet,
        source: article.sourceName,
        publishedAt: article.publishedAt?.toISOString() ?? null,
      };
      const report = await this.router.runReport<NewsClassificationOutput>({
        taskType: "NEWS_CLASSIFICATION",
        entityId: article.id,
        reportType: "NEWS_CLASSIFICATION",
        instruction:
          "請依新聞標題與摘要，輸出繁體中文摘要、分類與標籤。只輸出 JSON，欄位：" +
          '{ "summaryZh": string, "category": MATCH|PLAYER|INJURY|TRANSFER|TEAM|TACTIC|CONTROVERSY|TOURNAMENT|OTHER, ' +
          '"tags": [{ "name": string, "type": TEAM|PLAYER|MATCH|TOPIC|INJURY|TACTIC|CONTROVERSY|TRANSFER|OTHER }], ' +
          '"relatedTeamNames": string[], "relatedPlayerNames": string[], "confidenceScore": number, "dataLimitations": string[] }。',
        context,
        scope: `新聞：${article.titleEn}`,
        schema: NewsClassificationOutputSchema,
        mockData: NEWS_MOCK,
      });

      if (report.ok && report.data) {
        await this.applyClassification(article.id, report.data);
        generated += 1;
      } else {
        await this.prisma.newsArticle.update({
          where: { id: article.id },
          data: { aiSummaryStatus: AiReportStatus.FAILED },
        });
        failed += 1;
      }
    }

    return {
      scope: "news",
      scanned: articles.length,
      generated,
      skipped: 0,
      failed,
    };
  }

  private async applyClassification(
    articleId: string,
    data: NewsClassificationOutput,
  ): Promise<void> {
    await this.prisma.newsArticle.update({
      where: { id: articleId },
      data: {
        summaryZh: data.summaryZh || undefined,
        category: data.category as NewsCategory,
        aiSummaryStatus: AiReportStatus.DONE,
      },
    });
    for (const tag of data.tags) {
      const newsTag = await this.prisma.newsTag.upsert({
        where: { name_type: { name: tag.name, type: tag.type as NewsTagType } },
        create: { name: tag.name, type: tag.type as NewsTagType },
        update: {},
      });
      await this.prisma.newsArticleTag.createMany({
        data: [{ newsArticleId: articleId, newsTagId: newsTag.id }],
        skipDuplicates: true,
      });
    }
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
