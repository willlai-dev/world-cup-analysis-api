import { MatchStage, MatchStatus } from '@prisma/client';
import {
  deriveEliminatedTeamIds,
  ROUND_OF_32_FIXTURES,
  type EliminationMatchRow,
} from './elimination';

function row(overrides: Partial<EliminationMatchRow>): EliminationMatchRow {
  return {
    stage: MatchStage.GROUP,
    status: MatchStatus.FINISHED,
    homeTeamId: 'home',
    awayTeamId: 'away',
    winnerTeamId: null,
    ...overrides,
  };
}

/** A finished group stage: `groups` × 4 teams, everyone plays everyone. */
function finishedGroups(groups: number): EliminationMatchRow[] {
  const rows: EliminationMatchRow[] = [];
  for (let g = 0; g < groups; g += 1) {
    const teams = [0, 1, 2, 3].map((i) => `g${g}-t${i}`);
    for (let a = 0; a < teams.length; a += 1) {
      for (let b = a + 1; b < teams.length; b += 1) {
        rows.push(row({ homeTeamId: teams[a], awayTeamId: teams[b] }));
      }
    }
  }
  return rows;
}

/** R32 fixtures pairing the top two of each group (g0-t0 vs g1-t1, ...). */
function roundOf32(groups: number): EliminationMatchRow[] {
  const rows: EliminationMatchRow[] = [];
  for (let g = 0; g < groups; g += 1) {
    const opp = (g + 1) % groups;
    rows.push(
      row({
        stage: MatchStage.ROUND_OF_32,
        status: MatchStatus.SCHEDULED,
        homeTeamId: `g${g}-t0`,
        awayTeamId: `g${opp}-t1`,
      }),
    );
  }
  // Pad with extra fixtures between already-listed advancers to reach 16.
  while (rows.length < ROUND_OF_32_FIXTURES) {
    rows.push(
      row({
        stage: MatchStage.ROUND_OF_32,
        status: MatchStatus.SCHEDULED,
        homeTeamId: `g${rows.length % groups}-t0`,
        awayTeamId: `g${(rows.length + 1) % groups}-t1`,
      }),
    );
  }
  return rows;
}

describe('deriveEliminatedTeamIds', () => {
  it('eliminates the loser of a finished knockout match', () => {
    const out = deriveEliminatedTeamIds([
      row({
        stage: MatchStage.ROUND_OF_16,
        homeTeamId: 'winner-team',
        awayTeamId: 'loser-team',
        winnerTeamId: 'winner-team',
      }),
    ]);
    expect(out).toEqual(new Set(['loser-team']));
  });

  it('never eliminates anyone from an UNKNOWN-stage match', () => {
    const out = deriveEliminatedTeamIds([
      row({
        stage: MatchStage.UNKNOWN,
        homeTeamId: 'a',
        awayTeamId: 'b',
        winnerTeamId: 'a',
      }),
    ]);
    expect(out.size).toBe(0);
  });

  it('ignores unfinished knockout matches and winners that match neither team', () => {
    const out = deriveEliminatedTeamIds([
      row({
        stage: MatchStage.SEMI_FINAL,
        status: MatchStatus.SCHEDULED,
        winnerTeamId: 'home',
      }),
      row({
        stage: MatchStage.SEMI_FINAL,
        homeTeamId: 'a',
        awayTeamId: 'b',
        winnerTeamId: 'someone-else',
      }),
    ]);
    expect(out.size).toBe(0);
  });

  it('does not infer group exits while any group match is unfinished', () => {
    const rows = [...finishedGroups(12), ...roundOf32(12)];
    rows[0] = { ...rows[0], status: MatchStatus.SCHEDULED };
    const out = deriveEliminatedTeamIds(rows);
    expect(out.size).toBe(0);
  });

  it('does not infer group exits from a partially assigned bracket', () => {
    const rows = [...finishedGroups(12), ...roundOf32(12).slice(0, 10)];
    const out = deriveEliminatedTeamIds(rows);
    expect(out.size).toBe(0);
  });

  it('eliminates group teams absent from a fully assigned bracket', () => {
    const out = deriveEliminatedTeamIds([
      ...finishedGroups(12),
      ...roundOf32(12),
    ]);
    // t2/t3 of every group never appear in a knockout fixture.
    expect(out.size).toBe(24);
    expect(out.has('g0-t2')).toBe(true);
    expect(out.has('g11-t3')).toBe(true);
    // Advancers stay in.
    expect(out.has('g0-t0')).toBe(false);
    expect(out.has('g1-t1')).toBe(false);
  });

  it('keeps the champion in while eliminating the runner-up', () => {
    const out = deriveEliminatedTeamIds([
      row({
        stage: MatchStage.SEMI_FINAL,
        homeTeamId: 'champ',
        awayTeamId: 'third',
        winnerTeamId: 'champ',
      }),
      row({
        stage: MatchStage.SEMI_FINAL,
        homeTeamId: 'runner-up',
        awayTeamId: 'fourth',
        winnerTeamId: 'runner-up',
      }),
      row({
        stage: MatchStage.THIRD_PLACE,
        homeTeamId: 'third',
        awayTeamId: 'fourth',
        winnerTeamId: 'third',
      }),
      row({
        stage: MatchStage.FINAL,
        homeTeamId: 'champ',
        awayTeamId: 'runner-up',
        winnerTeamId: 'champ',
      }),
    ]);
    expect(out).toEqual(new Set(['third', 'fourth', 'runner-up']));
  });
});
