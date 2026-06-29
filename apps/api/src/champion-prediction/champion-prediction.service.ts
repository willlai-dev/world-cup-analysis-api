import { Injectable } from '@nestjs/common';
import {
  ChampionPredictionTriggerType,
  type ChampionPredictionRun,
  JobStatus,
} from '@prisma/client';
import type { AiReportDto, ChampionPredictionResponse } from '../common/dto/contracts';
import { toAiReportDto, toChampionEntrySummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';

const TOP_N = 8;

@Injectable()
export class ChampionPredictionService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatest(): Promise<ChampionPredictionResponse | null> {
    const run = await this.prisma.championPredictionRun.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { entries: { include: { team: true }, orderBy: { rank: 'asc' } } },
    });
    return run ? this.buildResponse(run) : null;
  }

  /**
   * Phase 1 mock recalculation: derives a fresh run from teams ranked by
   * championScore. Real dual-model (NVIDIA/Qwen) cross-analysis is Phase 3.
   */
  async recalculate(userId: string): Promise<ChampionPredictionResponse> {
    const teams = await this.prisma.team.findMany({
      orderBy: { championScore: 'desc' },
      take: TOP_N,
    });
    const run = await this.prisma.championPredictionRun.create({
      data: {
        triggeredByUserId: userId,
        triggerType: ChampionPredictionTriggerType.PREMIUM_USER,
        status: JobStatus.DONE,
        completedAt: new Date(),
        entries: {
          create: teams.map((team, index) => ({
            teamId: team.id,
            rank: index + 1,
            championScore: team.championScore ?? 0,
            ratingTier: team.ratingTier,
            probabilityText: `${Math.max(5, 40 - index * 5)}%`,
            strengths: [],
            risks: [],
            aiComment: '【AI_MOCK_MODE】重新計算的示範結果，正式版本將以資料庫快照與雙模型分析為準。',
          })),
        },
      },
      include: { entries: { include: { team: true }, orderBy: { rank: 'asc' } } },
    });
    return this.buildResponse(run);
  }

  private async buildResponse(
    run: ChampionPredictionRun & {
      entries: Parameters<typeof toChampionEntrySummary>[0][];
    },
  ): Promise<ChampionPredictionResponse> {
    const [nvidiaReport, qwenReport, finalReport] = await Promise.all([
      this.getReport(run.nvidiaReportId),
      this.getReport(run.qwenReportId),
      this.getReport(run.finalReportId),
    ]);
    return {
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      entries: run.entries.map(toChampionEntrySummary),
      finalReport,
      nvidiaReport,
      qwenReport,
    };
  }

  private async getReport(reportId: string | null): Promise<AiReportDto | null> {
    if (!reportId) {
      return null;
    }
    const report = await this.prisma.aiReport.findUnique({ where: { id: reportId } });
    return report ? toAiReportDto(report) : null;
  }
}
