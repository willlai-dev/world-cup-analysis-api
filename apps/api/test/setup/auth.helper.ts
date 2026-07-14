import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { MAIL_PROVIDER } from '../../src/mail/mail.types';
import type { FakeMailProvider } from '../../src/mail/providers/fake.provider';

/** Logs in and returns the Set-Cookie value to replay on subsequent requests. */
export async function login(
  app: NestFastifyApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) {
    throw new Error(`no Set-Cookie returned for ${email}`);
  }
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

export const SEED_CREDENTIALS = {
  admin: { email: 'admin@example.com', password: 'admin123456' },
  premium: { email: 'premium@example.com', password: 'premium123456' },
  user: { email: 'user@example.com', password: 'user123456' },
};

/** The fake mail provider instance backing the app (NODE_ENV=test forces it). */
export function getFakeMailbox(app: NestFastifyApplication): FakeMailProvider {
  return app.get<FakeMailProvider>(MAIL_PROVIDER);
}

/** Completes email verification using the token captured by the fake mailbox. */
export async function verifyEmailFromMailbox(
  app: NestFastifyApplication,
  email: string,
): Promise<void> {
  const token = getFakeMailbox(app).extractLastToken(email);
  if (!token) {
    throw new Error(`no verification token captured for ${email}`);
  }
  const res = await request(app.getHttpServer())
    .post('/api/auth/verify-email')
    .send({ token });
  if (res.status !== 200) {
    throw new Error(`verify failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/**
 * Registers a brand-new user (unique email per run), completes the email
 * verification flow via the fake mailbox, and returns its cookie.
 * The test DB is never truncated, so per-user quota counters (AiUsageLog /
 * ChampionPredictionRun) accumulate across runs — every AI-consuming test
 * must use a fresh user instead of the seeded accounts.
 */
export async function registerFreshUser(
  app: NestFastifyApplication,
  label: string,
): Promise<{ cookie: string; userId: string; email: string; password: string }> {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = 'password123';
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password, displayName: label });
  if (res.status !== 201) {
    throw new Error(`register failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const userId: string = res.body.data.user.id;
  await verifyEmailFromMailbox(app, email);
  const cookie = await login(app, email, password);
  return { cookie, userId, email, password };
}

/** Registers a fresh user and promotes it to PREMIUM via the admin API. */
export async function registerFreshPremium(
  app: NestFastifyApplication,
  adminCookie: string,
  label: string,
): Promise<{ cookie: string; userId: string }> {
  const fresh = await registerFreshUser(app, label);
  const res = await request(app.getHttpServer())
    .patch(`/api/admin/users/${fresh.userId}/role`)
    .set('Cookie', adminCookie)
    .send({ role: 'PREMIUM' });
  if (res.status !== 200) {
    throw new Error(`promote failed for ${fresh.userId}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return fresh;
}
