import { z } from 'zod';

const ImpactDirectionSchema = z
  .enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'UNKNOWN'])
  .default('UNKNOWN');

const AffectedEntitySchema = z.object({
  name: z.string().min(1),
  /** Cautious, clearly-inferred impact statement (zh-TW). */
  impact: z.string().default(''),
  direction: ImpactDirectionSchema,
});

/**
 * Structured output for `NEWS_IMPACT` — an inference-flagged, cautious-tone
 * analysis of how an article may affect the tagged teams/players. Persisted
 * as an `AiReport` (`entityType NEWS`, `reportType NEWS_IMPACT`).
 */
export const NewsImpactOutputSchema = z.object({
  impactSummaryZh: z.string().default(''),
  affectedTeams: z.array(AffectedEntitySchema).default([]),
  affectedPlayers: z.array(AffectedEntitySchema).default([]),
  confidenceScore: z.number().min(0).max(100).default(0),
  dataLimitations: z.array(z.string()).default([]),
});

export type NewsImpactOutput = z.infer<typeof NewsImpactOutputSchema>;
