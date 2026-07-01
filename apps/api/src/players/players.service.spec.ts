import type { AiRouterService } from '../ai/ai-router.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PlayersService } from './players.service';

describe('PlayersService.generateRatings', () => {
  function build() {
    const prisma = {
      player: { findMany: jest.fn(), update: jest.fn() },
    };
    const router = { runReportIfChanged: jest.fn() };
    const service = new PlayersService(
      prisma as unknown as PrismaService,
      router as unknown as AiRouterService,
    );
    return { service, prisma, router };
  }

  const hexagon = {
    overallScore: 90,
    ratingTier: 'S',
    attackScore: 88,
    creativityScore: 85,
    techniqueScore: 92,
    defenseScore: 40,
    physicalScore: 80,
    formScore: 86,
    strengths: [],
    weaknesses: [],
    roleSummary: 'x',
    injuryRiskLevel: 'LOW',
    dataLimitations: [],
  };

  it('writes scores back when a real provider returns the rating', async () => {
    const { service, prisma, router } = build();
    prisma.player.findMany.mockResolvedValue([{ id: 'p1', nameEn: 'Messi', team: { nameEn: 'Argentina' } }]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, provider: 'NVIDIA', data: hexagon });

    const result = await service.generateRatings();

    expect(prisma.player.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ overallScore: 90, ratingTier: 'S', injuryRiskLevel: 'LOW' }),
    });
    expect(result).toMatchObject({ scanned: 1, generated: 1, skipped: 0, failed: 0 });
  });

  it('does not overwrite row scores in mock mode (PROGRAM_RULE)', async () => {
    const { service, prisma, router } = build();
    prisma.player.findMany.mockResolvedValue([{ id: 'p1', nameEn: 'Messi', team: { nameEn: 'Argentina' } }]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, provider: 'PROGRAM_RULE', data: hexagon });

    const result = await service.generateRatings();

    expect(prisma.player.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ generated: 1 });
  });

  it('counts skipped (unchanged) reports without writing', async () => {
    const { service, prisma, router } = build();
    prisma.player.findMany.mockResolvedValue([{ id: 'p1', nameEn: 'Messi', team: { nameEn: 'Argentina' } }]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, skipped: true, data: null });

    const result = await service.generateRatings();

    expect(prisma.player.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, generated: 0, skipped: 1 });
  });
});
