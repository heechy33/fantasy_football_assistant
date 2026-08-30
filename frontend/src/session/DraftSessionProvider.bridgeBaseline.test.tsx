import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SavedLeague } from '../../../shared/types';

/**
 * Regression test for the 2026-08-29 black-page crash: the "streaming a different draft" alert
 * (inside the sessionAlerts memo) read `bridgeBaselineRef` before that ref was declared, so the
 * FIRST render of a `bridge` session with a live snapshot threw a temporal-dead-zone
 * ReferenceError and unmounted the entire app. jsdom tests never exercised this path before
 * because they never render a bridge session with `live` populated — exactly the setup only a
 * real extension stream produces. This file does produce it (via a mocked useEspnBridge), so a
 * re-introduced declaration-order slip fails here.
 */

const useEspnBridgeMock = vi.fn();

vi.mock('../hooks/useEspnBridge', () => ({
  useEspnBridge: (...args: unknown[]) => useEspnBridgeMock(...args),
}));

const { DraftSessionProvider, useDraftSession } = await import('./DraftSessionProvider');

/** Child that consumes the context, so a crash between provider and children is observable, and
 * gives the test a handle on the session-start actions. */
function Probe() {
  const { handleEspnStart } = useDraftSession();
  return (
    <button type="button" onClick={() => handleEspnStart(savedLeague(), 3)}>
      start-espn
    </button>
  );
}

function savedLeague(): SavedLeague {
  return {
    id: 'doc-1',
    userId: 'user-1',
    provider: 'espn',
    providerLeagueId: 'leag-1',
    name: 'Probe League',
    season: '2026',
    teams: 10,
    rounds: 14,
    mySlot: 3,
    settings: {
      provider: 'espn',
      leagueId: 'leag-1',
      name: 'Probe League',
      season: '2026',
      teams: 10,
      startingSlots: ['QB'],
      rosterSlots: { QB: 1, BN: 5 },
      scoring: { rec: 1 },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    } as SavedLeague['settings'],
    providerUserId: null,
    latestDraftId: null,
    createdAt: '',
    updatedAt: '',
  };
}

/** A healthy bridge session with a live snapshot present on the FIRST render — the exact state
 * whose first render used to hit the TDZ on `bridgeBaselineRef`. */
function liveBridgeReturn() {
  return {
    extensionPresent: true,
    live: { leagueId: 'leag-1', epoch: 0 },
    init: null,
    picks: null,
    lastHeartbeatAt: Date.now(),
    dataAgeMs: 0,
    status: 'live' as const,
    isStale: false,
    pickError: null,
    relayWarning: null,
    seatMismatch: null,
    derivedSeat: null,
    offset: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useEspnBridgeMock.mockReturnValue(liveBridgeReturn());
});

describe('DraftSessionProvider bridge-baseline TDZ regression', () => {
  it('mounts with a live bridge snapshot and survives starting a bridge session', async () => {
    // Mount with the mocked bridge already streaming: the disconnected session never reads the
    // baseline, but the first render must still be clean.
    render(
      <MemoryRouter>
        <DraftSessionProvider>
          <Probe />
        </DraftSessionProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('start-espn')).toBeInTheDocument();

    // Transition to a `bridge` session. Before the fix this render evaluated the sessionAlerts
    // memo's `bridgeBaselineRef.current` read while the ref was still in its temporal dead zone,
    // throwing `ReferenceError: Cannot access 'bridgeBaselineRef' before initialization` and
    // unmounting the app (the black page).
    await act(async () => {
      screen.getByText('start-espn').click();
    });

    expect(screen.getByText('start-espn')).toBeInTheDocument();
  });
});
