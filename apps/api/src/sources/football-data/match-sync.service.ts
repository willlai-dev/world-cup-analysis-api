import { Injectable } from "@nestjs/common";
import { MatchStage, MatchStatus, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { SyncResult } from "../sync-result";
import { SourceError } from "../http.util";
import { FootballDataClient } from "./football-data.client";
import type { FdMatch, FdMatchTeamRef } from "./football-data.types";

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

    const winner = fdMatch.score?.winner;
    const winnerTeamId =
      winner === "HOME_TEAM"
        ? opts.homeTeamId
        : winner === "AWAY_TEAM"
          ? opts.awayTeamId
          : null;

    await this.prisma.match.update({
      where: { id: opts.dbId },
      data: {
        status: mapStatus(fdMatch.status),
        homeScore: fdMatch.score?.fullTime?.home ?? null,
        awayScore: fdMatch.score?.fullTime?.away ?? null,
        winnerTeamId,
        sourceUpdatedAt: fdMatch.lastUpdated
          ? new Date(fdMatch.lastUpdated)
          : new Date(),
      },
    });

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
    const eliminated = new Set<string>();

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

      // A finished knockout match eliminates the loser.
      if (
        data.status === MatchStatus.FINISHED &&
        data.stage !== MatchStage.GROUP &&
        data.winnerTeamId
      ) {
        eliminated.add(
          data.winnerTeamId === homeTeamId ? awayTeamId : homeTeamId,
        );
      }
    }

    if (eliminated.size > 0) {
      await this.prisma.team.updateMany({
        where: { id: { in: [...eliminated] } },
        data: { isEliminated: true },
      });
    }

    return {
      source: "football-data",
      fetched: matches.length,
      created,
      updated,
      failed,
      eliminated: eliminated.size,
    };
  }

  private mapMatch(
    m: FdMatch,
    homeTeamId: string,
    awayTeamId: string,
  ): Prisma.MatchUncheckedCreateInput {
    const winner = m.score?.winner;
    const winnerTeamId =
      winner === "HOME_TEAM"
        ? homeTeamId
        : winner === "AWAY_TEAM"
          ? awayTeamId
          : undefined;
    return {
      homeTeamId,
      awayTeamId,
      kickoffAt: new Date(m.utcDate),
      status: mapStatus(m.status),
      stage: mapStage(m.stage),
      groupName: m.group ?? undefined,
      homeScore: m.score?.fullTime?.home ?? undefined,
      awayScore: m.score?.fullTime?.away ?? undefined,
      winnerTeamId,
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
