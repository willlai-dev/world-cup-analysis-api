import type { AiRouterService } from '../ai/ai-router.service';
import type { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from './matches.service';

describe('MatchesService.generateAnalyses', () => {
  function build() {
    const prisma = { match: { findMany: jest.fn() } };
    const router = { runReportIfChanged: jest.fn() };
    const service = new MatchesService(
      prisma as unknown as PrismaService,
      router as unknown as AiRouterService,
    );
    return { service, prisma, router };
  }

  const match = {
    id: 'm1',
    homeTeam: { nameEn: 'Brazil' },
    awayTeam: { nameEn: 'Argentina' },
    stage: 'FINAL',
    status: 'SCHEDULED',
    groupName: null,
    kickoffAt: new Date('2026-07-19T18:00:00Z'),
    homeScore: null,
    awayScore: null,
  };

  it('generates an analysis report per upcoming match only', async () => {
    const { service, prisma, router } = build();
    prisma.match.findMany.mockResolvedValue([match]);
    router.runReportIfChanged.mockResolvedValue({ ok: true });

    const result = await service.generateAnalyses();

    // Only SCHEDULED (not-yet-started) matches are analyzed.
    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'SCHEDULED' } }),
    );
    expect(router.runReportIfChanged).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'MATCH_ANALYSIS', entityId: 'm1', reportType: 'MATCH_ANALYSIS' }),
    );
    expect(result).toMatchObject({ scanned: 1, generated: 1, skipped: 0, failed: 0 });
  });

  it('counts skipped and failed correctly', async () => {
    const { service, prisma, router } = build();
    prisma.match.findMany.mockResolvedValue([{ ...match, id: 'm1' }, { ...match, id: 'm2' }]);
    router.runReportIfChanged
      .mockResolvedValueOnce({ ok: true, skipped: true })
      .mockResolvedValueOnce({ ok: false });

    const result = await service.generateAnalyses();

    expect(result).toMatchObject({ scanned: 2, generated: 0, skipped: 1, failed: 1 });
  });
});
