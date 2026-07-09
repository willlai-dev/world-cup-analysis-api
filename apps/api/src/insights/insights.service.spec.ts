import type { PrismaService } from '../prisma/prisma.service';
import type { CalibrationService } from './calibration.service';
import { InsightsService } from './insights.service';

const CAL_PARAMS = {
  sampleSize: 12,
  avgConfidence: 0.55,
  tendencyHitRate: 0.5,
  temperature: 1.21,
  applied: true,
  baselineBrier: 0.68,
  calibratedBrier: 0.63,
};

function buildService(rows: unknown[], params: unknown = CAL_PARAMS) {
  const prisma = {
    matchPredictionOutcome: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const calibration = {
    getBundle: jest.fn().mockResolvedValue({
      tendency: params,
      teamBias: new Map<string, number>(),
      scoreline: null,
    }),
  };
  return new InsightsService(
    prisma as unknown as PrismaService,
    calibration as unknown as CalibrationService,
  );
}

const team = (nameEn: string) => ({
  id: `t-${nameEn.toLowerCase()}`,
  nameEn,
  nameZh: null,
  fifaCode: null,
  continent: null,
  groupName: null,
  coachName: null,
  flagUrl: null,
  worldRanking: null,
  ratingTier: 'UNKNOWN',
  championScore: null,
  formScore: null,
  attackScore: null,
  midfieldScore: null,
  defenseScore: null,
  statusScore: null,
  isEliminated: false,
});

function outcome(overrides: Record<string, unknown>) {
  return {
    id: 'o1',
    matchId: 'm1',
    reportId: 'r1',
    retro: false,
    predictedAt: new Date('2026-07-01T10:00:00Z'),
    homeWinLean: 55,
    drawLean: 25,
    awayWinLean: 20,
    likelyScorelines: [{ score: '2-1', probability: 30 }],
    actualHomeScore: 2,
    actualAwayScore: 1,
    tendencyPredicted: 'HOME',
    tendencyActual: 'HOME',
    tendencyHit: true,
    exactScoreHit: true,
    top3ScoreHit: true,
    brierScore: 0.3,
    programScorelines: [{ score: '2-1', probability: 22 }],
    programExactScoreHit: true,
    programTop3ScoreHit: true,
    match: {
      stage: 'GROUP',
      kickoffAt: new Date('2026-07-01T18:00:00Z'),
      homeTeam: team('Brazil'),
      awayTeam: team('Norway'),
    },
    ...overrides,
  };
}

describe('InsightsService.getPredictionInsights', () => {
  const twoOutcomes = [
    outcome({}),
    outcome({
      id: 'o2',
      matchId: 'm2',
      retro: true,
      tendencyHit: false,
      exactScoreHit: false,
      top3ScoreHit: false,
      tendencyActual: 'AWAY',
      brierScore: 0.9,
      // Unusable leans at settlement → no program prediction for this row.
      programScorelines: null,
      programExactScoreHit: null,
      programTop3ScoreHit: null,
      match: {
        stage: 'ROUND_OF_16',
        kickoffAt: new Date('2026-07-04T18:00:00Z'),
        homeTeam: team('France'),
        awayTeam: team('Paraguay'),
      },
    }),
  ];

  it('aggregates real and retro buckets separately and maps items', async () => {
    const service = buildService(twoOutcomes);

    const dto = await service.getPredictionInsights();

    expect(dto.summary.overall).toMatchObject({ total: 2, tendencyHits: 1, tendencyHitRate: 0.5 });
    expect(dto.summary.real).toMatchObject({ total: 1, tendencyHitRate: 1, avgBrier: 0.3 });
    expect(dto.summary.retro).toMatchObject({ total: 1, tendencyHitRate: 0, avgBrier: 0.9 });
    // Program A/B: only o1 carries program metrics — o2 (null fields) stays
    // out of the program denominator.
    expect(dto.summary.overall).toMatchObject({
      programTotal: 1,
      programExactScoreHits: 1,
      programExactScoreHitRate: 1,
      programTop3ScoreHitRate: 1,
    });
    expect(dto.summary.retro).toMatchObject({ programTotal: 0, programExactScoreHitRate: null });
    expect(dto.items[0]).toMatchObject({
      programScorelines: [{ score: '2-1', probability: 22 }],
      programExactScoreHit: true,
    });
    expect(dto.items[1]).toMatchObject({ programScorelines: null, programExactScoreHit: null });
    // Stage buckets in chronological order of first kickoff.
    expect(dto.byStage.map((s) => s.stage)).toEqual(['GROUP', 'ROUND_OF_16']);
    expect(dto.items).toHaveLength(2);
    expect(dto.items[0]).toMatchObject({
      matchId: 'm1',
      homeTeam: { nameEn: 'Brazil' },
      actualHomeScore: 2,
      likelyScorelines: [{ score: '2-1', probability: 30 }],
      retro: false,
    });
    expect(dto.calibration).toMatchObject({
      temperature: 1.21,
      applied: true,
      sampleSize: 12,
      baselineBrier: 0.68,
      calibratedBrier: 0.63,
    });
  });

  it('computes per-team over/under-performance from both sides of a match', async () => {
    const service = buildService(twoOutcomes);

    const dto = await service.getPredictionInsights();

    const byName = Object.fromEntries(dto.byTeam.map((t) => [t.team.nameEn, t]));
    // m1: predicted HOME, actual HOME — both sides as predicted.
    expect(byName['Brazil']).toMatchObject({ total: 1, tendencyHits: 1, overPerformed: 0, underPerformed: 0 });
    // m2 (retro): predicted HOME but actual AWAY — France under, Paraguay over.
    expect(byName['France']).toMatchObject({ total: 1, retroCount: 1, underPerformed: 1 });
    expect(byName['Paraguay']).toMatchObject({ total: 1, overPerformed: 1 });
  });

  it('returns empty buckets (null rates) when nothing is settled yet', async () => {
    const service = buildService([], null);

    const dto = await service.getPredictionInsights();

    expect(dto.summary.overall).toMatchObject({ total: 0, tendencyHitRate: null, avgBrier: null });
    expect(dto.byStage).toEqual([]);
    expect(dto.byTeam).toEqual([]);
    expect(dto.calibration).toBeNull();
    expect(dto.items).toEqual([]);
  });
});
