import { z } from 'zod';

/**
 * Structured output for the per-model champion legs (`CHAMPION_PREDICTION_A`
 * NVIDIA / `CHAMPION_PREDICTION_B` Qwen). Keeps the narrative analysis while
 * adding a machine-readable ranking so the service can compute NVIDIA-vs-Qwen
 * divergence program-side (no extra AI call). Also used to re-parse persisted
 * `AiReport.structuredJson` when building the divergence field.
 */
export const ChampionModelEntrySchema = z.object({
  teamName: z.string().min(1),
  // 0 = unranked ("資料不足"); divergence treats 0 as "no rank from this model".
  rank: z.number().int().min(0).default(0),
  probabilityText: z.string().default(''),
  keyReason: z.string().default(''),
});

export const ChampionModelAnalysisSchema = z.object({
  analysis: z.string().default(''),
  entries: z.array(ChampionModelEntrySchema).default([]),
  dataLimitations: z.array(z.string()).default([]),
});

export type ChampionModelAnalysis = z.infer<typeof ChampionModelAnalysisSchema>;
export type ChampionModelEntry = z.infer<typeof ChampionModelEntrySchema>;
