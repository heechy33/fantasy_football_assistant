import type { AdpEntry, PlayerId } from '../../../shared/types';

/**
 * Display-only ranking lanes for the public Draft Guide's source selector. This module MUST stay
 * outside `frontend/src/engine/` — displayOnlySourceInvariant.test.ts fails CI on any engine
 * file referencing these artifacts, and selecting a provider lane re-sorts rows that the engine
 * already produced; it never re-runs buildRecommendationBoard on a display-only lane.
 *
 * Lane inventory (what the repo actually ships — no Yahoo artifact exists and FantasyPros was
 * deleted; omitted means omitted, never stubbed):
 * - 'sleeper' — the active per-format board (`adp-<format>.json`), the lane real drafts happen against.
 * - 'espn' — `adp-espn-ppr.json`, PPR only. MIXED SOURCE: ~171 native ESPN entries at the top plus a
 *   Sleeper-sourced tail below ESPN's censor cutoff (~165). The column label must carry the splice
 *   disclosure — presenting the tail as "ESPN ranks" would misattribute ~88% of the board.
 * - 'ffc' — `adp-ffc-<format>.json` per format (~221-270 rows — sparse by design).
 * - 'underdog' — `adp-underdog-bestball.json` (best-ball half-PPR only, ~250 rows). Its ranks
 *   describe a different format and say so.
 */
export type GuideRankSource = 'engine' | 'sleeper' | 'espn' | 'ffc' | 'underdog';

export interface ProviderColumn {
  key: GuideRankSource;
  label: string;
  status: 'ready' | 'unavailable';
  /** 1-based dense rank within this lane (ascending ADP among joinable entries). A player absent
   * from the map sorts last and renders an em-dash upstream — never rank 0, never dropped. */
  rankByPlayer: ReadonlyMap<PlayerId, number>;
  /** Raw average draft position by player, for the lane's own ADP cell. */
  adpByPlayer: ReadonlyMap<PlayerId, number>;
  /** How many joinable entries the lane actually has — surfaced for sparse-lane disclosure. */
  rowCount: number;
}

/** Per-lane provenance notes shown under the table (source label + honesty caveat). */
export const LANE_NOTES: Readonly<Record<Exclude<GuideRankSource, 'engine'>, string>> = {
  sleeper: 'Sleeper draft-lobby ADP — the population real drafts happen against.',
  espn: 'ESPN default-league PPR ADP: native ESPN ranks at the top, Sleeper-sourced tail below ESPN\u2019s cutoff — not a pure ESPN ordering end to end.',
  ffc: 'Fantasy Football Calculator mock-draft ADP (self-selected lobby). Sparse — many players legitimately have no row.',
  underdog: 'Underdog best-ball half-PPR ADP. A different format than redraft — treat as context only.',
};

/**
 * Dense-rank one lane's entries into {@link ProviderColumn} maps. Entries without a playerId can't
 * join to the pool and are skipped; ties in raw ADP keep their entry order (stable sort) so ranks
 * stay deterministic.
 */
export function buildProviderColumn(key: GuideRankSource, label: string, entries: readonly AdpEntry[]): ProviderColumn {
  const rankByPlayer = new Map<PlayerId, number>();
  const adpByPlayer = new Map<PlayerId, number>();
  // Rank in ascending-ADP order regardless of artifact row order; ties keep their relative order
  // (stable) so ranks stay deterministic.
  const joinable = [...entries].filter((entry) => entry.playerId != null).sort((a, b) => a.adp - b.adp);
  let rank = 0;
  for (const entry of joinable) {
    rank += 1;
    const playerId = entry.playerId as PlayerId;
    if (!rankByPlayer.has(playerId)) {
      rankByPlayer.set(playerId, rank);
      adpByPlayer.set(playerId, entry.adp);
    }
  }
  return { key, label, status: 'ready', rankByPlayer, adpByPlayer, rowCount: rank };
}

/** An unavailable lane keeps its slot in the selector (honest absence beats a silently vanishing option). */
export function unavailableProviderColumn(key: GuideRankSource, label: string): ProviderColumn {
  return { key, label, status: 'unavailable', rankByPlayer: new Map(), adpByPlayer: new Map(), rowCount: 0 };
}
