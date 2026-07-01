import { z } from 'zod';

/** Structured output for `NEWS_CLASSIFICATION` (spec §"NewsClassificationOutput"). */
export const NewsClassificationOutputSchema = z.object({
  summaryZh: z.string().default(''),
  category: z
    .enum([
      'MATCH',
      'PLAYER',
      'INJURY',
      'TRANSFER',
      'TEAM',
      'TACTIC',
      'CONTROVERSY',
      'TOURNAMENT',
      'OTHER',
    ])
    .default('OTHER'),
  tags: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z
          .enum([
            'TEAM',
            'PLAYER',
            'MATCH',
            'TOPIC',
            'INJURY',
            'TACTIC',
            'CONTROVERSY',
            'TRANSFER',
            'OTHER',
          ])
          .default('OTHER'),
      }),
    )
    .default([]),
  relatedTeamNames: z.array(z.string()).default([]),
  relatedPlayerNames: z.array(z.string()).default([]),
  confidenceScore: z.number().min(0).max(100).default(0),
  dataLimitations: z.array(z.string()).default([]),
});

export type NewsClassificationOutput = z.infer<typeof NewsClassificationOutputSchema>;
