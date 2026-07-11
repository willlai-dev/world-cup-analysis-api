import { Injectable } from '@nestjs/common';
import { AiReportStatus, TranslationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { SyncResult } from '../sync-result';
import { GuardianClient } from './guardian.client';
import type { GuardianResult, NewsApiArticle, NewsSourceDto } from './news-source.types';
import { NewsApiClient } from './newsapi.client';

const QUERY = 'World Cup';
/**
 * NewsAPI's `/everything` matches the whole article body, so a bare
 * "World Cup" drags in cricket/golf/finance pieces that merely mention the
 * phrase. Constrain to football context; the AI classification relevance gate
 * removes whatever still slips through.
 */
const NEWSAPI_QUERY = '"World Cup" AND (football OR soccer OR FIFA)';

function stripHtml(s?: string | null): string | null {
  if (!s) return null;
  const text = s.replace(/<[^>]*>/g, '').trim();
  return text.length > 0 ? text : null;
}

function normalizeGuardian(r: GuardianResult): NewsSourceDto | null {
  if (!r.webUrl || !r.webTitle) return null;
  const trail = stripHtml(r.fields?.trailText);
  const body = r.fields?.bodyText?.trim();
  return {
    sourceName: 'The Guardian',
    sourceUrl: r.webUrl,
    titleEn: r.webTitle,
    summaryEn: trail,
    contentSnippet: trail,
    contentEn: body && body.length > 0 ? body : null,
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
    contentEn: null, // NewsAPI never returns full bodies (content is truncated).
    publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
    language: 'en',
  };
}

/** Guardian rows without a stored body backfilled per sync run (rate-limit bound). */
const BODY_BACKFILL_PER_RUN = 20;

/**
 * Fetches football news from Guardian + NewsAPI, normalizes, dedupes by
 * `sourceUrl`, and inserts only new articles (existing rows are left untouched
 * so prior translations survive). Guardian articles carry their full plain-text
 * body (`contentEn`) so translation can cover the whole article; NewsAPI only
 * exposes a truncated snippet. A bounded backfill pass fetches bodies for
 * Guardian rows stored before bodies were captured.
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
        const results = await this.newsApi.search(NEWSAPI_QUERY);
        candidates.push(...results.map(normalizeNewsApi).filter((x): x is NewsSourceDto => x !== null));
      } catch {
        failed += 1;
      }
    }

    // Dedupe within the batch by URL and title (aggregators republish the same
    // piece under different URLs), then against the DB the same way.
    const byUrl = new Map<string, NewsSourceDto>();
    const seenTitles = new Set<string>();
    for (const c of candidates) {
      const titleKey = c.titleEn.trim().toLowerCase();
      if (byUrl.has(c.sourceUrl) || seenTitles.has(titleKey)) continue;
      byUrl.set(c.sourceUrl, c);
      seenTitles.add(titleKey);
    }
    const unique = [...byUrl.values()];

    const existing = await this.prisma.newsArticle.findMany({
      where: {
        OR: [
          { sourceUrl: { in: unique.map((u) => u.sourceUrl) } },
          { titleEn: { in: unique.map((u) => u.titleEn), mode: 'insensitive' } },
        ],
      },
      select: { sourceUrl: true, titleEn: true },
    });
    const existingUrls = new Set(existing.map((e) => e.sourceUrl));
    const existingTitles = new Set(existing.map((e) => e.titleEn.trim().toLowerCase()));
    const toCreate = unique.filter(
      (u) =>
        !existingUrls.has(u.sourceUrl) &&
        !existingTitles.has(u.titleEn.trim().toLowerCase()),
    );

    if (toCreate.length > 0) {
      await this.prisma.newsArticle.createMany({
        data: toCreate.map((u) => ({
          sourceName: u.sourceName,
          sourceUrl: u.sourceUrl,
          titleEn: u.titleEn,
          summaryEn: u.summaryEn ?? undefined,
          contentSnippet: u.contentSnippet ?? undefined,
          contentEn: u.contentEn ?? undefined,
          publishedAt: u.publishedAt ?? undefined,
          language: u.language,
          fetchedAt: new Date(),
          translationStatus: TranslationStatus.NONE,
          aiSummaryStatus: AiReportStatus.PENDING,
        })),
        skipDuplicates: true,
      });
    }

    const backfilled = guardianOn ? await this.backfillGuardianBodies() : 0;

    return {
      source: 'news',
      fetched: unique.length,
      created: toCreate.length,
      failed,
      backfilled,
    };
  }

  /**
   * Fetches full bodies for Guardian articles stored before `contentEn`
   * existed, newest first, a bounded batch per run. Failures are skipped (the
   * row is retried on a later run); rows whose body the API genuinely doesn't
   * expose keep contentEn null and translation falls back to the snippet.
   */
  private async backfillGuardianBodies(): Promise<number> {
    const missing = await this.prisma.newsArticle.findMany({
      where: { sourceName: 'The Guardian', contentEn: null },
      select: { id: true, sourceUrl: true },
      orderBy: { publishedAt: 'desc' },
      take: BODY_BACKFILL_PER_RUN,
    });
    let backfilled = 0;
    for (const row of missing) {
      try {
        const body = await this.guardian.getBodyTextByUrl(row.sourceUrl);
        if (!body) continue;
        await this.prisma.newsArticle.update({
          where: { id: row.id },
          data: { contentEn: body },
        });
        backfilled += 1;
      } catch {
        // Source hiccup — leave for the next run.
      }
    }
    return backfilled;
  }
}
