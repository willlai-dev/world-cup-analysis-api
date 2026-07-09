/** Summary every sync service returns; stored verbatim in `JobRun.metadata`. */
export type SyncResult = {
  source: string;
  /** true when skipped because the source's API key is not configured. */
  skipped?: boolean;
  reason?: string;
  fetched?: number;
  created?: number;
  updated?: number;
  failed?: number;
  /** Teams newly marked eliminated this run (match sync recompute). */
  eliminated?: number;
  /** Teams whose stale eliminated flag was cleared this run (match sync recompute). */
  reinstated?: number;
};
