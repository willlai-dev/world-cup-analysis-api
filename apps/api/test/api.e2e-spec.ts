import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { login, SEED_CREDENTIALS } from './setup/auth.helper';
import { createTestApp } from './setup/test-app.factory';

const SEED_NEWS_ID = 'seed-news-1';
const SEED_TEAM_ID = 'seed-team-BRA';
const CRON_SECRET = process.env.CRON_SECRET ?? 'test-cron-secret';

describe('AI World Cup Analyst API (e2e)', () => {
  let app: NestFastifyApplication;
  let http: ReturnType<NestFastifyApplication['getHttpServer']>;
  let adminCookie: string;
  let premiumCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    adminCookie = await login(app, SEED_CREDENTIALS.admin.email, SEED_CREDENTIALS.admin.password);
    premiumCookie = await login(
      app,
      SEED_CREDENTIALS.premium.email,
      SEED_CREDENTIALS.premium.password,
    );
    userCookie = await login(app, SEED_CREDENTIALS.user.email, SEED_CREDENTIALS.user.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Guest GET /api/home/highlights -> 200 (public)', async () => {
    const res = await request(http).get('/api/home/highlights');
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(Array.isArray(res.body.data.featuredTeams)).toBe(true);
  });

  it('2. Guest GET /api/matches -> 401', async () => {
    const res = await request(http).get('/api/matches');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('3. Register USER -> 201 success', async () => {
    const email = `user_${Date.now()}@example.com`;
    const res = await request(http)
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'New User' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('USER');
    expect(res.body.data.user.email).toBe(email);
  });

  it('4. Login USER -> redirectPath /matches + Set-Cookie', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send(SEED_CREDENTIALS.user);
    expect(res.status).toBe(200);
    expect(res.body.data.redirectPath).toBe('/matches');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('5. Login ADMIN -> redirectPath /admin/accounts', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send(SEED_CREDENTIALS.admin);
    expect(res.status).toBe(200);
    expect(res.body.data.redirectPath).toBe('/admin/accounts');
  });

  it('6. USER GET /api/admin/users -> 403', async () => {
    const res = await request(http).get('/api/admin/users').set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  it('7. ADMIN GET /api/admin/users -> 200 (paginated envelope)', async () => {
    const res = await request(http).get('/api/admin/users').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.pagination).toBeDefined();
  });

  it('8. ADMIN GET /api/matches -> 403 (admin blocked from user APIs)', async () => {
    const res = await request(http).get('/api/matches').set('Cookie', adminCookie);
    expect(res.status).toBe(403);
  });

  it('9. USER POST /api/news/:id/translate -> 403', async () => {
    const res = await request(http)
      .post(`/api/news/${SEED_NEWS_ID}/translate`)
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  it('10. PREMIUM POST /api/news/:id/translate -> 200 (mock)', async () => {
    const res = await request(http)
      .post(`/api/news/${SEED_NEWS_ID}/translate`)
      .set('Cookie', premiumCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.translationStatus).toBe('DONE');
    expect(res.body.data.translatedContentZh).toContain('AI_MOCK_MODE');
  });

  it('11. USER POST /api/champion-predictions/recalculate -> 403', async () => {
    const res = await request(http)
      .post('/api/champion-predictions/recalculate')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });

  it('12. PREMIUM POST /api/champion-predictions/recalculate -> 200', async () => {
    const res = await request(http)
      .post('/api/champion-predictions/recalculate')
      .set('Cookie', premiumCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.runId).toBeDefined();
    expect(['DONE', 'RUNNING', 'PENDING']).toContain(res.body.data.status);
  });

  it('13. Wrong cron secret -> 401', async () => {
    const res = await request(http)
      .post('/api/jobs/sync-fixtures')
      .set('x-cron-secret', 'wrong-secret');
    expect(res.status).toBe(401);
  });

  it('14. Correct cron secret -> 200 (creates JobRun)', async () => {
    const res = await request(http)
      .post('/api/jobs/sync-fixtures')
      .set('x-cron-secret', CRON_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.jobRunId).toBeDefined();
    expect(res.body.data.status).toBe('DONE');
  });

  it('15. Duplicate favorite does not create a duplicate', async () => {
    // Reset to a known state, then add twice.
    await request(http)
      .delete(`/api/favorites/teams/${SEED_TEAM_ID}`)
      .set('Cookie', premiumCookie);
    await request(http)
      .post(`/api/favorites/teams/${SEED_TEAM_ID}`)
      .set('Cookie', premiumCookie)
      .expect(201);
    await request(http)
      .post(`/api/favorites/teams/${SEED_TEAM_ID}`)
      .set('Cookie', premiumCookie)
      .expect(201);

    const res = await request(http)
      .get('/api/users/me/favorites')
      .set('Cookie', premiumCookie);
    expect(res.status).toBe(200);
    const matching = res.body.data.teams.filter(
      (t: { id: string }) => t.id === SEED_TEAM_ID,
    );
    expect(matching).toHaveLength(1);
  });

  it('Admin cannot use AI chat (NonAdminUserGuard) -> 403', async () => {
    const res = await request(http)
      .post('/api/ai/chat')
      .set('Cookie', adminCookie)
      .send({ question: '誰是奪冠熱門？' });
    expect(res.status).toBe(403);
  });

  it('USER can use AI chat -> 200 (mock)', async () => {
    const res = await request(http)
      .post('/api/ai/chat')
      .set('Cookie', userCookie)
      .send({ question: '目前冠軍預測前三名是誰？' });
    expect(res.status).toBe(201);
    expect(res.body.data.provider).toBe('PROGRAM_RULE');
  });
});
