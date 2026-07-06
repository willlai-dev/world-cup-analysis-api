import type { AiRouterService } from '../ai/ai-router.service';
import type { AppConfigService } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PlayersService } from './players.service';

function build(overrides: { aiMockMode?: boolean } = {}) {
  const prisma = {
    player: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    team: { findMany: jest.fn() },
    match: { findMany: jest.fn().mockResolvedValue([]) },
    newsArticle: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const router = { runReportIfChanged: jest.fn(), runReport: jest.fn() };
  const config = {
    aiMockMode: overrides.aiMockMode ?? true,
    aiGenerationDelayMs: 0,
    playerStatus: { topN: 15, newsDays: 7 },
  } as unknown as AppConfigService;
  const service = new PlayersService(
    prisma as unknown as PrismaService,
    router as unknown as AiRouterService,
    config,
  );
  return { service, prisma, router };
}

describe('PlayersService.generateRatings', () => {

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

describe('PlayersService name translation (via generateRatings)', () => {
  const missing = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      nameEn: `Player ${i}`,
      team: { nameEn: 'England', nameZh: '英格蘭' },
    }));

  it('skips translation entirely in mock mode (no placeholder writes)', async () => {
    const { service, prisma, router } = build(); // aiMockMode: true
    prisma.player.findMany.mockResolvedValue([]);

    const result = await service.generateRatings();

    expect(router.runReport).not.toHaveBeenCalled();
    // Only the ratings query ran — the nameZh selection query is skipped.
    expect(prisma.player.findMany).toHaveBeenCalledTimes(1);
    expect(result.nameTranslation).toEqual({ scanned: 0, translated: 0, failed: 0 });
  });

  it('writes back only CJK results matching a batched id', async () => {
    const { service, prisma, router } = build({ aiMockMode: false });
    prisma.player.findMany
      .mockResolvedValueOnce(missing(2)) // translation selection
      .mockResolvedValueOnce([]); // ratings loop
    router.runReport.mockResolvedValue({
      ok: true,
      provider: 'QWEN',
      data: {
        names: [
          { id: 'p0', nameZh: '凱恩' },
          { id: 'p1', nameZh: 'Kane' }, // romanized echo — must be dropped
          { id: 'zz', nameZh: '不存在' }, // unknown id — must be dropped
        ],
      },
    });

    const result = await service.generateRatings();

    const input = router.runReport.mock.calls[0][0];
    expect(input).toMatchObject({
      taskType: 'PLAYER_NAME_TRANSLATION',
      reportType: 'PLAYER_NAME_TRANSLATION',
    });
    expect(input.context.players).toEqual([
      { id: 'p0', name: 'Player 0', country: '英格蘭' },
      { id: 'p1', name: 'Player 1', country: '英格蘭' },
    ]);
    expect(prisma.player.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.player.updateMany).toHaveBeenCalledWith({
      where: { id: 'p0' },
      data: { nameZh: '凱恩' },
    });
    expect(result.nameTranslation).toEqual({ scanned: 2, translated: 1, failed: 0 });
  });

  it('stops after consecutive whole-batch failures (provider down)', async () => {
    const { service, prisma, router } = build({ aiMockMode: false });
    prisma.player.findMany
      .mockResolvedValueOnce(missing(150)) // 3 batches of 50
      .mockResolvedValueOnce([]);
    router.runReport.mockResolvedValue({ ok: false, data: null });

    const result = await service.generateRatings();

    expect(router.runReport).toHaveBeenCalledTimes(2); // 3rd batch not attempted
    expect(prisma.player.updateMany).not.toHaveBeenCalled();
    expect(result.nameTranslation).toEqual({ scanned: 150, translated: 0, failed: 100 });
  });
});

describe('PlayersService.generateStatuses', () => {
  const team = {
    id: 't1',
    nameEn: 'Brazil',
    nameZh: '巴西',
    players: [
      { id: 'p1', nameEn: 'Neymar', nameZh: '內馬爾', position: 'FW', clubName: 'X' },
    ],
  };

  it('covers only in-tournament teams, top-N players, and grounds context in news + matches', async () => {
    const { service, prisma, router } = build();
    prisma.team.findMany.mockResolvedValue([team]);
    prisma.match.findMany.mockResolvedValue([
      {
        kickoffAt: new Date('2026-06-30T18:00:00Z'),
        homeScore: 2,
        awayScore: 1,
        winnerTeamId: 't1',
        homeTeam: { id: 't1', nameEn: 'Brazil' },
        awayTeam: { id: 't2', nameEn: 'Spain' },
      },
    ]);
    prisma.newsArticle.findMany.mockResolvedValue([
      { titleEn: 'Neymar update', summaryZh: '近況', category: 'PLAYER', publishedAt: new Date() },
    ]);
    router.runReportIfChanged.mockResolvedValue({ ok: true, provider: 'NVIDIA', data: {
      statusSummaryZh: '狀態佳（推論）',
      injuryRiskLevel: 'LOW',
      formScore: 82,
      dataLimitations: [],
    } });

    const result = await service.generateStatuses();

    const teamQuery = prisma.team.findMany.mock.calls[0][0];
    expect(teamQuery.where).toEqual({ isEliminated: false });
    expect(teamQuery.select.players.take).toBe(15);
    expect(teamQuery.select.players.orderBy[0]).toEqual({ overallScore: 'desc' });

    const input = router.runReportIfChanged.mock.calls[0][0];
    expect(input).toMatchObject({
      taskType: 'PLAYER_STATUS_SUMMARY',
      entityId: 'p1',
      reportType: 'PLAYER_STATUS_SUMMARY',
    });
    expect(input.instruction).toContain('推論');
    expect(input.context.recentNews).toHaveLength(1);
    expect(input.context.recentMatches[0]).toMatchObject({ score: '2:1', teamWon: true });

    expect(prisma.player.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { injuryRiskLevel: 'LOW', formScore: 82 },
    });
    expect(result).toMatchObject({ scope: 'player-status', scanned: 1, generated: 1 });
  });

  it('does not write back for PROGRAM_RULE (mock) output and counts skips', async () => {
    const { service, prisma, router } = build();
    prisma.team.findMany.mockResolvedValue([team]);
    router.runReportIfChanged
      .mockResolvedValueOnce({ ok: true, provider: 'PROGRAM_RULE', data: { statusSummaryZh: 'x', injuryRiskLevel: 'UNKNOWN', formScore: null, dataLimitations: [] } });

    const result = await service.generateStatuses();

    expect(prisma.player.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ generated: 1, skipped: 0, failed: 0 });
  });
});
