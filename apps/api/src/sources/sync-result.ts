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
  /** Teams marked eliminated this run (match sync, knockout losers). */
  eliminated?: number;
};
