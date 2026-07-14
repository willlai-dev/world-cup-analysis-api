import { Injectable } from '@nestjs/common';
import { AiEntityType, AiReportStatus, JobStatus, MatchStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityMatcher } from './entity-matcher.service';
import { QuestionIntentResolver } from './question-intent.resolver';
import type {
  EntityMatchResult,
  GeneralChatCategory,
  GeneralChatContext,
} from './general-chat.types';

/** A gathered context slice plus the source timestamps it contributes. */
type Slice<T> = { items: T[]; sources: (Date | null)[] };

const CATEGORY_LABEL: Record<GeneralChatCategory, string> = {
  CHAMPION: '冠軍預測',
  MATCH: '賽事',
  TEAM: '國家隊',
  PLAYER: '球員',
  NEWS: '新聞',
};

const MAX_CHAMPION_ENTRIES = 8;
const MAX_MATCHES = 12;
const MAX_RECENT_MATCHES = 6;
const MAX_UPCOMING_MATCHES = 24;
const MAX_PLAYERS = 6;
const MAX_TEAMS = 5;
const MAX_NEWS = 5;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const displayName = (nameZh: string | null, nameEn: string): string => nameZh ?? nameEn;

/**
 * Builds a grounded DB context for the general floating chat: resolves the
 * question intent, matches referenced entities, and queries only the relevant
 * tables (Prisma-only, no HTTP self-calls). Fields are hand-picked slim shapes
 * — no rawPayload / passwordHash / secrets, bounded counts — so the prompt stays
 * small. Returns `context: undefined` when nothing relevant is found, letting the
 * strict Global Skill answer「目前資料不足」(spec §"Context Builder").
 */
@Injectable()
export class GeneralChatContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: QuestionIntentResolver,
    private readonly matcher: EntityMatcher,
  ) {}

  /**
   * @param priorText Recent user turns concatenated — used only to widen entity
   *   matching so references like「他/這隊」resolve to a previously named entity.
   *   Intent is still classified from the current question alone.
   */
  async build(question: string, priorText = ''): Promise<GeneralChatContext> {
    const { categories, wantsPrediction } = this.resolver.resolve(question);
    const matchText = priorText ? `${question} ${priorText}` : question;
    const entities = await this.matcher.match(matchText);
    const teamIds = entities.teams.map((t) => t.id);
    const playerIds = entities.players.map((p) => p.id);

    const cats = new Set<GeneralChatCategory>(categories);
    // No keyword category but the user named an entity → infer from the entity.
    if (cats.size === 0 && playerIds.length) cats.add('PLAYER');
    if (cats.size === 0 && teamIds.length) cats.add('TEAM');

    const context: Record<string, unknown> = {};
    const sources: (Date | null)[] = [];
    const labels: string[] = [];

    // A named team is always worth including (its profile grounds team/player/news answers).
    if (teamIds.length) {
      const teams = await this.loadTeams(teamIds);
      if (teams.items.length) {
        context.teams = teams.items;
        sources.push(...teams.sources);
        for (const t of entities.teams) labels.push(displayName(t.nameZh, t.nameEn));
      }
    }

    // Naming a team or player → bundle the relevant team(s) fixtures (past results
    // + upcoming), so「接下來(法國)對陣誰 / 上一場結果」work even when no match
    // keyword fired. Players carry their teamId, so「Mbappe 下一場」resolves too.
    const fixtureTeamIds = [...new Set([...teamIds, ...entities.players.map((p) => p.teamId)])];
    if (fixtureTeamIds.length) {
      const fixtures = await this.loadMatches(fixtureTeamIds, wantsPrediction);
      if (fixtures.items.length) {
        context.matches = fixtures.items;
        // Reference time so the model can resolve「接下來/今天/明天」against kickoff (UTC).
        context.now = new Date().toISOString();
        sources.push(...fixtures.sources);
        labels.push(CATEGORY_LABEL.MATCH);
      }
    }

    if (cats.has('CHAMPION')) {
      const champion = await this.loadChampion();
      if (champion) {
        context.championPrediction = champion.data;
        sources.push(champion.updatedAt);
        labels.push(CATEGORY_LABEL.CHAMPION);
      }
    }

    // General match questions with no named entity (fixtures are already bundled
    // above when an entity was named).
    if (cats.has('MATCH') && !context.matches) {
      const matches = await this.loadMatches(teamIds, wantsPrediction);
      if (matches.items.length) {
        context.matches = matches.items;
        // Reference time so the model can resolve「今天/明天」against kickoff (UTC).
        context.now = new Date().toISOString();
        sources.push(...matches.sources);
        labels.push(CATEGORY_LABEL.MATCH);
      }
    }

    if (cats.has('PLAYER')) {
      const players = await this.loadPlayers(playerIds, teamIds);
      if (players.items.length) {
        context.players = players.items;
        sources.push(...players.sources);
        labels.push(CATEGORY_LABEL.PLAYER);
      }
    }

    if (cats.has('TEAM')) {
      if (!context.teams) {
        const top = await this.loadTopTeams();
        if (top.items.length) {
          context.teams = top.items;
          sources.push(...top.sources);
        }
      }
      labels.push(CATEGORY_LABEL.TEAM);
    }

    if (cats.has('NEWS')) {
      const news = await this.loadNews(entities);
      if (news.items.length) {
        context.news = news.items;
        sources.push(...news.sources);
        labels.push(CATEGORY_LABEL.NEWS);
      }
    }

    // Player named but PLAYER category not triggered → still surface the player(s).
    if (playerIds.length && !context.players && !cats.has('PLAYER')) {
      const players = await this.loadPlayers(playerIds, []);
      if (players.items.length) {
        context.players = players.items;
        sources.push(...players.sources);
        labels.push(CATEGORY_LABEL.PLAYER);
      }
    }

    // Nothing keyword-classified and no entity → light fallback so generic
    // questions still get grounded, up-to-date data instead of a bare refusal.
    if (Object.keys(context).length === 0 && cats.size === 0) {
      const fb = await this.loadFallback();
      Object.assign(context, fb.data);
      sources.push(...fb.sources);
    }

    const isEmpty = Object.keys(context).length === 0;
    return {
      scope: this.buildScope(labels),
      context: isEmpty ? undefined : context,
      sourceUpdatedAt: this.maxIso(sources),
    };
  }

  // --- loaders -------------------------------------------------------------

  private async loadTeams(teamIds: string[]): Promise<Slice<unknown>> {
    const rows = await this.prisma.team.findMany({
      where: { id: { in: teamIds } },
      take: MAX_TEAMS,
      select: this.teamSelect(),
    });
    return { items: rows.map((t) => this.toTeamContext(t)), sources: rows.map((t) => t.updatedAt) };
  }

  private async loadTopTeams(): Promise<Slice<unknown>> {
    const rows = await this.prisma.team.findMany({
      orderBy: [{ championScore: 'desc' }, { id: 'asc' }],
      take: MAX_TEAMS,
      select: this.teamSelect(),
    });
    return { items: rows.map((t) => this.toTeamContext(t)), sources: rows.map((t) => t.updatedAt) };
  }

  private async loadChampion(): Promise<{ data: unknown; updatedAt: Date } | null> {
    const run = await this.prisma.championPredictionRun.findFirst({
      where: { status: JobStatus.DONE },
      orderBy: { createdAt: 'desc' },
      include: {
        entries: {
          orderBy: { rank: 'asc' },
          take: MAX_CHAMPION_ENTRIES,
          include: { team: { select: { nameEn: true, nameZh: true } } },
        },
      },
    });
    if (!run) return null;
    const updatedAt = run.completedAt ?? run.createdAt;
    return {
      updatedAt,
      data: {
        updatedAt: iso(updatedAt),
        entries: run.entries.map((e) => ({
          rank: e.rank,
          team: displayName(e.team.nameZh, e.team.nameEn),
          championScore: e.championScore,
          probabilityText: e.probabilityText,
          ratingTier: e.ratingTier,
          aiComment: e.aiComment,
        })),
      },
    };
  }

  private async loadMatches(teamIds: string[], includePredictions = false): Promise<Slice<unknown>> {
    if (teamIds.length) {
      const rows = await this.prisma.match.findMany({
        where: { OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }] },
        orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
        take: MAX_MATCHES,
        select: this.matchSelect(),
      });
      return this.toMatchSlice(rows, await this.loadPredictions(rows, includePredictions));
    }

    // No specific team: recent finished (for「最近/昨天」) + any live + a broad
    // window of upcoming SCHEDULED matches (for「未開始/今天/明天/某月某日」).
    // Crucially we always include upcoming across several days — not just
    // "today" — so date-specific questions can be answered from the snapshot.
    const [recent, live, upcoming] = await Promise.all([
      this.prisma.match.findMany({
        where: { status: MatchStatus.FINISHED },
        orderBy: [{ kickoffAt: 'desc' }, { id: 'asc' }],
        take: MAX_RECENT_MATCHES,
        select: this.matchSelect(),
      }),
      this.prisma.match.findMany({
        where: { status: MatchStatus.LIVE },
        orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
        take: MAX_MATCHES,
        select: this.matchSelect(),
      }),
      this.prisma.match.findMany({
        where: { status: MatchStatus.SCHEDULED },
        orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
        take: MAX_UPCOMING_MATCHES,
        select: this.matchSelect(),
      }),
    ]);
    // recent is newest-first → reverse to chronological, then live, then upcoming.
    const rows = [...recent.reverse(), ...live, ...upcoming];
    return this.toMatchSlice(rows, await this.loadPredictions(rows, includePredictions));
  }

  /**
   * Per-match forecast slices, keyed by match id — only fetched for 預測-flavoured
   * questions to keep ordinary fixture snapshots small. Settled matches use
   * MatchPredictionOutcome (leans + hit metrics; `retro` marks a post-hoc
   * backfilled prediction that must not be presented as a real pre-match call);
   * unsettled ones fall back to the latest DONE pre-match report's leans.
   */
  private async loadPredictions(
    rows: { id: string }[],
    includePredictions: boolean,
  ): Promise<Map<string, Record<string, unknown>> | undefined> {
    if (!includePredictions || rows.length === 0) return undefined;
    const matchIds = rows.map((r) => r.id);

    const [outcomes, reports] = await Promise.all([
      this.prisma.matchPredictionOutcome.findMany({
        where: { matchId: { in: matchIds } },
        select: {
          matchId: true,
          homeWinLean: true,
          drawLean: true,
          awayWinLean: true,
          tendencyPredicted: true,
          tendencyHit: true,
          exactScoreHit: true,
          retro: true,
          predictedAt: true,
        },
      }),
      this.prisma.aiReport.findMany({
        where: {
          entityType: AiEntityType.MATCH,
          entityId: { in: matchIds },
          status: AiReportStatus.DONE,
          reportType: { in: ['MATCH_PREDICTION', 'MATCH_ANALYSIS'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, structuredJson: true, createdAt: true },
      }),
    ]);

    const byMatch = new Map<string, Record<string, unknown>>();
    for (const o of outcomes) {
      byMatch.set(o.matchId, {
        homeWinLean: o.homeWinLean,
        drawLean: o.drawLean,
        awayWinLean: o.awayWinLean,
        predictedTendency: o.tendencyPredicted,
        tendencyHit: o.tendencyHit,
        exactScoreHit: o.exactScoreHit,
        retro: o.retro,
        ...(o.retro ? { note: '賽後回補之預測，非真實賽前預測' } : {}),
        predictedAt: iso(o.predictedAt),
      });
    }
    // reports are newest-first, so the first one seen per match wins.
    for (const r of reports) {
      if (!r.entityId || byMatch.has(r.entityId)) continue;
      const pred = this.reportPrediction(r.structuredJson);
      if (pred) {
        byMatch.set(r.entityId, { ...pred, predictedAt: iso(r.createdAt) });
      }
    }
    return byMatch;
  }

  /** Extracts the compact lean/scoreline snapshot from a pre-match report. */
  private reportPrediction(structuredJson: unknown): Record<string, unknown> | null {
    const s = structuredJson as {
      prediction?: { homeWinLean?: number; drawLean?: number; awayWinLean?: number };
      likelyScorelines?: { score?: string }[];
    } | null;
    const pred = s?.prediction;
    if (!pred || (pred.homeWinLean == null && pred.drawLean == null && pred.awayWinLean == null)) {
      return null;
    }
    const likelyScorelines = (s?.likelyScorelines ?? [])
      .map((x) => x?.score)
      .filter((score): score is string => Boolean(score))
      .slice(0, 3);
    return {
      homeWinLean: pred.homeWinLean ?? null,
      drawLean: pred.drawLean ?? null,
      awayWinLean: pred.awayWinLean ?? null,
      ...(likelyScorelines.length ? { likelyScorelines } : {}),
    };
  }

  private async loadPlayers(playerIds: string[], teamIds: string[]): Promise<Slice<unknown>> {
    const where = playerIds.length
      ? { id: { in: playerIds } }
      : teamIds.length
        ? { teamId: { in: teamIds } }
        : {};
    const take = playerIds.length ? Math.min(playerIds.length, MAX_PLAYERS * 2) : MAX_PLAYERS;
    const rows = await this.prisma.player.findMany({
      where,
      orderBy: [{ overallScore: 'desc' }, { id: 'asc' }],
      take,
      select: {
        nameEn: true,
        nameZh: true,
        position: true,
        ratingTier: true,
        overallScore: true,
        attackScore: true,
        creativityScore: true,
        techniqueScore: true,
        defenseScore: true,
        physicalScore: true,
        formScore: true,
        role: true,
        injuryRiskLevel: true,
        updatedAt: true,
        team: { select: { nameEn: true, nameZh: true } },
      },
    });
    const items = rows.map((p) => ({
      name: displayName(p.nameZh, p.nameEn),
      team: p.team ? displayName(p.team.nameZh, p.team.nameEn) : null,
      position: p.position,
      ratingTier: p.ratingTier,
      overallScore: p.overallScore,
      attackScore: p.attackScore,
      creativityScore: p.creativityScore,
      techniqueScore: p.techniqueScore,
      defenseScore: p.defenseScore,
      physicalScore: p.physicalScore,
      formScore: p.formScore,
      role: p.role,
      injuryRiskLevel: p.injuryRiskLevel,
    }));
    return { items, sources: rows.map((p) => p.updatedAt) };
  }

  private async loadNews(entities: EntityMatchResult): Promise<Slice<unknown>> {
    const names = [
      ...entities.teams.flatMap((t) => [t.nameEn, t.nameZh]),
      ...entities.players.flatMap((p) => [p.nameEn, p.nameZh]),
    ].filter((n): n is string => Boolean(n));

    const rows = names.length
      ? await this.queryNews({ tags: { some: { newsTag: { name: { in: names } } } } })
      : await this.queryNews({});
    // Entity-scoped query found nothing → fall back to latest headlines.
    const finalRows = rows.length === 0 && names.length ? await this.queryNews({}) : rows;
    return {
      items: finalRows.map((n) => ({
        title: n.titleZh ?? n.titleEn,
        summary: n.summaryZh ?? n.summaryEn,
        source: n.sourceName,
        publishedAt: iso(n.publishedAt),
        category: n.category,
        tags: n.tags.map((t) => t.newsTag.name),
      })),
      sources: finalRows.map((n) => n.publishedAt),
    };
  }

  private queryNews(where: Record<string, unknown>) {
    return this.prisma.newsArticle.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: MAX_NEWS,
      select: {
        titleEn: true,
        titleZh: true,
        summaryEn: true,
        summaryZh: true,
        sourceName: true,
        publishedAt: true,
        category: true,
        tags: { select: { newsTag: { select: { name: true } } } },
      },
    });
  }

  /** UNKNOWN intent: champion top-3 + recent/upcoming matches + latest news. */
  private async loadFallback(): Promise<{ data: Record<string, unknown>; sources: (Date | null)[] }> {
    const [champion, matches, news] = await Promise.all([
      this.loadChampion(),
      this.loadMatches([]),
      this.loadNews({ teams: [], players: [] }),
    ]);
    const data: Record<string, unknown> = {};
    const sources: (Date | null)[] = [];
    if (champion) {
      const c = champion.data as { updatedAt: string | null; entries: unknown[] };
      data.championPrediction = { updatedAt: c.updatedAt, entries: c.entries.slice(0, 3) };
      sources.push(champion.updatedAt);
    }
    if (matches.items.length) {
      data.matches = matches.items.slice(0, 5);
      sources.push(...matches.sources.slice(0, 5));
    }
    if (news.items.length) {
      data.news = news.items.slice(0, 3);
      sources.push(...news.sources.slice(0, 3));
    }
    return { data, sources };
  }

  // --- shapes / helpers ----------------------------------------------------

  private teamSelect() {
    return {
      nameEn: true,
      nameZh: true,
      fifaCode: true,
      continent: true,
      groupName: true,
      coachName: true,
      worldRanking: true,
      ratingTier: true,
      championScore: true,
      formScore: true,
      isEliminated: true,
      updatedAt: true,
    } as const;
  }

  private toTeamContext(t: {
    nameEn: string;
    nameZh: string | null;
    fifaCode: string | null;
    continent: string | null;
    groupName: string | null;
    coachName: string | null;
    worldRanking: number | null;
    ratingTier: string;
    championScore: number | null;
    formScore: number | null;
    isEliminated: boolean;
  }) {
    return {
      name: displayName(t.nameZh, t.nameEn),
      nameEn: t.nameEn,
      fifaCode: t.fifaCode,
      continent: t.continent,
      groupName: t.groupName,
      coachName: t.coachName,
      worldRanking: t.worldRanking,
      ratingTier: t.ratingTier,
      championScore: t.championScore,
      formScore: t.formScore,
      isEliminated: t.isEliminated,
    };
  }

  private matchSelect() {
    return {
      id: true,
      kickoffAt: true,
      status: true,
      stage: true,
      groupName: true,
      homeScore: true,
      awayScore: true,
      sourceUpdatedAt: true,
      homeTeam: { select: { nameEn: true, nameZh: true } },
      awayTeam: { select: { nameEn: true, nameZh: true } },
    } as const;
  }

  private toMatchSlice(
    rows: {
      id: string;
      kickoffAt: Date;
      status: string;
      stage: string;
      groupName: string | null;
      homeScore: number | null;
      awayScore: number | null;
      sourceUpdatedAt: Date | null;
      homeTeam: { nameEn: string; nameZh: string | null };
      awayTeam: { nameEn: string; nameZh: string | null };
    }[],
    predictions?: Map<string, Record<string, unknown>>,
  ): Slice<unknown> {
    const items = rows.map((m) => ({
      home: displayName(m.homeTeam.nameZh, m.homeTeam.nameEn),
      away: displayName(m.awayTeam.nameZh, m.awayTeam.nameEn),
      stage: m.stage,
      groupName: m.groupName,
      kickoffAt: iso(m.kickoffAt),
      status: m.status,
      score:
        m.homeScore != null && m.awayScore != null ? `${m.homeScore}-${m.awayScore}` : null,
      // JSON.stringify drops the key entirely for non-prediction questions.
      prediction: predictions?.get(m.id),
    }));
    return { items, sources: rows.map((m) => m.sourceUpdatedAt ?? m.kickoffAt) };
  }

  private buildScope(labels: string[]): string {
    const unique = [...new Set(labels)];
    return unique.length ? `一般問答（${unique.join('、')}）` : '一般問答';
  }

  private maxIso(sources: (Date | null)[]): string | null {
    let max: number | null = null;
    for (const d of sources) {
      if (d) max = max === null ? d.getTime() : Math.max(max, d.getTime());
    }
    return max === null ? null : new Date(max).toISOString();
  }
}
