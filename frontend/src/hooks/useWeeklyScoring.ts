import { useEffect, useState } from 'react';
import type { PlayerId, WeeklyFantasyPoints } from '../../../shared/types';
import { loadWeeklyScoring } from '../data/loadWeeklyScoring';

export type WeeklyScoringStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface WeeklyScoringState {
  weeks: WeeklyFantasyPoints[];
  season: number | null;
  status: WeeklyScoringStatus;
}

const IDLE: WeeklyScoringState = { weeks: [], season: null, status: 'idle' };

/**
 * Loads `/data/weekly-ppr.json` only after a player detail view opens (`playerId != null`).
 * A valid artifact with no series for the selected player is `ready` with `weeks: []`.
 * Missing weeks stay gaps — this hook never zero-fills.
 */
export function useWeeklyScoring(
  playerId: PlayerId | null,
  draftSeason: number | null,
): WeeklyScoringState {
  const [state, setState] = useState<WeeklyScoringState>(IDLE);

  useEffect(() => {
    if (playerId == null || draftSeason == null) {
      setState(IDLE);
      return;
    }

    let active = true;
    setState({ weeks: [], season: null, status: 'loading' });
    loadWeeklyScoring(draftSeason).then((result) => {
      if (!active) return;
      if (result.status === 'unavailable') {
        setState({ weeks: [], season: null, status: 'unavailable' });
        return;
      }
      setState({
        weeks: result.artifact.players[playerId] ?? [],
        season: result.artifact.season,
        status: 'ready',
      });
    });

    return () => {
      active = false;
    };
  }, [playerId, draftSeason]);

  return state;
}
