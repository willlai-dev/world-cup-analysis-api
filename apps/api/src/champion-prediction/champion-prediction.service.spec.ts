import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AiRouterService } from '../ai/ai-router.service';
import { ChampionPredictionService } from './champion-prediction.service';

describe('ChampionPredictionService.generateSystemRun', () => {
  function build() {
    const prisma = {
      team: { findMany: jest.fn() },
      championPredictionRun: { create: jest.fn() },
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
