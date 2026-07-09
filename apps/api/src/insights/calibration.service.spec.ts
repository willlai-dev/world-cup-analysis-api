import type { PrismaService } from '../prisma/prisma.service';
import { CalibrationService } from './calibration.service';

describe('CalibrationService', () => {
  function build(rows: unknown[]) {
    const prisma = {
      matchPredictionOutcome: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const service = new CalibrationService(prisma as unknown as PrismaService);
    return { service, prisma };
  }

  const rows = Array.from({ length: 12 }, (_, i) => ({
    homeWinLean: 55,
    drawLean: 25,
    awayWinLean: 20,
    tendencyPredicted: 'HOME',
    tendencyActual: i % 2 === 0 ? 'HOME' : 'AWAY',
    tendencyHit: i % 2 === 0,
    exactScoreHit: i % 4 === 0,
    top3ScoreHit: i % 2 === 0,
    likelyScorelines: [
      { score: '2-1', probability: 30 },
      { score: '1-1', probability: 25 },
    ],
    actualHomeScore: i % 2 === 0 ? 2 : 0,
    actualAwayScore: 1,
    match: { homeTeamId: 'team-h', awayTeamId: 'team-a' },
  }));

  it('samples only real (non-retro) outcomes and caches the whole bundle', async () => {
    const { service, prisma } = build(rows);

    const first = await service.getBundle();
    const second = await service.getBundle();

    expect(prisma.matchPredictionOutcome.findMany).toHaveBeenCalledTimes(1); // cached
    expect(prisma.matchPredictionOutcome.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retro: false } }),
    );
    expect(first.tendency).toMatchObject({ sampleSize: 12, applied: true });
    expect(first.tendency!.temperature).toBeGreaterThan(0);
    // Every home row over/under-performs symmetrically here, but the map is built.
    expect(first.teamBias).toBeInstanceOf(Map);
    // 12 rows × 2 scorelines = 24 binary samples ≥ SCORELINE_MIN_SAMPLE.
    expect(first.scoreline).toMatchObject({ sampleSize: 24, applied: true });
    // All 12 rows have usable leans → blend weight is fitted.
    expect(first.scorelineBlend).toMatchObject({ sampleSize: 12, applied: true });
    expect(first.scoreTrack).toEqual({
      sampleSize: 12,
      exactScoreHitRate: 3 / 12,
      top3ScoreHitRate: 6 / 12,
    });
    expect(second).toBe(first);
  });

  it('returns an empty bundle when nothing is settled yet', async () => {
    const { service } = build([]);

    const bundle = await service.getBundle();

    expect(bundle.tendency).toBeNull();
    expect(bundle.teamBias.size).toBe(0);
    expect(bundle.scoreline).toBeNull();
    expect(bundle.scorelineBlend).toBeNull();
    expect(bundle.scoreTrack).toBeNull();
  });
});
