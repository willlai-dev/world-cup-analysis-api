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
import {
  type NewsImpactOutput,
  NewsImpactOutputSchema,
} from "../ai/schemas/news-impact.schema";
import type {
  AiReportDto,
  ChatAnswerDto,
  NewsSummary,
} from "../common/dto/contracts";
import { sleep } from "../common/utils/sleep.util";
import { AppConfigService } from "../config/app-config.service";
import { toAiReportDto, toNewsSummary } from "../mappers";
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

const NEWS_IMPACT_MOCK: NewsImpactOutput = {
  impactSummaryZh: "【AI_MOCK_MODE】新聞影響分析示範（推論，僅供參考）。",
  affectedTeams: [],
  affectedPlayers: [],
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
    private readonly config: AppConfigService,
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
      await this.throttle();
    }

    return {
      scope: "news",
      scanned: articles.length,
      generated,
      skipped: 0,
      failed,
    };
  }

  /**
   * Job: cautious, inference-flagged impact analysis for recent articles that
   * carry TEAM/PLAYER tags. Persists an AiReport (NEWS / NEWS_IMPACT) per
   * article; `runReportIfChanged` skips articles whose material is unchanged.
   */
  async generateImpacts(): Promise<GenerationResult> {
    const since = new Date();
    since.setDate(since.getDate() - this.config.newsImpactLookbackDays);
    const articles = await this.prisma.newsArticle.findMany({
      where: {
        aiSummaryStatus: AiReportStatus.DONE,
        publishedAt: { gte: since },
        tags: {
          some: {
            newsTag: { type: { in: [NewsTagType.TEAM, NewsTagType.PLAYER] } },
          },
        },
      },
      take: MAX_GENERATIONS_PER_RUN,
      orderBy: { publishedAt: "desc" },
      include: withTags,
    });

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const article of articles) {
      const tagNames = (type: NewsTagType) =>
        article.tags
          .filter((t) => t.newsTag.type === type)
          .map((t) => t.newsTag.name);
      const teamNames = tagNames(NewsTagType.TEAM);
      const playerNames = tagNames(NewsTagType.PLAYER);

      const [teams, players] = await Promise.all([
        teamNames.length
          ? this.prisma.team.findMany({
              where: {
                OR: [
                  { nameEn: { in: teamNames } },
                  { nameZh: { in: teamNames } },
                ],
              },
              select: {
                nameEn: true,
                nameZh: true,
                isEliminated: true,
                worldRanking: true,
                ratingTier: true,
              },
              take: 5,
            })
          : Promise.resolve([]),
        playerNames.length
          ? this.prisma.player.findMany({
              where: {
                OR: [
                  { nameEn: { in: playerNames } },
                  { nameZh: { in: playerNames } },
                ],
              },
              select: {
                nameEn: true,
                nameZh: true,
                position: true,
                injuryRiskLevel: true,
                formScore: true,
                team: { select: { nameEn: true, nameZh: true } },
              },
              take: 8,
            })
          : Promise.resolve([]),
      ]);

      const report = await this.router.runReportIfChanged<NewsImpactOutput>({
        taskType: "NEWS_IMPACT",
        entityId: article.id,
        reportType: "NEWS_IMPACT",
        instruction:
          "請根據這則新聞與資料庫中相關球隊/球員的現況，分析其可能影響。務必使用謹慎語氣：" +
          "所有影響判斷皆屬「推論」，需在文字中明確標示，不可斷言未經證實的事實；" +
          "資料不足時列入 dataLimitations。只輸出 JSON，欄位：" +
          '{ "impactSummaryZh": string, "affectedTeams": [{ "name": string, "impact": string, ' +
          '"direction": "POSITIVE"|"NEGATIVE"|"NEUTRAL"|"UNKNOWN" }], "affectedPlayers": [同 affectedTeams], ' +
          '"confidenceScore": number, "dataLimitations": string[] }。',
        context: {
          title: article.titleEn,
          summaryZh: article.summaryZh,
          summaryEn: article.summaryEn,
          category: article.category,
          publishedAt: article.publishedAt?.toISOString() ?? null,
          taggedTeams: teams,
          taggedPlayers: players,
        },
        scope: `新聞：${article.titleEn}`,
        schema: NewsImpactOutputSchema,
        mockData: NEWS_IMPACT_MOCK,
      });

      if (report.skipped) {
        skipped += 1;
        continue;
      }
      if (report.ok) {
        generated += 1;
      } else {
        failed += 1;
      }
      await this.throttle();
    }

    return {
      scope: "news-impact",
      scanned: articles.length,
      generated,
      skipped,
      failed,
    };
  }

  /** Latest DONE NEWS_IMPACT report for an article (null when none yet). */
  async getAnalysis(newsId: string): Promise<AiReportDto | null> {
    const news = await this.prisma.newsArticle.findUnique({
      where: { id: newsId },
      select: { id: true },
    });
    if (!news) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "News article not found",
      });
    }
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: "NEWS",
        entityId: newsId,
        reportType: "NEWS_IMPACT",
        status: AiReportStatus.DONE,
      },
      orderBy: { createdAt: "desc" },
    });
    return report ? toAiReportDto(report) : null;
  }

  /** Small inter-call delay in real mode only (NVIDIA 503 mitigation). */
  private throttle(): Promise<void> {
    return this.config.aiMockMode
      ? Promise.resolve()
      : sleep(this.config.aiGenerationDelayMs);
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
    // Merge the classifier's relatedTeamNames/relatedPlayerNames into the tag
    // set — they anchor news-impact / player-status lookups by entity name.
    const tags = [
      ...data.tags.map((t) => ({ name: t.name, type: t.type as NewsTagType })),
      ...data.relatedTeamNames.map((name) => ({
        name,
        type: NewsTagType.TEAM,
      })),
      ...data.relatedPlayerNames.map((name) => ({
        name,
        type: NewsTagType.PLAYER,
      })),
    ].filter(
      (tag, index, all) =>
        tag.name.trim().length > 0 &&
        all.findIndex((t) => t.name === tag.name && t.type === tag.type) ===
          index,
    );
    for (const tag of tags) {
      const newsTag = await this.prisma.newsTag.upsert({
        where: { name_type: { name: tag.name, type: tag.type } },
        create: { name: tag.name, type: tag.type },
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
