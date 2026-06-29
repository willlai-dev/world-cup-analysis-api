/**
 * No-op teardown. The test database is left in place (seed is idempotent, so
 * re-running globalSetup is safe) for inspection between runs.
 */
export default async function globalTeardown(): Promise<void> {
  // intentionally empty
}
