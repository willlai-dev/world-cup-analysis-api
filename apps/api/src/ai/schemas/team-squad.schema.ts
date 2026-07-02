import { z } from 'zod';

const score = z.number().min(0).max(100).default(0);

/**
 * Structured output for `TEAM_SQUAD_ANALYSIS` — team-level strength scores.
 * The DB only carries names/codes for most teams, so this task runs under the
 * RELAXED skill (public football knowledge, uncertain info flagged 推估). The
 * scores are written back to the Team row (championScore/attack/… + ratingTier)
 * so champion prediction and team pages have data for every team, not just the
 * six seeded ones.
 */
export const TeamSquadOutputSchema = z.object({
  championScore: score, // 奪冠競爭力
  formScore: score, // 近期狀態
  attackScore: score,
  midfieldScore: score,
  defenseScore: score,
  statusScore: score, // 整體穩定度 / 陣容完整度
  ratingTier: z.enum(['S', 'A', 'B', 'C', 'UNKNOWN']).default('UNKNOWN'),
  strengths: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  summary: z.string().default(''),
  dataLimitations: z.array(z.string()).default([]),
});

export type TeamSquadOutput = z.infer<typeof TeamSquadOutputSchema>;
