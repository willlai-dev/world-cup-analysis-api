import { z } from 'zod';

const score = z.number().min(0).max(100).default(0);

/** Structured output for `PLAYER_HEXAGON_ANALYSIS` (spec §"PlayerHexagonOutput"). */
export const PlayerHexagonOutputSchema = z.object({
  overallScore: score,
  ratingTier: z.enum(['S', 'A_PLUS', 'A', 'B_PLUS', 'B', 'C', 'UNKNOWN']).default('UNKNOWN'),
  attackScore: score,
  creativityScore: score,
  techniqueScore: score,
  defenseScore: score,
  physicalScore: score,
  formScore: score,
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  roleSummary: z.string().default(''),
  injuryRiskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']).default('UNKNOWN'),
  dataLimitations: z.array(z.string()).default([]),
});

export type PlayerHexagonOutput = z.infer<typeof PlayerHexagonOutputSchema>;
