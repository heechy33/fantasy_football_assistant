import type { LeagueSettings, PlayerId, PlayerMeta, RosterSlot } from '../../../shared/types';

export interface LineupAssignment {
  playerId: PlayerId;
  slot: RosterSlot;
  value: number;
}

export interface LineupResult {
  value: number;
  assignments: LineupAssignment[];
  benched: PlayerId[];
}

function accepts(slot: RosterSlot, player: PlayerMeta): boolean {
  const positions = new Set(player.eligiblePositions.length ? player.eligiblePositions : player.position ? [player.position] : []);
  if (slot === 'FLEX') return positions.has('RB') || positions.has('WR') || positions.has('TE');
  if (slot === 'SUPER_FLEX') return positions.has('QB') || positions.has('RB') || positions.has('WR') || positions.has('TE');
  if (slot === 'WRRB_FLEX') return positions.has('RB') || positions.has('WR');
  if (slot === 'REC_FLEX') return positions.has('RB') || positions.has('WR') || positions.has('TE');
  return slot !== 'BN' && slot !== 'IR' && positions.has(slot);
}

interface SlotSolution { value: number; count: number; picks: readonly (number | null)[]; }

/** Exact small-roster assignment solver. It favors dedicated slots through
 * the objective naturally, while still finding the FLEX counterexample where
 * a WR belongs in FLEX and a RB fills the dedicated RB slot.
 *
 * Bitmask DP over (slotIndex, remaining-players-mask) with memoization: the
 * naive recursion revisits the same remaining-player set whenever different
 * skip/assign orderings empty the same slots, which without memoization
 * blows up combinatorially for realistic roster sizes. Player membership is
 * lexicographically ranked (value first, then assignment count) so ties
 * resolve identically to the old exhaustive search. */
export function optimizeLineup(
  settings: LeagueSettings,
  players: PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
): LineupResult {
  const slots = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR');
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const ids = players.filter((player) => projectedPoints.has(player.playerId)).map((player) => player.playerId);
  const points = ids.map((id) => projectedPoints.get(id) ?? 0);

  const slotEligibilityMask = slots.map((slot) => {
    let mask = 0n;
    ids.forEach((id, index) => {
      const player = playerById.get(id);
      if (player && accepts(slot, player)) mask |= 1n << BigInt(index);
    });
    return mask;
  });
  const fullMask = ids.length ? (1n << BigInt(ids.length)) - 1n : 0n;

  const memo = new Map<string, SlotSolution>();
  function solve(slotIndex: number, remainingMask: bigint): SlotSolution {
    if (slotIndex >= slots.length) return { value: 0, count: 0, picks: [] };
    const key = `${slotIndex}:${remainingMask}`;
    const cached = memo.get(key);
    if (cached) return cached;

    // Leaving a slot empty is legal for partial rosters and makes the solver
    // useful before a full mock draft is complete.
    const skip = solve(slotIndex + 1, remainingMask);
    let bestValue = skip.value;
    let bestCount = skip.count;
    let bestContinuation = skip.picks;
    let bestPick: number | null = null;

    const eligible = (slotEligibilityMask[slotIndex] ?? 0n) & remainingMask;
    for (let index = 0; index < ids.length; index += 1) {
      const bit = 1n << BigInt(index);
      if (!(eligible & bit)) continue;
      const sub = solve(slotIndex + 1, remainingMask & ~bit);
      const value = (points[index] ?? 0) + sub.value;
      const count = sub.count + 1;
      if (value > bestValue || (value === bestValue && count > bestCount)) {
        bestValue = value;
        bestCount = count;
        bestContinuation = sub.picks;
        bestPick = index;
      }
    }

    const result: SlotSolution = { value: bestValue, count: bestCount, picks: [bestPick, ...bestContinuation] };
    memo.set(key, result);
    return result;
  }

  const solved = solve(0, fullMask);
  const assignments: LineupAssignment[] = [];
  solved.picks.forEach((pick, slotIndex) => {
    if (pick === null) return;
    const slot = slots[slotIndex];
    const id = ids[pick];
    if (!slot || !id) return;
    assignments.push({ playerId: id, slot, value: points[pick] ?? 0 });
  });
  const used = new Set(assignments.map((assignment) => assignment.playerId));
  return { value: solved.value, assignments, benched: ids.filter((id) => !used.has(id)) };
}

export function rosterValue(
  settings: LeagueSettings,
  players: PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
): number {
  return optimizeLineup(settings, players, projectedPoints).value;
}

export function slotEligibility(slot: RosterSlot, player: PlayerMeta): boolean {
  return accepts(slot, player);
}
