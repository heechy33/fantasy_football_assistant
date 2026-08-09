import type { PlayerId, PlayerMeta } from '../../../shared/types';
import { comparePlayersByScoreDesc } from './ranking';

export interface TierInfo {
  playerId: PlayerId;
  tier: number;
  /** Points gap to the very next-ranked player at this position (not tier-level). */
  gapAfter: number;
  /** Explicit alias for `gapAfter`; use this label in presentation. */
  gapToNextPlayer: number;
  /** Lowest score in this tier minus the best score in the next tier. */
  tierBoundaryGap: number;
  /** Bounded [0,1] cliff-size signal. Explanation only — never a ranking term (see recommend.ts;
   * PLAN.md's principled urgency mechanism is S3's VONA, not a hand-tuned multiplier here). */
  urgency: number;
  /** True when this player is the last (lowest-points) member of his tier at this position. */
  isTierLast: boolean;
  /** How many players are left on the board in this tier at this position, including this one. */
  remainingInTier: number;
  /** Best points in the next tier down at this position, or null if this is the last tier present. */
  nextTierBestPoints: number | null;
  /** Back-compatible alias for `tierBoundaryGap`. */
  nextTierDrop: number;
}

/**
 * `players` should be the pool the caller wants tiers measured against — pass the remaining
 * (undrafted, scored) pool so tier numbers mean "tier among what's left on the board" and drop as
 * the position drains, per PLAN.md's replacement/tier design. A player's tier number can therefore
 * decrease across the draft; that is intentional, not a bug.
 */
export function buildTiers(players: PlayerMeta[], projectedPoints: ReadonlyMap<PlayerId, number>): Map<PlayerId, TierInfo> {
  const result = new Map<PlayerId, TierInfo>();
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const ranked = players.filter((player) => player.position === position && projectedPoints.has(player.playerId))
      .sort(comparePlayersByScoreDesc(projectedPoints));

    const rows: { playerId: PlayerId; points: number; tier: number; gapAfter: number }[] = [];
    let tier = 1;
    let tierLeaderPoints = ranked[0] ? projectedPoints.get(ranked[0].playerId) ?? 0 : 0;
    for (let i = 0; i < ranked.length; i += 1) {
      const currentPlayer = ranked[i];
      if (!currentPlayer) continue;
      const current = projectedPoints.get(currentPlayer.playerId) ?? 0;
      if (i > 0 && tierLeaderPoints - current >= Math.max(6, tierLeaderPoints * 0.08)) {
        tier += 1;
        tierLeaderPoints = current;
      }
      const nextPlayer = ranked[i + 1];
      const next = projectedPoints.get(nextPlayer?.playerId ?? '') ?? 0;
      const gapAfter = Math.max(0, current - next);
      rows.push({ playerId: currentPlayer.playerId, points: current, tier, gapAfter });
    }

    // Rows are sorted by points desc and tiers are contiguous blocks in that order, so each tier's
    // best score is its first row's points — a single pass gathers size/best per tier for everyone.
    const tierSize = new Map<number, number>();
    const tierBest = new Map<number, number>();
    const tierLowest = new Map<number, number>();
    for (const row of rows) {
      tierSize.set(row.tier, (tierSize.get(row.tier) ?? 0) + 1);
      if (!tierBest.has(row.tier)) tierBest.set(row.tier, row.points);
      tierLowest.set(row.tier, row.points);
    }

    rows.forEach((row, index) => {
      const nextRow = rows[index + 1];
      const isTierLast = !nextRow || nextRow.tier !== row.tier;
      const nextTierBestPoints = tierBest.get(row.tier + 1) ?? null;
      const tierBoundaryGap = nextTierBestPoints != null
        ? Math.max(0, (tierLowest.get(row.tier) ?? row.points) - nextTierBestPoints)
        : 0;
      result.set(row.playerId, {
        playerId: row.playerId,
        tier: row.tier,
        gapAfter: row.gapAfter,
        gapToNextPlayer: row.gapAfter,
        tierBoundaryGap,
        urgency: Math.min(1, tierBoundaryGap / Math.max(1, tierBest.get(row.tier) ?? row.points)),
        isTierLast,
        remainingInTier: tierSize.get(row.tier) ?? 1,
        nextTierBestPoints,
        nextTierDrop: tierBoundaryGap,
      });
    });
  }
  return result;
}
