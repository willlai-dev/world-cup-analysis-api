import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

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
