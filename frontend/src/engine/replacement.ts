import type { AdpEntry, LeagueSettings, PlayerId, PlayerMeta } from '../../../shared/types';
import { comparePlayersByScoreDesc } from './ranking';

export const REPLACEMENT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

export interface ReplacementLevel {
  position: string;
  /** Index actually used against the pool passed in. `max(MIN_REPLACEMENT_RANK, leagueDemandRank -
   * consumed)` when a demand context is supplied. */
  rank: number;
  /** Expected league-wide rostered count at this position (starters + a bench/late-round share),
   * independent of what has actually been drafted. See `positionalDemand`. */
  demand: number;
  /** `demand + 1` — "first player nobody is expected to roster." Kept as a separate field (rather
   * than folding the `+1` into `demand`) because `remainingReplacementRank` is written against this
   * value, and every existing fixture/test is pinned to that convention. */
  leagueDemandRank: number;
  /** The old S2 starters-only figure (named starters + FLEX share + 1), retained for explanation and
   * as the floor `positionalDemand` never lets `leagueDemandRank` fall below. */
  starterDemandRank: number;
  /** Players at this position already removed from the scored pool (drafted ∩ scored). */
  consumed: number;
  playerId: PlayerId | null;
  points: number;
  /** True once market demand at this position (`demand`) has been fully consumed. This is *not* "the
   * replacement baseline is the best remaining player" — `MIN_REPLACEMENT_RANK` prevents that case
   * outright. It only means the level is now tracking further into what would have been late-bench
   * territory than the demand model expected. */
  exhausted: boolean;
  /** True when `MIN_REPLACEMENT_RANK` actually raised the rank above what `leagueDemandRank -
   * consumed` alone would have given — i.e. the floor did real work, not just the demand model. */
  floored: boolean;
}

export function starterReplacementRank(settings: LeagueSettings, position: string): number {
  const named = settings.startingSlots.filter((slot) => slot === position).length * settings.teams;
  const flex = settings.startingSlots.filter((slot) => ['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'].includes(slot)).length;
  // K/DEF are never FLEX-eligible (see eligibility.ts's accepts()); QB only
  // shares FLEX pressure when SUPER_FLEX/two-QB makes it FLEX-eligible.
  const flexEligible = position === 'RB' || position === 'WR' || position === 'TE' || (position === 'QB' && settings.format.qb !== 'one-qb');
  const flexShare = flexEligible ? Math.ceil(flex * settings.teams / 3) : 0;
  return Math.max(1, named + flexShare + 1);
}

/** @deprecated Use {@link starterReplacementRank}. Kept as an alias so any external caller that
 * imported the old name doesn't silently break; the S2 UI/engine no longer calls this directly. */
export const replacementRank = starterReplacementRank;

/** Total draftable spots per team: every `rosterSlots` count (bench included) except `IR`, which is
 * not real draft capacity. Falls back to the starting-lineup count (minus `BN`/`IR`) when
 * `rosterSlots` is partial or absent — Sleeper mock-draft settings carry no `BN` entry
 * (`adapters/sleeper.ts`'s `normalizeMockDraftSettings`), so this floor keeps the number sane but is
 * NOT a substitute for a real bench count. Callers with a real round count (e.g. `DraftInit.rounds`)
 * should pass `positionalDemand`'s `rosterSpotsPerTeam` override instead of relying on this alone. */
export function rosterSpotsPerTeam(settings: LeagueSettings): number {
  let total = 0;
  for (const [slot, count] of Object.entries(settings.rosterSlots)) {
    if (slot === 'IR') continue;
    total += count ?? 0;
  }
  const starters = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR').length;
  return Math.max(total, starters, 1);
}

/** Frozen **proportions** (not absolute counts) so the fallback scales to any league size and never
 * drifts when `data/adp-*.json` is refreshed. Derived once from the committed 2026 PPR ADP board's
 * positional mix over a standard 12-team x 15-round universe; not recomputed at runtime. */
export const DEFAULT_POSITION_MIX: Readonly<Record<(typeof REPLACEMENT_POSITIONS)[number], number>> = {
  RB: 0.28, WR: 0.38, QB: 0.12, TE: 0.10, DEF: 0.06, K: 0.05,
};

export interface PositionalDemand {
  readonly byPosition: ReadonlyMap<string, number>;
  readonly source: 'adp' | 'adp-extrapolated' | 'default-mix';
  /** `teams x rosterSpotsPerTeam` — the target the pre-guardrail allocation sums to exactly. */
  readonly rosterSpots: number;
  /** How many ADP rows were usable (matched `playerId`, scored, known position). */
  readonly usableRows: number;
}

export interface PositionalDemandInput {
  settings: LeagueSettings;
  adp: readonly AdpEntry[];
  /** Overrides `rosterSpotsPerTeam(settings)` — pass a real round count (e.g. `DraftInit.rounds`)
   * when available, since Sleeper mock-draft settings carry no `BN` count (see
   * `rosterSpotsPerTeam`'s doc). */
  rosterSpotsPerTeam?: number;
  /** Restricts usable ADP rows to scored players, aligning demand's units with
   * `consumedByPosition` (drafted ∩ scored). Omit to count every positioned, matched row. */
  scoredPlayerIds?: ReadonlySet<PlayerId>;
}

/** Largest-remainder (Hamilton) apportionment of `total` across `proportions`, tie-broken by
 * `REPLACEMENT_POSITIONS` order so the result is deterministic and always sums to exactly `total`. */
function apportion(proportions: ReadonlyMap<string, number>, total: number): Map<string, number> {
  const positions = REPLACEMENT_POSITIONS.filter((p) => (proportions.get(p) ?? 0) > 0);
  const totalWeight = positions.reduce((sum, p) => sum + (proportions.get(p) ?? 0), 0);
  const result = new Map<string, number>();
  if (totalWeight <= 0 || total <= 0) {
    for (const p of REPLACEMENT_POSITIONS) result.set(p, 0);
    return result;
  }
  const exact = positions.map((p) => ({ p, raw: (total * (proportions.get(p) ?? 0)) / totalWeight }));
  let allocated = 0;
  for (const { p, raw } of exact) {
    const floor = Math.floor(raw);
    result.set(p, floor);
    allocated += floor;
  }
  let remainder = total - allocated;
  const byFraction = [...exact].sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw))
    || REPLACEMENT_POSITIONS.indexOf(a.p as (typeof REPLACEMENT_POSITIONS)[number]) - REPLACEMENT_POSITIONS.indexOf(b.p as (typeof REPLACEMENT_POSITIONS)[number]));
  for (const { p } of byFraction) {
    if (remainder <= 0) break;
    result.set(p, (result.get(p) ?? 0) + 1);
    remainder -= 1;
  }
  for (const p of REPLACEMENT_POSITIONS) if (!result.has(p)) result.set(p, 0);
  return result;
}

const namedSlotCount = (settings: LeagueSettings, position: string): number =>
  settings.startingSlots.filter((slot) => slot === position).length * settings.teams;

/**
 * Expected league-wide rostered count per position — the input to `remainingReplacementRank`.
 * Replaces a pure starters count (which clamps to the best remaining player once starter demand is
 * consumed, pinning that player's value to 0 — see this module's `exhausted`/`floored` doc) with a
 * demand model that keeps draining sensibly into bench/late-round territory.
 *
 * Three exhaustive tiers, chosen by how much of the target universe (`teams x rosterSpotsPerTeam`
 * ADP rows) is actually usable — matched `playerId`, scored, known position. Full coverage uses
 * real counts directly; coverage of at least 50% is extrapolated; anything below 50% uses the
 * frozen default mix. Extrapolation and fallback use largest-remainder rounding so the
 * pre-guardrail allocation sums to exactly `rosterSpots`.
 *
 * Two guardrails run after allocation, independently per position, so the post-guardrail sum can
 * legitimately drift from `rosterSpots` — demand is a per-position rank, not a partition that must
 * sum to a fixed total:
 *   - starter floor: never below `starterReplacementRank(position) - 1` (a superflex/2-QB/2-TE
 *     league must not derive less demand than it has actual starters for).
 *   - K/DEF cap: never above `teams x namedSlots(position)` (extrapolation must not invent bench
 *     kickers).
 */
export function positionalDemand(input: PositionalDemandInput): PositionalDemand {
  const { settings, adp, scoredPlayerIds } = input;
  const fallbackSpotsPerTeam = rosterSpotsPerTeam(settings);
  const startingSpotsPerTeam = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR').length;
  const override = input.rosterSpotsPerTeam;
  const validOverride = override != null
    && Number.isFinite(override)
    && override > 0
    && override >= startingSpotsPerTeam;
  const rosterSpots = Math.max(1, Math.round(settings.teams * (validOverride ? override : fallbackSpotsPerTeam)));

  const usable = adp.filter((entry): entry is AdpEntry & { playerId: PlayerId } =>
    entry.playerId != null
    && (scoredPlayerIds == null || scoredPlayerIds.has(entry.playerId))
    && (REPLACEMENT_POSITIONS as readonly string[]).includes(entry.position));
  // (adp asc, name asc, playerId asc): the UI's own ordering (loadPlayerPool.ts) stops at name, but
  // demand must be caller-order independent, and real ADP data has meaningful ties at the boundary.
  usable.sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId));

  let byPosition: Map<string, number>;
  let source: PositionalDemand['source'];
  if (usable.length >= rosterSpots) {
    byPosition = new Map(REPLACEMENT_POSITIONS.map((p) => [p, 0]));
    for (const entry of usable.slice(0, rosterSpots)) byPosition.set(entry.position, (byPosition.get(entry.position) ?? 0) + 1);
    source = 'adp';
  } else if (usable.length * 2 >= rosterSpots) {
    const counts = new Map<string, number>();
    for (const entry of usable) counts.set(entry.position, (counts.get(entry.position) ?? 0) + 1);
    byPosition = apportion(counts, rosterSpots);
    source = 'adp-extrapolated';
  } else {
    byPosition = apportion(new Map(Object.entries(DEFAULT_POSITION_MIX)), rosterSpots);
    source = 'default-mix';
  }

  for (const position of REPLACEMENT_POSITIONS) {
    const starterFloor = starterReplacementRank(settings, position) - 1;
    let demand = Math.max(byPosition.get(position) ?? 0, starterFloor);
    // K/DEF cap: extrapolation must never invent bench kickers/defenses beyond one per named slot
    // per team. Applied after the starter floor so the cap always wins when the two conflict (a
    // league can't need more K/DEF demand than it has named K/DEF slots for).
    if (position === 'K' || position === 'DEF') {
      demand = Math.min(demand, namedSlotCount(settings, position));
    }
    byPosition.set(position, demand);
  }

  return { byPosition, source, rosterSpots, usableRows: usable.length };
}

export const MIN_REPLACEMENT_RANK = 2;

/**
 * Remaining league-wide demand at `position` once `consumedAtPosition` players there are already
 * drafted, floored at `MIN_REPLACEMENT_RANK` so the replacement baseline can never become the single
 * best remaining player (the exhaustion pathology this module exists to prevent — see
 * `ReplacementLevel.exhausted`'s doc).
 */
export function remainingReplacementRank(leagueDemandRank: number, consumedAtPosition: number): number {
  return Math.max(MIN_REPLACEMENT_RANK, leagueDemandRank - consumedAtPosition);
}

export interface ReplacementContext {
  consumedByPosition?: ReadonlyMap<string, number>;
  /** From `positionalDemand`. Omitted -> falls back to the starters-only rule (pre-S2.2 behavior),
   * for callers that want the deterministic small-fixture answer without threading ADP through. */
  demandByPosition?: ReadonlyMap<string, number>;
}

/**
 * `remainingPlayers` should be the undrafted-and-scored pool. Pass `context.consumedByPosition`
 * (drafted ∩ scored counts, by position) to index the remaining-demand rank instead of the static
 * one; pass `context.demandByPosition` (from `positionalDemand`) to drain into realistic bench/late
 * territory instead of clamping to the best remaining player once starter demand is consumed.
 */
export function replacementLevels(
  settings: LeagueSettings,
  remainingPlayers: PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
  context?: ReplacementContext,
): ReplacementLevel[] {
  return REPLACEMENT_POSITIONS.map((position) => {
    const ranked = remainingPlayers
      .filter((player) => player.position === position && projectedPoints.has(player.playerId))
      .sort(comparePlayersByScoreDesc(projectedPoints));
    const starterDemandRank = starterReplacementRank(settings, position);
    const demand = context?.demandByPosition?.get(position) ?? (starterDemandRank - 1);
    const leagueDemandRank = demand + 1;
    const consumed = context?.consumedByPosition?.get(position) ?? 0;
    const rawRank = leagueDemandRank - consumed;
    const rank = context ? remainingReplacementRank(leagueDemandRank, consumed) : leagueDemandRank;
    // A pool shorter than `rank` still has a real worst-remaining player at this position (unless
    // the position has no scored candidates at all) — falling back to 0 would collapse VOR/the
    // ranking value back to raw points, the exact degeneracy this module exists to prevent.
    const player = ranked[rank - 1] ?? ranked[ranked.length - 1];
    return {
      position,
      rank,
      demand,
      leagueDemandRank,
      starterDemandRank,
      consumed,
      playerId: player?.playerId ?? null,
      points: player ? projectedPoints.get(player.playerId) ?? 0 : 0,
      exhausted: context != null && consumed >= demand,
      floored: context != null && rawRank < MIN_REPLACEMENT_RANK,
    };
  });
}

export function replacementPointsByPosition(levels: ReplacementLevel[]): Map<string, number> {
  return new Map(levels.map((level) => [level.position, level.points]));
}

export function vorForPlayer(player: PlayerMeta, points: number, levels: ReplacementLevel[]): number {
  return points - (levels.find((level) => level.position === player.position)?.points ?? 0);
}
