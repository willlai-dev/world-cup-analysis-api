import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AiRouterService } from '../ai/ai-router.service';
import { ChampionPredictionService } from './champion-prediction.service';

describe('ChampionPredictionService.generateSystemRun', () => {
  function build() {
    const prisma = {
      team: { findMany: jest.fn() },
      championPredictionRun: { create: jest.fn() },
      aiReport: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const config = { aiMockMode: true } as unknown as AppConfigService;
    const router = {} as unknown as AiRouterService;
    const service = new ChampionPredictionService(
      prisma as unknown as PrismaService,
      config,
      router,
    );
    return { service, prisma };
  }

  it('creates a SYSTEM-triggered run (mock mode) from the championScore ranking', async () => {
    const { service, prisma } = build();
    prisma.team.findMany.mockResolvedValue([
      { id: 't1', championScore: 80, ratingTier: 'S' },
      { id: 't2', championScore: 70, ratingTier: 'A' },
    ]);
    prisma.championPredictionRun.create.mockResolvedValue({
      id: 'run1',
      status: 'DONE',
      createdAt: new Date(),
      completedAt: new Date(),
      nvidiaReportId: null,
      qwenReportId: null,
      finalReportId: null,
      entries: [
        {
          id: 'e1',
          rank: 1,
          championScore: 80,
          ratingTier: 'S',
          probabilityText: '40%',
          strengths: [],
          risks: [],
          aiComment: 'x',
          team: { id: 't1', nameEn: 'Brazil', isEliminated: false },
        },
      ],
    });

    const result = await service.generateSystemRun();

    const createArg = prisma.championPredictionRun.create.mock.calls[0][0];
    expect(createArg.data.triggerType).toBe('SYSTEM');
    expect(createArg.data.triggeredByUserId).toBeNull();
    expect(result).toMatchObject({ scope: 'champion', runId: 'run1', status: 'DONE', entries: 1 });
  });
});

describe('ChampionPredictionService divergence (getLatest)', () => {
  const baseRun = {
    id: 'run1',
    status: 'DONE',
    createdAt: new Date(),
    completedAt: new Date(),
    nvidiaReportId: 'ra',
    qwenReportId: 'rb',
    finalReportId: null,
    entries: [],
  };

  function report(id: string, structuredJson: unknown) {
    return {
      id,
      entityType: 'CHAMPION_PREDICTION',
      entityId: null,
      reportType: 'X',
      provider: 'NVIDIA',
      model: 'm',
      language: 'zh-TW',
      title: null,
      content: 'text',
      structuredJson,
      confidenceScore: null,
      status: 'DONE',
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function build(reports: Record<string, unknown>) {
    const prisma = {
      championPredictionRun: {
        findFirst: jest.fn().mockResolvedValue(baseRun),
      },
      aiReport: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(reports[where.id] ?? null),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const config = { aiMockMode: true } as unknown as AppConfigService;
    const service = new ChampionPredictionService(
      prisma as unknown as PrismaService,
      config,
      {} as unknown as AiRouterService,
    );
    return service;
  }

  function ranks(entries: { teamName: string; rank: number }[]) {
    return { analysis: 'a', entries, dataLimitations: [] };
  }

  it('computes per-team deltas and flags a top-pick disagreement', async () => {
    const service = build({
      ra: report(
        'ra',
        ranks([
          { teamName: 'Brazil', rank: 1 },
          { teamName: 'France', rank: 2 },
          { teamName: 'Spain', rank: 3 },
        ]),
      ),
      rb: report(
        'rb',
        ranks([
          { teamName: 'France', rank: 1 },
          { teamName: 'Brazil', rank: 2 },
        ]),
      ),
    });

    const res = await service.getLatest();
    const divergence = res!.divergence!;
    expect(divergence.computable).toBe(true);
    expect(divergence.summary).toContain('NVIDIA 看好 Brazil');
    expect(divergence.summary).toContain('Qwen 看好 France');
    expect(divergence.teamDeltas).toEqual([
      { teamName: 'Brazil', nvidiaRank: 1, qwenRank: 2, rankDelta: 1 },
      { teamName: 'France', nvidiaRank: 2, qwenRank: 1, rankDelta: 1 },
      { teamName: 'Spain', nvidiaRank: 3, qwenRank: null, rankDelta: null },
    ]);
  });

  it('reports agreement when both models rank identically', async () => {
    const entries = [
      { teamName: 'Brazil', rank: 1 },
      { teamName: 'France', rank: 2 },
    ];
    const service = build({
      ra: report('ra', ranks(entries)),
      rb: report('rb', ranks(entries)),
    });

    const divergence = (await service.getLatest())!.divergence!;
    expect(divergence.computable).toBe(true);
    expect(divergence.summary).toContain('雙模型冠軍首選一致：Brazil');
    expect(divergence.summary).toContain('共同排名完全一致');
  });

  it('is not computable when a leg lacks structured ranks (legacy/mock runs)', async () => {
    const service = build({
      ra: report('ra', ranks([{ teamName: 'Brazil', rank: 1 }])),
      rb: report('rb', null),
    });

    const divergence = (await service.getLatest())!.divergence!;
    expect(divergence.computable).toBe(false);
    expect(divergence.teamDeltas).toEqual([]);
  });
});

describe('ChampionPredictionService.recalculate polish (real mode)', () => {
  function buildReal(polishEnabled: boolean) {
    const prisma = {
      team: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            nameEn: 'Brazil',
            nameZh: '巴西',
            fifaCode: 'BRA',
            worldRanking: 1,
            ratingTier: 'S',
            championScore: 80,
            formScore: 1,
            attackScore: 1,
            midfieldScore: 1,
            defenseScore: 1,
            statusScore: 1,
          },
        ]),
      },
      championPredictionRun: {
        create: jest.fn().mockResolvedValue({
          id: 'run1',
          status: 'DONE',
          createdAt: new Date(),
          completedAt: new Date(),
          nvidiaReportId: 'ra',
          qwenReportId: 'rb',
          finalReportId: 'rf',
          entries: [],
        }),
      },
      aiReport: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const modelLeg = { analysis: 'a', entries: [], dataLimitations: [] };
    const runReport = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, reportId: 'ra', data: modelLeg, content: 'a' })
      .mockResolvedValueOnce({ ok: true, reportId: 'rb', data: modelLeg, content: 'b' })
      .mockResolvedValueOnce({
        ok: true,
        reportId: 'rf',
        content: 'f',
        data: {
          summary: 's',
          entries: [
            {
              teamName: 'Brazil',
              rank: 1,
              probabilityText: '40%',
              strengths: [],
              risks: [],
              aiComment: 'c',
            },
          ],
          dataLimitations: [],
        },
      })
      .mockResolvedValue({ ok: true, reportId: 'rp', data: null, content: 'polished' });
    const config = {
      aiMockMode: false,
      championPolishEnabled: polishEnabled,
    } as unknown as AppConfigService;
    const service = new ChampionPredictionService(
      prisma as unknown as PrismaService,
      config,
      { runReport } as unknown as AiRouterService,
    );
    return { service, runReport };
  }

  it('runs FINAL_REPORT_POLISH bound to the run id after a successful final leg', async () => {
    const { service, runReport } = buildReal(true);

    const res = await service.recalculate('u1');

    expect(runReport).toHaveBeenCalledTimes(4);
    expect(runReport.mock.calls[3][0]).toMatchObject({
      taskType: 'FINAL_REPORT_POLISH',
      reportType: 'FINAL_REPORT_POLISH',
      entityId: 'run1',
      userId: 'u1',
    });
    expect(res.polishedReport).toBeNull(); // findFirst mocked to null
  });

  it('skips polish when CHAMPION_POLISH_ENABLED=false', async () => {
    const { service, runReport } = buildReal(false);

    await service.recalculate('u1');

    expect(runReport).toHaveBeenCalledTimes(3);
  });
});
