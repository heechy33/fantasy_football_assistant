import { useCallback, useMemo, useReducer } from 'react';
import type { Pick } from '../../../shared/types';
import {
  applyOverride,
  computeEffectivePicks,
  createDraftBoardState,
  freezeLivePicksToOverrides,
  setMode,
  undoOverride,
  type DraftBoardState,
  type PickOverride,
} from '../state/draftBoardState';

type Action =
  | { type: 'applyOverride'; override: PickOverride }
  | { type: 'undoOverride'; overall: number }
  | { type: 'setMode'; mode: DraftBoardState['mode'] }
  | { type: 'freeze'; livePicks: Pick[] }
  | { type: 'reset'; mode: DraftBoardState['mode'] };

const NO_LIVE_PICKS: Pick[] = [];

function reducer(state: DraftBoardState, action: Action): DraftBoardState {
  switch (action.type) {
    case 'applyOverride':
      return applyOverride(state, action.override);
    case 'undoOverride':
      return undoOverride(state, action.overall);
    case 'setMode':
      return setMode(state, action.mode);
    case 'freeze':
      // Live picks intentionally remain a prop so a poll change reaches the UI in one commit.
      // Supply that current layer here because the reducer itself never owns it.
      return freezeLivePicksToOverrides({ ...state, livePicks: action.livePicks });
    case 'reset':
      return createDraftBoardState(action.mode);
    default:
      return state;
  }
}

export interface UseDraftBoardStateResult {
  state: DraftBoardState;
  effectivePicks: Pick[];
  applyOverride: (override: PickOverride) => void;
  undoOverride: (overall: number) => void;
  setMode: (mode: DraftBoardState['mode']) => void;
  /** Atomic manual takeover: every effective pick becomes a complete manual-entry override. */
  freeze: () => void;
  reset: (mode: DraftBoardState['mode']) => void;
}

/**
 * Live picks flow in as a plain prop (from the poll snapshot), not through the reducer, so a
 * changed poll feeds `effectivePicks` — and the clock math derived from it — in the same React
 * commit as the poll render. The reducer only holds user-authored state (`mode` + `overrides`);
 * the live layer is merged at read time by `computeEffectivePicks`, so override precedence is
 * exactly the invariant `state/draftBoardState.ts` already tests. Manual mode passes `[]` (there
 * is no poll) and behaves identically to the old reducer-held empty live layer.
 */
export function useDraftBoardState(
  livePicks: Pick[],
  initial?: DraftBoardState,
): UseDraftBoardStateResult {
  const [state, dispatch] = useReducer(reducer, initial ?? createDraftBoardState());
  const effectivePicks = useMemo(
    () => computeEffectivePicks({ ...state, livePicks: state.mode === 'live' ? livePicks : NO_LIVE_PICKS }),
    // state.livePicks is inert (never dispatched to) — only mode/overrides and the prop change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.mode, state.overrides, livePicks],
  );

  return {
    state,
    effectivePicks,
    applyOverride: (override) => dispatch({ type: 'applyOverride', override }),
    undoOverride: (overall) => dispatch({ type: 'undoOverride', overall }),
    setMode: (mode) => dispatch({ type: 'setMode', mode }),
    freeze: useCallback(() => dispatch({ type: 'freeze', livePicks }), [livePicks]),
    reset: (mode) => dispatch({ type: 'reset', mode }),
  };
}
