import type { AiRouterService } from '../ai/ai-router.service';
import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';

function build() {
  const prisma = {
    newsArticle: { findMany: jest.fn(), update: jest.fn() },
    newsTag: { upsert: jest.fn() },
    newsArticleTag: { createMany: jest.fn() },
    team: { findMany: jest.fn().mockResolvedValue([]) },
    player: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const router = { runReport: jest.fn(), runReportIfChanged: jest.fn() };
  const config = {
    aiMockMode: true,
    aiGenerationDelayMs: 0,
    newsImpactLookbackDays: 7,
  } as unknown as AppConfigService;
  const service = new NewsService(
    prisma as unknown as PrismaService,
    router as unknown as AiRouterService,
    config,
  );
  return { service, prisma, router };
}

describe('NewsService.generateSummaries', () => {

  it('classifies a pending article: updates summary/category + upserts tags', async () => {
    const { service, prisma, router } = build();
    prisma.newsArticle.findMany.mockResolvedValue([
      { id: 'n1', titleEn: 'Messi shines', summaryEn: 's', contentSnippet: 'c', sourceName: 'Guardian', publishedAt: null },
    ]);
    router.runReport.mockResolvedValue({
      ok: true,
      data: {
        summaryZh: '梅西發光',
        category: 'PLAYER',
        tags: [{ name: 'Messi', type: 'PLAYER' }],
        relatedTeamNames: [],
        relatedPlayerNames: [],
        confidenceScore: 80,
        dataLimitations: [],
      },
    });
    prisma.newsTag.upsert.mockResolvedValue({ id: 'tag-messi' });

    const result = await service.generateSummaries();

    expect(prisma.newsArticle.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: expect.objectContaining({ category: 'PLAYER', summaryZh: '梅西發光', aiSummaryStatus: 'DONE' }),
    });
    expect(prisma.newsTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name_type: { name: 'Messi', type: 'PLAYER' } } }),
    );
    expect(prisma.newsArticleTag.createMany).toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, generated: 1, failed: 0 });
  });

  it('marks the article FAILED when generation fails', async () => {
    const { service, prisma, router } = build();
    prisma.newsArticle.findMany.mockResolvedValue([
      { id: 'n2', titleEn: 'x', summaryEn: null, contentSnippet: null, sourceName: 'NewsAPI', publishedAt: null },
    ]);
    router.runReport.mockResolvedValue({ ok: false, data: null });

    const result = await service.generateSummaries();

    expect(prisma.newsArticle.update).toHaveBeenCalledWith({
      where: { id: 'n2' },
      data: { aiSummaryStatus: 'FAILED' },
    });
    expect(result).toMatchObject({ generated: 0, failed: 1 });
  });

  it('persists relatedTeamNames/relatedPlayerNames as TEAM/PLAYER tags', async () => {
    const { service, prisma, router } = build();
    prisma.newsArticle.findMany.mockResolvedValue([
      { id: 'n3', titleEn: 'x', summaryEn: 's', contentSnippet: null, sourceName: 'G', publishedAt: null },
    ]);
    router.runReport.mockResolvedValue({
      ok: true,
      data: {
        summaryZh: '摘要',
        category: 'TEAM',
        tags: [{ name: 'Brazil', type: 'TEAM' }],
        relatedTeamNames: ['Brazil', 'France'],
        relatedPlayerNames: ['Mbappé'],
        confidenceScore: 80,
        dataLimitations: [],
      },
    });
    prisma.newsTag.upsert.mockResolvedValue({ id: 'tag-x' });

    await service.generateSummaries();

    const upserted = prisma.newsTag.upsert.mock.calls.map(
      (c) => c[0].where.name_type,
    );
    // deduped: Brazil/TEAM appears once even though tags + relatedTeamNames both have it
    expect(upserted).toEqual([
      { name: 'Brazil', type: 'TEAM' },
      { name: 'France', type: 'TEAM' },
      { name: 'Mbappé', type: 'PLAYER' },
    ]);
  });
});

describe('NewsService.generateImpacts', () => {
  const article = {
    id: 'n1',
    titleEn: 'Injury news',
    summaryZh: '摘要',
    summaryEn: 's',
    category: 'INJURY',
    publishedAt: new Date(),
    tags: [
      { newsTag: { name: 'Brazil', type: 'TEAM' } },
      { newsTag: { name: 'Neymar', type: 'PLAYER' } },
    ],
  };

  it('selects recent tagged+summarized articles and runs NEWS_IMPACT if changed', async () => {
    const { service, prisma, router } = build();
    prisma.newsArticle.findMany.mockResolvedValue([article]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, skipped: false, data: {} });

    const result = await service.generateImpacts();

    const where = prisma.newsArticle.findMany.mock.calls[0][0].where;
    expect(where.aiSummaryStatus).toBe('DONE');
    expect(where.tags.some.newsTag.type.in).toEqual(['TEAM', 'PLAYER']);
    const input = router.runReportIfChanged.mock.calls[0][0];
    expect(input).toMatchObject({
      taskType: 'NEWS_IMPACT',
      entityId: 'n1',
      reportType: 'NEWS_IMPACT',
    });
    expect(input.instruction).toContain('推論');
    expect(result).toMatchObject({ scope: 'news-impact', scanned: 1, generated: 1 });
  });

  it('counts hash-skipped articles as skipped', async () => {
    const { service, prisma, router } = build();
    prisma.newsArticle.findMany.mockResolvedValue([article]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, skipped: true, data: null });

    const result = await service.generateImpacts();

    expect(result).toMatchObject({ scanned: 1, generated: 0, skipped: 1, failed: 0 });
  });
});
