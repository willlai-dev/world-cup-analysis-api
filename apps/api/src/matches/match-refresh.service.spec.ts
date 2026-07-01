import { NotFoundException } from "@nestjs/common";
import type { AppConfigService } from "../config/app-config.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { MatchSyncService } from "../sources/football-data/match-sync.service";
import { MatchRefreshService, type RefreshMeta } from "./match-refresh.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COOLDOWN_SECONDS = 60;

function makeMatch(
  overrides: Partial<{
    id: string;
    externalId: string | null;
    homeTeamId: string;
    awayTeamId: string;
  }> = {},
) {
  return {
    id: "match-1",
    externalId: "12345",
    homeTeamId: "team-a",
    awayTeamId: "team-b",
    homeTeam: { id: "team-a", nameEn: "Alpha", isEliminated: false },
    awayTeam: { id: "team-b", nameEn: "Beta", isEliminated: false },
    stage: "GROUP",
    groupName: "A",
    stadium: "Seed Stadium",
    kickoffAt: new Date("2026-07-10T18:00:00Z"),
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    sourceUpdatedAt: new Date("2026-07-01T00:00:00Z"),
    winnerTeamId: null,
    events: [],
    ...overrides,
  };
}

function build() {
  const prisma = { match: { findUnique: jest.fn() } };
  const matchSync = { refreshOneMatch: jest.fn() };
  const config = {
    matchRefreshCooldownSeconds: COOLDOWN_SECONDS,
  } as unknown as AppConfigService;

  const service = new MatchRefreshService(
    prisma as unknown as PrismaService,
    matchSync as unknown as MatchSyncService,
    config,
  );

  return { service, prisma, matchSync };
}

/** Typed accessor to avoid `unknown` cast noise in every test. */
function getMeta(result: { meta: Record<string, unknown> }): RefreshMeta {
  return result.meta.refresh as RefreshMeta;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MatchRefreshService", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("throws NotFoundException when match does not exist", async () => {
    const { service, prisma } = build();
    prisma.match.findUnique.mockResolvedValue(null);

    await expect(service.refresh("nonexistent")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("returns SKIPPED_NO_SOURCE when matchSync says no source (no API key)", async () => {
    const { service, prisma, matchSync } = build();
    prisma.match.findUnique.mockResolvedValue(makeMatch());
    matchSync.refreshOneMatch.mockResolvedValue({
      refreshed: false,
      sourceFailed: false,
      reason: "FOOTBALL_DATA_API_KEY not configured",
    });

    const result = await service.refresh("match-1");

    expect(getMeta(result).status).toBe("SKIPPED_NO_SOURCE");
    expect(getMeta(result).reason).toBe("FOOTBALL_DATA_API_KEY not configured");
    expect(result.data.id).toBe("match-1");
  });

  it("returns SKIPPED_NO_SOURCE when match has no externalId", async () => {
    const { service, prisma, matchSync } = build();
    prisma.match.findUnique.mockResolvedValue(makeMatch({ externalId: null }));
    matchSync.refreshOneMatch.mockResolvedValue({
      refreshed: false,
      sourceFailed: false,
      reason: "match has no externalId",
    });

    const result = await service.refresh("match-1");

    expect(getMeta(result).status).toBe("SKIPPED_NO_SOURCE");
  });

  it("returns SOURCE_FAILED when the source call throws", async () => {
    const { service, prisma, matchSync } = build();
    prisma.match.findUnique.mockResolvedValue(makeMatch());
    matchSync.refreshOneMatch.mockResolvedValue({
      refreshed: false,
      sourceFailed: true,
      reason: "HTTP 503: Service Unavailable",
    });

    const result = await service.refresh("match-1");

    expect(getMeta(result).status).toBe("SOURCE_FAILED");
    expect(getMeta(result).reason).toContain("503");
  });

  it("returns UPDATED and reloads the match on successful refresh", async () => {
    const { service, prisma, matchSync } = build();
    const fresh = makeMatch({ externalId: "12345" });
    // first call: load original; second call: reload after update
    prisma.match.findUnique
      .mockResolvedValueOnce(fresh)
      .mockResolvedValueOnce({
        ...fresh,
        status: "LIVE",
        homeScore: 1,
        awayScore: 0,
      });
    matchSync.refreshOneMatch.mockResolvedValue({ refreshed: true });

    const result = await service.refresh("match-1");

    expect(getMeta(result).status).toBe("UPDATED");
    expect(result.data.status).toBe("LIVE");
    expect(result.data.homeScore).toBe(1);
    expect(matchSync.refreshOneMatch).toHaveBeenCalledWith({
      dbId: "match-1",
      externalId: "12345",
      homeTeamId: "team-a",
      awayTeamId: "team-b",
    });
  });

  it("returns SKIPPED_COOLDOWN within cooldown window and does NOT call source", async () => {
    const { service, prisma, matchSync } = build();
    prisma.match.findUnique.mockResolvedValue(makeMatch());
    matchSync.refreshOneMatch.mockResolvedValue({ refreshed: true });

    // First call — sets cooldown; reload after update uses the same mock
    prisma.match.findUnique.mockResolvedValue(makeMatch());
    await service.refresh("match-1");
    // Second call — still within 60 s cooldown
    jest.advanceTimersByTime(10_000);
    const result = await service.refresh("match-1");

    expect(getMeta(result).status).toBe("SKIPPED_COOLDOWN");
    // matchSync called only once (for the first call)
    expect(matchSync.refreshOneMatch).toHaveBeenCalledTimes(1);
  });

  it("hits the source again after the cooldown expires", async () => {
    const { service, prisma, matchSync } = build();
    prisma.match.findUnique.mockResolvedValue(makeMatch());
    matchSync.refreshOneMatch.mockResolvedValue({ refreshed: true });

    await service.refresh("match-1");
    jest.advanceTimersByTime(COOLDOWN_SECONDS * 1000 + 1);
    await service.refresh("match-1");

    expect(matchSync.refreshOneMatch).toHaveBeenCalledTimes(2);
  });

  it("returns nextRefreshAt that is cooldown seconds after lastRefreshedAt", async () => {
    const { service, prisma, matchSync } = build();
    prisma.match.findUnique.mockResolvedValue(makeMatch());
    matchSync.refreshOneMatch.mockResolvedValue({
      refreshed: false,
      sourceFailed: false,
      reason: "no key",
    });

    const before = Date.now();
    const result = await service.refresh("match-1");
    const after = Date.now();

    const meta = getMeta(result);
    const lastMs = new Date(meta.lastRefreshedAt!).getTime();
    const nextMs = new Date(meta.nextRefreshAt!).getTime();
    expect(nextMs - lastMs).toBe(COOLDOWN_SECONDS * 1000);
    expect(lastMs).toBeGreaterThanOrEqual(before);
    expect(lastMs).toBeLessThanOrEqual(after);
  });

  it("deduplicates concurrent refresh calls for the same match", async () => {
    const { service, prisma, matchSync } = build();
    prisma.match.findUnique.mockResolvedValue(makeMatch());
    let resolveRefresh!: () => void;
    const blocker = new Promise<void>((res) => {
      resolveRefresh = res;
    });
    matchSync.refreshOneMatch.mockReturnValue(
      blocker.then(() => ({ refreshed: true })),
    );

    const p1 = service.refresh("match-1");
    const p2 = service.refresh("match-1");
    expect(p1).toBe(p2); // same promise

    resolveRefresh();
    await Promise.all([p1, p2]);
    expect(matchSync.refreshOneMatch).toHaveBeenCalledTimes(1);
  });
});
