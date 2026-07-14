import { createHash } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AuthTokenPurpose } from "@prisma/client";
import request from "supertest";
import { IpRateLimitGuard } from "../src/common/guards/ip-rate-limit.guard";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  getFakeMailbox,
  login,
  registerFreshPremium,
  registerFreshUser,
  SEED_CREDENTIALS,
  verifyEmailFromMailbox,
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

  it("8. ADMIN GET /api/matches -> 200 (admin is a feature superuser)", async () => {
    const res = await request(http)
      .get("/api/matches")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.pagination).toBeDefined();
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

  it("Admin can use AI chat (feature superuser) -> 201 (mock)", async () => {
    const res = await request(http)
      .post("/api/ai/chat")
      .set("Cookie", adminCookie)
      .send({ question: "誰是奪冠熱門？" });
    expect(res.status).toBe(201);
    expect(res.body.data.provider).toBe("PROGRAM_RULE");
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

  it("17. ADMIN POST /api/matches/:id/refresh -> 201 (admin is a feature superuser)", async () => {
    // Uses seed-match-6 so it does not touch the seed-match-2 cooldown state
    // exercised by tests 18/19. No API key in test env => graceful skip.
    const res = await request(http)
      .post("/api/matches/seed-match-6/refresh")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(201);
    expect(res.body.error).toBeNull();
    expect(res.body.data.id).toBe("seed-match-6");
    expect(res.body.meta.refresh.status).toBe("SKIPPED_NO_SOURCE");
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

  // ---------------------------------------------------------------------------
  // Per-country manual trigger (§6.2.1 run-team)
  // ---------------------------------------------------------------------------

  it("31. Non-admin POST /api/admin/jobs/run-team/:id -> 403 FORBIDDEN", async () => {
    const res = await request(http)
      .post(`/api/admin/jobs/run-team/${SEED_TEAM_ID}`)
      .set("Cookie", userCookie)
      .send({ sync: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("32. ADMIN POST run-team for unknown team -> 404 NOT_FOUND", async () => {
    const res = await request(http)
      .post("/api/admin/jobs/run-team/does-not-exist")
      .set("Cookie", adminCookie)
      .send({ sync: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("33. ADMIN POST run-team -> 202 (scoped background, sync:false)", async () => {
    const res = await request(http)
      .post(`/api/admin/jobs/run-team/${SEED_TEAM_ID}`)
      .set("Cookie", adminCookie)
      .send({ sync: false });
    expect(res.status).toBe(202);
    expect(res.body.error).toBeNull();
    expect(res.body.data.started).toBe(true);
    expect(res.body.data.teamId).toBe(SEED_TEAM_ID);
    // sync:false drops SYNC_PLAYERS; player ratings run before the team rating.
    expect(res.body.data.jobTypes).toEqual([
      "GENERATE_PLAYER_RATINGS",
      "GENERATE_TEAM_RATINGS",
      "GENERATE_PLAYER_STATUS",
    ]);
  });

  // ---------------------------------------------------------------------------
  // Email verification & password reset
  // ---------------------------------------------------------------------------

  describe("Email verification & password reset", () => {
    let prisma: PrismaService;

    const emailHash = (email: string): string =>
      createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

    /** Registers without completing verification; the mail stays in the fake box. */
    const registerUnverified = async (label: string) => {
      const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
      const password = "password123";
      const res = await request(http)
        .post("/api/auth/register")
        .send({ email, password, displayName: label });
      expect(res.status).toBe(201);
      expect(res.body.data.requiresEmailVerification).toBe(true);
      expect(res.body.data.user.emailVerified).toBe(false);
      return { email, password, userId: res.body.data.user.id as string };
    };

    /** Clears the per-email send bookkeeping so cooldown/daily caps reset. */
    const clearSendLimits = async (email: string) => {
      await prisma.emailSendRequest.deleteMany({ where: { emailHash: emailHash(email) } });
    };

    beforeAll(() => {
      prisma = app.get(PrismaService);
    });

    beforeEach(() => {
      // Keep the per-IP limiter out of the way — it has its own test below.
      app.get(IpRateLimitGuard).reset();
    });

    it("34. unverified login -> 403 EMAIL_NOT_VERIFIED, no cookie issued", async () => {
      const { email, password } = await registerUnverified("unverified-login");
      const res = await request(http).post("/api/auth/login").send({ email, password });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("35. verify-email happy path: mail token verifies once, then login works", async () => {
      const { email, password } = await registerUnverified("verify-happy");
      const token = getFakeMailbox(app).extractLastToken(email);
      expect(token).toBeDefined();

      const ok = await request(http).post("/api/auth/verify-email").send({ token });
      expect(ok.status).toBe(200);
      expect(ok.body.data.success).toBe(true);

      const loginRes = await request(http).post("/api/auth/login").send({ email, password });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.user.emailVerified).toBe(true);

      // Single use: replaying the same token is rejected.
      const replay = await request(http).post("/api/auth/verify-email").send({ token });
      expect(replay.status).toBe(400);
      expect(replay.body.error.code).toBe("EMAIL_VERIFICATION_TOKEN_INVALID");
    });

    it("36. verify-email with a garbage token -> 400 EMAIL_VERIFICATION_TOKEN_INVALID", async () => {
      const res = await request(http)
        .post("/api/auth/verify-email")
        .send({ token: "x".repeat(43) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("EMAIL_VERIFICATION_TOKEN_INVALID");
    });

    it("37. expired verification token -> 400 EMAIL_VERIFICATION_TOKEN_EXPIRED", async () => {
      const { email, userId } = await registerUnverified("verify-expired");
      const token = getFakeMailbox(app).extractLastToken(email);
      await prisma.authToken.updateMany({
        where: { userId, purpose: AuthTokenPurpose.EMAIL_VERIFICATION },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await request(http).post("/api/auth/verify-email").send({ token });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("EMAIL_VERIFICATION_TOKEN_EXPIRED");
    });

    it("38. duplicate registration: verified -> 409; unverified -> re-enter verification", async () => {
      const verified = await registerFreshUser(app, "dup-verified");
      const dupVerified = await request(http)
        .post("/api/auth/register")
        .send({ email: verified.email, password: "password123", displayName: "Dup" });
      expect(dupVerified.status).toBe(409);
      expect(dupVerified.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");

      const pending = await registerUnverified("dup-unverified");
      const dupPending = await request(http)
        .post("/api/auth/register")
        .send({ email: pending.email, password: "other-password", displayName: "Dup2" });
      expect(dupPending.status).toBe(201);
      expect(dupPending.body.data.requiresEmailVerification).toBe(true);
      // No duplicate account was created.
      expect(dupPending.body.data.user.id).toBe(pending.userId);
    });

    it("39. resend inside the 60s cooldown -> 429 EMAIL_SEND_COOLDOWN", async () => {
      const { email } = await registerUnverified("resend-cooldown");
      const res = await request(http).post("/api/auth/resend-verification").send({ email });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("EMAIL_SEND_COOLDOWN");
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("40. resend invalidates the previous verification token", async () => {
      const { email } = await registerUnverified("resend-invalidate");
      const oldToken = getFakeMailbox(app).extractLastToken(email);
      await clearSendLimits(email);

      const resend = await request(http).post("/api/auth/resend-verification").send({ email });
      expect(resend.status).toBe(200);
      const newToken = getFakeMailbox(app).extractLastToken(email);
      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(oldToken);

      const oldAttempt = await request(http)
        .post("/api/auth/verify-email")
        .send({ token: oldToken });
      expect(oldAttempt.status).toBe(400);
      expect(oldAttempt.body.error.code).toBe("EMAIL_VERIFICATION_TOKEN_INVALID");

      const newAttempt = await request(http)
        .post("/api/auth/verify-email")
        .send({ token: newToken });
      expect(newAttempt.status).toBe(200);
    });

    it("41. 24h daily cap -> 429 EMAIL_DAILY_LIMIT_EXCEEDED", async () => {
      const { email } = await registerUnverified("daily-cap");
      // Backfill 4 extra sends (register already logged one) spread outside the
      // cooldown window so the daily cap — not the cooldown — is what triggers.
      await prisma.emailSendRequest.updateMany({
        where: { emailHash: emailHash(email) },
        data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      });
      await prisma.emailSendRequest.createMany({
        data: [3, 4, 5, 6].map((h) => ({
          emailHash: emailHash(email),
          purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
          createdAt: new Date(Date.now() - h * 60 * 60 * 1000),
        })),
      });
      const res = await request(http).post("/api/auth/resend-verification").send({ email });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("EMAIL_DAILY_LIMIT_EXCEEDED");
      expect(res.body.error.details.resetAt).toBeDefined();
    });

    it("42. resend for an already-verified account -> 409 EMAIL_ALREADY_VERIFIED", async () => {
      const { email } = await registerFreshUser(app, "resend-verified");
      await clearSendLimits(email);
      const res = await request(http).post("/api/auth/resend-verification").send({ email });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EMAIL_ALREADY_VERIFIED");
      // The 409 must not burn cooldown quota — an immediate retry stays 409, not 429.
      const again = await request(http).post("/api/auth/resend-verification").send({ email });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("EMAIL_ALREADY_VERIFIED");
    });

    it("43. forgot-password never reveals whether the email exists", async () => {
      // The test DB is never truncated — drop leftovers from earlier runs first.
      await clearSendLimits(SEED_CREDENTIALS.user.email);
      const known = await request(http)
        .post("/api/auth/forgot-password")
        .send({ email: SEED_CREDENTIALS.user.email });
      const unknown = await request(http)
        .post("/api/auth/forgot-password")
        .send({ email: `ghost-${Date.now()}@example.com` });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual(known.body);
      // Cleanup so later suite runs aren't rate limited for the seed user.
      await clearSendLimits(SEED_CREDENTIALS.user.email);
    });

    it("44. full reset flow: new password works, sessions revoked, notice sent", async () => {
      const { cookie, email, password } = await registerFreshUser(app, "reset-flow");

      const forgot = await request(http).post("/api/auth/forgot-password").send({ email });
      expect(forgot.status).toBe(200);
      const token = getFakeMailbox(app).extractLastToken(email);
      expect(token).toBeDefined();

      // Mismatched confirmation is rejected before anything changes.
      const mismatch = await request(http)
        .post("/api/auth/reset-password")
        .send({ token, newPassword: "newpassword456", confirmPassword: "different456" });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.error.code).toBe("PASSWORD_MISMATCH");

      const reset = await request(http)
        .post("/api/auth/reset-password")
        .send({ token, newPassword: "newpassword456", confirmPassword: "newpassword456" });
      expect(reset.status).toBe(200);

      // Every pre-reset session is revoked (tokenVersion bump) …
      const revoked = await request(http).get("/api/auth/me").set("Cookie", cookie);
      expect(revoked.status).toBe(401);
      // … the old password no longer works …
      const oldLogin = await request(http).post("/api/auth/login").send({ email, password });
      expect(oldLogin.status).toBe(401);
      // … the new one does (reset itself never auto-logs-in).
      expect(reset.headers["set-cookie"]).toBeUndefined();
      const newLogin = await request(http)
        .post("/api/auth/login")
        .send({ email, password: "newpassword456" });
      expect(newLogin.status).toBe(200);

      // A "password changed" notice went out.
      const mails = getFakeMailbox(app).mailsTo(email);
      expect(mails.at(-1)?.subject).toContain("密碼已變更");

      // Reusing the consumed token is rejected.
      const reuse = await request(http)
        .post("/api/auth/reset-password")
        .send({ token, newPassword: "another-pass789", confirmPassword: "another-pass789" });
      expect(reuse.status).toBe(400);
      expect(reuse.body.error.code).toBe("PASSWORD_RESET_TOKEN_USED");
    });

    it("45. a newer reset link invalidates the previous one", async () => {
      const { email } = await registerFreshUser(app, "reset-supersede");

      await request(http).post("/api/auth/forgot-password").send({ email }).expect(200);
      const oldToken = getFakeMailbox(app).extractLastToken(email);
      await clearSendLimits(email);
      await request(http).post("/api/auth/forgot-password").send({ email }).expect(200);
      const newToken = getFakeMailbox(app).extractLastToken(email);
      expect(newToken).not.toBe(oldToken);

      const oldAttempt = await request(http)
        .post("/api/auth/reset-password")
        .send({ token: oldToken, newPassword: "newpassword456", confirmPassword: "newpassword456" });
      expect(oldAttempt.status).toBe(400);
      expect(oldAttempt.body.error.code).toBe("PASSWORD_RESET_TOKEN_INVALID");

      const newAttempt = await request(http)
        .post("/api/auth/reset-password")
        .send({ token: newToken, newPassword: "newpassword456", confirmPassword: "newpassword456" });
      expect(newAttempt.status).toBe(200);
    });

    it("46. expired reset token -> 400 PASSWORD_RESET_TOKEN_EXPIRED", async () => {
      const { email, userId } = await registerFreshUser(app, "reset-expired");
      await request(http).post("/api/auth/forgot-password").send({ email }).expect(200);
      const token = getFakeMailbox(app).extractLastToken(email);
      await prisma.authToken.updateMany({
        where: { userId, purpose: AuthTokenPurpose.PASSWORD_RESET },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await request(http)
        .post("/api/auth/reset-password")
        .send({ token, newPassword: "newpassword456", confirmPassword: "newpassword456" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PASSWORD_RESET_TOKEN_EXPIRED");
    });

    it("47. per-IP rate limit on token/mail endpoints -> 429 TOO_MANY_REQUESTS", async () => {
      for (let i = 0; i < 20; i++) {
        await request(http)
          .post("/api/auth/verify-email")
          .send({ token: "y".repeat(43) })
          .expect(400);
      }
      const res = await request(http)
        .post("/api/auth/verify-email")
        .send({ token: "y".repeat(43) });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
    }, 30000);
  });
});
