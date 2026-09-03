import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { mockSignIn, __resetMockAuthState } from '../auth/adapters/mockAuthAdapter';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';

// The extension relay has nothing to answer in jsdom — mocked so the assertion below is about the
// app's OWN session/persistence logic, not a 900ms postMessage timeout.
const requestEspnResetSnapshotMock = vi.fn().mockResolvedValue(true);
vi.mock('../adapters/espnBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/espnBridge')>();
  return { ...actual, requestEspnResetSnapshot: (...args: unknown[]) => requestEspnResetSnapshotMock(...args) };
});

/**
 * 2026-08-29 regression: a `bridge`/`manual` session had NO exit action anywhere in the app —
 * abandoning a draft left the Draft Room permanently wedged, even after connecting a brand-new
 * league on `/leagues/connect` (save-only by design, so it couldn't help). "End draft" is the fix.
 * Exercised through the REAL `DraftSessionProvider` + `persistence.ts` (not a mock of either), so a
 * regression in the handler, the persisted-session read, or the route's action wiring all fail this.
 */
describe('DraftRoomRoute end-draft exit', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPlayerPoolCache();
    __resetMockAuthState();
    requestEspnResetSnapshotMock.mockClear();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('manifest.json')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('offers "End draft" on a wedged manual session and clears the stored session on click', async () => {
    // The exact shape `persistence.ts` (v4) writes for a leave-mid-draft-then-abandoned ESPN
    // session that never reconnected: `manual`, no frozenInit, no reconnectCred (activeProvider
    // reads this as 'espn' — see DraftSessionProvider's doc on that ternary).
    localStorage.setItem('ffa.draftSession.v4', JSON.stringify({
      userId: null, draftId: null, mode: 'manual', overrides: [], frozenInit: null,
      completedAt: null, from: null, provider: null, savedLeagueId: null,
    }));
    mockSignIn();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/draft']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    // Before the fix: this state rendered forever, with no button anywhere that could exit it.
    expect(await screen.findByText('Manual draft log')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect a draft' }));

    // Lands back on the disconnected launcher...
    expect(await screen.findByText(/Start tracking a draft/)).toBeInTheDocument();
    // ...and the wedge cannot recur on the next refresh.
    expect(localStorage.getItem('ffa.draftSession.v4')).toBeNull();
    // The ESPN-owned session asked the extension to drop its captured stream too, so a fresh
    // draft never inherits the abandoned one's picks.
    expect(requestEspnResetSnapshotMock).toHaveBeenCalled();
  });
});
