import { useEffect, useState } from 'react';
import type { PlayerId, PlayerWeeklyStatsArtifact } from '../../../shared/types';
import { loadWeeklyStats } from '../data/loadWeeklyStats';

export type WeeklyStatsStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface WeeklyStatsState {
  artifact: PlayerWeeklyStatsArtifact | null;
  status: WeeklyStatsStatus;
}

const IDLE: WeeklyStatsState = { artifact: null, status: 'idle' };

function useWeeklyStatsArtifact(shouldLoad: boolean, draftSeason: number | null): WeeklyStatsState {
  // Lazily seeded to 'loading' when `shouldLoad` is already true on first render (the board-wide
  // caller): avoids an IDLE -> loading transition that would force an extra synchronous re-render
  // on mount for no observable reason.
  const [state, setState] = useState<WeeklyStatsState>(() => (
    shouldLoad && draftSeason != null ? { artifact: null, status: 'loading' } : IDLE
  ));

  useEffect(() => {
    if (!shouldLoad || draftSeason == null) {
      setState(IDLE);
      return;
    }

    let active = true;
    setState((prev) => (prev.status === 'loading' ? prev : { artifact: null, status: 'loading' }));
    loadWeeklyStats(draftSeason).then((result) => {
      if (!active) return;
      if (result.status === 'unavailable') {
        setState({ artifact: null, status: 'unavailable' });
        return;
      }
      setState({ artifact: result.artifact, status: 'ready' });
    });

    return () => {
      active = false;
    };
  }, [shouldLoad, draftSeason]);

  return state;
}

/**
 * Loads `/data/weekly-stats.json` only after a player detail view opens
 * (`playerId != null`) -- same lazy-fetch contract as the retired
 * `useWeeklyScoring`. Unlike that hook, this one hands back the whole
 * artifact (not a pre-filtered series): the role panel needs every position's
 * `columns` map, and the grid needs `weeksFetched`/`heat`, not just one
 * player's rows. `weeklyGameLog.ts`/`weeklyRoleColumns.ts` do the
 * per-player selection from here.
 */
export function useWeeklyStats(
  playerId: PlayerId | null,
  draftSeason: number | null,
): WeeklyStatsState {
  return useWeeklyStatsArtifact(playerId != null, draftSeason);
}

/**
 * Same artifact as `useWeeklyStats`, loaded unconditionally as soon as a season is known --
 * for board-wide, per-card decorations (K/DEF's "Avg fpts" tile) that can't wait for a player
 * detail view to open. `loadWeeklyStats` is session-memoized, so this shares the fetch with
 * `useWeeklyStats` rather than duplicating it.
 */
export function useBoardWeeklyStats(draftSeason: number | null): WeeklyStatsState {
  return useWeeklyStatsArtifact(true, draftSeason);
}
