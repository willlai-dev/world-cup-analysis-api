import { Injectable } from "@nestjs/common";
import { MatchStage, MatchStatus, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { SyncResult } from "../sync-result";
import { SourceError } from "../http.util";
import { FootballDataClient } from "./football-data.client";
import type { FdMatch, FdMatchTeamRef } from "./football-data.types";
import { deriveEliminatedTeamIds } from "./elimination";

function mapStatus(status: string): MatchStatus {
  switch (status) {
    case "IN_PLAY":
    case "PAUSED":
      return MatchStatus.LIVE;
    case "FINISHED":
      return MatchStatus.FINISHED;
    case "POSTPONED":
      return MatchStatus.POSTPONED;
    case "SUSPENDED":
    case "CANCELLED":
      return MatchStatus.CANCELLED;
    default:
      return MatchStatus.SCHEDULED; // TIMED / SCHEDULED / unknown
  }
}

function mapStage(stage?: string | null): MatchStage {
  switch (stage) {
    case "GROUP_STAGE":
    case "LEAGUE_STAGE":
      return MatchStage.GROUP;
    case "LAST_32":
      return MatchStage.ROUND_OF_32;
    case "LAST_16":
      return MatchStage.ROUND_OF_16;
    case "QUARTER_FINALS":
      return MatchStage.QUARTER_FINAL;
    case "SEMI_FINALS":
      return MatchStage.SEMI_FINAL;
    case "THIRD_PLACE":
      return MatchStage.THIRD_PLACE;
    case "FINAL":
      return MatchStage.FINAL;
    default:
      return MatchStage.UNKNOWN;
  }
}

/**
 * `score.winner` is authoritative (football-data sets it even for penalty
 * shootouts); when it's absent but the full-time score is level and a
 * penalty result exists, fall back to penalties so knockout losers still
 * get a winner attributed.
 */
function deriveWinnerTeamId(
  m: FdMatch,
  homeTeamId: string,
  awayTeamId: string,
): string | null {
  const winner = m.score?.winner;
  if (winner === "HOME_TEAM") return homeTeamId;
  if (winner === "AWAY_TEAM") return awayTeamId;

  const full = m.score?.fullTime;
  const pens = m.score?.penalties;
  if (
    full?.home != null &&
    full?.away != null &&
    full.home === full.away &&
    pens?.home != null &&
    pens?.away != null &&
    pens.home !== pens.away
  ) {
    return pens.home > pens.away ? homeTeamId : awayTeamId;
  }
  return null;
}

type TeamResolver = (ref: FdMatchTeamRef) => string | null;

/**
 * Result of a single-match refresh attempt.
 * `refreshed: true`  — DB was updated with latest source data.
 * `refreshed: false` — Not updated; `sourceFailed` distinguishes between
 *   "no key/no externalId" (expected, no external call) vs an actual source error.
 */
export type RefreshOneResult =
  | { refreshed: true }
  | { refreshed: false; sourceFailed: boolean; reason: string };

/** Syncs World Cup fixtures and results from football-data.org into Match. */
@Injectable()
export class MatchSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FootballDataClient,
  ) {}

  /** All competition matches (scheduled + finished), upserted by externalId. */
  syncFixtures(): Promise<SyncResult> {
    return this.syncMatches(undefined);
  }

  /** Finished matches only — refreshes scores / winner / status. */
  syncResults(): Promise<SyncResult> {
    return this.syncMatches("FINISHED");
  }

  /**
   * Refresh a single match from football-data.org by its externalId.
   * Only updates volatile fields: status, homeScore, awayScore, winnerTeamId,
   * sourceUpdatedAt.  Never touches AI fields, kickoffAt, stage, or teams.
   */
  async refreshOneMatch(opts: {
    dbId: string;
    externalId: string | null;
    homeTeamId: string;
    awayTeamId: string;
  }): Promise<RefreshOneResult> {
    if (!this.client.hasKey()) {
      return {
        refreshed: false,
        sourceFailed: false,
        reason: "FOOTBALL_DATA_API_KEY not configured",
      };
    }
    if (!opts.externalId) {
      return {
        refreshed: false,
        sourceFailed: false,
        reason: "match has no externalId",
      };
    }
    const numericId = Number(opts.externalId);
    if (!Number.isFinite(numericId)) {
      return {
        refreshed: false,
        sourceFailed: false,
        reason: "match externalId is not a numeric football-data id",
      };
    }

    let fdMatch: FdMatch;
    try {
      fdMatch = await this.client.getMatch(numericId);
    } catch (err) {
      return {
        refreshed: false,
        sourceFailed: true,
        reason: err instanceof SourceError ? err.message : String(err),
      };
    }

    const status = mapStatus(fdMatch.status);
    await this.prisma.match.update({
      where: { id: opts.dbId },
      data: {
        status,
        homeScore: fdMatch.score?.fullTime?.home ?? null,
        awayScore: fdMatch.score?.fullTime?.away ?? null,
        winnerTeamId: deriveWinnerTeamId(
          fdMatch,
          opts.homeTeamId,
          opts.awayTeamId,
        ),
        sourceUpdatedAt: fdMatch.lastUpdated
          ? new Date(fdMatch.lastUpdated)
          : new Date(),
      },
    });

    // A manual refresh that settles a match can change who is eliminated.
    if (status === MatchStatus.FINISHED) {
      await this.recomputeEliminations();
    }

    return { refreshed: true };
  }

  private async syncMatches(status?: string): Promise<SyncResult> {
    if (!this.client.hasKey()) {
      return {
        source: "football-data",
        skipped: true,
        reason: "FOOTBALL_DATA_API_KEY not configured",
      };
    }

    const resolve = await this.buildTeamResolver();
    const matches = await this.client.getCompetitionMatches(status);
    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const m of matches) {
      const homeTeamId = resolve(m.homeTeam);
      const awayTeamId = resolve(m.awayTeam);
      if (!homeTeamId || !awayTeamId) {
        failed += 1; // a team in this fixture is not in our DB yet
        continue;
      }
      const externalId = String(m.id);
      const data = this.mapMatch(m, homeTeamId, awayTeamId);
      const existing = await this.prisma.match.findUnique({
        where: { externalId },
        select: { id: true },
      });
      await this.prisma.match.upsert({
        where: { externalId },
        create: { externalId, ...data },
        update: data,
      });
      if (existing) updated += 1;
      else created += 1;
    }

    const { eliminated, reinstated } = await this.recomputeEliminations();

    return {
      source: "football-data",
      fetched: matches.length,
      created,
      updated,
      failed,
      eliminated,
      reinstated,
    };
  }

  /**
   * Recomputes the eliminated set from the full match table and applies it in
   * both directions, so stale flags (e.g. from mis-staged matches) heal on
   * every sync. When the derived set is empty, `notIn: []` matches every team
   * and resets all flags to false — that is intentional: no matches means
   * nobody has been eliminated.
   */
  private async recomputeEliminations(): Promise<{
    eliminated: number;
    reinstated: number;
  }> {
    const rows = await this.prisma.match.findMany({
      select: {
        stage: true,
        status: true,
        homeTeamId: true,
        awayTeamId: true,
        winnerTeamId: true,
      },
    });
    const ids = [...deriveEliminatedTeamIds(rows)];
    const [markEliminated, clearStale] = await this.prisma.$transaction([
      this.prisma.team.updateMany({
        where: { id: { in: ids }, isEliminated: false },
        data: { isEliminated: true },
      }),
      this.prisma.team.updateMany({
        where: { id: { notIn: ids }, isEliminated: true },
        data: { isEliminated: false },
      }),
    ]);
    return { eliminated: markEliminated.count, reinstated: clearStale.count };
  }

  private mapMatch(
    m: FdMatch,
    homeTeamId: string,
    awayTeamId: string,
  ): Prisma.MatchUncheckedCreateInput {
    return {
      homeTeamId,
      awayTeamId,
      kickoffAt: new Date(m.utcDate),
      status: mapStatus(m.status),
      stage: mapStage(m.stage),
      groupName: m.group ?? undefined,
      // Volatile fields mirror the source with explicit nulls (never
      // undefined) so the upsert's update path clears stale values when the
      // source retracts them — e.g. a corrected winner must not linger and
      // skew elimination derivation.
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      winnerTeamId: deriveWinnerTeamId(m, homeTeamId, awayTeamId),
      sourceUpdatedAt: m.lastUpdated ? new Date(m.lastUpdated) : new Date(),
    };
  }

  private async buildTeamResolver(): Promise<TeamResolver> {
    const teams = await this.prisma.team.findMany({
      select: { id: true, externalId: true, fifaCode: true },
    });
    const byExternal = new Map<string, string>();
    const byTla = new Map<string, string>();
    for (const t of teams) {
      if (t.externalId) byExternal.set(t.externalId, t.id);
      if (t.fifaCode) byTla.set(t.fifaCode.toUpperCase(), t.id);
    }
    return (ref) => {
      if (ref.id != null) {
        const hit = byExternal.get(String(ref.id));
        if (hit) return hit;
      }
      if (ref.tla) {
        const hit = byTla.get(ref.tla.toUpperCase());
        if (hit) return hit;
      }
      return null;
    };
  }
}
