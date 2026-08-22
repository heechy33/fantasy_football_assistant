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

/**
 * Value-only exact lineup solve: returns `optimizeLineup(...).value` at a fraction of the cost,
 * for callers that read only the optimal *value* and never occupant identity. The historical
 * backtest scores ~185 (team, week) cells per draft with `optimizeLineup`'s string-keyed BigInt
 * memo, which measured ~28ms/solve on a real 16-man roster — infeasible at ~1,200 drafts.
 *
 * Same DP, same eligibility (`accepts`), same tie-break semantics — the count tie-break in
 * `solveIndexed` selects WHICH equal-value assignment is canonical and never changes the optimum's
 * value, so dropping it (and the identity-tracking `picks` array) leaves the value exact. The memo
 * stores only the scalar value under an integer `mask * (slots + 1) + slot` key (exact within 2^53
 * for <= 30 scored players) instead of a BigInt-interpolated string key. For more than 30 scored
 * players (beyond safe 32-bit mask range) it falls back to `optimizeLineup`.
 *
 * Verified against `optimizeLineup` by a randomized property suite (`backtest.test.ts`) so this
 * path can never drift from the canonical solver — it is a performance profile, not a new algorithm.
 */
export function optimizeLineupValue(
  settings: LeagueSettings,
  players: readonly PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
): number {
  const slots = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR');
  const playerById = new Map(players.map((player) => [player.playerId, player]));
  const ids = players.filter((player) => projectedPoints.has(player.playerId)).map((player) => player.playerId);
  if (ids.length > 30) return optimizeLineup(settings, players as PlayerMeta[], projectedPoints).value;

  const points = ids.map((id) => projectedPoints.get(id) ?? 0);
  const slotEligibilityMask = slots.map((slot) => {
    let mask = 0;
    ids.forEach((id, index) => {
      const player = playerById.get(id);
      if (player && accepts(slot, player)) mask |= 1 << index;
    });
    return mask;
  });
  const fullMask = ids.length ? (1 << ids.length) - 1 : 0;
  const slotCount = slots.length;
  const memo = new Map<number, number>();

  function solve(slotIndex: number, remainingMask: number): number {
    if (slotIndex >= slotCount) return 0;
    const key = remainingMask * (slotCount + 1) + slotIndex;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    // Leaving a slot empty is legal for partial rosters and makes the solver
    // useful before a full mock draft is complete.
    let best = solve(slotIndex + 1, remainingMask);
    const eligible = (slotEligibilityMask[slotIndex] ?? 0) & remainingMask;
    for (let index = 0; index < ids.length; index += 1) {
      const bit = 1 << index;
      if (!(eligible & bit)) continue;
      const sub = solve(slotIndex + 1, remainingMask & ~bit);
      const value = (points[index] ?? 0) + sub;
      if (value > best) best = value;
    }
    memo.set(key, best);
    return best;
  }

  return solve(0, fullMask);
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
 * `eligibilityIncremental.test.ts`'s property suite history). On real committed FFToday data this
 * bites far more often than "essentially never" — S3 measured an 11% ambiguity rate deep in a draft
 * (many tied low/zero-point bench-tier rows), and each fallback costs a full re-solve (~33ms on a
 * 15-man roster) — so `resolveAmbiguityExactly` (below) lets a caller that only needs `.result.value`
 * skip it. `state.value` is exact regardless of which tied option is taken (see below); the fallback
 * exists only to match the reference DP's specific choice of *identity* — who's benched/placed —
 * for callers (e.g. `recommend.ts`'s displayed `assignedRosterSlot`) that show that identity to a
 * user. Every other path is the fast O(slots^2) search.
 *
 * One tie is deliberately NOT treated as ambiguous: "leave the candidate unassigned" tying a
 * reachable bench-cascade at net value 0. `bestValue` there is unambiguously 0 either way, so
 * `state.value` stays exact — only *who* ends up benched could differ from the reference DP's
 * choice. This is common with real data (many literal zero-point bench-tier rows, e.g. sparse
 * K/DEF projection coverage) and treating it as ambiguous turned routine boards into dozens of
 * unnecessary full re-solves; see this function's ambiguity check below for detail.
 */
/**
 * BFS over slot-eligibility hops from `player`'s directly-eligible slots, exactly as
 * `addPlayerToLineup` used to compute inline (extracted, not changed, so its exactness proof still
 * applies verbatim). Returns every empty slot and every occupied slot reachable through a chain of
 * displacements, plus the BFS parent pointers `addPlayerToLineup` needs to reconstruct the winning
 * chain. `benchDepthValue` below reuses this to find which starter(s) a bench candidate could
 * actually replace, without duplicating the traversal.
 */
function reachableSlotsFor(
  base: PreparedLineup,
  player: PlayerMeta,
): { reachableEmptySlots: number[]; reachableOccupiedSlots: number[]; parent: number[] } {
  const { slots, occupantBySlot, playerMetaById } = base;
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

  return { reachableEmptySlots, reachableOccupiedSlots, parent };
}

// ---------------------------------------------------------------------------
// Bench depth value (S3 bench-mode fix) — see PLAN.md's bench-mode revision. Once
// `coreStartingSlotsFilled` is true, `addPlayerToLineup`'s marginal value collapses to `max(0,
// points - worstReachableStarter)`, which is exactly 0 for almost every remaining candidate: there
// is no empty slot left to claim, so a bench pickup can only ever look like a displacement of an
// already-rostered starter, never like the real thing it actually is — insurance against that
// starter missing games. `benchDepthValue` prices that insurance directly instead of pretending the
// depth pickup competes with the starter today.
// ---------------------------------------------------------------------------

/** Season length assumed for the bye/health weighting below. Not league-configurable today — every
 * supported provider plays a 17-week regular season. */
export const SEASON_WEEKS = 17;
export const NON_BYE_WEEKS = SEASON_WEEKS - 1;

/** Prior applied when a player has no observed `PlayerUsage.availabilityRate` (rookies, sparse
 * history, or the caller simply didn't supply usage data). Deliberately the population-typical
 * rate, not 0 or 1 — an unknown player should read as average-durable, never as "never plays" or
 * "never misses a game." Revisit against real `data/player-usage.json` availabilityRate distribution
 * if this default starts visibly skewing bench ordering. */
export const DEFAULT_AVAILABILITY_RATE = 0.85;

/**
 * Season-long expected fraction of games `incumbent` misses — the weight `benchDepthValue` applies
 * to a bench candidate's point gap over replacement. Two independent, additive risk sources, each
 * documented as a labeled heuristic (not a calibrated hazard model — see the S3 bench-mode plan):
 *   - **bye-week collision**: if `incumbent`'s bye differs from `candidate`'s, `candidate` is
 *     guaranteed a start that one week regardless of health, contributing exactly `1/SEASON_WEEKS`.
 *     A shared bye contributes nothing (the candidate can't help that week either).
 *   - **health**: `1 - availabilityRate` (a pooled prior-season games-played fraction, not a medical
 *     forecast) applied across the remaining non-bye weeks.
 * Bounded to `[0, 1]`. Returns `1` when there is no incumbent at all (nothing to weight against).
 */
export function expectedUnavailableFraction(
  incumbent: PlayerMeta | null,
  candidate: PlayerMeta,
  availabilityByPlayer: ReadonlyMap<PlayerId, number>,
): number {
  if (!incumbent) return 1;
  const byeCollision = incumbent.byeWeek != null && incumbent.byeWeek === candidate.byeWeek;
  const byeContribution = incumbent.byeWeek != null && !byeCollision ? 1 : 0;
  const rate = availabilityByPlayer.get(incumbent.playerId) ?? DEFAULT_AVAILABILITY_RATE;
  const healthWeeks = Math.max(0, 1 - rate) * NON_BYE_WEEKS;
  return Math.min(1, Math.max(0, (byeContribution + healthWeeks) / SEASON_WEEKS));
}

/**
 * Marginal value of rostering `player` as bench depth once no empty/displaceable starter slot makes
 * them a real starter-value upgrade today (see this section's header doc). `0` in every case
 * `addPlayerToLineup`'s MRV already prices — an open slot, or a reachable incumbent `player` already
 * beats outright — so this is additive insurance value, never a duplicate of MRV.
 *
 * Reuses `reachableSlotsFor` to find which rostered starter(s) `player` is even eligible to replace,
 * takes the worst (lowest-point) reachable incumbent as "who this bench slot actually insures," and
 * weights the gap between `player` and the position's replacement level (streaming off waivers, not
 * a second roster spot — `replacementPointsByPosition`, already computed each board build) by that
 * incumbent's `expectedUnavailableFraction`. A healthy, well-covered starter (low unavailable
 * fraction) makes a backup at that position worth little; a battered or bye-colliding starter makes
 * the same backup worth much more — which is what derives "don't draft a QB2 in a 1-QB league" and
 * "build RB/WR depth" from the value function itself rather than hard-coding either rule.
 */
export function benchDepthValue(
  base: PreparedLineup,
  player: PlayerMeta,
  points: number,
  replacementPointsByPosition: ReadonlyMap<string, number>,
  availabilityByPlayer: ReadonlyMap<PlayerId, number>,
): number {
  const { reachableEmptySlots, reachableOccupiedSlots } = reachableSlotsFor(base, player);
  if (reachableEmptySlots.length > 0 || reachableOccupiedSlots.length === 0) return 0;

  let minPoints = Infinity;
  let worstIncumbent: PlayerMeta | null = null;
  for (const slotIndex of reachableOccupiedSlots) {
    const occupant = base.occupantBySlot[slotIndex];
    if (occupant == null) continue;
    const occupantPoints = base.points.get(occupant) ?? 0;
    if (occupantPoints < minPoints) {
      minPoints = occupantPoints;
      worstIncumbent = base.playerMetaById.get(occupant) ?? null;
    }
  }
  if (!worstIncumbent) return 0;

  // A filled roster is not necessarily a settled roster: an available player can still be a
  // genuine starter upgrade by displacing this reachable incumbent. That gain is already MRV and
  // must remain on the starter path in `recommend.ts`, never be double-counted as insurance.
  if (points > minPoints) return 0;

  const replacement = player.position ? replacementPointsByPosition.get(player.position) ?? 0 : 0;
  const gap = Math.max(0, points - replacement);
  if (gap === 0) return 0;
  const weight = expectedUnavailableFraction(worstIncumbent, player, availabilityByPlayer);
  return weight * gap;
}

export interface RosterUtility {
  /** Exact optimized starter production already carried by `PreparedLineup.value`. */
  starterValue: number;
  /** Maximum non-overlapping insurance value supplied by the optimized lineup's bench. */
  depthValue: number;
  total: number;
}

const DEPTH_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

/**
 * Values the whole bench as a portfolio instead of summing each player's best individual backup
 * assignment. Bench players are matched one-to-one with occupied core starter-slot instances, so
 * (for example) one WR cannot insure both WR2 and FLEX. FLEX eligibility is delegated to the same
 * `accepts` predicate as the starter solver. Empty slots and K/DEF are deliberately excluded: an
 * open starter is priced by `starterValue`, while special teams retain their draft-schedule policy.
 *
 * The DP's mask is over starter slots (normally fewer than 12), not rostered players, keeping a
 * full rematch cheap enough to use for candidate and follow-up states.
 */
export function depthPortfolioValue(
  base: PreparedLineup,
  replacementPointsByPosition: ReadonlyMap<string, number>,
  availabilityByPlayer: ReadonlyMap<PlayerId, number>,
): number {
  const occupiedCoreSlots = base.slots
    .map((slot, index) => ({ slot, index, incumbentId: base.occupantBySlot[index] ?? null }))
    .filter(({ slot, incumbentId }) => slot !== 'K' && slot !== 'DEF' && incumbentId != null);
  if (occupiedCoreSlots.length === 0) return 0;

  const starters = new Set(occupiedCoreSlots.map(({ incumbentId }) => incumbentId as PlayerId));
  const bench = base.activePlayerIds
    .filter((id) => !starters.has(id))
    .map((id) => base.playerMetaById.get(id))
    .filter((player): player is PlayerMeta => player != null && player.position != null && DEPTH_POSITIONS.has(player.position));
  if (bench.length === 0) return 0;

  const edges = bench.map((candidate) => {
    const points = base.points.get(candidate.playerId) ?? 0;
    const replacement = candidate.position ? replacementPointsByPosition.get(candidate.position) ?? 0 : 0;
    const productionGap = Math.max(0, points - replacement);
    return occupiedCoreSlots.map(({ slot, incumbentId }) => {
      if (productionGap === 0 || !accepts(slot, candidate)) return 0;
      const incumbent = incumbentId == null ? null : base.playerMetaById.get(incumbentId) ?? null;
      return productionGap * expectedUnavailableFraction(incumbent, candidate, availabilityByPlayer);
    });
  });

  // Standard fantasy lineups have far fewer than 31 core slots. A numeric mask avoids allocating
  // BigInts and string keys in the candidate-pair hot path (hundreds of exact rematches per board).
  // Preserve a BigInt fallback for exotic custom leagues whose core lineup exceeds that bound.
  if (occupiedCoreSlots.length <= 30) {
    const memo = Array.from({ length: bench.length }, () => new Map<number, number>());
    function bestNumeric(benchIndex: number, usedSlots: number): number {
      if (benchIndex >= bench.length) return 0;
      const cached = memo[benchIndex]?.get(usedSlots);
      if (cached !== undefined) return cached;
      let value = bestNumeric(benchIndex + 1, usedSlots);
      for (let slotIndex = 0; slotIndex < occupiedCoreSlots.length; slotIndex += 1) {
        const edge = edges[benchIndex]?.[slotIndex] ?? 0;
        const bit = 1 << slotIndex;
        if (edge <= 0 || (usedSlots & bit) !== 0) continue;
        value = Math.max(value, edge + bestNumeric(benchIndex + 1, usedSlots | bit));
      }
      memo[benchIndex]?.set(usedSlots, value);
      return value;
    }
    return bestNumeric(0, 0);
  }

  const memo = new Map<string, number>();
  function bestBigInt(benchIndex: number, usedSlots: bigint): number {
    if (benchIndex >= bench.length) return 0;
    const key = `${benchIndex}:${usedSlots}`;
    const cached = memo.get(key);
    if (cached != null) return cached;
    let value = bestBigInt(benchIndex + 1, usedSlots);
    for (let slotIndex = 0; slotIndex < occupiedCoreSlots.length; slotIndex += 1) {
      const edge = edges[benchIndex]?.[slotIndex] ?? 0;
      const bit = 1n << BigInt(slotIndex);
      if (edge <= 0 || (usedSlots & bit) !== 0n) continue;
      value = Math.max(value, edge + bestBigInt(benchIndex + 1, usedSlots | bit));
    }
    memo.set(key, value);
    return value;
  }

  return bestBigInt(0, 0n);
}

/** Shared terminal objective for starter, transition, and bench states. */
export function rosterUtility(
  base: PreparedLineup,
  replacementPointsByPosition: ReadonlyMap<string, number>,
  availabilityByPlayer: ReadonlyMap<PlayerId, number>,
): RosterUtility {
  const depthValue = depthPortfolioValue(base, replacementPointsByPosition, availabilityByPlayer);
  return { starterValue: base.value, depthValue, total: base.value + depthValue };
}

export function addPlayerToLineup(
  base: PreparedLineup,
  player: PlayerMeta,
  points: number,
  /**
   * When `false`, skip the exact re-solve on an ambiguous tie and instead apply whichever tied
   * option the O(slots^2) reachability search already found — still an *optimal-value* assignment
   * (augmenting-path optimality holds starting from any tied-optimal state, not only the DP's
   * canonical one — see `eligibilityIncremental.test.ts`'s value-invariance property suite), so
   * `state.value` remains exact at this step and stays exact through any further incremental chain
   * built on top of it. Only the specific occupant identity can differ from the canonical DP choice.
   *
   * Default `true` (today's exact behavior) for any caller that surfaces occupant identity to a
   * user — `recommend.ts`'s S2 board reads `addedPlayerSlot`/`LineupResult.assignments` for the
   * displayed "currently fits <slot>" explanation, so it must keep the canonical identity.
   *
   * Pass `false` only where identity is provably unobserved: `simulate.ts`'s Stage C rollout reads
   * only `.result.value` from every one of its hot-path calls (`bestFollowUpValue`'s per-survivor
   * gain, `runSimulation`'s per-candidate MRV, and `simulateOpponentWindow`'s team-roster tracking,
   * which `opponentModel.ts`'s `needBonusFromLineup` reduces to a per-*dedicated-slot* filled/empty
   * count — see that function's doc). The one true edge case this doesn't cover: a player with
   * *dedicated* (non-FLEX) eligibility at two positions who ties for two different empty dedicated
   * slots could occasionally shift *which position* an opponent is modeled as needing. Opponent
   * need-bonus modeling is already documented "Uncalibrated pending S6," so this narrow imprecision
   * is within that existing tolerance — it never reaches the displayed VONA/lookahead numbers, which
   * only ever consume `.result.value`.
   */
  resolveAmbiguityExactly = true,
): { state: PreparedLineup; result: LineupResult; addedPlayerSlot: RosterSlot | null } {
  const { slots, occupantBySlot, playerMetaById, points: basePoints } = base;

  const { reachableEmptySlots, reachableOccupiedSlots, parent } = reachableSlotsFor(base, player);

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
  if (ambiguous && resolveAmbiguityExactly) {
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
