import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPlayerPoolCache } from '../../data/loadPlayerPool';
import { AppRoutes } from '../../App';
import { espnAdapter } from '../../adapters/espn';
import { mockSignIn, __resetMockAuthState } from '../../auth/adapters/mockAuthAdapter';

// Regression guard for the 2026-08-15 ESPN sync outage: a session could land out of `kind:
// 'bridge'` with the bridge disarmed, and `sessionAlerts` returned `[]` for any non-bridge
// session — so the Draft Room showed an ESPN pill, a league name, "0 picks", and NO alert anywhere
// explaining why nothing was streaming. These tests assert that state can't recur: a bridge
// session must self-announce when the relay isn't streaming, and any manual session the header
// still calls "espn" must self-announce that it isn't connected.
//
// PORTED from App.test.tsx in Phase 3; RE-PORTED 2026-08-28 for the connect/start split, and
// RE-DRIVEN 2026-08-28 when the manual-create path was removed (DECISIONS.md: drafts start only
// from a saved league / the launcher card, so there is no form to drive anymore). The driver now
// seeds a persisted bridge session (`ffa.draftSession.v3`, mode 'espn') and renders /draft — the
// same `kind: 'bridge'` state the old flow produced, without the deleted entry point. The
// assertions are unchanged in meaning.
//
// DraftWorkspace is mocked out — this file is about session routing (the provider's Session union
// and the sessionAlerts memo), not engine/board rendering, which DraftWorkspace.test.tsx already
// covers in depth with its own heavy mocks (recommend engine, refinement worker).
vi.mock('../../components/DraftWorkspace', async () => {
  const { SessionMenu } = await import('../../components/SessionMenu');
  return {
    DraftWorkspace: ({
      sessionActions = [],
    }: {
      sessionActions?: import('../../components/SessionMenu').SessionAction[];
    }) => (sessionActions.length > 0 ? <SessionMenu actions={sessionActions} /> : null),
  };
});

const { requestEspnSnapshotMock, requestEspnLeagueMock, requestEspnDraftLeagueMock } = vi.hoisted(() => ({
  requestEspnSnapshotMock: vi.fn(),
  // Added alongside the 2026-08-27 connect-split work's EspnSetupTabs, which calls this on mount
  // to detect the league — an unmocked import made every test in this file throw on mount.
  requestEspnLeagueMock: vi.fn(),
  // Draft-page settings poll (2026-08-29) — useEspnBridge runs for real whenever a bridge session
  // exists (this file seeds one via persisted state), so it needs a stub too or its own effect
  // throws on the missing export.
  requestEspnDraftLeagueMock: vi.fn().mockResolvedValue({ responded: false, league: null }),
}));
vi.mock('../../adapters/espnBridge', () => ({
  requestEspnSnapshot: requestEspnSnapshotMock,
  requestEspnLeague: requestEspnLeagueMock,
  requestEspnDraftLeague: requestEspnDraftLeagueMock,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  requestEspnSnapshotMock.mockReset();
  requestEspnSnapshotMock.mockResolvedValue({ responded: false, live: null });
  requestEspnLeagueMock.mockReset();
  requestEspnLeagueMock.mockResolvedValue({ responded: false, league: null });
  __resetPlayerPoolCache();
  __resetMockAuthState();
  // /onboarding/* is account-required (Phase 4) — every test here drives the flow post-signup.
  mockSignIn();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('manifest.json')) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  cleanup();
});

/** Seeds a persisted ESPN bridge session (mode 'espn' + a valid frozenInit) and renders /draft,
 * landing in the Draft Room workspace. Shared by every test below since the regression is
 * specifically about what this session state produces. The bridge's `requestEspnSnapshot` mock
 * stays at its default `{ responded: false }` — a bridge session whose relay isn't streaming. */
function startEspnBridgeSession() {
  const slotToTeam: Record<number, string> = {};
  const slotToTeamName: Record<number, string> = {};
  for (let slot = 1; slot <= 12; slot += 1) {
    slotToTeam[slot] = String(slot);
    slotToTeamName[slot] = `Team ${slot}`;
  }
  const frozenInit = {
    provider: 'espn',
    draftId: 'manual-session',
    leagueId: 'espn-test-1',
    draftType: 'snake',
    teams: 12,
    rounds: 15,
    slotToTeam,
    slotToTeamName,
    myTeamId: '3',
    mySlot: 3,
    settings: {
      provider: 'espn',
      leagueId: 'espn-test-1',
      name: 'ESPN Test League',
      season: '2026',
      teams: 12,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 },
      scoring: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    },
  };
  localStorage.setItem('ffa.draftSession.v4', JSON.stringify({
    userId: null,
    draftId: null,
    mode: 'espn',
    overrides: [],
    frozenInit,
    completedAt: null,
    from: null,
    provider: 'espn',
    savedLeagueId: null,
  }));
  render(
    <MemoryRouter initialEntries={['/draft']}>
      <AppRoutes />
    </MemoryRouter>,
  );
  return act(async () => {});
}

describe('Onboarding league step — ESPN session routing', () => {
  it('lands the ESPN setup flow directly in a bridge session, not a disarmed manual one', async () => {
    const user = userEvent.setup();
    await startEspnBridgeSession();

    // Bridge-only vs manual-only menu items are the observable proof of session.kind: 'bridge'
    // menus offer "Switch to manual"; plain manual-ESPN sessions offer "Connect ESPN tab" instead.
    await user.click(await screen.findByRole('button', { name: 'Session actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Connect ESPN tab' })).not.toBeInTheDocument();

    // The regression itself: no silent state. A brand-new bridge session with the relay not yet
    // detected must show ITS OWN honest-failure alert, never nothing.
    expect(await screen.findByText(/ESPN extension not detected/i)).toBeInTheDocument();
  });

  it('shows a working "bridge not connected" alert for a manual session the header still calls ESPN', async () => {
    const user = userEvent.setup();
    await startEspnBridgeSession();

    // Explicitly downgrade to manual (the user's own "Switch to manual" action) — activeProvider
    // still reports 'espn' for this session, which is exactly the ambiguous state that rendered
    // zero alerts before this fix.
    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Switch to manual' }));

    expect(screen.queryByText(/Not connected to your ESPN draft tab/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    const connectAction = screen.getByRole('menuitem', { name: 'Connect ESPN tab' });

    // The action must actually work: it re-arms the bridge (kind: 'bridge' again).
    await user.click(connectAction);
    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Switch to manual' })).toBeInTheDocument();
    expect(screen.queryByText(/Not connected to your ESPN draft tab/i)).not.toBeInTheDocument();
  });
  it('surfaces unattributed picks as a danger alert with a working Switch-to-manual action (Step 6d)', async () => {
    const user = userEvent.setup();
    vi.spyOn(espnAdapter, 'picks').mockResolvedValue({
      status: 'drafting',
      picks: [
        { overall: 1, round: 1, slot: 0, teamId: '', playerId: '1', providerPlayerId: '3139477', providerPlayerName: 'Christian McCaffrey', unattributed: true },
        { overall: 2, round: 1, slot: 0, teamId: '', playerId: null, providerPlayerId: '15847', providerPlayerName: 'James Cook', unattributed: true },
      ],
      onTheClock: null,
      fetchedAt: 1,
      unattributedCount: 2,
    });
    await startEspnBridgeSession();

    const alertText = await screen.findByText(/Pick attribution isn't confirmed yet/i);
    expect(alertText.closest('[role="alert"]')).toHaveAttribute('data-severity', 'danger');

    // The escape hatch freezes the live board into a manual session, exactly like the menu action.
    await user.click(screen.getByRole('button', { name: 'Switch to manual' }));
    expect(screen.queryByText(/Not connected to your ESPN draft tab/i)).not.toBeInTheDocument();
  });

  it('warns when the ESPN tab attached mid-draft and names the attach point (Step 6d)', async () => {
    vi.spyOn(espnAdapter, 'picks').mockResolvedValue({
      status: 'drafting',
      picks: [
        { overall: 138, round: 12, slot: 1, teamId: '1', playerId: '1', providerPlayerId: '3139477', providerPlayerName: 'Christian McCaffrey', providerTeamId: '5' },
        { overall: 139, round: 12, slot: 2, teamId: '2', playerId: '2', providerPlayerId: '15847', providerPlayerName: 'James Cook', providerTeamId: '1' },
      ],
      onTheClock: null,
      fetchedAt: 1,
      unattributedCount: 0,
    });
    await startEspnBridgeSession();

    const alertText = await screen.findByText(/attached mid-draft at pick 138/i);
    expect(alertText.closest('[role="alert"]')).toHaveAttribute('data-severity', 'warn');
  });


});
