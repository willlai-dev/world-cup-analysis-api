import { z } from 'zod';

/**
 * Structured output for `PLAYER_NAME_TRANSLATION` — one batch of player-name
 * transliterations. `id` must echo the input id so results can be written back
 * without name matching; entries with unknown ids or non-CJK values are dropped
 * by the caller (PlayersService.translateMissingNames).
 */
export const PlayerNameTranslationOutputSchema = z.object({
  names: z
    .array(
      z.object({
        id: z.string(),
        nameZh: z.string(),
      }),
    )
    .default([]),
});

export type PlayerNameTranslationOutput = z.infer<typeof PlayerNameTranslationOutputSchema>;
