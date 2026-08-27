import type { PlayerId } from '../../../shared/types';
import { roundForOverall, slotForOverall } from '../adapters/draftOrder';
import type { GuideRow } from './guideBoard';

/**
 * Pure derivation for the guide's Draft View — the same ranked pool rendered as a STACKED-style
 * snake board. A row occupies the pick its OWN source rank names: pick k renders the player whose
 * `rankBy` value is k (the same adapters the live board uses — `draftOrder.ts`, already
 * unit-tested — supply the (round, slot) for each overall, so the two views can never disagree
 * about where a pick sits).
 *
 * Rows the selected lane didn't rank (sparse provider lanes, the engine's scored-limit tail)
 * claim NO pick — their cells stay visibly empty rather than being compressed onto fabricated
 * late-round assignments. No order math lives here by design, and no sort either: the rank map
 * IS the ordering, which keeps provider lanes interchangeable without this module knowing what a
 * "provider" is.
 */

/** One cell of the draft grid, indexed `[round - 1][slot - 1]`. Picks no ranked row claims
 * render as visibly empty cells (`row: null`) — never fabricated players. */
export interface GuideDraftCell {
  overall: number;
  round: number;
  slot: number;
  row: GuideRow | null;
}

export function buildDraftGrid(
  rows: readonly GuideRow[],
  teams: number,
  rounds: number,
  rankBy: ReadonlyMap<PlayerId, number>,
): GuideDraftCell[][] {
  const capacity = Math.max(0, teams) * Math.max(0, rounds);
  // Invert rows into pick slots. First row wins a duplicated rank (dense maps never produce one;
  // input order keeps even that degenerate case deterministic). Ranks beyond capacity fall off
  // the board naturally — the loop below never asks for them.
  const rowByRank = new Map<number, GuideRow>();
  for (const row of rows) {
    const rank = rankBy.get(row.playerId);
    if (rank != null && !rowByRank.has(rank)) rowByRank.set(rank, row);
  }

  const grid: GuideDraftCell[][] = [];
  for (let overall = 1; overall <= capacity; overall += 1) {
    const round = roundForOverall(teams, overall);
    const slot = slotForOverall('snake', teams, overall);
    const column = grid[round - 1] ?? (grid[round - 1] = []);
    column[slot - 1] = { overall, round, slot, row: rowByRank.get(overall) ?? null };
  }
  return grid;
}
