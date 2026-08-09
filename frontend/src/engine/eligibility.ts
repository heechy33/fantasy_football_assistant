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

interface IndexedSolution {
  /** Starting slots only (BN/IR filtered out), in settings order. Index = slot identity —
   * load-bearing for duplicate slots (e.g. two `RB`s), which are otherwise indistinguishable by name. */
  slots: RosterSlot[];
  /** Scored players, in input order — this order is the DP's tie-break authority (see `solve` below). */
  ids: PlayerId[];
  /** `picks[slotIndex]` = index into `ids` occupying that slot, or `null` if left empty. */
  picks: readonly (number | null)[];
  value: number;
}

/**
 * Exact small-roster assignment solver. It favors dedicated slots through
 * the objective naturally, while still finding the FLEX counterexample where
 * a WR belongs in FLEX and a RB fills the dedicated RB slot.
 *
 * Bitmask DP over (slotIndex, remaining-players-mask) with memoization: the
 * naive recursion revisits the same remaining-player set whenever different
 * skip/assign orderings empty the same slots, which without memoization
 * blows up combinatorially for realistic roster sizes. Player membership is
 * lexicographically ranked (value first, then assignment count) so ties
 * resolve identically to the old exhaustive search.
 *
 * Factored out from `optimizeLineup` so `prepareLineup` can reuse the exact
 * same canonical base solve — see that function's doc for why the base case
 * must never be re-derived by hand.
 */
function solveIndexed(
  settings: LeagueSettings,
  players: PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
): IndexedSolution {
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
  return { slots, ids, picks: solved.picks, value: solved.value };
}

export function optimizeLineup(
  settings: LeagueSettings,
  players: PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
): LineupResult {
  const { slots, ids, picks, value } = solveIndexed(settings, players, projectedPoints);
  const assignments: LineupAssignment[] = [];
  picks.forEach((pick, slotIndex) => {
    if (pick === null) return;
    const slot = slots[slotIndex];
    const id = ids[pick];
    if (!slot || !id) return;
    assignments.push({ playerId: id, slot, value: projectedPoints.get(id) ?? 0 });
  });
  const used = new Set(assignments.map((assignment) => assignment.playerId));
  return { value, assignments, benched: ids.filter((id) => !used.has(id)) };
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

// ---------------------------------------------------------------------------
// Incremental lineup value (S3) — see PLAN.md §2 "Slot-aware marginal roster
// value". S3's VONA rollouts call this O(candidates x scenarios x follow-ups)
// times per recommendation board; a full solveIndexed() re-solve is
// exponential in roster size (measured ~33ms at a full 15-man roster) and
// makes that flatly infeasible. `addPlayerToLineup` gets the same exact
// answer via an O(slots^2) reachability search instead.
// ---------------------------------------------------------------------------

/**
 * A `solveIndexed` result kept in a form that supports adding one more player
 * without re-solving. `occupantBySlot` is indexed (not keyed by slot name) so
 * duplicate slots (two `RB`s) are distinguishable — `LineupResult.assignments`
 * alone can't express that.
 */
export interface PreparedLineup {
  readonly settings: LeagueSettings;
  readonly slots: readonly RosterSlot[];
  /** Original input order, with later incremental additions appended. This is the DP tie-break order. */
  readonly players: readonly PlayerMeta[];
  /** `slotPlayerIndex[slotIndex]` indexes `players`, preserving duplicate-slot identity. */
  readonly slotPlayerIndex: readonly (number | null)[];
  /** Internal ID-oriented view of `slotPlayerIndex`, retained for cheap chain traversal. */
  readonly occupantBySlot: readonly (PlayerId | null)[];
  readonly playerMetaById: ReadonlyMap<PlayerId, PlayerMeta>;
  readonly points: ReadonlyMap<PlayerId, number>;
  /** All scored players considered so far, in the order they entered (original roster order,
   * then each `addPlayerToLineup` call appends one). Mirrors `solveIndexed`'s `ids` order, which
   * is this DP's tie-break authority and also `LineupResult.benched`'s iteration order. */
  readonly activePlayerIds: readonly PlayerId[];
  readonly value: number;
}

/** Solves once via the exact DP and keeps the indexed assignment so `addPlayerToLineup` can
 * extend it. The base case is never re-derived by hand — it's the same `solveIndexed` call
 * `optimizeLineup` uses, so a `PreparedLineup`'s starting state is byte-identical to it. */
export function prepareLineup(
  settings: LeagueSettings,
  players: PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
): PreparedLineup {
  const { slots, ids, picks, value } = solveIndexed(settings, players, projectedPoints);
  const playerList = [...players];
  const playerIndexById = new Map(playerList.map((player, index) => [player.playerId, index]));
  const occupantBySlot: (PlayerId | null)[] = picks.map((pick) => (pick === null ? null : (ids[pick] ?? null)));
  const slotPlayerIndex = occupantBySlot.map((id) => (id == null ? null : playerIndexById.get(id) ?? null));
  const playerMetaById = new Map(playerList.map((player) => [player.playerId, player]));
  return {
    settings,
    slots,
    players: playerList,
    slotPlayerIndex,
    occupantBySlot,
    playerMetaById,
    points: projectedPoints,
    activePlayerIds: ids,
    value,
  };
}

/**
 * Whether every non-K/DEF starting slot in `prepared`'s optimal assignment has an occupant — the
 * predicate `recommend.ts` uses to hold K/DEF recommendations back until core skill/QB starters are
 * filled (see that module's `deprioritized` sort key). FLEX-family slots **count as core here** — an
 * empty FLEX is a real skill-position need for a single roster's board.
 *
 * This deliberately diverges from `opponentModel.ts`'s `needBonusFromLineup`, which excludes
 * FLEX-family slots entirely because it reports per-*position* need for opponent modeling, not a
 * single filled/unfilled verdict. Do not "unify" the two — `needBonusFromLineup` excluding FLEX is
 * correct for its own purpose (a FLEX slot doesn't cleanly attribute to one position), and folding
 * FLEX into it would silently change simulated opponent behavior.
 */
export function coreStartingSlotsFilled(prepared: PreparedLineup): boolean {
  return prepared.slots.every((slot, index) =>
    slot === 'K' || slot === 'DEF' || (prepared.occupantBySlot[index] ?? null) != null);
}

function lineupResultFromState(state: PreparedLineup): LineupResult {
  const assignments: LineupAssignment[] = [];
  const used = new Set<PlayerId>();
  state.slots.forEach((slot, index) => {
    const occupant = state.occupantBySlot[index];
    if (occupant == null) return;
    assignments.push({ playerId: occupant, slot, value: state.points.get(occupant) ?? 0 });
    used.add(occupant);
  });
  const benched = state.activePlayerIds.filter((id) => !used.has(id));
  return { value: state.value, assignments, benched };
}

/**
 * Whether `entrant` has exactly one simple path (through slot-eligibility hops) to a slot
 * satisfying `isTarget`, with every step along the way also forced (no branching).
 *
 * Telescoping (see `addPlayerToLineup`'s doc) makes *every* chain reaching a given terminal worth
 * the same value, independent of route — so whenever a candidate has two or more genuinely
 * different routes to open capacity (a direct empty slot *and* an occupied slot whose occupant can
 * also reach open capacity, or two occupied slots that both lead to the same bench target), the
 * reference DP's specific choice among the value-tied results is a global property of its
 * recursion this local search can't derive locally. This walk detects exactly that branching so
 * `addPlayerToLineup` knows when to fall back to an exact re-solve instead of guessing.
 */
function hasUniqueAugmentingPath(
  slots: readonly RosterSlot[],
  occupantBySlot: readonly (PlayerId | null)[],
  playerMetaById: ReadonlyMap<PlayerId, PlayerMeta>,
  entrant: PlayerMeta,
  isTarget: (slotIndex: number) => boolean,
): boolean {
  const slotCount = slots.length;
  const canReachMemo = new Map<number, boolean>();
  const inProgress = new Set<number>();
  function canReach(slotIndex: number): boolean {
    if (isTarget(slotIndex)) return true;
    const cached = canReachMemo.get(slotIndex);
    if (cached != null) return cached;
    const occupant = occupantBySlot[slotIndex] ?? null;
    if (occupant == null || inProgress.has(slotIndex)) return false; // empty-but-not-target, or a cycle
    inProgress.add(slotIndex);
    const occupantMeta = playerMetaById.get(occupant);
    let result = false;
    if (occupantMeta) {
      for (let j = 0; j < slotCount; j += 1) {
        if (j === slotIndex) continue;
        const slot = slots[j];
        if (slot && accepts(slot, occupantMeta) && canReach(j)) { result = true; break; }
      }
    }
    inProgress.delete(slotIndex);
    canReachMemo.set(slotIndex, result);
    return result;
  }

  const entryPoints: number[] = [];
  for (let i = 0; i < slotCount; i += 1) {
    const slot = slots[i];
    if (slot && accepts(slot, entrant) && canReach(i)) entryPoints.push(i);
  }
  if (entryPoints.length !== 1) return false;

  const visitedWalk = new Set<number>();
  let current = entryPoints[0] as number;
  while (!isTarget(current)) {
    if (visitedWalk.has(current)) return false; // defensive; canReach's cycle guard should prevent this
    visitedWalk.add(current);
    const occupant = occupantBySlot[current] ?? null;
    const occupantMeta = occupant != null ? playerMetaById.get(occupant) : undefined;
    if (!occupantMeta) return false; // contradicts canReach(current) being true — treat conservatively
    const nextSteps: number[] = [];
    for (let j = 0; j < slotCount; j += 1) {
      if (j === current || visitedWalk.has(j)) continue;
      const slot = slots[j];
      if (slot && accepts(slot, occupantMeta) && canReach(j)) nextSteps.push(j);
    }
    if (nextSteps.length !== 1) return false;
    current = nextSteps[0] as number;
  }
  return true;
}

/**
 * Adds one player to an already-optimal `PreparedLineup` and returns the new optimum, exactly
 * matching what a fresh `solveIndexed`/`optimizeLineup` call on `[...previousPlayers, player]`
 * would produce — see `engine.test.ts`'s incremental-lineup property suite, which is the actual
 * correctness oracle this function is verified against (not a hand proof).
 *
 * How: inserting one player can only improve an optimal assignment through an alternating chain —
 * the new player displaces a slot's incumbent, that incumbent displaces another slot's incumbent,
 * and so on, terminating either at a genuinely empty slot or by benching the last displaced player.
 * Telescoping cancels every intermediate term, so a chain's *value* depends only on where it
 * terminates, not on the path: a chain ending in an empty slot is worth exactly `+points` (a slot's
 * worth of capacity was created from nothing), and a chain ending by benching player `p` is worth
 * exactly `points - pts(p)` (the whole cascade nets out to one direct swap). That reduces the
 * search to two questions — is any empty slot reachable, and what is the minimum point value among
 * reachable incumbents — both answerable by one unweighted reachability search: O(slots^2), against
 * the ~33ms/13.4k-state cost of a full re-solve on a 15-man roster.
 *
 * The three options (leave the player unassigned; bench the cheapest reachable incumbent; claim a
 * reachable empty slot) are then ranked the same way the underlying DP ranks slot choices — value
 * first, ties broken toward the option that fills more slots — so a zero-point player still claims
 * a genuinely empty slot (matching the DP's fill-preference) but never displaces an equal-value
 * incumbent (matching its "leave already-settled assignments alone" tie-break).
 *
 * Telescoping only pins down *that* value, not *which* reachable terminal produces it: when two or
 * more reachable empty slots (or two or more reachable incumbents at the exact minimum) tie, the
 * reference DP's choice among them is a genuinely global property of its slot-by-slot recursion —
 * not reproducible from local reachability alone (verified empirically: a naive "prefer the
 * latest-discovered option" rule matches the simple two-slot case but diverges on richer ones, see
 * `eligibilityIncremental.test.ts`'s property suite history). Real projected points are essentially
 * never exactly tied across multiple reachable slots — this only bites synthetic/replacement-level
 * inputs — so on that specific ambiguity this function falls back to an exact `solveIndexed`
 * re-run rather than guess. `state.value` is exact regardless (see below); a fallback here is only
 * about getting the *identity* of who's benched/placed right too. Every other path is the fast
 * O(slots^2) search.
 *
 * One tie is deliberately NOT treated as ambiguous: "leave the candidate unassigned" tying a
 * reachable bench-cascade at net value 0. `bestValue` there is unambiguously 0 either way, so
 * `state.value` stays exact — only *who* ends up benched could differ from the reference DP's
 * choice. This is common with real data (many literal zero-point bench-tier rows, e.g. sparse
 * K/DEF projection coverage) and treating it as ambiguous turned routine boards into dozens of
 * unnecessary full re-solves; see this function's ambiguity check below for detail.
 */
export function addPlayerToLineup(
  base: PreparedLineup,
  player: PlayerMeta,
  points: number,
): { state: PreparedLineup; result: LineupResult; addedPlayerSlot: RosterSlot | null } {
  const { slots, occupantBySlot, playerMetaById, points: basePoints } = base;
  const slotCount = slots.length;

  const visited: boolean[] = new Array(slotCount).fill(false);
  const parent: number[] = new Array(slotCount).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < slotCount; i += 1) {
    const slot = slots[i];
    if (slot && accepts(slot, player)) {
      visited[i] = true;
      parent[i] = -1;
      queue.push(i);
    }
  }

  const reachableEmptySlots: number[] = [];
  const reachableOccupiedSlots: number[] = [];

  for (let qi = 0; qi < queue.length; qi += 1) {
    const slotIndex = queue[qi] as number;
    const occupant = occupantBySlot[slotIndex] ?? null;
    if (occupant == null) {
      reachableEmptySlots.push(slotIndex);
      continue;
    }
    reachableOccupiedSlots.push(slotIndex);
    const occupantMeta = playerMetaById.get(occupant);
    if (!occupantMeta) continue;
    for (let j = 0; j < slotCount; j += 1) {
      if (visited[j] || j === slotIndex) continue;
      const candidateSlot = slots[j];
      if (candidateSlot && accepts(candidateSlot, occupantMeta)) {
        visited[j] = true;
        parent[j] = slotIndex;
        queue.push(j);
      }
    }
  }

  let minReachablePoints = Infinity;
  for (const slotIndex of reachableOccupiedSlots) {
    const occupant = occupantBySlot[slotIndex];
    const occupantPoints = occupant != null ? basePoints.get(occupant) ?? 0 : 0;
    if (occupantPoints < minReachablePoints) minReachablePoints = occupantPoints;
  }
  const minReachablePlayerSlots = reachableOccupiedSlots.filter((slotIndex) => {
    const occupant = occupantBySlot[slotIndex];
    return (occupant != null ? basePoints.get(occupant) ?? 0 : 0) === minReachablePoints;
  });

  // Rank the three options the same way the reference DP ranks slot choices: strictly higher
  // value wins outright; an equal-value option wins only if it fills strictly more slots. "Leave
  // unassigned" is the default (value 0, fills nothing) so it beats an equal-value bench-swap
  // (which fills the same number of slots either way) but loses to an equal-value empty-slot claim
  // (which fills one more).
  let bestValue = 0;
  let bestFillDelta = 0;
  let bestKind: 'none' | 'bench' | 'empty' = 'none';
  let bestSlot = -1;

  if (minReachablePlayerSlots.length > 0) {
    const value = points - minReachablePoints;
    if (value > bestValue) {
      bestValue = value;
      bestFillDelta = 0;
      bestKind = 'bench';
      bestSlot = minReachablePlayerSlots[minReachablePlayerSlots.length - 1] as number;
    }
  }
  if (reachableEmptySlots.length > 0) {
    const value = points;
    if (value > bestValue || (value === bestValue && 1 > bestFillDelta)) {
      bestValue = value;
      bestFillDelta = 1;
      bestKind = 'empty';
      bestSlot = reachableEmptySlots[reachableEmptySlots.length - 1] as number;
    }
  }

  // Ambiguous: either 2+ reachable terminals tie for the winning option (different empty slots, or
  // different occupants tied at the minimum), or there are 2+ distinct routes to the *same*
  // winning terminal (see `hasUniqueAugmentingPath`) — either way the reference DP's specific
  // choice is a global property this local search can't derive, so fall back to an exact re-solve.
  //
  // Deliberately NOT flagged as ambiguous: a reachable bench-cascade tying "leave unassigned" at
  // net value 0. The reference DP doesn't reliably pick "leave it out" there either (verified
  // empirically — see `eligibilityIncremental.test.ts`'s property-suite history), but `bestValue`
  // is already correctly 0 either way, so `state.value` is exact regardless of which zero-value
  // option gets applied; only *occupancy identity* could differ (who's benched), never value. This
  // matters in practice: real committed FFToday data has many literal zero-point bench-tier K/DEF
  // rows (sparse projection coverage), so treating every such tie as ambiguous turned a ~40-candidate
  // recommendation board into dozens of unnecessary full re-solves — see PLAN.md's S3 stage-A note.
  const ambiguous =
    (bestKind === 'empty' &&
      // With no reachable incumbent, multiple empty terminals are not a real assignment
      // ambiguity: the DP's skip-first recursion deterministically puts the new player in the
      // last eligible empty slot, exactly what the BFS order below already chooses. This is the
      // ordinary early-draft dedicated-slot-plus-FLEX case, so avoid paying for a full re-solve.
      reachableOccupiedSlots.length > 0 &&
      (reachableEmptySlots.length > 1 ||
        !hasUniqueAugmentingPath(slots, occupantBySlot, playerMetaById, player, (idx) => (occupantBySlot[idx] ?? null) == null))) ||
    (bestKind === 'bench' &&
      (minReachablePlayerSlots.length > 1 ||
        !hasUniqueAugmentingPath(slots, occupantBySlot, playerMetaById, player, (idx) => idx === bestSlot)));
  if (ambiguous) {
    const newPoints = new Map(basePoints);
    newPoints.set(player.playerId, points);
    const fresh = prepareLineup(base.settings, [...base.players, player], newPoints);
    const slotIndex = fresh.occupantBySlot.indexOf(player.playerId);
    return { state: fresh, result: lineupResultFromState(fresh), addedPlayerSlot: slotIndex === -1 ? null : fresh.slots[slotIndex] ?? null };
  }

  const newPoints = new Map(basePoints);
  newPoints.set(player.playerId, points);
  const newPlayerMetaById = new Map(playerMetaById);
  newPlayerMetaById.set(player.playerId, player);
  const players = [...base.players, player];
  const activePlayerIds = [...base.activePlayerIds, player.playerId];

  if (bestKind === 'none') {
    const state: PreparedLineup = { ...base, players, points: newPoints, playerMetaById: newPlayerMetaById, activePlayerIds };
    return { state, result: lineupResultFromState(state), addedPlayerSlot: null };
  }

  // Reconstruct the chain from x to bestSlot and apply the cascade: x takes chain[0], chain[0]'s
  // old occupant moves to chain[1], and so on; whatever falls off the end is either `null` (the
  // empty-slot case) or the player being benched (the bench case).
  const chain: number[] = [];
  for (let cur = bestSlot; cur !== -1; cur = parent[cur] as number) chain.unshift(cur);

  const newOccupantBySlot = [...occupantBySlot];
  let incoming: PlayerId | null = player.playerId;
  for (const slotIndex of chain) {
    const outgoing = newOccupantBySlot[slotIndex] ?? null;
    newOccupantBySlot[slotIndex] = incoming;
    incoming = outgoing;
  }

  const playerIndexById = new Map(players.map((entry, index) => [entry.playerId, index]));
  const slotPlayerIndex = newOccupantBySlot.map((id) => (id == null ? null : playerIndexById.get(id) ?? null));

  const state: PreparedLineup = {
    ...base,
    players,
    slotPlayerIndex,
    occupantBySlot: newOccupantBySlot,
    points: newPoints,
    playerMetaById: newPlayerMetaById,
    activePlayerIds,
    value: base.value + bestValue,
  };
  const addedPlayerSlot = slots[chain[0] as number] ?? null;
  return { state, result: lineupResultFromState(state), addedPlayerSlot };
}
