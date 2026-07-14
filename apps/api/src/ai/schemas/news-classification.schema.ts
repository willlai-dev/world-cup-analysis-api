import { z } from 'zod';

/** Structured output for `NEWS_CLASSIFICATION` (spec §"NewsClassificationOutput"). */
export const NewsClassificationOutputSchema = z.object({
  /**
   * Relevance gate: false means the article is not about the FIFA World Cup
   * (other sports, club-only news, off-topic feeds that merely mention the
   * phrase) and the pipeline deletes it. Defaults true so a model that omits
   * the field can never mass-delete articles.
   */
  isWorldCupRelated: z.boolean().default(true),
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
        // .catch (not .default): models routinely reuse category's TOURNAMENT
        // for a tournament-referencing tag, which this enum omits on purpose
        // (use TOPIC/OTHER instead). .default only covers an omitted field;
        // .catch also absorbs that invalid value so one bad tag degrades to
        // OTHER instead of failing the whole structured output.
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
          .catch('OTHER'),
      }),
    )
    .default([]),
  relatedTeamNames: z.array(z.string()).default([]),
  relatedPlayerNames: z.array(z.string()).default([]),
  confidenceScore: z.number().min(0).max(100).default(0),
  dataLimitations: z.array(z.string()).default([]),
});

export type NewsClassificationOutput = z.infer<typeof NewsClassificationOutputSchema>;
