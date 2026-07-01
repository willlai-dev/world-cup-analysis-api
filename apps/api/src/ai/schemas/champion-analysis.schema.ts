import { z } from 'zod';

/**
 * Structured output for `CHAMPION_PREDICTION_FINAL`. The final model returns a
 * consensus ranking; the service maps each entry's `teamName` back to a seeded
 * Team and persists strengths / risks / aiComment per `ChampionPredictionEntry`.
 */
export const ChampionAnalysisEntrySchema = z.object({
  teamName: z.string().min(1),
  // 0 = unranked ("資料不足"); the service re-ranks entries sequentially anyway.
  rank: z.number().int().min(0).default(0),
  probabilityText: z.string().min(1),
  strengths: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  aiComment: z.string().default(''),
});

export const ChampionAnalysisOutputSchema = z.object({
  summary: z.string().default(''),
  entries: z.array(ChampionAnalysisEntrySchema).min(1),
  dataLimitations: z.array(z.string()).default([]),
});

export type ChampionAnalysisOutput = z.infer<typeof ChampionAnalysisOutputSchema>;
export type ChampionAnalysisEntry = z.infer<typeof ChampionAnalysisEntrySchema>;
