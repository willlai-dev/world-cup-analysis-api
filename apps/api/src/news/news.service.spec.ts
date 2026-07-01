import type { AiRouterService } from '../ai/ai-router.service';
import type { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';

describe('NewsService.generateSummaries', () => {
  function build() {
    const prisma = {
      newsArticle: { findMany: jest.fn(), update: jest.fn() },
      newsTag: { upsert: jest.fn() },
      newsArticleTag: { createMany: jest.fn() },
    };
    const router = { runReport: jest.fn() };
    const service = new NewsService(
      prisma as unknown as PrismaService,
      router as unknown as AiRouterService,
    );
    return { service, prisma, router };
  }

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
});
