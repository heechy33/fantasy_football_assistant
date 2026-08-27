import { describe, expect, it } from 'vitest';
import type { PlayerId } from '../../../shared/types';
import { roundForOverall, slotForOverall } from '../adapters/draftOrder';
import { buildDraftGrid } from './guideDraftGrid';
import type { GuideRow } from './guideBoard';

/** Synthetic rows — the grid's contract is pure assignment/order math, so fixture rows only need
 * identity + tie-break fields (the real-data engine behavior is pinned in guideBoard.test.ts). */
function row(playerId: string, seed: number): GuideRow {
  return {
    playerId,
    player: { playerId, name: `Player ${playerId}`, position: 'RB', eligiblePositions: ['RB'], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} },
    recommendation: null,
    engineRank: seed,
    adpEntry: null,
  };
}

function makeRows(count: number): GuideRow[] {
  return Array.from({ length: count }, (_, i) => row(`id-${String(i + 1).padStart(3, '0')}`, i + 1));
}

function rankMap(rows: readonly GuideRow[]): ReadonlyMap<PlayerId, number> {
  return new Map(rows.map((r, i) => [r.playerId, i + 1]));
}

describe('guideDraftGrid', () => {
  it.each([10, 12, 14])('assigns every pick to the (round, slot) draftOrder computes — %d teams', (teams) => {
    const rounds = teams % 2 === 0 ? 15 : 14; // exercise odd and even round counts
    const rows = makeRows(teams * rounds);
    const grid = buildDraftGrid(rows, teams, rounds, rankMap(rows));

    expect(grid.length).toBe(rounds);
    const seen = new Set<number>();
    for (let r = 1; r <= rounds; r += 1) {
      expect(grid[r - 1]!.length).toBe(teams);
      for (let s = 1; s <= teams; s += 1) {
        const cell = grid[r - 1]![s - 1]!;
        // Columns ARE team slots. Each cell's overall must round-trip through draftOrder's
        // math back to exactly this (round, slot) — that holds on snake turns too.
        expect(cell.round).toBe(r);
        expect(cell.slot).toBe(s);
        expect(roundForOverall(teams, cell.overall)).toBe(r);
        expect(slotForOverall('snake', teams, cell.overall)).toBe(s);
        seen.add(cell.overall);
      }
    }
    // Every overall pick 1..capacity appears exactly once across the board.
    expect(seen.size).toBe(teams * rounds);
    for (let o = 1; o <= teams * rounds; o += 1) {
      expect(seen.has(o)).toBe(true);
    }
  });

  it('reverses snake order on even rounds', () => {
    const teams = 12;
    const rounds = 2;
    const rows = makeRows(24);
    const grid = buildDraftGrid(rows, teams, rounds, rankMap(rows));

    // Columns are team slots. Round 1 runs with the grain (slot s → overall s); round 2 runs
    // against it (the turn): slot 1 holds overall 24, slot 12 holds overall 13.
    const round1 = grid[0]!;
    const round2 = grid[1]!;
    for (let s = 1; s <= teams; s += 1) {
      expect(round1[s - 1]!.overall).toBe(s);
      expect(round2[s - 1]!.overall).toBe(2 * teams + 1 - s);
      expect(round2[s - 1]!.slot).toBe(s); // column identity never moves
    }
    expect(round2[0]!.overall).toBe(24); // slot 1 on the turn = last pick of the pair
    expect(round2[teams - 1]!.overall).toBe(13);
  });

  it('orders cells by the selected source rank (rank 1 → pick 1)', () => {
    const rows = makeRows(5);
    const grid = buildDraftGrid(rows, 5, 1, rankMap(rows));
    expect(grid[0]![0]!.row?.playerId).toBe('id-001');
    expect(grid[0]![4]!.row?.playerId).toBe('id-005');
  });

  // Rank-TRUTH contract: a row occupies the pick its own rank names. A gap in the ranks leaves
  // that pick visibly empty — the following players are NOT compressed up onto fabricated picks.
  it('leaves a pick empty when the rank map has a gap (no compression)', () => {
    const rows = makeRows(4); // ids 001..004
    const gapped = new Map<PlayerId, number>([
      [rows[0]!.playerId, 1],
      [rows[1]!.playerId, 3],
    ]);
    const grid = buildDraftGrid(rows, 4, 1, gapped);
    expect(grid[0]!.map((cell) => cell.row?.playerId ?? null)).toEqual(['id-001', null, 'id-002', null]);
  });

  // Sparse-lane contract: rows the lane didn't rank claim NO pick at all (the old index-based
  // assignment fabricated late-round picks for them).
  it('never assigns a pick to a row missing from the rank map', () => {
    const rows = makeRows(6);
    const sparse = new Map<PlayerId, number>([
      [rows[0]!.playerId, 1],
      [rows[1]!.playerId, 2],
      [rows[2]!.playerId, 4],
    ]);
    const grid = buildDraftGrid(rows, 4, 1, sparse);
    const filled = grid.flat().filter((cell) => cell.row != null);
    expect(filled.map((cell) => cell.row!.playerId)).toEqual(['id-001', 'id-002', 'id-003']);
    expect(grid[0]![2]!.row).toBeNull(); // pick 3: gap between ranks 2 and 4
    // The unranked rows appear NOWHERE on the board.
    const everyPlayerId = grid.flat().map((cell) => cell.row?.playerId);
    expect(everyPlayerId).not.toContain('id-004');
    expect(everyPlayerId).not.toContain('id-005');
    expect(everyPlayerId).not.toContain('id-006');
  });

  it('truncates by rank: rows ranked beyond capacity fall off the board', () => {
    const rows = makeRows(30);
    const grid = buildDraftGrid(rows, 12, 1, rankMap(rows)); // capacity 12
    const playerIds = grid.flat().map((cell) => cell.row?.playerId);
    expect(playerIds).toHaveLength(12);
    expect(playerIds).not.toContain('id-013');
  });

  it('pads short pools with empty cells and truncates at capacity', () => {
    // Short pool: 7 ranked rows into a 12x2 board → picks 8..24 are empty.
    const short = makeRows(7);
    const padded = buildDraftGrid(short, 12, 2, rankMap(short));
    const filled = padded.flat().filter((cell) => cell.row != null);
    const empty = padded.flat().filter((cell) => cell.row == null);
    expect(filled.length).toBe(7);
    expect(empty.length).toBe(17);

    // Overlong pool: truncated at teams*rounds.
    const long = makeRows(40);
    const truncated = buildDraftGrid(long, 12, 2, rankMap(long));
    expect(truncated.flat().every((cell) => cell.row != null)).toBe(true);
    expect(truncated.flat().length).toBe(24);
  });

  it('is deterministic across rebuilds', () => {
    const rows = makeRows(36);
    const a = buildDraftGrid(rows, 12, 3, rankMap(rows)).flat().map((c) => c.row?.playerId ?? null);
    const b = buildDraftGrid(rows, 12, 3, rankMap(rows)).flat().map((c) => c.row?.playerId ?? null);
    expect(a).toEqual(b);
  });
});
