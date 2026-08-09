import type { AdpEntry, PlayerId, PlayerMeta, Position, RosterSlot } from '../../../shared/types';
import type { PreparedLineup } from './eligibility';
import { comparePlayersByScoreDesc } from './ranking';
import type { Rng } from './rng';

/**
 * The opponent-pick model for S3's rollouts: per-scenario ADP noise plus a bounded roster-need
 * bonus (PLAN.md §6). Deliberately not "every opponent blindly follows ADP" — see PLAN.md's
 * research corrections — but also deliberately simple: a single noise term and a single capped
 * need term, calibrated later in S6 against a recorded mock, not tuned here.
 */

export interface OpponentModelConfig {
  /** Multiplies each player's own ADP stdev to get that player's shock stdev. Uncalibrated pending S6. */
  shockScale: number;
  /** NEED_CAP, in pick-equivalents. Uncalibrated pending S6. */
  needBonusCap: number;
  /** M — how many of the base priority order's undrafted entries a single simulated pick scans
   * before taking the argmin. Keeps a scenario's per-pick cost bounded regardless of pool size. */
  candidateWindow: number;
  /** Stdev used when a real ADP row exists but reports stdev <= 0 (a degenerate/single-sample entry). */
  fallbackStdev: number;
  /** Spacing between consecutive synthetic ADP values at a position with no observed ADP rows. */
  syntheticStep: number;
  /** Last-resort "deepest ADP" when there is no ADP data at all, for any position, in the pool
   * (`teams * rounds` is the documented choice — the caller supplies it since this module doesn't
   * know the draft's shape). */
  noAdpAtAllFallback: number;
}

const DEDICATED_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function isDedicatedPositionSlot(slot: RosterSlot): slot is Position {
  return (DEDICATED_POSITIONS as readonly RosterSlot[]).includes(slot);
}

// ---------------------------------------------------------------------------
// Opponent pool: real ADP + synthetic ADP for scored-but-unlisted players
// ---------------------------------------------------------------------------

export interface EffectiveAdpEntry {
  readonly playerId: PlayerId;
  /** Canonical `PlayerMeta.position` — never null; null-position players are excluded entirely
   * (see `unscoredPositionCount`), not bucketed under a guess. */
  readonly position: Position;
  readonly adp: number;
  readonly stdev: number;
  readonly synthetic: boolean;
}

export interface OpponentPool {
  /** Every opponent-draftable player, sorted by `playerId` ascending — a canonical, caller-order-
   * independent iteration order, which is what makes per-scenario shock draws (one draw per entry,
   * in this order) reproducible regardless of how `remainingPlayers` was constructed upstream. */
  readonly entries: readonly EffectiveAdpEntry[];
  /** Count of `entries` with `synthetic: true` — scoped to *this* pool (the undrafted scored
   * players passed in for *this* board), not the static full-dataset figure. Rescope this at every
   * call site: it is meaningless cached across picks. */
  readonly syntheticAdpCount: number;
  /** Scored players excluded because `position === null` — see `EffectiveAdpEntry.position`'s doc.
   * Not currently reachable with the committed data (no scored player has a null position today),
   * but `PlayerMeta.position` is typed `Position | null`, so this is real defensive accounting, not
   * dead code. */
  readonly unscoredPositionCount: number;
}

/** Builds the opponent-draftable pool from the undrafted scored player set. Real ADP rows are used
 * as-is (with `fallbackStdev` substituted for a degenerate non-positive stdev); scored players with
 * no ADP row get a synthetic entry placed past the deepest observed ADP at their position, so they
 * remain samplable by opponents instead of showing spurious 100%-survival (PLAN.md's no-lost-player
 * contract — see this module's header and the S3 stage-B plan note on the 413/256/249/164 gap). */
export function buildOpponentPool(
  remainingPlayers: readonly PlayerMeta[],
  scores: ReadonlyMap<PlayerId, number>,
  adp: readonly AdpEntry[],
  config: OpponentModelConfig,
  /** Full scored player universe used only to establish the observed ADP depth/spread reference.
   * Defaults to `remainingPlayers` for direct callers/tests, but simulation callers must pass the
   * full universe: drafted observed players still determine where synthetic ADP begins. */
  observedScoredPlayers: readonly PlayerMeta[] = remainingPlayers,
): OpponentPool {
  const adpByPlayerId = new Map<PlayerId, AdpEntry>();
  for (const entry of adp) {
    if (entry.playerId != null) adpByPlayerId.set(entry.playerId, entry);
  }

  const withObservedAdp: EffectiveAdpEntry[] = [];
  const needingSynthetic: PlayerMeta[] = [];
  const observedByPosition = new Map<Position, { adp: number; stdev: number }[]>();
  let unscoredPositionCount = 0;

  for (const player of observedScoredPlayers) {
    if (player.position == null || !scores.has(player.playerId)) continue;
    const observed = adpByPlayerId.get(player.playerId);
    if (!observed) continue;
    const stdev = observed.stdev > 0 ? observed.stdev : config.fallbackStdev;
    const list = observedByPosition.get(player.position);
    if (list) list.push({ adp: observed.adp, stdev });
    else observedByPosition.set(player.position, [{ adp: observed.adp, stdev }]);
  }

  for (const player of remainingPlayers) {
    if (!scores.has(player.playerId)) continue;
    if (player.position == null) {
      unscoredPositionCount += 1;
      continue;
    }
    const observed = adpByPlayerId.get(player.playerId);
    if (observed) {
      const stdev = observed.stdev > 0 ? observed.stdev : config.fallbackStdev;
      withObservedAdp.push({ playerId: player.playerId, position: player.position, adp: observed.adp, stdev, synthetic: false });
    } else {
      needingSynthetic.push(player);
    }
  }

  const allObserved = [...observedByPosition.values()].flat();
  const globalDeepest = allObserved.length ? Math.max(...allObserved.map((o) => o.adp)) : null;
  const globalSpread = allObserved.length ? Math.max(...allObserved.map((o) => o.stdev)) : null;

  function deepestFor(position: Position): number {
    const list = observedByPosition.get(position);
    if (list?.length) return Math.max(...list.map((o) => o.adp));
    return globalDeepest ?? config.noAdpAtAllFallback;
  }
  function spreadFor(position: Position): number {
    const list = observedByPosition.get(position);
    if (list?.length) return Math.max(...list.map((o) => o.stdev));
    return globalSpread ?? config.fallbackStdev;
  }

  // Group the synthetic-needing players by position, order each group by projected points desc
  // (tie-broken by playerId ascending — matches replacement.ts/tiers.ts's existing convention), and
  // space them out past that position's deepest observed ADP.
  const byPosition = new Map<Position, PlayerMeta[]>();
  for (const player of needingSynthetic) {
    const position = player.position as Position; // narrowed above (null already filtered out)
    const list = byPosition.get(position);
    if (list) list.push(player);
    else byPosition.set(position, [player]);
  }

  const synthetic: EffectiveAdpEntry[] = [];
  for (const [position, players] of byPosition) {
    const ordered = [...players].sort(comparePlayersByScoreDesc(scores));
    const deepest = deepestFor(position);
    const stdev = spreadFor(position);
    ordered.forEach((player, index) => {
      synthetic.push({
        playerId: player.playerId,
        position,
        adp: deepest + config.syntheticStep * (index + 1),
        stdev,
        synthetic: true,
      });
    });
  }

  const entries = [...withObservedAdp, ...synthetic].sort((a, b) => a.playerId.localeCompare(b.playerId));
  return { entries, syntheticAdpCount: synthetic.length, unscoredPositionCount };
}

// ---------------------------------------------------------------------------
// Per-scenario priority order (ADP + shock) and the windowed argmin pick
// ---------------------------------------------------------------------------

export interface PriorityEntry {
  readonly playerId: PlayerId;
  readonly position: Position;
  /** `adp + Normal(0, shockScale * stdev)` — lower drafts sooner. Does not include any team's need
   * bonus; that is applied per-pick in `pickForTeam` since it depends on who is on the clock. */
  readonly value: number;
}

/** Draws one shock per pool entry from `rng` (in the pool's canonical `playerId`-ascending order,
 * so the draw sequence doesn't depend on incidental array construction order) and returns entries
 * sorted by the shocked value ascending, tie-broken by `playerId`. Call this **once per scenario**
 * and reuse the result across the baseline rollout and every candidate's forced rollout in that
 * scenario — that shared-shocks reuse is the "common random numbers" property that keeps VONA
 * *differences* between candidates low-variance (PLAN.md §6/S3 stage-B). */
export function computeScenarioPriorities(pool: OpponentPool, rng: Rng, config: OpponentModelConfig): PriorityEntry[] {
  const withShocks = pool.entries.map((entry) => ({
    playerId: entry.playerId,
    position: entry.position,
    value: entry.adp + rng.standardNormal() * config.shockScale * entry.stdev,
  }));
  withShocks.sort((a, b) => a.value - b.value || a.playerId.localeCompare(b.playerId));
  return withShocks;
}

/**
 * Simulates one opponent pick: scans the first `candidateWindow` **undrafted** entries of the
 * (already shocked and sorted) base priority order, applies the team's per-position need bonus to
 * each, and takes the argmin (tie-broken by `playerId`). Returns `null` if fewer than one undrafted
 * entry remains within the window (pool exhausted) — the caller (`simulate.ts`) must handle that as
 * "no more simulatable opponent picks," not a crash.
 *
 * Scanning only a bounded window (rather than re-sorting the whole pool with the need term added)
 * is a deliberate approximation: a position needs an implausibly large need bonus to promote a
 * player from outside the top `candidateWindow` of the base (need-agnostic) order, so the window
 * only needs to be wide enough to plausibly reorder *within* itself.
 */
export function pickForTeam(
  basePriorityOrder: readonly PriorityEntry[],
  drafted: ReadonlySet<PlayerId>,
  needBonusByPosition: ReadonlyMap<Position, number>,
  candidateWindow: number,
): PlayerId | null {
  let scanned = 0;
  let best: { playerId: PlayerId; adjusted: number } | null = null;
  for (const entry of basePriorityOrder) {
    if (drafted.has(entry.playerId)) continue;
    if (scanned >= candidateWindow) break;
    scanned += 1;
    const adjusted = entry.value - (needBonusByPosition.get(entry.position) ?? 0);
    if (!best || adjusted < best.adjusted || (adjusted === best.adjusted && entry.playerId < best.playerId)) {
      best = { playerId: entry.playerId, adjusted };
    }
  }
  return best?.playerId ?? null;
}

// ---------------------------------------------------------------------------
// Roster-need accounting
// ---------------------------------------------------------------------------

/**
 * Per-position need bonus for one team's current roster, derived from a `PreparedLineup`'s optimal
 * **assignment** rather than a tally of roster players by position — the assignment gives exactly
 * one occupant per slot, so counting unfilled slots by slot type is inherently non-double-counting
 * regardless of any player's cross-eligibility (a player eligible at RB and WR is one occupant of
 * one slot, never counted against both RB and WR need). FLEX-family slots are excluded: need is
 * reported only for dedicated (`QB`/`RB`/`WR`/`TE`/`K`/`DEF`) slots.
 *
 * Takes an already-`prepareLineup`'d state rather than raw roster players so `simulate.ts` can
 * maintain each team's roster incrementally across a scenario's opponent-pick window via
 * `addPlayerToLineup` (Stage A) — recomputing this from scratch on every single simulated pick
 * would reintroduce the O(2^n) full-DP cost per pick that Stage A exists to avoid. The roster used
 * to build `prepared` must already exclude any pick the crosswalk couldn't match
 * (`playerId === null`) — such a pick consumes a bench spot (accounted for elsewhere, in the
 * roster-is-full check) but has no known position, so it must contribute zero to positional need
 * rather than being guessed at.
 */
export function needBonusFromLineup(
  prepared: PreparedLineup,
  config: OpponentModelConfig,
): ReadonlyMap<Position, number> {
  const totalByPosition = new Map<Position, number>();
  const unfilledByPosition = new Map<Position, number>();
  prepared.slots.forEach((slot, index) => {
    if (!isDedicatedPositionSlot(slot)) return;
    totalByPosition.set(slot, (totalByPosition.get(slot) ?? 0) + 1);
    if ((prepared.occupantBySlot[index] ?? null) == null) {
      unfilledByPosition.set(slot, (unfilledByPosition.get(slot) ?? 0) + 1);
    }
  });

  const bonus = new Map<Position, number>();
  for (const position of DEDICATED_POSITIONS) {
    const total = totalByPosition.get(position) ?? 0;
    if (total === 0) continue;
    const unfilled = unfilledByPosition.get(position) ?? 0;
    bonus.set(position, config.needBonusCap * (unfilled / total));
  }
  return bonus;
}
