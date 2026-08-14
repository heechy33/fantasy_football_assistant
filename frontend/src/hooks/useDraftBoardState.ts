import { useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { Pick } from '../../../shared/types';
import { draftMark, draftMeasure, draftPollMarkName } from '../lib/perf';
import {
  applyOverride,
  computeEffectivePicks,
  createDraftBoardState,
  setMode,
  undoOverride,
  type DraftBoardState,
  type PickOverride,
} from '../state/draftBoardState';

type Action =
  | { type: 'applyOverride'; override: PickOverride }
  | { type: 'undoOverride'; overall: number }
  | { type: 'setMode'; mode: DraftBoardState['mode'] }
  | { type: 'reset'; mode: DraftBoardState['mode'] };

function reducer(state: DraftBoardState, action: Action): DraftBoardState {
  switch (action.type) {
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
  applyOverride: (override: PickOverride) => void;
  undoOverride: (overall: number) => void;
  setMode: (mode: DraftBoardState['mode']) => void;
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
  timingPollId: number | null = null,
): UseDraftBoardStateResult {
  const [state, dispatch] = useReducer(reducer, initial ?? createDraftBoardState());
  const effectivePicks = useMemo(
    () => computeEffectivePicks({ ...state, livePicks }),
    // state.livePicks is inert (never dispatched to) — only mode/overrides and the prop change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.mode, state.overrides, livePicks],
  );

  const measuredPollIdRef = useRef<number | null>(null);

  // Commit mark for the poll→effective relay. A unique poll id is essential: a subsequent,
  // unchanged poll must not overwrite the response mark before this commit is measured.
  useLayoutEffect(() => {
    if (timingPollId == null || measuredPollIdRef.current === timingPollId) return;
    measuredPollIdRef.current = timingPollId;
    const responseMark = draftPollMarkName(timingPollId, 'response');
    const commitMark = draftPollMarkName(timingPollId, 'effective-committed');
    draftMark(commitMark);
    if (!import.meta.env.DEV) return;
    const relayMs = draftMeasure(`relay: poll/${timingPollId}→effective`, responseMark, commitMark);
    if (relayMs != null) {
      // eslint-disable-next-line no-console
      console.debug(`[draft-timing] relay poll→effective ${relayMs.toFixed(1)}ms`);
    }
  }, [effectivePicks, timingPollId]);

  return {
    state,
    effectivePicks,
    applyOverride: (override) => dispatch({ type: 'applyOverride', override }),
    undoOverride: (overall) => dispatch({ type: 'undoOverride', overall }),
    setMode: (mode) => dispatch({ type: 'setMode', mode }),
    reset: (mode) => dispatch({ type: 'reset', mode }),
  };
}
