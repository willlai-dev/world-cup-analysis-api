import type { PrismaService } from '../../prisma/prisma.service';
import type { GuardianClient } from './guardian.client';
import { NewsSyncService } from './news-sync.service';
import type { NewsApiClient } from './newsapi.client';

describe('NewsSyncService', () => {
  function build() {
    const prisma = {
      newsArticle: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn(), update: jest.fn() },
    };
    const guardian = {
      hasKey: jest.fn(),
      search: jest.fn(),
      getBodyTextByUrl: jest.fn().mockResolvedValue(null),
    };
    const newsApi = { hasKey: jest.fn(), search: jest.fn() };
    const service = new NewsSyncService(
      prisma as unknown as PrismaService,
      guardian as unknown as GuardianClient,
      newsApi as unknown as NewsApiClient,
    );
    return { service, prisma, guardian, newsApi };
  }

  it('skips with no network when no news key is configured', async () => {
    const { service, prisma, guardian, newsApi } = build();
    guardian.hasKey.mockReturnValue(false);
    newsApi.hasKey.mockReturnValue(false);

    const result = await service.run();

    expect(result).toMatchObject({ skipped: true });
    expect(prisma.newsArticle.findMany).not.toHaveBeenCalled();
  });

  it('normalizes Guardian results and inserts only new articles', async () => {
    const { service, prisma, guardian, newsApi } = build();
    guardian.hasKey.mockReturnValue(true);
    newsApi.hasKey.mockReturnValue(false);
    guardian.search.mockResolvedValue([
      { webTitle: 'A', webUrl: 'https://g/a', webPublicationDate: '2026-06-01T00:00:00Z', fields: { trailText: '<p>hi</p>' } },
      { webTitle: 'B', webUrl: 'https://g/b', webPublicationDate: '2026-06-02T00:00:00Z', fields: { trailText: 'plain' } },
    ]);
    // First findMany = URL/title dedupe against DB (A already exists);
    // second = Guardian body backfill scan (nothing to backfill).
    prisma.newsArticle.findMany
      .mockResolvedValueOnce([{ sourceUrl: 'https://g/a', titleEn: 'A' }])
      .mockResolvedValueOnce([]);

    const result = await service.run();

    const createArg = prisma.newsArticle.createMany.mock.calls[0][0];
    expect(createArg.data).toHaveLength(1);
    expect(createArg.data[0]).toMatchObject({
      sourceUrl: 'https://g/b',
      sourceName: 'The Guardian',
      summaryEn: 'plain',
      translationStatus: 'NONE',
      aiSummaryStatus: 'PENDING',
    });
    expect(result).toMatchObject({ fetched: 2, created: 1 });
  });

  it('dedupes the same sourceUrl coming from both providers', async () => {
    const { service, prisma, guardian, newsApi } = build();
    guardian.hasKey.mockReturnValue(true);
    newsApi.hasKey.mockReturnValue(true);
    guardian.search.mockResolvedValue([
      { webTitle: 'Dup', webUrl: 'https://x/1', fields: { trailText: 'g' } },
    ]);
    newsApi.search.mockResolvedValue([
      { title: 'Dup', url: 'https://x/1', description: 'n', source: { name: 'NewsAPI' } },
    ]);

    const result = await service.run();

    expect(result).toMatchObject({ fetched: 1, created: 1 });
    expect(prisma.newsArticle.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('dedupes the same title republished under different URLs', async () => {
    const { service, prisma, guardian, newsApi } = build();
    guardian.hasKey.mockReturnValue(false);
    newsApi.hasKey.mockReturnValue(true);
    newsApi.search.mockResolvedValue([
      { title: 'Same Story', url: 'https://a/1', description: 'x', source: { name: 'A' } },
      { title: 'Same Story', url: 'https://b/2', description: 'y', source: { name: 'B' } },
    ]);

    const result = await service.run();

    expect(result).toMatchObject({ fetched: 1, created: 1 });
    expect(prisma.newsArticle.createMany.mock.calls[0][0].data[0]).toMatchObject({
      sourceUrl: 'https://a/1',
    });
  });

  it('stores the Guardian full body as contentEn when provided', async () => {
    const { service, prisma, guardian, newsApi } = build();
    guardian.hasKey.mockReturnValue(true);
    newsApi.hasKey.mockReturnValue(false);
    guardian.search.mockResolvedValue([
      {
        webTitle: 'Full',
        webUrl: 'https://g/full',
        fields: { trailText: 'trail', bodyText: 'the whole article body' },
      },
    ]);

    await service.run();

    expect(prisma.newsArticle.createMany.mock.calls[0][0].data[0]).toMatchObject({
      contentEn: 'the whole article body',
    });
  });

  it('backfills bodies for stored Guardian rows missing contentEn', async () => {
    const { service, prisma, guardian, newsApi } = build();
    guardian.hasKey.mockReturnValue(true);
    newsApi.hasKey.mockReturnValue(false);
    guardian.search.mockResolvedValue([]);
    prisma.newsArticle.findMany
      .mockResolvedValueOnce([]) // dedupe scan (no candidates)
      .mockResolvedValueOnce([{ id: 'n1', sourceUrl: 'https://www.theguardian.com/x' }]);
    guardian.getBodyTextByUrl.mockResolvedValue('backfilled body');

    const result = await service.run();

    expect(prisma.newsArticle.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { contentEn: 'backfilled body' },
    });
    expect(result).toMatchObject({ backfilled: 1 });
  });
});
