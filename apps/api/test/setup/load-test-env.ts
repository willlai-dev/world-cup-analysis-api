import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads apps/api/.env.test into process.env and forces NODE_ENV=test.
 * A tiny parser avoids depending on dotenv directly. Used by both the jest
 * globalSetup (main process) and setupFiles (worker process).
 */
export function loadTestEnv(): void {
  process.env.NODE_ENV = 'test';
  const path = resolve(__dirname, '../../.env.test');
  try {
    const content = readFileSync(path, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const eq = line.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      process.env[key] = value;
    }
  } catch {
    // .env.test missing — rely on whatever is already in the environment.
  }
}
