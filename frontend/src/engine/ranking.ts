import type { PlayerId, PlayerMeta } from '../../../shared/types';

/** Canonical score ordering for player lists: highest projected score first, then player ID. */
export function comparePlayersByScoreDesc(
  scores: ReadonlyMap<PlayerId, number>,
): (a: PlayerMeta, b: PlayerMeta) => number {
  return (a, b) =>
    (scores.get(b.playerId) ?? 0) - (scores.get(a.playerId) ?? 0) || a.playerId.localeCompare(b.playerId);
}
