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
    tendencyHit: i % 2 === 0,
  }));

  it('samples only real (non-retro) outcomes and caches the result', async () => {
    const { service, prisma } = build(rows);

    const first = await service.getParams();
    const second = await service.getParams();

    expect(prisma.matchPredictionOutcome.findMany).toHaveBeenCalledTimes(1); // cached
    expect(prisma.matchPredictionOutcome.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retro: false } }),
    );
    expect(first).toMatchObject({ sampleSize: 12, applied: true });
    expect(second).toBe(first);
  });

  it('returns null when nothing is settled yet', async () => {
    const { service } = build([]);
    expect(await service.getParams()).toBeNull();
  });
});
