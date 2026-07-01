import { Injectable } from '@nestjs/common';
import { AiReportStatus, TranslationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { SyncResult } from '../sync-result';
import { GuardianClient } from './guardian.client';
import type { GuardianResult, NewsApiArticle, NewsSourceDto } from './news-source.types';
import { NewsApiClient } from './newsapi.client';

const QUERY = 'World Cup';

function stripHtml(s?: string | null): string | null {
  if (!s) return null;
  const text = s.replace(/<[^>]*>/g, '').trim();
  return text.length > 0 ? text : null;
}

function normalizeGuardian(r: GuardianResult): NewsSourceDto | null {
  if (!r.webUrl || !r.webTitle) return null;
  const trail = stripHtml(r.fields?.trailText);
  return {
    sourceName: 'The Guardian',
    sourceUrl: r.webUrl,
    titleEn: r.webTitle,
    summaryEn: trail,
    contentSnippet: trail,
    publishedAt: r.webPublicationDate ? new Date(r.webPublicationDate) : null,
    language: 'en',
  };
}

function normalizeNewsApi(a: NewsApiArticle): NewsSourceDto | null {
  if (!a.url || !a.title) return null;
  return {
    sourceName: a.source?.name ?? 'NewsAPI',
    sourceUrl: a.url,
    titleEn: a.title,
    summaryEn: a.description ?? null,
    contentSnippet: (a.content ?? a.description ?? null)?.slice(0, 500) ?? null,
    publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
    language: 'en',
  };
}

/**
 * Fetches football news from Guardian + NewsAPI, normalizes, dedupes by
 * `sourceUrl`, and inserts only new articles (existing rows are left untouched
 * so prior translations survive). Stores title/summary/snippet/source URL only —
 * never full article bodies.
 */
@Injectable()
export class NewsSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guardian: GuardianClient,
    private readonly newsApi: NewsApiClient,
  ) {}

  async run(): Promise<SyncResult> {
    const guardianOn = this.guardian.hasKey();
    const newsApiOn = this.newsApi.hasKey();
    if (!guardianOn && !newsApiOn) {
      return { source: 'news', skipped: true, reason: 'No news API key configured' };
    }

    const candidates: NewsSourceDto[] = [];
    let failed = 0;

    if (guardianOn) {
      try {
        const results = await this.guardian.search(QUERY);
        candidates.push(...results.map(normalizeGuardian).filter((x): x is NewsSourceDto => x !== null));
      } catch {
        failed += 1;
      }
    }
    if (newsApiOn) {
      try {
        const results = await this.newsApi.search(QUERY);
        candidates.push(...results.map(normalizeNewsApi).filter((x): x is NewsSourceDto => x !== null));
      } catch {
        failed += 1;
      }
    }

    // Dedupe within the batch, then against the DB (sourceUrl is @unique).
    const byUrl = new Map<string, NewsSourceDto>();
    for (const c of candidates) {
      if (!byUrl.has(c.sourceUrl)) byUrl.set(c.sourceUrl, c);
    }
    const unique = [...byUrl.values()];

    const existing = await this.prisma.newsArticle.findMany({
      where: { sourceUrl: { in: unique.map((u) => u.sourceUrl) } },
      select: { sourceUrl: true },
    });
    const existingUrls = new Set(existing.map((e) => e.sourceUrl));
    const toCreate = unique.filter((u) => !existingUrls.has(u.sourceUrl));

    if (toCreate.length > 0) {
      await this.prisma.newsArticle.createMany({
        data: toCreate.map((u) => ({
          sourceName: u.sourceName,
          sourceUrl: u.sourceUrl,
          titleEn: u.titleEn,
          summaryEn: u.summaryEn ?? undefined,
          contentSnippet: u.contentSnippet ?? undefined,
          publishedAt: u.publishedAt ?? undefined,
          language: u.language,
          fetchedAt: new Date(),
          translationStatus: TranslationStatus.NONE,
          aiSummaryStatus: AiReportStatus.PENDING,
        })),
        skipDuplicates: true,
      });
    }

    return { source: 'news', fetched: unique.length, created: toCreate.length, failed };
  }
}
