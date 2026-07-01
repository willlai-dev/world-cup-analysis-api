import { createHash } from 'node:crypto';

/**
 * Deterministic sha256 of the DB context snapshot used to ground an AI report.
 * Stored on `AiReport.sourceSnapshotHash` so generation jobs can skip an entity
 * whose underlying data hasn't changed since the last successful report.
 */
export function sourceSnapshotHash(context: unknown): string | null {
  if (context === undefined || context === null) {
    return null;
  }
  const text = typeof context === 'string' ? context : JSON.stringify(context);
  return createHash('sha256').update(text).digest('hex');
}
