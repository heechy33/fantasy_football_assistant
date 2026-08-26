import { useEffect, useState } from 'react';
import type { AdpEntry } from '../../../shared/types';
import type { AdpFormat } from '../data/loadPlayerPool';
import { loadDisplayAdpBoard, type DisplayAdpLoadResult } from '../data/loadDisplayAdpBoard';

export type ProviderAdpStatus = 'loading' | 'ready' | 'unavailable';

export interface ProviderAdpLaneState {
  /** Stable lane key (`espn-ppr`, `ffc-<format>`), also used as the React key. */
  key: string;
  label: string;
  brandKey: 'espn' | 'ffc';
  entries: AdpEntry[];
  status: ProviderAdpStatus;
}

const IDLE_ENTRIES: AdpEntry[] = [];

function toState(key: string, label: string, brandKey: 'espn' | 'ffc', result: DisplayAdpLoadResult): ProviderAdpLaneState {
  return result.status === 'ready'
    ? { key, label, brandKey, entries: result.entries, status: 'ready' }
    : { key, label, brandKey, entries: IDLE_ENTRIES, status: 'unavailable' };
}

/**
 * Display-only comparison ADP lanes for the player-detail drawer's Market ADP section — one
 * per provider board the repo actually has committed access to beyond the active board:
 *
 * - ESPN's default-league PPR board (`adp-espn-ppr.json`; PPR sessions only — it's the only
 *   format ESPN's board is built for).
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
    const lanes: ReadonlyArray<{ fileName: string; key: string; label: string; brandKey: 'espn' | 'ffc' }> = [
      ...(adpFormat === 'ppr'
        ? [{ fileName: 'adp-espn-ppr.json', key: 'espn-ppr', label: 'ESPN (PPR)', brandKey: 'espn' as const }]
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
