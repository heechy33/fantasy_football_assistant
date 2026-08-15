import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Pick } from '../../../shared/types';
import { useDraftBoardState } from './useDraftBoardState';

const livePicks: Pick[] = [
  {
    overall: 1,
    round: 1,
    slot: 1,
    teamId: 'team-1',
    playerId: 'canonical-player',
    providerPlayerId: 'provider-player',
    providerPlayerName: 'Player One',
  },
];

describe('useDraftBoardState', () => {
  it('freezes the current prop-based live layer into manual overrides', () => {
    const { result, rerender } = renderHook(({ picks }: { picks: Pick[] }) => useDraftBoardState(picks), {
      initialProps: { picks: livePicks },
    });

    act(() => result.current.freeze());
    rerender({ picks: [] });

    expect(result.current.state.mode).toBe('manual');
    expect(result.current.effectivePicks).toEqual(livePicks);
    expect(result.current.state.overrides.get(1)).toMatchObject({
      source: 'manual-entry',
      providerPlayerId: 'provider-player',
    });
  });
});
