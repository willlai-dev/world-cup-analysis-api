import { MatchStage, MatchStatus } from "@prisma/client";

/**
 * Derives the full set of eliminated teams from the complete match list —
 * pure function, recomputed from scratch on every sync so stale flags heal
 * themselves (the old incremental approach could only ever add `true`).
 */

/** Explicit knockout rounds. UNKNOWN is deliberately excluded: a stage the
 * mapper couldn't classify must never eliminate anyone. */
export const KNOCKOUT_STAGES: ReadonlySet<MatchStage> = new Set([
  MatchStage.ROUND_OF_32,
  MatchStage.ROUND_OF_16,
  MatchStage.QUARTER_FINAL,
  MatchStage.SEMI_FINAL,
  MatchStage.THIRD_PLACE,
  MatchStage.FINAL,
]);

/** WC2026: 48 teams / 12 groups → the round of 32 has exactly 16 fixtures.
 * Sync skips fixtures whose teams aren't assigned yet, so fewer rows means
 * the bracket is only partially known and group-exit inference must wait. */
export const ROUND_OF_32_FIXTURES = 16;

export type EliminationMatchRow = {
  stage: MatchStage;
  status: MatchStatus;
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId: string | null;
};

/**
 * Teams that are out of the tournament:
 * 1. Losers of finished knockout matches.
 * 2. Group-stage participants who never appear in any knockout fixture —
 *    inferred from bracket presence (no FIFA tie-breaker math needed), but
 *    only once every group match is finished AND the full round of 32 is in
 *    the DB, otherwise an unassigned bracket slot would read as elimination.
 */
export function deriveEliminatedTeamIds(
  rows: EliminationMatchRow[],
): Set<string> {
  const eliminated = new Set<string>();
  const groupParticipants = new Set<string>();
  const knockoutParticipants = new Set<string>();
  let groupMatches = 0;
  let unfinishedGroupMatches = 0;
  let roundOf32Matches = 0;

  for (const row of rows) {
    if (row.stage === MatchStage.GROUP) {
      groupMatches += 1;
      if (row.status !== MatchStatus.FINISHED) unfinishedGroupMatches += 1;
      groupParticipants.add(row.homeTeamId);
      groupParticipants.add(row.awayTeamId);
      continue;
    }
    if (!KNOCKOUT_STAGES.has(row.stage)) continue; // UNKNOWN etc.

    knockoutParticipants.add(row.homeTeamId);
    knockoutParticipants.add(row.awayTeamId);
    if (row.stage === MatchStage.ROUND_OF_32) roundOf32Matches += 1;

    if (
      row.status === MatchStatus.FINISHED &&
      row.winnerTeamId &&
      (row.winnerTeamId === row.homeTeamId ||
        row.winnerTeamId === row.awayTeamId)
    ) {
      eliminated.add(
        row.winnerTeamId === row.homeTeamId ? row.awayTeamId : row.homeTeamId,
      );
    }
  }

  const groupStageComplete = groupMatches > 0 && unfinishedGroupMatches === 0;
  if (groupStageComplete && roundOf32Matches >= ROUND_OF_32_FIXTURES) {
    for (const teamId of groupParticipants) {
      if (!knockoutParticipants.has(teamId)) eliminated.add(teamId);
    }
  }

  return eliminated;
}
