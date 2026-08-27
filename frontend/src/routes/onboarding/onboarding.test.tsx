import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPlayerPoolCache } from '../../data/loadPlayerPool';
import { AppRoutes } from '../../App';
import { espnAdapter } from '../../adapters/espn';
import { mockSignIn, __resetMockAuthState } from '../../auth/adapters/mockAuthAdapter';

// Regression guard for the 2026-08-15 ESPN sync outage: the setup form used to land in
// `session.kind: 'manual'` with the bridge disarmed, and `sessionAlerts` returned `[]` for any
// non-bridge session — so the Draft Room showed an ESPN pill, a league name, "0 picks", and NO
// alert anywhere explaining why nothing was streaming. These tests assert that state can't recur:
// the ESPN setup flow must land directly in a bridge session, and any manual session the header
// still calls "espn" must self-announce that it isn't connected.
//
// PORTED from App.test.tsx in Phase 3: the flow used to start on the landing's Sleeper card;
// since the landing became illustration-only it starts at /onboarding/league, which hosts the
// real ConnectSleeper/EspnSetupTabs unchanged. The assertions are untouched in meaning.
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

const { requestEspnSnapshotMock } = vi.hoisted(() => ({ requestEspnSnapshotMock: vi.fn() }));
vi.mock('../../adapters/espnBridge', () => ({ requestEspnSnapshot: requestEspnSnapshotMock }));

beforeEach(() => {
  vi.restoreAllMocks();
  requestEspnSnapshotMock.mockReset();
  requestEspnSnapshotMock.mockResolvedValue({ responded: false, live: null });
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

/** Drives Onboarding → League → "Set up ESPN draft" → fills the required draft position →
 * submits, landing in the Draft Room. Shared by every test below since the regression is
 * specifically about what this flow produces. */
async function startEspnSetup(user: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter initialEntries={['/onboarding/league']}>
      <AppRoutes />
    </MemoryRouter>,
  );
  await act(async () => {});
  await user.click(await screen.findByRole('button', { name: 'Set up ESPN draft' }));
  await user.type(screen.getByLabelText(/Your draft position/), '3');
  await user.click(screen.getByRole('button', { name: 'Start draft' }));
}

describe('Onboarding league step — ESPN session routing', () => {
  it('lands the ESPN setup flow directly in a bridge session, not a disarmed manual one', async () => {
    const user = userEvent.setup();
    await startEspnSetup(user);

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
    await startEspnSetup(user);

    // Explicitly downgrade to manual (the user's own "Switch to manual" action) — activeProvider
    // still reports 'espn' for this session, which is exactly the ambiguous state that rendered
    // zero alerts before this fix.
    await user.click(screen.getByRole('button', { name: 'Session actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Switch to manual' }));

    const alert = await screen.findByText(/Not connected to your ESPN draft tab/i);
    expect(alert).toBeInTheDocument();
    const connectAction = screen.getByRole('button', { name: 'Connect ESPN tab' });
    expect(connectAction).toBeInTheDocument();

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
    await startEspnSetup(user);

    const alertText = await screen.findByText(/Pick attribution isn't confirmed yet/i);
    expect(alertText.closest('[role="alert"]')).toHaveAttribute('data-severity', 'danger');

    // The escape hatch freezes the live board into a manual session, exactly like the menu action.
    await user.click(screen.getByRole('button', { name: 'Switch to manual' }));
    expect(await screen.findByText(/Not connected to your ESPN draft tab/i)).toBeInTheDocument();
  });

  it('warns when the ESPN tab attached mid-draft and names the attach point (Step 6d)', async () => {
    const user = userEvent.setup();
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
    await startEspnSetup(user);

    const alertText = await screen.findByText(/attached mid-draft at pick 138/i);
    expect(alertText.closest('[role="alert"]')).toHaveAttribute('data-severity', 'warn');
  });


});
