import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { Paginated } from "../common/dto/api-response.types";
import { AppConfigService } from "../config/app-config.service";
import { toMatchSummary } from "../mappers";
import { PrismaService } from "../prisma/prisma.service";
import { MatchSyncService } from "../sources/football-data/match-sync.service";
import type { MatchDetailDto, MatchEventDto } from "./matches.service";

const matchDetailInclude = {
  homeTeam: true,
  awayTeam: true,
  events: { orderBy: [{ minute: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.MatchInclude;

/** Status of this refresh attempt, surfaced to the frontend via meta.refresh. */
export type RefreshStatus =
  | "UPDATED" // Source was fetched; DB fields updated.
  | "SKIPPED_COOLDOWN" // Still within cooldown window — no external call made.
  | "SKIPPED_NO_SOURCE" // No API key or match has no externalId — no external call made.
  | "SOURCE_FAILED"; // Had key + externalId, but source returned an error.

export type RefreshMeta = {
  /** Outcome of this refresh call. */
  status: RefreshStatus;
  /**
   * ISO timestamp of the last time the backend actually attempted a source
   * fetch for this match (within the current server process lifetime).
   * Null if this match has never been refreshed in this session.
   */
  lastRefreshedAt: string | null;
  /** ISO timestamp of when the cooldown expires (null if no recent fetch). */
  nextRefreshAt: string | null;
  /** Human-readable explanation for SKIPPED_* and SOURCE_FAILED. */
  reason?: string;
};

@Injectable()
export class MatchRefreshService {
  /**
   * In-memory cooldown: matchId → ms timestamp of last source-fetch attempt.
   * Resets on server restart — intentional; prevents hammering external API.
   */
  private readonly lastFetchedAt = new Map<string, number>();

  /**
   * In-memory in-flight dedup: matchId → Promise for an ongoing refresh.
   * Concurrent requests for the same match share one Promise so the source
   * is called at most once.
   */
  private readonly inFlight = new Map<
    string,
    Promise<Paginated<MatchDetailDto>>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchSync: MatchSyncService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Refresh a single match and return the latest match detail.
   * Handles cooldown + concurrent-request dedup before hitting the source.
   * Throws NotFoundException (404) if matchId does not exist.
   */
  refresh(matchId: string): Promise<Paginated<MatchDetailDto>> {
    const existing = this.inFlight.get(matchId);
    if (existing) return existing;

    const promise = this.doRefresh(matchId).finally(() => {
      this.inFlight.delete(matchId);
    });
    this.inFlight.set(matchId, promise);
    return promise;
  }

  private async doRefresh(matchId: string): Promise<Paginated<MatchDetailDto>> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: matchDetailInclude,
    });
    if (!match) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Match not found",
      });
    }

    const cooldownMs = this.config.matchRefreshCooldownSeconds * 1000;
    const last = this.lastFetchedAt.get(matchId);
    const now = Date.now();

    if (last !== undefined && now - last < cooldownMs) {
      const meta: RefreshMeta = {
        status: "SKIPPED_COOLDOWN",
        lastRefreshedAt: new Date(last).toISOString(),
        nextRefreshAt: new Date(last + cooldownMs).toISOString(),
      };
      return new Paginated(this.toDetail(match), { refresh: meta });
    }

    // Record the fetch attempt time before calling the source so that concurrent
    // requests racing past the in-flight check also see the cooldown.
    this.lastFetchedAt.set(matchId, now);

    const result = await this.matchSync.refreshOneMatch({
      dbId: match.id,
      externalId: match.externalId,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
    });

    const lastRefreshedAt = new Date(now).toISOString();
    const nextRefreshAt = new Date(now + cooldownMs).toISOString();

    if (result.refreshed) {
      const updated = await this.prisma.match.findUnique({
        where: { id: matchId },
        include: matchDetailInclude,
      });
      const meta: RefreshMeta = {
        status: "UPDATED",
        lastRefreshedAt,
        nextRefreshAt,
      };
      return new Paginated(this.toDetail(updated!), { refresh: meta });
    }

    const meta: RefreshMeta = {
      status: result.sourceFailed ? "SOURCE_FAILED" : "SKIPPED_NO_SOURCE",
      lastRefreshedAt,
      nextRefreshAt,
      reason: result.reason,
    };
    return new Paginated(this.toDetail(match), { refresh: meta });
  }

  private toDetail(
    match: Prisma.MatchGetPayload<{ include: typeof matchDetailInclude }>,
  ): MatchDetailDto {
    const events: MatchEventDto[] = match.events.map((e) => ({
      id: e.id,
      minute: e.minute,
      extraMinute: e.extraMinute,
      eventType: e.eventType,
      teamId: e.teamId,
      playerId: e.playerId,
      description: e.description,
    }));
    return { ...toMatchSummary(match), events };
  }
}
