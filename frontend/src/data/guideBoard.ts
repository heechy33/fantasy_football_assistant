import type { AdpEntry, LeagueSettings, PlayerId, PlayerMeta, SeasonProjection } from '../../../shared/types';
import type { Recommendation, RecommendationInput, RecommendationResult } from '../engine/recommend';
import type { GuideRankSource, ProviderColumn } from './guideProviderColumns';

/**
 * Pure derivation for the public Draft Guide's board — deliberately separate from the React hook
 * so it can be tested against the real committed `data/` artifacts without a renderer, following
 * the same convention as the engine tests (`readFileSync` over `data/`, no mocks).
 *
 * Engine invocation contract (all three traps deliberate — see DECISIONS.md, 2026-08-25):
 * - `picks: []`, `myTeamId: null`, `nextPick: null` keep stageC and planningActive off — no Monte
 *   Carlo, no worker, no pairwise loop, and no fabricated availability/vona/pickAction numbers
 *   that would be meaningless without a real seat and shown to the public.
 * - `limit` is explicit (it defaults to 3!) while `rolloutDisplayLimit` stays small and explicit
 *   (it otherwise defaults to `limit`, inflating the candidate pool per candidate group).
 * - `includeRecommendationViews` stays false — it would raise expansion depth to 24 AND disable
 *   the full market join we rely on for ADP-lane rows. Position filtering is client-side.
 *
 * `rounds` comes from the guide's selector state (LeagueSettings has no rounds field; on a real
 * draft it would be DraftInit.rounds) — it feeds the engine's roster-spots/late-K/DEF schedule.
 */
export function buildGuideInput(
  settings: LeagueSettings,
  rounds: number,
  data: {
    players: PlayerMeta[];
    projections: SeasonProjection[];
    adp: AdpEntry[];
    availabilityByPlayer?: ReadonlyMap<PlayerId, number>;
  },
): RecommendationInput {
  return {
    settings,
    players: data.players,
    projections: data.projections,
    adp: data.adp,
    picks: [],
    myTeamId: null,
    nextPick: null,
    currentPick: 1,
    limit: 200,
    rolloutDisplayLimit: 5,
    includeRecommendationViews: false,
    includeMarketRecommendations: true,
    includeExpansion: true,
    rosterSpotsPerTeam: rounds,
    draftRounds: rounds,
    displayPosition: null,
    availabilityByPlayer: data.availabilityByPlayer,
  };
}

/** One sortable row of the guide table. The universe is the UNION of engine-scored players and
 * active-board ADP entries — never an inner join (the repo-wide no-lost-player contract): an
 * ADP-sorted view shows players the engine can't score, and those rows show an em-dash for engine
 * rank rather than being dropped. */
export interface GuideRow {
  playerId: PlayerId;
  player: PlayerMeta | undefined;
  recommendation: Recommendation | null;
  /** 1-based dense position in the engine's ordering; null when unscored or beyond `limit`. */
  engineRank: number | null;
  /** The player's entry on the active ADP board; null when the lane has no row for them. */
  adpEntry: AdpEntry | null;
}

/** Dense engine ranks (1-based, recommendation-array order) for the Δ-vs-ADP column and sorting. */
export function deriveEngineRankByPlayer(result: RecommendationResult): ReadonlyMap<PlayerId, number> {
  const ranks = new Map<PlayerId, number>();
  result.recommendations.forEach((recommendation, index) => {
    if (!ranks.has(recommendation.playerId)) ranks.set(recommendation.playerId, index + 1);
  });
  return ranks;
}

export function deriveGuideRows(
  result: RecommendationResult,
  adpEntries: readonly AdpEntry[],
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
): GuideRow[] {
  const engineRankByPlayer = deriveEngineRankByPlayer(result);
  const adpByPlayer = new Map<PlayerId, AdpEntry>();
  for (const entry of adpEntries) {
    if (entry.playerId != null && !adpByPlayer.has(entry.playerId)) adpByPlayer.set(entry.playerId, entry);
  }
  const recommendationById = new Map(result.recommendations.map((r) => [r.playerId, r]));
  const marketRecommendationById = new Map(result.marketRecommendations.map((m) => [m.playerId, m]));

  const ids = new Set<PlayerId>([...engineRankByPlayer.keys(), ...adpByPlayer.keys()]);
  return [...ids].map((playerId) => ({
    playerId,
    player: playersById.get(playerId),
    recommendation: recommendationById.get(playerId) ?? marketRecommendationById.get(playerId)?.recommendation ?? null,
    engineRank: engineRankByPlayer.get(playerId) ?? null,
    adpEntry: adpByPlayer.get(playerId) ?? null,
  }));
}

const MISSING = Number.POSITIVE_INFINITY;

/** Sort rows by the selected source's dense rank. A player absent from the selected lane sorts
 * LAST with an em-dash upstream — never rank 0, never dropped (same contract as unmatched picks).
 * Ties break toward engine order, then raw ADP, then name, so the sort is deterministic. */
export function sortGuideRows(
  rows: readonly GuideRow[],
  source: GuideRankSource,
  columns: Readonly<Record<Exclude<GuideRankSource, 'engine'>, ProviderColumn>>,
  engineRankByPlayer: ReadonlyMap<PlayerId, number>,
): GuideRow[] {
  const laneRank = (row: GuideRow): number => {
    if (source === 'engine') return engineRankByPlayer.get(row.playerId) ?? MISSING;
    return columns[source].rankByPlayer.get(row.playerId) ?? MISSING;
  };
  return [...rows].sort((a, b) =>
    laneRank(a) - laneRank(b)
    || (a.engineRank ?? MISSING) - (b.engineRank ?? MISSING)
    || (a.adpEntry?.adp ?? MISSING) - (b.adpEntry?.adp ?? MISSING)
    || (a.player?.name ?? a.playerId).localeCompare(b.player?.name ?? b.playerId),
  );
}

