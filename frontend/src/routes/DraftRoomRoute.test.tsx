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

  it('renders "Save to My Leagues" banner on an unsaved active draft and saves on click', async () => {
    const testInit = {
      provider: 'yahoo' as const,
      leagueId: 'yahoo-league-123',
      draftId: 'yahoo-draft-123',
      mySlot: 1,
      myTeamId: '1',
      teams: 10,
      rounds: 15,
      slotToTeam: { 1: '1', 2: '2' },
      slotToTeamName: { 1: 'Team 1', 2: 'Team 2' },
      settings: {
        name: 'My Yahoo League',
        teams: 10,
        rounds: 15,
        format: { reception: 'half-ppr' as const, qb: 'single-qb' as const },
        scoring: {},
        startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const,
        rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
      },
    };

    localStorage.setItem('ffa.draftSession.v4', JSON.stringify({
      userId: null, draftId: 'yahoo-draft-123', mode: 'manual', overrides: [], frozenInit: testInit,
      completedAt: null, from: null, provider: 'yahoo', savedLeagueId: null,
    }));
    mockSignIn();
    const user = userEvent.setup();
    const savedLeagueFixture = { id: 'saved-league-1', ...testInit, provider: 'manual', providerLeagueId: testInit.leagueId };
    const savedDraftFixture = { id: 'saved-draft-1', ...testInit, leagueId: 'saved-league-1', status: 'active' as const };

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('manifest.json')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      if (url.includes('/api/leagues') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedLeagueFixture) });
      }
      if (url.includes('/api/drafts') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedDraftFixture) });
      }
      if (url.includes('/api/leagues')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (url.includes('/api/drafts')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }));

    render(
      <MemoryRouter initialEntries={['/draft']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    // Save banner is present
    expect(await screen.findByText(/Save to My Leagues to sync across devices/)).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: 'Save to My Leagues' });
    await user.click(saveButton);

    // Success notification appears
    expect(await screen.findByText(/Saved to My Leagues!/)).toBeInTheDocument();
  });
});
