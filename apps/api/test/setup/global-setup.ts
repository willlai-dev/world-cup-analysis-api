import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadTestEnv } from './load-test-env';

/**
 * Prepares a dedicated test database (footy_predict_test):
 *  1. create it if missing (npustSpcsAdmin has CREATEDB; it then owns the DB),
 *  2. apply migrations,
 *  3. seed deterministic fixtures (idempotent upserts — safe to re-run).
 */
export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  const testUrl = process.env.DATABASE_URL;
  if (!testUrl) {
    throw new Error('DATABASE_URL not set for e2e (check apps/api/.env.test)');
  }

  const dbName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ''));
  await ensureDatabase(testUrl, dbName);

  const apiDir = resolve(__dirname, '../..');
  const childEnv = { ...process.env, DATABASE_URL: testUrl };
  execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, env: childEnv, stdio: 'inherit' });
  execSync('node scripts/patch-prisma-client.cjs', { cwd: apiDir, env: childEnv, stdio: 'inherit' });
  execSync('pnpm exec prisma db seed', { cwd: apiDir, env: childEnv, stdio: 'inherit' });
}

async function ensureDatabase(testUrl: string, dbName: string): Promise<void> {
  const client = await connectMaintenance(testUrl);
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      // Identifier can't be parameterized; dbName comes from our own .env.test.
      await client.query(`CREATE DATABASE "${dbName}"`);
      // eslint-disable-next-line no-console
      console.log(`[e2e] created database ${dbName}`);
    }
  } finally {
    await client.end();
  }
}

/** Connects to a maintenance DB to manage the test DB; tries postgres then the dev DB. */
async function connectMaintenance(testUrl: string): Promise<Client> {
  const candidates = ['postgres', 'footy_predict_dev'];
  let lastError: unknown;
  for (const name of candidates) {
    const url = new URL(testUrl);
    url.pathname = `/${name}`;
    const client = new Client({ connectionString: url.toString() });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
    }
  }
  throw new Error(`Could not connect to a maintenance database: ${String(lastError)}`);
}
