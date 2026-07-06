import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AiEntityType,
  AiProvider,
  AiReportStatus,
  type Prisma,
  RatingTier,
  RiskLevel,
} from "@prisma/client";
import {
  type GenerationResult,
  MAX_GENERATIONS_PER_RUN,
} from "../ai/generation-result";
import { AiRouterService } from "../ai/ai-router.service";
import {
  type PlayerHexagonOutput,
  PlayerHexagonOutputSchema,
} from "../ai/schemas/player-hexagon.schema";
import {
  type PlayerNameTranslationOutput,
  PlayerNameTranslationOutputSchema,
} from "../ai/schemas/player-name-translation.schema";
import {
  type PlayerStatusOutput,
  PlayerStatusOutputSchema,
} from "../ai/schemas/player-status.schema";
import type {
  AiReportDto,
  ChatAnswerDto,
  PlayerSummary,
} from "../common/dto/contracts";
import { sleep } from "../common/utils/sleep.util";
import { AppConfigService } from "../config/app-config.service";
import { toAiReportDto, toPlayerSummary } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import type { ListPlayersQueryDto } from "./dto/list-players-query.dto";

const PLAYER_MOCK: PlayerHexagonOutput = {
  overallScore: 0,
  ratingTier: "UNKNOWN",
  attackScore: 0,
  creativityScore: 0,
  techniqueScore: 0,
  defenseScore: 0,
  physicalScore: 0,
  formScore: 0,
  strengths: [],
  weaknesses: [],
  roleSummary: "【AI_MOCK_MODE】示範",
  injuryRiskLevel: "UNKNOWN",
  dataLimitations: ["示範模式"],
};

const PLAYER_STATUS_MOCK: PlayerStatusOutput = {
  statusSummaryZh: "【AI_MOCK_MODE】球員近況摘要示範（推論，僅供參考）。",
  injuryRiskLevel: "UNKNOWN",
  formScore: null,
  dataLimitations: ["示範模式"],
};

/** Players per PLAYER_NAME_TRANSLATION AI call (id + name + country in, id + 譯名 out). */
const NAME_TRANSLATION_BATCH_SIZE = 50;
/** Per-run batch cap — 26 × 50 covers a full 48-squad backfill in a single run. */
const NAME_TRANSLATION_MAX_BATCHES = 26;
/** Stop early when the provider looks down (whole batches failing back-to-back). */
const NAME_TRANSLATION_MAX_CONSECUTIVE_FAILURES = 2;
/** A returned 譯名 must contain CJK — a romanized echo (e.g. the English name)
 *  is dropped and the row stays null so a later run retries it. */
const CJK_RE = /[㐀-鿿]/;

/** Per-run summary of the nameZh backfill; stored in JobRun.metadata. */
export type NameTranslationResult = {
  scanned: number;
  translated: number;
  failed: number;
};

const PLAYER_SORT_FIELDS = [
  "overallScore",
  "attackScore",
  "creativityScore",
  "techniqueScore",
  "defenseScore",
  "physicalScore",
  "formScore",
  "nameEn",
  "createdAt",
] as const;

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: AiRouterService,
    private readonly config: AppConfigService,
  ) {}

  async list(
    query: ListPlayersQueryDto,
  ): Promise<{ items: PlayerSummary[]; total: number }> {
    const where: Prisma.PlayerWhereInput = {};
    if (query.teamId) {
      where.teamId = query.teamId;
    }
    if (query.position) {
      where.position = query.position;
    }
    if (query.ratingTier) {
      where.ratingTier = query.ratingTier;
    }
    if (query.eliminated !== undefined) {
      where.team = { isEliminated: query.eliminated };
    }
    if (query.search) {
      where.OR = [
        { nameEn: { contains: query.search, mode: "insensitive" } },
        { nameZh: { contains: query.search, mode: "insensitive" } },
        { clubName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const sortBy = (PLAYER_SORT_FIELDS as readonly string[]).includes(
      query.sortBy ?? "",
    )
      ? (query.sortBy as string)
      : "overallScore";
    const sortOrder: Prisma.SortOrder =
      query.sortOrder === "asc" ? "asc" : "desc";

    const [items, total] = await this.prisma.$transaction([
      this.prisma.player.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
        include: { team: true },
      }),
      this.prisma.player.count({ where }),
    ]);
    return { items: items.map((p) => toPlayerSummary(p)), total };
  }

  async getById(playerId: string): Promise<PlayerSummary> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { team: true },
    });
    if (!player) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Player not found",
      });
    }
    return toPlayerSummary(player);
  }

  async deepChat(
    playerId: string,
    userId: string,
    question: string,
  ): Promise<ChatAnswerDto> {
    const player = await this.getById(playerId);
    return this.router.runChat({
      taskType: "DEEP_PLAYER_CHAT",
      userId,
      entityId: playerId,
      question,
      scope: `球員：${player.nameEn}`,
      context: player,
    });
  }

  /** Job: hexagon rating per player — saves an AiReport and (real mode) writes scores back. */
  async generateRatings(
    opts?: { teamId?: string },
  ): Promise<GenerationResult & { nameTranslation: NameTranslationResult }> {
    // 先補中文譯名再評分：資料源(football-data)只有英文名，SYNC_PLAYERS 進來的新
    // 球員一律缺 nameZh。掛在這裡讓每日 ratings 排程與手動 FULL/GENERATE/PLAYERS/
    // 單隊管線都會自動補齊，不需要新的 JobType（正式環境不必跑 enum migration）。
    const nameTranslation = await this.translateMissingNames(opts?.teamId);

    // Players on still-in-tournament teams first (team.isEliminated=false sorts
    // before true), so the per-run cap spends the AI budget on live squads before
    // knocked-out ones. Eliminated teams' players get whatever budget remains.
    // `opts.teamId` scopes the run to a single country's squad.
    const players = await this.prisma.player.findMany({
      where: opts?.teamId ? { teamId: opts.teamId } : undefined,
      orderBy: [{ team: { isEliminated: "asc" } }, { id: "asc" }],
      select: {
        id: true,
        nameEn: true,
        position: true,
        clubName: true,
        shirtNumber: true,
        team: { select: { nameEn: true } },
      },
    });
    let scanned = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const p of players) {
      if (generated >= MAX_GENERATIONS_PER_RUN) break;
      scanned += 1;
      const context = {
        name: p.nameEn,
        position: p.position,
        club: p.clubName,
        shirtNumber: p.shirtNumber,
        team: p.team?.nameEn ?? null,
      };
      const report = await this.router.runReportIfChanged<PlayerHexagonOutput>({
        taskType: "PLAYER_HEXAGON_ANALYSIS",
        entityId: p.id,
        reportType: "PLAYER_HEXAGON_ANALYSIS",
        instruction:
          "請依球員資料輸出六邊形能力評估。只輸出 JSON,欄位:overallScore、attackScore、creativityScore、" +
          "techniqueScore、defenseScore、physicalScore、formScore(皆 0-100)、ratingTier(S|A_PLUS|A|B_PLUS|B|C|UNKNOWN)、" +
          "strengths[]、weaknesses[]、roleSummary、injuryRiskLevel(LOW|MEDIUM|HIGH|UNKNOWN)、dataLimitations[]。",
        context,
        scope: `球員：${p.nameEn}`,
        schema: PlayerHexagonOutputSchema,
        mockData: PLAYER_MOCK,
        allowModelKnowledge: true,
      });

      if (report.skipped) {
        skipped += 1;
      } else if (report.ok && report.data) {
        // Only write AI scores back to the row for real provider output (not mock zeros).
        if (report.provider && report.provider !== AiProvider.PROGRAM_RULE) {
          await this.applyHexagon(p.id, report.data);
        }
        generated += 1;
      } else {
        failed += 1;
      }
      if (!report.skipped && !this.config.aiMockMode) {
        await sleep(this.config.aiGenerationDelayMs);
      }
    }

    return { scope: "players", scanned, generated, skipped, failed, nameTranslation };
  }

  /**
   * Backfills `nameZh` for players that don't have one yet (idempotent — only
   * null/empty rows are selected). Names go to the cheap QWEN slot in batches;
   * the player's country travels along so transliteration can follow the name's
   * origin language. Only results that actually contain CJK are written back —
   * anything else stays null and is retried on a later run.
   */
  private async translateMissingNames(
    teamId?: string,
  ): Promise<NameTranslationResult> {
    // Mock mode: never write placeholder names into rows; report a no-op.
    if (this.config.aiMockMode) {
      return { scanned: 0, translated: 0, failed: 0 };
    }

    const players = await this.prisma.player.findMany({
      where: {
        OR: [{ nameZh: null }, { nameZh: "" }],
        ...(teamId ? { teamId } : {}),
      },
      // In-tournament squads first — same budget priority as the ratings loop.
      orderBy: [{ team: { isEliminated: "asc" } }, { id: "asc" }],
      take: NAME_TRANSLATION_BATCH_SIZE * NAME_TRANSLATION_MAX_BATCHES,
      select: {
        id: true,
        nameEn: true,
        team: { select: { nameEn: true, nameZh: true } },
      },
    });

    let translated = 0;
    let failed = 0;
    let consecutiveFailures = 0;

    for (let i = 0; i < players.length; i += NAME_TRANSLATION_BATCH_SIZE) {
      const batch = players.slice(i, i + NAME_TRANSLATION_BATCH_SIZE);
      const batchIds = new Set(batch.map((p) => p.id));

      const report = await this.router.runReport<PlayerNameTranslationOutput>({
        taskType: "PLAYER_NAME_TRANSLATION",
        reportType: "PLAYER_NAME_TRANSLATION",
        instruction:
          "請為 context.players 中每位足球員產生台灣媒體慣用的繁體中文譯名：" +
          "知名球員使用台灣主流體育媒體常用譯名（如 Lionel Messi → 梅西、Kylian Mbappé → 姆巴佩）；" +
          "其他球員依其國籍（country 欄位）的語言發音音譯，以姓氏慣用譯名為主。" +
          '只輸出 JSON：{"names":[{"id":"<照抄輸入的 id>","nameZh":"<繁體中文譯名>"}]}，' +
          "每位球員一筆，id 不可增刪或修改。",
        context: {
          players: batch.map((p) => ({
            id: p.id,
            name: p.nameEn,
            country: p.team?.nameZh ?? p.team?.nameEn ?? null,
          })),
        },
        scope: "球員名單中文譯名",
        schema: PlayerNameTranslationOutputSchema,
        mockData: { names: [] },
        allowModelKnowledge: true,
      });

      if (!report.ok || !report.data) {
        failed += batch.length;
        consecutiveFailures += 1;
        if (consecutiveFailures >= NAME_TRANSLATION_MAX_CONSECUTIVE_FAILURES) {
          break; // provider is likely down — don't burn the remaining batches
        }
        continue;
      }
      consecutiveFailures = 0;

      const applied = new Set<string>();
      for (const item of report.data.names) {
        const nameZh = item.nameZh?.trim();
        if (!batchIds.has(item.id) || applied.has(item.id)) continue;
        if (!nameZh || nameZh.length > 30 || !CJK_RE.test(nameZh)) continue;
        applied.add(item.id);
        // updateMany: no throw if the row was deleted while the batch was in flight.
        await this.prisma.player.updateMany({
          where: { id: item.id },
          data: { nameZh },
        });
        translated += 1;
      }

      await sleep(this.config.aiGenerationDelayMs);
    }

    return { scanned: players.length, translated, failed };
  }

  /**
   * Job: daily form/injury summary for in-tournament players (top N per team
   * by overallScore — user-tuned cost cap). Material = recent news tagged with
   * the player's name + the team's recent finished matches; the source hash
   * skips players whose material hasn't changed since the last run.
   */
  async generateStatuses(opts?: { teamId?: string }): Promise<GenerationResult> {
    const { topN, newsDays } = this.config.playerStatus;
    const since = new Date();
    since.setDate(since.getDate() - newsDays);

    // Scoped to one team when `opts.teamId` is set (admin per-country refresh);
    // otherwise every still-in-tournament team, top N players each.
    const teams = await this.prisma.team.findMany({
      where: opts?.teamId ? { id: opts.teamId } : { isEliminated: false },
      select: {
        id: true,
        nameEn: true,
        nameZh: true,
        players: {
          orderBy: [{ overallScore: "desc" }, { id: "asc" }],
          take: topN,
          select: {
            id: true,
            nameEn: true,
            nameZh: true,
            position: true,
            clubName: true,
          },
        },
      },
    });

    let scanned = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    outer: for (const team of teams) {
      const recentMatches = await this.prisma.match.findMany({
        where: {
          status: "FINISHED",
          OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
        },
        orderBy: { kickoffAt: "desc" },
        take: 5,
        select: {
          kickoffAt: true,
          homeScore: true,
          awayScore: true,
          winnerTeamId: true,
          homeTeam: { select: { id: true, nameEn: true } },
          awayTeam: { select: { id: true, nameEn: true } },
        },
      });
      const matchContext = recentMatches.map((m) => ({
        kickoffAt: m.kickoffAt?.toISOString() ?? null,
        home: m.homeTeam.nameEn,
        away: m.awayTeam.nameEn,
        score: `${m.homeScore ?? "-"}:${m.awayScore ?? "-"}`,
        teamWon: m.winnerTeamId === team.id,
      }));

      for (const p of team.players) {
        if (generated >= MAX_GENERATIONS_PER_RUN) break outer;
        scanned += 1;

        const names = [p.nameEn, p.nameZh].filter(
          (n): n is string => !!n && n.length > 0,
        );
        const recentNews = await this.prisma.newsArticle.findMany({
          where: {
            publishedAt: { gte: since },
            tags: { some: { newsTag: { name: { in: names } } } },
          },
          orderBy: { publishedAt: "desc" },
          take: 5,
          select: {
            titleEn: true,
            summaryZh: true,
            category: true,
            publishedAt: true,
          },
        });

        const report = await this.router.runReportIfChanged<PlayerStatusOutput>(
          {
            taskType: "PLAYER_STATUS_SUMMARY",
            entityId: p.id,
            reportType: "PLAYER_STATUS_SUMMARY",
            instruction:
              "請根據近期相關新聞與該隊近況比賽結果，輸出球員近況與身體狀況摘要。務必謹慎：" +
              "傷病與狀態判斷屬「推論」，需在文字中明確標示，不可斷言未經證實的傷情；" +
              "引用新聞時附上發布時間；資料不足時列入 dataLimitations 並將 injuryRiskLevel 設為 UNKNOWN。" +
              '只輸出 JSON，欄位：{ "statusSummaryZh": string, "injuryRiskLevel": "LOW"|"MEDIUM"|"HIGH"|"UNKNOWN", ' +
              '"formScore": number|null, "dataLimitations": string[] }。',
            context: {
              player: {
                name: p.nameEn,
                nameZh: p.nameZh,
                position: p.position,
                club: p.clubName,
              },
              team: { name: team.nameEn, nameZh: team.nameZh },
              recentNews: recentNews.map((n) => ({
                title: n.titleEn,
                summaryZh: n.summaryZh,
                category: n.category,
                publishedAt: n.publishedAt?.toISOString() ?? null,
              })),
              recentMatches: matchContext,
            },
            scope: `球員：${p.nameEn}`,
            schema: PlayerStatusOutputSchema,
            mockData: PLAYER_STATUS_MOCK,
          },
        );

        if (report.skipped) {
          skipped += 1;
          continue;
        }
        if (report.ok && report.data) {
          if (report.provider && report.provider !== AiProvider.PROGRAM_RULE) {
            await this.applyStatus(p.id, report.data);
          }
          generated += 1;
        } else {
          failed += 1;
        }
        if (!this.config.aiMockMode) {
          await sleep(this.config.aiGenerationDelayMs);
        }
      }
    }

    return { scope: "player-status", scanned, generated, skipped, failed };
  }

  private async applyStatus(
    playerId: string,
    d: PlayerStatusOutput,
  ): Promise<void> {
    await this.prisma.player.update({
      where: { id: playerId },
      data: {
        injuryRiskLevel: d.injuryRiskLevel as RiskLevel,
        ...(d.formScore !== null ? { formScore: d.formScore } : {}),
      },
    });
  }

  private async applyHexagon(
    playerId: string,
    d: PlayerHexagonOutput,
  ): Promise<void> {
    await this.prisma.player.update({
      where: { id: playerId },
      data: {
        overallScore: d.overallScore,
        attackScore: d.attackScore,
        creativityScore: d.creativityScore,
        techniqueScore: d.techniqueScore,
        defenseScore: d.defenseScore,
        physicalScore: d.physicalScore,
        formScore: d.formScore,
        ratingTier: d.ratingTier as RatingTier,
        injuryRiskLevel: d.injuryRiskLevel as RiskLevel,
      },
    });
  }

  async getReport(
    playerId: string,
    reportTypes: string[],
  ): Promise<AiReportDto | null> {
    await this.getById(playerId);
    const report = await this.prisma.aiReport.findFirst({
      where: {
        entityType: AiEntityType.PLAYER,
        entityId: playerId,
        status: AiReportStatus.DONE,
        reportType: { in: reportTypes },
      },
      orderBy: { createdAt: "desc" },
    });
    return report ? toAiReportDto(report) : null;
  }
}
