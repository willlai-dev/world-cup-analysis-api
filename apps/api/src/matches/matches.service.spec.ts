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

function buildSettlement() {
  const prisma = {
    match: { findMany: jest.fn() },
    aiReport: { findFirst: jest.fn(), count: jest.fn() },
    matchPredictionOutcome: { upsert: jest.fn() },
  };
  const router = { runReportIfChanged: jest.fn() };
  const service = new MatchesService(
    prisma as unknown as PrismaService,
    router as unknown as AiRouterService,
  );
  return { service, prisma, router };
}

const finishedMatch = {
  id: 'm1',
  kickoffAt: new Date('2026-07-01T18:00:00Z'),
  homeScore: 2,
  awayScore: 1,
};

const structured = {
  prediction: { homeWinLean: 55, drawLean: 25, awayWinLean: 20 },
  likelyScorelines: [
    { score: '2-1', probability: 30 },
    { score: '1-1', probability: 25 },
  ],
};

describe('MatchesService.scorePredictions', () => {
  it('settles against the latest pre-kickoff report (retro=false)', async () => {
    const { service, prisma } = buildSettlement();
    prisma.match.findMany.mockResolvedValue([finishedMatch]);
    prisma.aiReport.findFirst.mockResolvedValueOnce({
      id: 'r1',
      createdAt: new Date('2026-07-01T10:00:00Z'),
      structuredJson: structured,
    });

    const result = await service.scorePredictions();

    // Pre-kickoff lookup constrained to reports created before kickoff.
    const where = prisma.aiReport.findFirst.mock.calls[0][0].where;
    expect(where.reportType).toEqual({ in: ['MATCH_PREDICTION', 'MATCH_ANALYSIS'] });
    expect(where.createdAt).toEqual({ lt: finishedMatch.kickoffAt });

    expect(prisma.matchPredictionOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'm1' },
        create: expect.objectContaining({
          matchId: 'm1',
          reportId: 'r1',
          retro: false,
          actualHomeScore: 2,
          actualAwayScore: 1,
          tendencyPredicted: 'HOME',
          tendencyActual: 'HOME',
          tendencyHit: true,
          exactScoreHit: true,
          top3ScoreHit: true,
        }),
      }),
    );
    expect(result).toMatchObject({ scanned: 1, scored: 1, noPrediction: 0, failed: 0 });
  });

  it('falls back to a retro report and flags the outcome retro=true', async () => {
    const { service, prisma } = buildSettlement();
    prisma.match.findMany.mockResolvedValue([finishedMatch]);
    prisma.aiReport.findFirst
      .mockResolvedValueOnce(null) // no pre-kickoff report
      .mockResolvedValueOnce({
        id: 'r-retro',
        createdAt: new Date('2026-07-05T10:00:00Z'),
        structuredJson: structured,
      });

    const result = await service.scorePredictions();

    const retroWhere = prisma.aiReport.findFirst.mock.calls[1][0].where;
    expect(retroWhere.reportType).toBe('RETRO_MATCH_ANALYSIS');
    expect(prisma.matchPredictionOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ reportId: 'r-retro', retro: true }),
      }),
    );
    expect(result).toMatchObject({ scored: 1 });
  });

  it('counts matches without any scoreable prediction and never upserts', async () => {
    const { service, prisma } = buildSettlement();
    prisma.match.findMany.mockResolvedValue([finishedMatch]);
    prisma.aiReport.findFirst.mockResolvedValue(null);

    const result = await service.scorePredictions();

    expect(prisma.matchPredictionOutcome.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, scored: 0, noPrediction: 1 });
  });
});

describe('MatchesService.generateRetroAnalyses', () => {
  const fullMatch = {
    ...finishedMatch,
    homeTeamId: 't1',
    awayTeamId: 't2',
    stage: 'GROUP',
    groupName: 'A',
    status: 'FINISHED',
    homeTeam: { nameEn: 'Brazil' },
    awayTeam: { nameEn: 'Norway' },
  };

  it('skips matches that already have a real pre-kickoff analysis', async () => {
    const { service, prisma, router } = buildSettlement();
    prisma.match.findMany.mockResolvedValue([fullMatch]);
    prisma.aiReport.count.mockResolvedValue(1);

    const result = await service.generateRetroAnalyses();

    expect(router.runReportIfChanged).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, generated: 0, skipped: 1 });
  });

  it('generates a retro report from pre-kickoff context only (no actual score)', async () => {
    const { service, prisma, router } = buildSettlement();
    prisma.match.findMany
      .mockResolvedValueOnce([fullMatch]) // job selection
      .mockResolvedValue([]); // both form lookups
    prisma.aiReport.count.mockResolvedValue(0);
    router.runReportIfChanged.mockResolvedValue({ ok: true });

    const result = await service.generateRetroAnalyses();

    const input = router.runReportIfChanged.mock.calls[0][0];
    expect(input).toMatchObject({
      taskType: 'RETRO_MATCH_ANALYSIS',
      reportType: 'RETRO_MATCH_ANALYSIS',
      entityId: 'm1',
      allowModelKnowledge: false,
    });
    // Leakage guard: the actual final score must never reach the prompt context.
    expect(input.context).not.toHaveProperty('homeScore');
    expect(input.context).not.toHaveProperty('awayScore');
    expect(input.instruction).toContain('賽前');
    // Form lookups are bounded to matches kicked off before this one.
    const formWhere = prisma.match.findMany.mock.calls[1][0].where;
    expect(formWhere.kickoffAt).toEqual({ lt: fullMatch.kickoffAt });
    expect(result).toMatchObject({ scanned: 1, generated: 1, skipped: 0 });
  });
});
