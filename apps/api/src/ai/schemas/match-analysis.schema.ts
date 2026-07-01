import { z } from 'zod';

const lean = z.number().min(0).max(100).default(0);

/** Structured output for `MATCH_ANALYSIS` (spec §"MatchAnalysisOutput"). */
export const MatchAnalysisOutputSchema = z.object({
  title: z.string().default(''),
  summary: z.string().default(''),
  keyFactors: z.array(z.string()).default([]),
  keyPlayers: z
    .array(
      z.object({
        playerName: z.string(),
        teamName: z.string(),
        reason: z.string().default(''),
      }),
    )
    .default([]),
  prediction: z
    .object({
      homeWinLean: lean,
      drawLean: lean,
      awayWinLean: lean,
      explanation: z.string().default(''),
    })
    .default({ homeWinLean: 0, drawLean: 0, awayWinLean: 0, explanation: '' }),
  likelyScorelines: z
    .array(
      z.object({
        score: z.string().min(1), // "home-away", e.g. "2-1"
        probability: z.number().min(0).max(100).default(0),
      }),
    )
    .default([]),
  risks: z.array(z.string()).default([]),
  dataLimitations: z.array(z.string()).default([]),
});

export type MatchAnalysisOutput = z.infer<typeof MatchAnalysisOutputSchema>;
