import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import {
  login,
  registerFreshPremium,
  registerFreshUser,
  SEED_CREDENTIALS,
} from "./setup/auth.helper";
import { createTestApp } from "./setup/test-app.factory";

const SEED_NEWS_ID = "seed-news-1";
const SEED_TEAM_ID = "seed-team-BRA";
const CRON_SECRET = process.env.CRON_SECRET ?? "test-cron-secret";

describe("AI World Cup Analyst API (e2e)", () => {
  let app: NestFastifyApplication;
  let http: ReturnType<NestFastifyApplication["getHttpServer"]>;
  let adminCookie: string;
  let premiumCookie: string;
  let userCookie: string;
  // Fresh per-run accounts for AI-consuming calls — quota counters live in
  // the never-truncated test DB, so seeded accounts would flake across runs.
  let aiUserCookie: string;
  let aiPremiumCookie: string;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    adminCookie = await login(
      app,
      SEED_CREDENTIALS.admin.email,
      SEED_CREDENTIALS.admin.password,
    );
    premiumCookie = await login(
      app,
      SEED_CREDENTIALS.premium.email,
      SEED_CREDENTIALS.premium.password,
    );
    userCookie = await login(
      app,
      SEED_CREDENTIALS.user.email,
      SEED_CREDENTIALS.user.password,
    );
    aiUserCookie = (await registerFreshUser(app, "ai-user")).cookie;
    aiPremiumCookie = (
      await registerFreshPremium(app, adminCookie, "ai-premium")
    ).cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Guest GET /api/home/highlights -> 200 (public)", async () => {
    const res = await request(http).get("/api/home/highlights");
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(Array.isArray(res.body.data.featuredTeams)).toBe(true);
  });

  it("2. Guest GET /api/matches -> 401", async () => {
    const res = await request(http).get("/api/matches");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("3. Register USER -> 201 success", async () => {
    const email = `user_${Date.now()}@example.com`;
    const res = await request(http)
      .post("/api/auth/register")
      .send({ email, password: "password123", displayName: "New User" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("USER");
    expect(res.body.data.user.email).toBe(email);
  });

  it("4. Login USER -> redirectPath /matches + Set-Cookie", async () => {
    const res = await request(http)
      .post("/api/auth/login")
      .send(SEED_CREDENTIALS.user);
    expect(res.status).toBe(200);
    expect(res.body.data.redirectPath).toBe("/matches");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("5. Login ADMIN -> redirectPath /admin/accounts", async () => {
    const res = await request(http)
      .post("/api/auth/login")
      .send(SEED_CREDENTIALS.admin);
    expect(res.status).toBe(200);
    expect(res.body.data.redirectPath).toBe("/admin/accounts");
  });

  it("6. USER GET /api/admin/users -> 403", async () => {
    const res = await request(http)
      .get("/api/admin/users")
      .set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("7. ADMIN GET /api/admin/users -> 200 (paginated envelope)", async () => {
    const res = await request(http)
      .get("/api/admin/users")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.pagination).toBeDefined();
  });

  it("8. ADMIN GET /api/matches -> 403 (admin blocked from user APIs)", async () => {
    const res = await request(http)
      .get("/api/matches")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(403);
  });

  it("9. USER POST /api/news/:id/translate -> 403", async () => {
    const res = await request(http)
      .post(`/api/news/${SEED_NEWS_ID}/translate`)
      .set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("10. PREMIUM POST /api/news/:id/translate -> 200 (mock)", async () => {
    const res = await request(http)
      .post(`/api/news/${SEED_NEWS_ID}/translate`)
      .set("Cookie", aiPremiumCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.translationStatus).toBe("DONE");
    expect(res.body.data.translatedContentZh).toContain("AI_MOCK_MODE");
  });

  it("11. USER POST /api/champion-predictions/recalculate -> 403", async () => {
    const res = await request(http)
      .post("/api/champion-predictions/recalculate")
      .set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("12. PREMIUM POST /api/champion-predictions/recalculate -> 200", async () => {
    const res = await request(http)
      .post("/api/champion-predictions/recalculate")
      .set("Cookie", aiPremiumCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.runId).toBeDefined();
    expect(["DONE", "RUNNING", "PENDING"]).toContain(res.body.data.status);
    // Mock runs skip the A/B legs → divergence present but not computable,
    // and there is no polish leg either.
    expect(res.body.data.divergence).toMatchObject({ computable: false });
    expect(Array.isArray(res.body.data.divergence.teamDeltas)).toBe(true);
    expect(res.body.data.polishedReport).toBeNull();
  });

  it("13. Wrong cron secret -> 401", async () => {
    const res = await request(http)
      .post("/api/jobs/sync-fixtures")
      .set("x-cron-secret", "wrong-secret");
    expect(res.status).toBe(401);
  });

  it("14. Correct cron secret -> 200 (creates JobRun)", async () => {
    const res = await request(http)
      .post("/api/jobs/sync-fixtures")
      .set("x-cron-secret", CRON_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.jobRunId).toBeDefined();
    expect(res.body.data.status).toBe("DONE");
  });

  it("15. Duplicate favorite does not create a duplicate", async () => {
    // Reset to a known state, then add twice.
    await request(http)
      .delete(`/api/favorites/teams/${SEED_TEAM_ID}`)
      .set("Cookie", premiumCookie);
    await request(http)
      .post(`/api/favorites/teams/${SEED_TEAM_ID}`)
      .set("Cookie", premiumCookie)
      .expect(201);
    await request(http)
      .post(`/api/favorites/teams/${SEED_TEAM_ID}`)
      .set("Cookie", premiumCookie)
      .expect(201);

    const res = await request(http)
      .get("/api/users/me/favorites")
      .set("Cookie", premiumCookie);
    expect(res.status).toBe(200);
    const matching = res.body.data.teams.filter(
      (t: { id: string }) => t.id === SEED_TEAM_ID,
    );
    expect(matching).toHaveLength(1);
  });

  it("Admin cannot use AI chat (NonAdminUserGuard) -> 403", async () => {
    const res = await request(http)
      .post("/api/ai/chat")
      .set("Cookie", adminCookie)
      .send({ question: "誰是奪冠熱門？" });
    expect(res.status).toBe(403);
  });

  it("USER can use AI chat -> 200 (mock)", async () => {
    const res = await request(http)
      .post("/api/ai/chat")
      .set("Cookie", aiUserCookie)
      .send({ question: "目前冠軍預測前三名是誰？" });
    expect(res.status).toBe(201);
    expect(res.body.data.provider).toBe("PROGRAM_RULE");
  });

  it("USER AI chat accepts multi-turn history -> 200 (mock)", async () => {
    const res = await request(http)
      .post("/api/ai/chat")
      .set("Cookie", aiUserCookie)
      .send({
        question: "他狀態如何？",
        history: [
          { role: "user", content: "Mbappé 是誰？" },
          { role: "assistant", content: "他是法國前鋒。" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.provider).toBe("PROGRAM_RULE");
  });

  // ---------------------------------------------------------------------------
  // Match refresh endpoint
  // ---------------------------------------------------------------------------

  it("16. Guest POST /api/matches/:id/refresh -> 401", async () => {
    const res = await request(http).post("/api/matches/seed-match-2/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("17. ADMIN POST /api/matches/:id/refresh -> 403", async () => {
    const res = await request(http)
      .post("/api/matches/seed-match-2/refresh")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("18. USER POST /api/matches/:id/refresh (no API key) -> 201 with SKIPPED_NO_SOURCE", async () => {
    // FOOTBALL_DATA_API_KEY is empty by default in test env — graceful skip.
    const res = await request(http)
      .post("/api/matches/seed-match-2/refresh")
      .set("Cookie", userCookie);
    expect(res.status).toBe(201);
    expect(res.body.error).toBeNull();
    expect(res.body.data.id).toBe("seed-match-2");
    expect(res.body.meta.refresh.status).toBe("SKIPPED_NO_SOURCE");
    expect(res.body.meta.refresh.lastRefreshedAt).not.toBeNull();
    expect(res.body.meta.refresh.nextRefreshAt).not.toBeNull();
  });

  it("19. USER POST immediately again -> 201 SKIPPED_COOLDOWN", async () => {
    // seed-match-2 was refreshed in test 18; cooldown is active.
    const res = await request(http)
      .post("/api/matches/seed-match-2/refresh")
      .set("Cookie", userCookie);
    expect(res.status).toBe(201);
    expect(res.body.error).toBeNull();
    expect(res.body.meta.refresh.status).toBe("SKIPPED_COOLDOWN");
    expect(res.body.data.id).toBe("seed-match-2");
  });

  it("20. PREMIUM POST /api/matches/:id/refresh -> 201", async () => {
    // Use a different match (seed-match-3) to avoid cooldown from tests above.
    const res = await request(http)
      .post("/api/matches/seed-match-3/refresh")
      .set("Cookie", premiumCookie);
    expect(res.status).toBe(201);
    expect(res.body.error).toBeNull();
    expect([
      "UPDATED",
      "SKIPPED_NO_SOURCE",
      "SKIPPED_COOLDOWN",
      "SOURCE_FAILED",
    ]).toContain(res.body.meta.refresh.status);
  });

  it("21. POST /api/matches/nonexistent/refresh -> 404", async () => {
    const res = await request(http)
      .post("/api/matches/nonexistent-match-id/refresh")
      .set("Cookie", userCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  // ---------------------------------------------------------------------------
  // Phase 3 generation jobs + news impact read endpoint
  // ---------------------------------------------------------------------------

  it("24. Cron: generate-news-impact / generate-player-status -> DONE (mock)", async () => {
    const impact = await request(http)
      .post("/api/jobs/generate-news-impact")
      .set("x-cron-secret", CRON_SECRET);
    expect(impact.status).toBe(200);
    expect(impact.body.data.status).toBe("DONE");

    const status = await request(http)
      .post("/api/jobs/generate-player-status")
      .set("x-cron-secret", CRON_SECRET);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe("DONE");
    expect(status.body.data.metadata.scope).toBe("player-status");
  }, 30000);

  it("25. GET /api/news/:id/analysis -> 200 (NEWS_IMPACT report or null)", async () => {
    const res = await request(http)
      .get(`/api/news/${SEED_NEWS_ID}/analysis`)
      .set("Cookie", userCookie);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    if (res.body.data) {
      expect(res.body.data.reportType).toBe("NEWS_IMPACT");
    }
  });

  it("27. Cron: generate-team-ratings -> DONE (mock)", async () => {
    const res = await request(http)
      .post("/api/jobs/generate-team-ratings")
      .set("x-cron-secret", CRON_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("DONE");
    expect(res.body.data.metadata.scope).toBe("teams");
  }, 30000);

  it("26. GET /api/admin/ai-usage: ADMIN -> 200 aggregated stats, USER -> 403", async () => {
    const res = await request(http)
      .get("/api/admin/ai-usage")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.totals.calls).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.data.byTaskType)).toBe(true);
    expect(Array.isArray(res.body.data.byProvider)).toBe(true);
    expect(Array.isArray(res.body.data.byDay)).toBe(true);
    expect(Array.isArray(res.body.data.topUsers)).toBe(true);

    const forbidden = await request(http)
      .get("/api/admin/ai-usage")
      .set("Cookie", userCookie);
    expect(forbidden.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // AI quota (Phase 3) — dedicated fresh users so counts start at zero
  // ---------------------------------------------------------------------------

  it("22. USER exceeding daily general-chat quota -> 429 AI_QUOTA_EXCEEDED", async () => {
    const { cookie } = await registerFreshUser(app, "quota-user");
    for (let i = 0; i < 20; i++) {
      await request(http)
        .post("/api/ai/chat")
        .set("Cookie", cookie)
        .send({ question: `第 ${i + 1} 次提問` })
        .expect(201);
    }
    const res = await request(http)
      .post("/api/ai/chat")
      .set("Cookie", cookie)
      .send({ question: "第 21 次提問" });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("AI_QUOTA_EXCEEDED");
    expect(res.body.error.details).toMatchObject({
      quotaKey: "GENERAL_CHAT",
      limit: 20,
      used: 20,
    });
    expect(res.body.error.details.resetAt).toBeDefined();
  }, 30000);

  it("23. PREMIUM 4th champion recalculate this week -> 429 AI_QUOTA_EXCEEDED", async () => {
    const { cookie } = await registerFreshPremium(app, adminCookie, "quota-premium");
    for (let i = 0; i < 3; i++) {
      await request(http)
        .post("/api/champion-predictions/recalculate")
        .set("Cookie", cookie)
        .expect(200);
    }
    const res = await request(http)
      .post("/api/champion-predictions/recalculate")
      .set("Cookie", cookie);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("AI_QUOTA_EXCEEDED");
    expect(res.body.error.details.quotaKey).toBe("CHAMPION_RECALCULATE");
  }, 30000);

  // ---------------------------------------------------------------------------
  // Admin manual pipeline trigger (§6.2.1)
  // ---------------------------------------------------------------------------

  it("28. Non-admin POST /api/admin/jobs/run -> 403 FORBIDDEN", async () => {
    const res = await request(http)
      .post("/api/admin/jobs/run")
      .set("Cookie", userCookie)
      .send({ pipeline: "SYNC" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("29. ADMIN POST /api/admin/jobs/run -> 202 (background; no keys => jobs skip)", async () => {
    const res = await request(http)
      .post("/api/admin/jobs/run")
      .set("Cookie", adminCookie)
      .send({ jobs: ["SYNC_TEAMS"] });
    expect(res.status).toBe(202);
    expect(res.body.error).toBeNull();
    expect(res.body.data.started).toBe(true);
    expect(res.body.data.label).toBe("manual-custom");
    expect(res.body.data.jobTypes).toEqual(["SYNC_TEAMS"]);
  });

  it("30. GET /api/admin/jobs/runs: ADMIN -> 200 array, USER -> 403", async () => {
    const ok = await request(http)
      .get("/api/admin/jobs/runs?limit=5")
      .set("Cookie", adminCookie);
    expect(ok.status).toBe(200);
    expect(ok.body.error).toBeNull();
    expect(Array.isArray(ok.body.data)).toBe(true);

    const forbidden = await request(http)
      .get("/api/admin/jobs/runs")
      .set("Cookie", userCookie);
    expect(forbidden.status).toBe(403);
  });
});
