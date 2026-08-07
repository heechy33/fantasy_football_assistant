import { useMemo, useReducer } from 'react';
import type { Pick } from '../../../shared/types';
import {
  applyOverride,
  computeEffectivePicks,
  createDraftBoardState,
  setLivePicks,
  setMode,
  undoOverride,
  type DraftBoardState,
  type PickOverride,
} from '../state/draftBoardState';

type Action =
  | { type: 'setLivePicks'; picks: Pick[] }
  | { type: 'applyOverride'; override: PickOverride }
  | { type: 'undoOverride'; overall: number }
  | { type: 'setMode'; mode: DraftBoardState['mode'] }
  | { type: 'reset'; mode: DraftBoardState['mode'] };

function reducer(state: DraftBoardState, action: Action): DraftBoardState {
  switch (action.type) {
    case 'setLivePicks':
      return setLivePicks(state, action.picks);
    case 'applyOverride':
      return applyOverride(state, action.override);
    case 'undoOverride':
      return undoOverride(state, action.overall);
    case 'setMode':
      return setMode(state, action.mode);
    case 'reset':
      return createDraftBoardState(action.mode);
    default:
      return state;
  }
}

export interface UseDraftBoardStateResult {
  state: DraftBoardState;
  effectivePicks: Pick[];
  setLivePicks: (picks: Pick[]) => void;
  applyOverride: (override: PickOverride) => void;
  undoOverride: (overall: number) => void;
  setMode: (mode: DraftBoardState['mode']) => void;
  reset: (mode: DraftBoardState['mode']) => void;
}

/** Thin useReducer wrapper around the pure state/draftBoardState.ts functions. */
export function useDraftBoardState(initial?: DraftBoardState): UseDraftBoardStateResult {
  const [state, dispatch] = useReducer(reducer, initial ?? createDraftBoardState());
  const effectivePicks = useMemo(() => computeEffectivePicks(state), [state]);

  return {
    state,
    effectivePicks,
    setLivePicks: (picks) => dispatch({ type: 'setLivePicks', picks }),
    applyOverride: (override) => dispatch({ type: 'applyOverride', override }),
    undoOverride: (overall) => dispatch({ type: 'undoOverride', overall }),
    setMode: (mode) => dispatch({ type: 'setMode', mode }),
    reset: (mode) => dispatch({ type: 'reset', mode }),
  };
}
