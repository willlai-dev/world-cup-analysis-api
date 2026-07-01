import { Injectable } from '@nestjs/common';
import {
  ChampionPredictionTriggerType,
  type ChampionPredictionRun,
  JobStatus,
  type Team,
} from '@prisma/client';
import { AiRouterService } from '../ai/ai-router.service';
import {
  type ChampionAnalysisOutput,
  ChampionAnalysisOutputSchema,
} from '../ai/schemas/champion-analysis.schema';
import type {
  AiReportDto,
  ChampionPredictionResponse,
  ChatAnswerDto,
} from '../common/dto/contracts';
import { AppConfigService } from '../config/app-config.service';
import { toAiReportDto, toChampionEntrySummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';

const TOP_N = 8;

const MOCK_COMMENT =
  '【AI_MOCK_MODE】重新計算的示範結果，正式版本將以資料庫快照與雙模型分析為準。';
const DEGRADE_COMMENT = 'AI 分析暫時無法使用，此為依資料庫冠軍分數排序的初步結果。';

type EntryCreate = {
  teamId: string;
  rank: number;
  championScore: number;
  ratingTier: Team['ratingTier'];
  probabilityText: string;
  strengths: string[];
  risks: string[];
  aiComment: string;
};

@Injectable()
export class ChampionPredictionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly router: AiRouterService,
  ) {}

  async getLatest(): Promise<ChampionPredictionResponse | null> {
    const run = await this.prisma.championPredictionRun.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { entries: { include: { team: true }, orderBy: { rank: 'asc' } } },
    });
    return run ? this.buildResponse(run) : null;
  }

  async deepChat(userId: string, question: string): Promise<ChatAnswerDto> {
    const latest = await this.getLatest();
    return this.router.runChat({
      taskType: 'DEEP_CHAMPION_CHAT',
      userId,
      question,
      scope: '冠軍預測',
      sourceUpdatedAt: latest?.completedAt ?? latest?.createdAt ?? null,
      context: latest,
    });
  }

  /**
   * Recalculates the champion prediction. Mock mode keeps the deterministic
   * championScore ranking; real mode runs NVIDIA (A) + Qwen (B) + a final
   * consensus (Qwen→NVIDIA fallback), persisting an AiReport per leg. If the
   * final fails/returns invalid output, degrades to the ranking but still links
   * the FAILED reports so the outage is visible.
   */
  async recalculate(userId: string): Promise<ChampionPredictionResponse> {
    return this.runPrediction(ChampionPredictionTriggerType.PREMIUM_USER, userId);
  }

  /** Job: SYSTEM-triggered champion prediction run (same A/B/final pipeline). */
  async generateSystemRun(): Promise<{
    scope: string;
    runId: string;
    status: string;
    entries: number;
  }> {
    const res = await this.runPrediction(ChampionPredictionTriggerType.SYSTEM, null);
    return { scope: 'champion', runId: res.runId, status: res.status, entries: res.entries.length };
  }

  private async runPrediction(
    triggerType: ChampionPredictionTriggerType,
    userId: string | null,
  ): Promise<ChampionPredictionResponse> {
    const teams = await this.prisma.team.findMany({
      orderBy: { championScore: 'desc' },
      take: TOP_N,
    });

    if (this.config.aiMockMode) {
      const run = await this.createRun(triggerType, userId, this.rankedEntries(teams, MOCK_COMMENT));
      return this.buildResponse(run);
    }

    const teamContext = teams.map((t) => ({
      name: t.nameEn,
      nameZh: t.nameZh,
      fifaCode: t.fifaCode,
      worldRanking: t.worldRanking,
      ratingTier: t.ratingTier,
      championScore: t.championScore,
      formScore: t.formScore,
      attackScore: t.attackScore,
      midfieldScore: t.midfieldScore,
      defenseScore: t.defenseScore,
      statusScore: t.statusScore,
    }));

    const reportA = await this.router.runReport({
      taskType: 'CHAMPION_PREDICTION_A',
      userId,
      reportType: 'CHAMPION_ANALYSIS_NVIDIA',
      instruction:
        '請分析本屆世界盃各參賽國家隊的奪冠競爭格局，逐隊說明其優勢與風險（資料庫缺實力數據時可用公開足球知識並標註推估）。',
      context: { teams: teamContext },
      scope: '冠軍預測',
      allowModelKnowledge: true,
    });

    const reportB = await this.router.runReport({
      taskType: 'CHAMPION_PREDICTION_B',
      userId,
      reportType: 'CHAMPION_ANALYSIS_QWEN',
      instruction:
        '請為各國家隊的奪冠可能性排序，並說明排序理由與關鍵變數（資料庫缺實力數據時可用公開足球知識並標註推估）。',
      context: { teams: teamContext },
      scope: '冠軍預測',
      allowModelKnowledge: true,
    });

    const finalReport = await this.router.runReport<ChampionAnalysisOutput>({
      taskType: 'CHAMPION_PREDICTION_FINAL',
      userId,
      reportType: 'CHAMPION_FINAL',
      instruction:
        '綜合模型 A 與模型 B 的分析，輸出最終奪冠預測排名。請「只」輸出 JSON 物件，格式為：' +
        '{ "summary": string, "entries": [{ "teamName": string, "rank": number, ' +
        '"probabilityText": string, "strengths": string[], "risks": string[], "aiComment": string }], ' +
        '"dataLimitations": string[] }。teamName 必須是提供清單中的英文名稱（name 欄位）。',
      context: { teams: teamContext, modelA: reportA.content, modelB: reportB.content },
      scope: '冠軍預測',
      schema: ChampionAnalysisOutputSchema,
      allowModelKnowledge: true,
    });

    const finalEntries =
      finalReport.ok && finalReport.data ? this.mapFinalEntries(finalReport.data, teams) : [];
    const entries =
      finalEntries.length > 0 ? finalEntries : this.rankedEntries(teams, DEGRADE_COMMENT);

    const run = await this.createRun(triggerType, userId, entries, {
      nvidiaReportId: reportA.reportId,
      qwenReportId: reportB.reportId,
      finalReportId: finalReport.reportId,
    });
    return this.buildResponse(run);
  }

  private createRun(
    triggerType: ChampionPredictionTriggerType,
    userId: string | null,
    entries: EntryCreate[],
    reportIds?: { nvidiaReportId?: string; qwenReportId?: string; finalReportId?: string },
  ) {
    return this.prisma.championPredictionRun.create({
      data: {
        triggeredByUserId: userId,
        triggerType,
        status: JobStatus.DONE,
        completedAt: new Date(),
        nvidiaReportId: reportIds?.nvidiaReportId ?? null,
        qwenReportId: reportIds?.qwenReportId ?? null,
        finalReportId: reportIds?.finalReportId ?? null,
        entries: { create: entries },
      },
      include: { entries: { include: { team: true }, orderBy: { rank: 'asc' } } },
    });
  }

  /** Deterministic ranking used by mock mode and as the real-mode degrade path. */
  private rankedEntries(teams: Team[], aiComment: string): EntryCreate[] {
    return teams.map((team, index) => ({
      teamId: team.id,
      rank: index + 1,
      championScore: team.championScore ?? 0,
      ratingTier: team.ratingTier,
      probabilityText: `${Math.max(5, 40 - index * 5)}%`,
      strengths: [],
      risks: [],
      aiComment,
    }));
  }

  /** Resolves final-output entries to seeded teams by name; dedupes + re-ranks. */
  private mapFinalEntries(data: ChampionAnalysisOutput, teams: Team[]): EntryCreate[] {
    const byName = new Map<string, Team>();
    for (const t of teams) {
      byName.set(t.nameEn.toLowerCase(), t);
      if (t.nameZh) byName.set(t.nameZh.toLowerCase(), t);
      if (t.fifaCode) byName.set(t.fifaCode.toLowerCase(), t);
    }
    const used = new Set<string>();
    const entries: EntryCreate[] = [];
    let rank = 1;
    for (const e of data.entries) {
      const team = byName.get(e.teamName.trim().toLowerCase());
      if (!team || used.has(team.id)) {
        continue;
      }
      used.add(team.id);
      entries.push({
        teamId: team.id,
        rank: rank++,
        championScore: team.championScore ?? 0,
        ratingTier: team.ratingTier,
        probabilityText: e.probabilityText,
        strengths: e.strengths,
        risks: e.risks,
        aiComment: e.aiComment,
      });
    }
    return entries;
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
