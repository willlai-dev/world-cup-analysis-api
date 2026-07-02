import { Injectable } from '@nestjs/common';
import {
  ChampionPredictionTriggerType,
  type ChampionPredictionRun,
  JobStatus,
  type Team,
} from '@prisma/client';
import { AiRouterService, type ReportResult } from '../ai/ai-router.service';
import {
  type ChampionAnalysisOutput,
  ChampionAnalysisOutputSchema,
} from '../ai/schemas/champion-analysis.schema';
import {
  type ChampionModelAnalysis,
  ChampionModelAnalysisSchema,
} from '../ai/schemas/champion-model-analysis.schema';
import type {
  AiReportDto,
  ChampionDivergence,
  ChampionDivergenceTeamDelta,
  ChampionPredictionResponse,
  ChatAnswerDto,
} from '../common/dto/contracts';
import { AppConfigService } from '../config/app-config.service';
import { toAiReportDto, toChampionEntrySummary } from '../mappers';
import { PrismaService } from '../prisma/prisma.service';

const MOCK_COMMENT =
  '【AI_MOCK_MODE】重新計算的示範結果，正式版本將以資料庫快照與雙模型分析為準。';
const DEGRADE_COMMENT = 'AI 分析暫時無法使用，此為依資料庫冠軍分數排序的初步結果。';

/** JSON shape appended to both per-model leg instructions. */
const MODEL_LEG_FORMAT =
  '請「只」輸出 JSON 物件，格式為：{ "analysis": string, "entries": [{ "teamName": string, ' +
  '"rank": number, "probabilityText": string, "keyReason": string }], "dataLimitations": string[] }。' +
  'teamName 必須是提供清單中的英文名稱（name 欄位），rank 由 1 開始。';

// Dormant under the current champion mock path (it bypasses the router), kept
// so runReport stays well-defined if that ever changes.
const MODEL_LEG_MOCK: ChampionModelAnalysis = {
  analysis: '【AI_MOCK_MODE】示範模型分析。',
  entries: [],
  dataLimitations: ['AI_MOCK_MODE'],
};

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
    // Only teams still in the tournament can win it. Evaluate every
    // non-eliminated team (the pool shrinks as the knockouts progress).
    // NULLS LAST so teams that already have a championScore lead the context
    // over not-yet-rated ones (Postgres defaults DESC to NULLS FIRST).
    const teams = await this.prisma.team.findMany({
      where: { isEliminated: false },
      orderBy: [{ championScore: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
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

    const reportA = await this.router.runReport<ChampionModelAnalysis>({
      taskType: 'CHAMPION_PREDICTION_A',
      userId,
      reportType: 'CHAMPION_ANALYSIS_NVIDIA',
      instruction:
        '以下清單為目前仍在賽（未淘汰）的國家隊，已出局的隊伍不在其中。請完整評估每一支的奪冠競爭格局，' +
        '在 analysis 中逐隊說明其優勢與風險，並在 entries 給出你的奪冠排名' +
        '（資料庫缺實力數據時可用公開足球知識並標註推估）。' +
        MODEL_LEG_FORMAT,
      context: { teams: teamContext },
      scope: '冠軍預測',
      schema: ChampionModelAnalysisSchema,
      mockData: MODEL_LEG_MOCK,
      allowModelKnowledge: true,
    });

    const reportB = await this.router.runReport<ChampionModelAnalysis>({
      taskType: 'CHAMPION_PREDICTION_B',
      userId,
      reportType: 'CHAMPION_ANALYSIS_QWEN',
      instruction:
        '以下清單為目前仍在賽（未淘汰）的國家隊。請為每一支的奪冠可能性排序，在 analysis 中說明排序理由與關鍵變數，' +
        '並在 entries 給出你的奪冠排名（資料庫缺實力數據時可用公開足球知識並標註推估）。' +
        MODEL_LEG_FORMAT,
      context: { teams: teamContext },
      scope: '冠軍預測',
      schema: ChampionModelAnalysisSchema,
      mockData: MODEL_LEG_MOCK,
      allowModelKnowledge: true,
    });

    const finalReport = await this.router.runReport<ChampionAnalysisOutput>({
      taskType: 'CHAMPION_PREDICTION_FINAL',
      userId,
      reportType: 'CHAMPION_FINAL',
      instruction:
        '綜合模型 A 與模型 B 的分析，輸出最終奪冠預測排名。提供的清單皆為仍在賽（未淘汰）的國家隊，' +
        '請完整涵蓋每一支、不要遺漏。請「只」輸出 JSON 物件，格式為：' +
        '{ "summary": string, "entries": [{ "teamName": string, "rank": number, ' +
        '"probabilityText": string, "strengths": string[], "risks": string[], "aiComment": string }], ' +
        '"dataLimitations": string[] }。teamName 必須是提供清單中的英文名稱（name 欄位）。',
      context: {
        teams: teamContext,
        modelA: reportA.data?.analysis || reportA.content,
        modelB: reportB.data?.analysis || reportB.content,
      },
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
    await this.polishFinalReport(run.id, userId, finalReport);
    return this.buildResponse(run);
  }

  /**
   * FINAL_REPORT_POLISH leg (real mode only, env-gated): rewrites the final
   * consensus into a fluent zh-TW markdown report, persisted as its own
   * AiReport bound to the run via entityId — no schema change. Failure is
   * tolerated: the run is already DONE; buildResponse just returns null.
   */
  private async polishFinalReport(
    runId: string,
    userId: string | null,
    finalReport: ReportResult<ChampionAnalysisOutput>,
  ): Promise<void> {
    if (
      !this.config.championPolishEnabled ||
      !finalReport.ok ||
      !finalReport.data
    ) {
      return;
    }
    await this.router.runReport({
      taskType: 'FINAL_REPORT_POLISH',
      userId,
      entityId: runId,
      reportType: 'FINAL_REPORT_POLISH',
      instruction:
        '請將以下冠軍預測最終報告潤飾為一篇流暢、結構清晰的繁體中文 markdown 報告' +
        '（含標題、總覽、逐隊要點與資料侷限）。只做文字潤飾與重組，' +
        '不可新增原文沒有的事實、數據或排名。',
      context: {
        summary: finalReport.data.summary,
        entries: finalReport.data.entries,
        dataLimitations: finalReport.data.dataLimitations,
      },
      scope: '冠軍預測',
      mockContent: '【AI_MOCK_MODE】潤稿示範。',
    });
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
    const [nvidiaReport, qwenReport, finalReport, polishedReport] =
      await Promise.all([
        this.getReport(run.nvidiaReportId),
        this.getReport(run.qwenReportId),
        this.getReport(run.finalReportId),
        this.getPolishedReport(run.id),
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
      polishedReport,
      divergence: this.computeDivergence(nvidiaReport, qwenReport),
    };
  }

  /** Polish report is bound to the run by entityId (not a run FK column). */
  private async getPolishedReport(runId: string): Promise<AiReportDto | null> {
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: 'CHAMPION_PREDICTION',
        entityId: runId,
        reportType: 'FINAL_REPORT_POLISH',
        status: 'DONE',
      },
      orderBy: { createdAt: 'desc' },
    });
    return report ? toAiReportDto(report) : null;
  }

  /**
   * Program-side NVIDIA-vs-Qwen comparison from the persisted A/B structured
   * rankings — no AI call. Legacy runs (pre-schema A/B) and mock runs (no A/B
   * reports at all) come back `computable: false`.
   */
  private computeDivergence(
    nvidiaReport: AiReportDto | null,
    qwenReport: AiReportDto | null,
  ): ChampionDivergence {
    const nvidia = this.parseModelRanks(nvidiaReport);
    const qwen = this.parseModelRanks(qwenReport);
    if (!nvidia || !qwen) {
      return {
        computable: false,
        summary: '此 run 缺少雙模型結構化排名（舊版報告或 mock 模式），無法計算模型分歧。',
        teamDeltas: [],
      };
    }

    const names = [...new Set([...nvidia.keys(), ...qwen.keys()])];
    const teamDeltas: ChampionDivergenceTeamDelta[] = names
      .map((teamName) => {
        const nvidiaRank = nvidia.get(teamName) ?? null;
        const qwenRank = qwen.get(teamName) ?? null;
        return {
          teamName,
          nvidiaRank,
          qwenRank,
          rankDelta:
            nvidiaRank !== null && qwenRank !== null
              ? Math.abs(nvidiaRank - qwenRank)
              : null,
        };
      })
      .sort(
        (a, b) =>
          Math.min(a.nvidiaRank ?? 99, a.qwenRank ?? 99) -
          Math.min(b.nvidiaRank ?? 99, b.qwenRank ?? 99),
      );

    const topA = teamDeltas.find((d) => d.nvidiaRank === 1)?.teamName;
    const topB = teamDeltas.find((d) => d.qwenRank === 1)?.teamName;
    const shared = teamDeltas.filter((d) => d.rankDelta !== null);
    const maxDelta = shared.reduce<ChampionDivergenceTeamDelta | null>(
      (max, d) => ((d.rankDelta ?? 0) > (max?.rankDelta ?? -1) ? d : max),
      null,
    );

    const parts: string[] = [];
    if (topA && topB) {
      parts.push(
        topA === topB
          ? `雙模型冠軍首選一致：${topA}`
          : `冠軍首選分歧：NVIDIA 看好 ${topA}，Qwen 看好 ${topB}`,
      );
    }
    parts.push(`共同排名 ${shared.length} 隊`);
    if (maxDelta && (maxDelta.rankDelta ?? 0) > 0) {
      parts.push(
        `名次差最大：${maxDelta.teamName}（NVIDIA 第 ${maxDelta.nvidiaRank} vs Qwen 第 ${maxDelta.qwenRank}，相差 ${maxDelta.rankDelta} 名）`,
      );
    } else if (shared.length > 0) {
      parts.push('共同排名完全一致');
    }
    return { computable: true, summary: `${parts.join('；')}。`, teamDeltas };
  }

  /** teamName → rank (rank 0 = unranked → dropped). null when not structured. */
  private parseModelRanks(report: AiReportDto | null): Map<string, number> | null {
    if (!report?.structuredJson) {
      return null;
    }
    const parsed = ChampionModelAnalysisSchema.safeParse(report.structuredJson);
    if (!parsed.success || parsed.data.entries.length === 0) {
      return null;
    }
    const ranks = new Map<string, number>();
    for (const entry of parsed.data.entries) {
      if (entry.rank > 0 && !ranks.has(entry.teamName)) {
        ranks.set(entry.teamName, entry.rank);
      }
    }
    return ranks.size > 0 ? ranks : null;
  }

  private async getReport(reportId: string | null): Promise<AiReportDto | null> {
    if (!reportId) {
      return null;
    }
    const report = await this.prisma.aiReport.findUnique({ where: { id: reportId } });
    return report ? toAiReportDto(report) : null;
  }
}
