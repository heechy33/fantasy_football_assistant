import type { LeagueSettings, PlayerId, PlayerMeta } from '../../../shared/types';

export interface ReplacementLevel {
  position: string;
  /** Index actually used against the pool passed in — equals `leagueDemandRank` unless a
   * `consumedByPosition` count shrinks it for a draining pool. */
  rank: number;
  /** Static total league-wide demand at this position (teams × starters + FLEX share),
   * independent of what has actually been drafted. */
  leagueDemandRank: number;
  /** Players at this position already removed from the scored pool (drafted ∩ scored). */
  consumed: number;
  playerId: PlayerId | null;
  points: number;
  /** True once league-wide demand at this position has been fully consumed — `rank` has bottomed
   * out at 1 and the level now tracks the single best player left, not "the Nth-best". */
  exhausted: boolean;
}

export function replacementRank(settings: LeagueSettings, position: string): number {
  const named = settings.startingSlots.filter((slot) => slot === position).length * settings.teams;
  const flex = settings.startingSlots.filter((slot) => ['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'].includes(slot)).length;
  // K/DEF are never FLEX-eligible (see eligibility.ts's accepts()); QB only
  // shares FLEX pressure when SUPER_FLEX/two-QB makes it FLEX-eligible.
  const flexEligible = position === 'RB' || position === 'WR' || position === 'TE' || (position === 'QB' && settings.format.qb !== 'one-qb');
  const flexShare = flexEligible ? Math.ceil(flex * settings.teams / 3) : 0;
  return Math.max(1, named + flexShare + 1);
}

/**
 * Remaining league-wide demand at `position` once `consumedAtPosition` players there are already
 * drafted. Indexing a draining pool at the static `replacementRank` double-counts the drain — after
 * k players at a position are gone, only `rank - k` more starters will ever be needed from what's
 * left, so that's the index that keeps "replacement level" meaning the same thing all draft.
 */
export function remainingReplacementRank(settings: LeagueSettings, position: string, consumedAtPosition: number): number {
  return Math.max(1, replacementRank(settings, position) - consumedAtPosition);
}

/**
 * `remainingPlayers` should be the undrafted-and-scored pool. Pass `consumedByPosition` (drafted ∩
 * scored counts, by position) to index the remaining-demand rank instead of the static one; omit it
 * to get the old static-full-pool behavior (e.g. `remainingPlayers` is the whole pool).
 */
export function replacementLevels(
  settings: LeagueSettings,
  remainingPlayers: PlayerMeta[],
  projectedPoints: ReadonlyMap<PlayerId, number>,
  consumedByPosition?: ReadonlyMap<string, number>,
): ReplacementLevel[] {
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((position) => {
    const ranked = remainingPlayers
      .filter((player) => player.position === position && projectedPoints.has(player.playerId))
      .sort((a, b) => (projectedPoints.get(b.playerId) ?? 0) - (projectedPoints.get(a.playerId) ?? 0) || a.playerId.localeCompare(b.playerId));
    const leagueDemandRank = replacementRank(settings, position);
    const consumed = consumedByPosition?.get(position) ?? 0;
    const rank = consumedByPosition ? remainingReplacementRank(settings, position, consumed) : leagueDemandRank;
    // A pool shorter than `rank` still has a real worst-remaining player at this position (unless
    // the position has no scored candidates at all) — falling back to 0 would collapse VOR/the
    // ranking value back to raw points, the exact degeneracy this module exists to prevent.
    const player = ranked[rank - 1] ?? ranked[ranked.length - 1];
    return {
      position,
      rank,
      leagueDemandRank,
      consumed,
      playerId: player?.playerId ?? null,
      points: player ? projectedPoints.get(player.playerId) ?? 0 : 0,
      exhausted: consumedByPosition != null && consumed >= leagueDemandRank,
    };
  });
}

export function replacementPointsByPosition(levels: ReplacementLevel[]): Map<string, number> {
  return new Map(levels.map((level) => [level.position, level.points]));
}

export function vorForPlayer(player: PlayerMeta, points: number, levels: ReplacementLevel[]): number {
  return points - (levels.find((level) => level.position === player.position)?.points ?? 0);
}
