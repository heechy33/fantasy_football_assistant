import { useEffect, useState } from 'react';
import type { AdpEntry } from '../../../shared/types';
import type { AdpFormat } from '../data/loadPlayerPool';
import { loadDisplayAdpBoard, type DisplayAdpLoadResult } from '../data/loadDisplayAdpBoard';

export type ProviderAdpStatus = 'loading' | 'ready' | 'unavailable';

export interface ProviderAdpLaneState {
  /** Stable lane key (`espn-ppr`, `ffc-<format>`, `sleeper-<format>`, `yahoo-<format>`), also used as the React key. */
  key: string;
  label: string;
  brandKey: 'espn' | 'ffc' | 'sleeper' | 'yahoo';
  entries: AdpEntry[];
  status: ProviderAdpStatus;
}

const IDLE_ENTRIES: AdpEntry[] = [];

function toState(key: string, label: string, brandKey: 'espn' | 'ffc' | 'sleeper' | 'yahoo', result: DisplayAdpLoadResult): ProviderAdpLaneState {
  return result.status === 'ready'
    ? { key, label, brandKey, entries: result.entries, status: 'ready' }
    : { key, label, brandKey, entries: IDLE_ENTRIES, status: 'unavailable' };
}

/**
 * Display-only comparison ADP lanes for the player-detail drawer's Market ADP section — one
 * per provider board the repo actually has committed access to beyond the active board:
 *
 * - Sleeper's draft-lobby board (`adp-<format>.json`, written by every pipeline run). This is the
 *   ACTIVE board on Sleeper sessions — there the caller/`PlayerMarketComparison` drops the lane as
 *   a duplicate of the engine tile — but on ESPN/Yahoo/FFC-fallback sessions it is the one way
 *   the drawer can show Sleeper ADP at all.
 * - ESPN's default-league PPR board (`adp-espn-ppr.json`; PPR sessions only — it's the only
 *   format ESPN's board is built for).
 * - Yahoo's draft-analysis board for the active format (`adp-yahoo-<fmt>.json`; only the three
 *   formats Yahoo actually serves — standard/half-ppr/ppr, NOT 2qb). Phase 2 addition. (2026-09-XX)
 * - The FFC mock-draft board for the active redraft format (`adp-ffc-<format>.json`, written by
 *   every pipeline run; sparse (~267 rows vs Sleeper's ~1500), so many players legitimately
 *   have no row there).
 *
 * Underdog stays its own separate best-ball lane via `useUnderdogAdp` — never merged here.
 * All lanes are fail-open: a missing artifact renders nothing, never an error state.
 */
export function useProviderAdpBoards(adpFormat: AdpFormat): ProviderAdpLaneState[] {
  const [states, setStates] = useState<ProviderAdpLaneState[]>([]);

  useEffect(() => {
    let active = true;
    const lanes: ReadonlyArray<{ fileName: string; key: string; label: string; brandKey: 'espn' | 'ffc' | 'sleeper' | 'yahoo' }> = [
      { fileName: `adp-${adpFormat}.json`, key: `sleeper-${adpFormat}`, label: 'Sleeper', brandKey: 'sleeper' as const },
      ...(adpFormat === 'ppr'
        ? [{ fileName: 'adp-espn-ppr.json', key: 'espn-ppr', label: 'ESPN', brandKey: 'espn' as const }]
        : []),
      // Yahoo serves three formats; the file only exists once the pipeline has shipped it
      // (fail-open -> empty/unavailable tile, never an error).
      ...(adpFormat === 'standard' || adpFormat === 'half-ppr' || adpFormat === 'ppr'
        ? [{
            fileName: `adp-yahoo-${adpFormat}.json`,
            key: `yahoo-${adpFormat}`,
            label: 'Yahoo',
            brandKey: 'yahoo' as const,
          }]
        : []),
      { fileName: `adp-ffc-${adpFormat}.json`, key: `ffc-${adpFormat}`, label: 'FFC', brandKey: 'ffc' as const },
    ];
    setStates(lanes.map(({ key, label, brandKey }) => ({ key, label, brandKey, entries: IDLE_ENTRIES, status: 'loading' })));
    Promise.all(
      lanes.map(async ({ fileName, key, label, brandKey }) => toState(key, label, brandKey, await loadDisplayAdpBoard(fileName))),
    ).then((loaded) => {
      if (active) setStates(loaded);
    });
    return () => {
      active = false;
    };
  }, [adpFormat]);

  return states;
}
