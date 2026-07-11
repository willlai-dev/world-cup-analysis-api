/** Summary every AI-generation job returns; stored in `JobRun.metadata`. */
export type GenerationResult = {
  scope: string;
  /** Entities considered this run (after the per-run cap). */
  scanned: number;
  /** Reports newly generated (or regenerated). */
  generated: number;
  /** Skipped because an up-to-date report already existed. */
  skipped: number;
  /** Entities whose generation failed. */
  failed: number;
  /** Entities deleted by a relevance/cleanup gate (news classification). */
  removed?: number;
};

/** Bound a single generation run so a cron job never runs unboundedly. */
export const MAX_GENERATIONS_PER_RUN = 200;
