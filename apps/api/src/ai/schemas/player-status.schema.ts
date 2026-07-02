import { z } from 'zod';

/**
 * Structured output for `PLAYER_STATUS_SUMMARY` — daily form/injury update
 * for in-tournament players, grounded in recent tagged news + team results.
 * Persisted as an `AiReport` (already surfaced by `GET /players/:id/analysis`);
 * `injuryRiskLevel`/`formScore` are written back to the Player row in real mode.
 */
export const PlayerStatusOutputSchema = z.object({
  /** Cautious zh-TW summary of recent form and physical condition. */
  statusSummaryZh: z.string().default(''),
  injuryRiskLevel: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'])
    .default('UNKNOWN'),
  formScore: z.number().min(0).max(100).nullable().default(null),
  dataLimitations: z.array(z.string()).default([]),
});

export type PlayerStatusOutput = z.infer<typeof PlayerStatusOutputSchema>;
