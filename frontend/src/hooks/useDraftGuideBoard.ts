import { useMemo } from 'react';
import type { AdpEntry, LeagueSettings, PlayerId, PlayerMeta, PlayerUsageArtifact, ProviderProjectionsArtifact } from '../../../shared/types';
import type { UsageLoadStatus } from './usePlayerBoardData';
import { buildRecommendationBoard } from '../engine/recommend';
import { buildGuideInput, deriveEngineRankByPlayer, deriveGuideRows, type GuideRow } from '../data/guideBoard';
import { buildGuideSettings, guideAdpFormat, type GuideFormat } from '../data/guideLeagueSettings';
import { usePlayerBoardData } from './usePlayerBoardData';

export interface DraftGuideBoardState {
  /** 'loading' until players + projections + ADP have all landed; 'error' only when the core
   * board itself failed (the same fail-open contract as the workspace's data hook). */
  status: 'loading' | 'ready' | 'error';
  rows: GuideRow[];
  engineRankByPlayer: ReadonlyMap<PlayerId, number>;
  /** The active per-format ADP lane (also the 'sleeper' provider column's raw data). */
  adp: AdpEntry[];
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  usageLoadStatus: UsageLoadStatus;
  /** Prior-season usage artifact — feeds the detail drawer and bench-depth pricing input. */
  usage: PlayerUsageArtifact;
  /** The synthesized LeagueSettings the engine scored against — lets the detail drawer score
   * provider projections in the guide's selected format (same role as the live room's
   * `draftInit.settings`). */
  settings: LeagueSettings;
  /** Committed multi-provider projections decoration (display-only) — passthrough from
   * `usePlayerBoardData`, feeds the drawer's Market ADP tile grid. */
  providerProjectionsArtifact: ProviderProjectionsArtifact | null;
}

/** The public guide's one-shot board. Data loading reuses `usePlayerBoardData` verbatim — it takes
 * no draft state and already owns the JSON content-type guard and fail-open fallback — and the
 * engine runs synchronously on the main thread (safe by measurement: ~414 scored candidates, no
 * planning loop, no simulation; see draftGuidePerformance.bench.ts). The build memoizes on the
 * settings fingerprint + dataset identities, so recompute fires only when a selector or data
 * actually changes — not on unrelated renders.
 *
 * A just-changed ADP lane (e.g. 1QB → superflex) reports 'loading' until its refetch resolves:
 * `usePlayerBoardData` keeps the previous board's arrays mounted mid-flight, and without this gate
 * the engine would score the NEW settings against the OLD format's ADP for a frame or two. */
export function useDraftGuideBoard(format: GuideFormat): DraftGuideBoardState {
  const adpFormat = guideAdpFormat(format);
  const settings = useMemo(() => buildGuideSettings(format), [format]);
  const {
    players, projections, adp, usage, usageLoadStatus, loadError, resolvedAdpKey,
    playersById, providerProjectionsArtifact = null,
  } = usePlayerBoardData(adpFormat, adpFormat);

  // Same derivation as the workspace: prior-season availability rates price bench depth.
  const availabilityByPlayer = useMemo(() => {
    const map = new Map<PlayerId, number>();
    for (const [playerId, playerUsage] of Object.entries(usage)) {
      if (playerUsage.availabilityRate != null) map.set(playerId, playerUsage.availabilityRate);
    }
    return map;
  }, [usage]);

  return useMemo(() => {
    const empty = new Map<PlayerId, number>();
    if (loadError) return { status: 'error' as const, rows: [], engineRankByPlayer: empty, adp, playersById, usageLoadStatus, usage, settings, providerProjectionsArtifact };
    // Stale-window gate: `resolvedAdpKey` names the board actually loaded (guide keys never fall
    // back — key === format — so inequality reliably means a refetch is still in flight).
    if (
      resolvedAdpKey !== adpFormat
      || players.length === 0 || projections.length === 0 || adp.length === 0
    ) {
      return { status: 'loading' as const, rows: [], engineRankByPlayer: empty, adp, playersById, usageLoadStatus, usage, settings, providerProjectionsArtifact };
    }
    const input = buildGuideInput(settings, format.rounds, { players, projections, adp, availabilityByPlayer });
    const result = buildRecommendationBoard(input);
    const engineRankByPlayer = deriveEngineRankByPlayer(result);
    return { status: 'ready' as const, rows: deriveGuideRows(result, adp, playersById), engineRankByPlayer, adp, playersById, usageLoadStatus, usage, settings, providerProjectionsArtifact };
    // The fingerprint documents intent: only a format change or new data rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [`${format.reception}|${format.qb}|${format.teams}|${format.rounds}`, settings, format.rounds, players, projections, adp, availabilityByPlayer, playersById, loadError, usageLoadStatus, usage, resolvedAdpKey, adpFormat]);
}

