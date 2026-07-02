import type { AiRouterService } from '../ai/ai-router.service';
import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { TeamsService } from './teams.service';

function build() {
  const prisma = {
    team: { findMany: jest.fn(), update: jest.fn() },
    player: { findMany: jest.fn().mockResolvedValue([]) },
    match: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const router = { runReportIfChanged: jest.fn() };
  const config = {
    aiMockMode: true,
    aiGenerationDelayMs: 0,
  } as unknown as AppConfigService;
  const service = new TeamsService(
    prisma as unknown as PrismaService,
    router as unknown as AiRouterService,
    config,
  );
  return { service, prisma, router };
}

const squad = {
  championScore: 78,
  formScore: 72,
  attackScore: 80,
  midfieldScore: 75,
  defenseScore: 70,
  statusScore: 74,
  ratingTier: 'A',
  strengths: [],
  risks: [],
  summary: 'x',
  dataLimitations: [],
};

describe('TeamsService.generateRatings', () => {
  it('writes team scores back when a real provider returns them', async () => {
    const { service, prisma, router } = build();
    prisma.team.findMany.mockResolvedValue([
      { id: 't1', nameEn: 'Austria', nameZh: '奧地利', fifaCode: 'AUT', isEliminated: false },
    ]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, provider: 'NVIDIA', data: squad });

    const result = await service.generateRatings();

    const input = router.runReportIfChanged.mock.calls[0][0];
    expect(input).toMatchObject({
      taskType: 'TEAM_SQUAD_ANALYSIS',
      entityId: 't1',
      reportType: 'TEAM_SQUAD_ANALYSIS',
      allowModelKnowledge: true,
    });
    expect(prisma.team.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        championScore: 78,
        attackScore: 80,
        ratingTier: 'A',
      }),
    });
    expect(result).toMatchObject({ scope: 'teams', scanned: 1, generated: 1, failed: 0 });
  });

  it('does not overwrite scores for mock (PROGRAM_RULE) output', async () => {
    const { service, prisma, router } = build();
    prisma.team.findMany.mockResolvedValue([
      { id: 't1', nameEn: 'Austria', isEliminated: false },
    ]);
    router.runReportIfChanged.mockResolvedValue({
      ok: true,
      provider: 'PROGRAM_RULE',
      data: { ...squad, championScore: 0 },
    });

    const result = await service.generateRatings();

    expect(prisma.team.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ generated: 1 });
  });

  it('counts hash-skipped teams without writing', async () => {
    const { service, prisma, router } = build();
    prisma.team.findMany.mockResolvedValue([
      { id: 't1', nameEn: 'Austria', isEliminated: false },
    ]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, skipped: true, data: null });

    const result = await service.generateRatings();

    expect(prisma.team.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, generated: 0, skipped: 1 });
  });
});
