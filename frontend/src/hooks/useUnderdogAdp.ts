import { useEffect, useState } from 'react';
import type { AdpEntry } from '../../../shared/types';
import { loadUnderdogAdp } from '../data/loadUnderdogAdp';

export type UnderdogAdpStatus = 'loading' | 'ready' | 'unavailable';

export interface UnderdogAdpState {
  entries: AdpEntry[];
  status: UnderdogAdpStatus;
}

const IDLE: UnderdogAdpState = { entries: [], status: 'loading' };

/**
 * Board-wide, loaded unconditionally as soon as the session mounts — same fetch-once-per-session
 * shape as `useBoardWeeklyStats` (`useWeeklyStats.ts`). The Underdog board is small and
 * display-only, so there's no reason to gate it behind a player-detail view opening the way the
 * heavier weekly-stats artifact is.
 */
export function useUnderdogAdp(): UnderdogAdpState {
  const [state, setState] = useState<UnderdogAdpState>(IDLE);

  useEffect(() => {
    let active = true;
    loadUnderdogAdp().then((result) => {
      if (!active) return;
      setState(result.status === 'ready'
        ? { entries: result.entries, status: 'ready' }
        : { entries: [], status: 'unavailable' });
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
