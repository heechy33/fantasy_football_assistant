import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { EspnLeagueSnapshot, SavedDraft, SavedLeague } from '../../../shared/types';

const useSleeperAccountMock = vi.fn();
const useEspnBridgeMock = vi.fn();
const useActiveSavedDraftsMock = vi.fn();
const handleConnectMock = vi.fn();
const handleEspnStartMock = vi.fn();
const handleResumeDraftMock = vi.fn();
const listSleeperDraftsMock = vi.fn();
const resolveUserMock = vi.fn();

vi.mock('../data/useSleeperAccount', () => ({
  useSleeperAccount: (...args: unknown[]) => useSleeperAccountMock(...args),
}));
vi.mock('../data/useSavedDrafts', () => ({
  useActiveSavedDrafts: (...args: unknown[]) => useActiveSavedDraftsMock(...args),
}));
vi.mock('../hooks/useEspnBridge', () => ({
  useEspnBridge: (...args: unknown[]) => useEspnBridgeMock(...args),
}));
vi.mock('../session/DraftSessionProvider', () => ({
  useDraftSession: () => ({
    handleConnect: handleConnectMock,
    handleEspnStart: handleEspnStartMock,
    handleResumeDraft: handleResumeDraftMock,
  }),
}));
vi.mock('../adapters/sleeper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/sleeper')>();
  return {
    ...actual,
    listSleeperDrafts: (...args: unknown[]) => listSleeperDraftsMock(...args),
    resolveUser: (...args: unknown[]) => resolveUserMock(...args),
  };
});

const { DraftLauncher } = await import('./DraftLauncher');

function savedLeague(overrides: Partial<SavedLeague> = {}): SavedLeague {
  return {
    id: 'doc-1',
    userId: 'user-1',
    provider: 'espn',
    providerLeagueId: 'espn-1',
    name: 'ESPN League',
    season: '2026',
    teams: 10,
    rounds: 14,
    mySlot: null,
    settings: { provider: 'espn', leagueId: 'espn-1' } as SavedLeague['settings'],
    providerUserId: null,
    latestDraftId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function savedDraft(overrides: Partial<SavedDraft> = {}): SavedDraft {
  return {
    id: 'draft-doc-1',
    userId: 'user-1',
    leagueId: 'doc-1',
    provider: 'espn',
    providerDraftId: 'espn-draft-1',
    mode: 'espn',
    frozenInit: null,
    overrides: [],
    status: 'active',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function espnLeagueSnapshot(overrides: Partial<EspnLeagueSnapshot> = {}): EspnLeagueSnapshot {
  return {
    schemaVersion: 1,
    leagueId: 'L1',
    season: '2026',
    name: 'Real League',
    teams: 10,
    rounds: 15,
    startingSlots: [],
    rosterSlots: {},
    scoring: { rec: 1 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    myTeamId: null,
    diagnostics: [],
    teamNames: [],
    capturedAt: 1,
    ...overrides,
  };
}

/** Default hook returns for a signed-out/no-leagues mount; individual tests override. */
function mockAccountHook(account: unknown, leagues: SavedLeague[] = []) {
  useSleeperAccountMock.mockReturnValue({
    leagues, loading: false, error: null, refresh: async () => {},
    saveLeague: async () => { throw new Error('not used'); }, saveDraft: async () => { throw new Error('not used'); },
    removeLeague: async () => {}, account,
  });
}

function harness() {
  return render(
    <MemoryRouter>
      <DraftLauncher />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useEspnBridgeMock.mockReturnValue({ status: 'no-extension', extensionPresent: false, live: null, detectedLeague: null });
  useActiveSavedDraftsMock.mockReturnValue({
    drafts: [], loading: false, error: null, refresh: async () => {}, removeDraft: async () => {},
  });
  mockAccountHook(null);
});

describe('DraftLauncher — Sleeper', () => {
  it('auto-lists the remembered account’s drafts and tracks the chosen one', async () => {
    mockAccountHook({ userId: 'u-9', username: 'coach_x' });
    listSleeperDraftsMock.mockResolvedValue([
      { draftId: 'd-1', name: 'League draft', season: '2026', totalTeams: 12, status: 'drafting', type: 'snake' },
    ]);
    harness();
    expect(await screen.findByText('League draft')).toBeTruthy();
    expect(listSleeperDraftsMock).toHaveBeenCalledWith({ provider: 'sleeper', userId: 'u-9' }, '2026');
    // Account known → the paste form never asks for a username.
    expect(screen.queryByText(/Sleeper username/i)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Track draft' }));
    expect(handleConnectMock).toHaveBeenCalledWith({ provider: 'sleeper', userId: 'u-9' }, 'd-1');
  });

  it('renders a finished draft disabled with a finished chip instead of hiding it', async () => {
    mockAccountHook({ userId: 'u-9', username: null });
    listSleeperDraftsMock.mockResolvedValue([
      { draftId: 'd-2', name: 'Done deal', season: '2026', totalTeams: 10, status: 'complete', type: 'snake' },
    ]);
    harness();
    const button = (await screen.findByRole('button', { name: 'Finished' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('finished')).toBeTruthy();
    expect(handleConnectMock).not.toHaveBeenCalled();
  });

  it('renders a draft-listing failure as an error with a working Retry, not as "no drafts"', async () => {
    mockAccountHook({ userId: 'u-9', username: null });
    listSleeperDraftsMock
      .mockRejectedValueOnce(new Error('Sleeper down'))
      .mockResolvedValueOnce([
        { draftId: 'd-3', name: 'Second try', season: '2026', totalTeams: 12, status: 'drafting', type: 'snake' },
      ]);
    harness();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sleeper down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Second try')).toBeTruthy();
  });

  it('with zero saved leagues it keeps the resolve-a-username escape hatch in the paste form', () => {
    harness();
    expect(screen.getByText(/Sleeper username/i)).toBeTruthy();
    // The hoisted bridge poller is ALWAYS on — live detection without a saved league (mocks, a
    // friend's league) requires listening even when nothing is connected.
    expect(useEspnBridgeMock).toHaveBeenCalledWith(null);
  });

  it('never asks a remembered user for a username after the account resolves post-mount', async () => {
    // useSleeperAccount resolves asynchronously: at first paint account is still null, and the
    // paste form must pick the account up when it arrives (it previously locked the mount-time
    // null into component state and demanded a username from a known user).
    listSleeperDraftsMock.mockResolvedValue([]);
    const view = harness();
    expect(screen.getByText(/Sleeper username/i)).toBeTruthy();
    mockAccountHook({ userId: 'u-9', username: 'coach_x' });
    view.rerender(
      <MemoryRouter>
        <DraftLauncher />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No 2026 Sleeper drafts on this account yet/)).toBeTruthy();
    expect(screen.queryByText(/Sleeper username/i)).toBeNull();
  });
});

describe('DraftLauncher — ESPN (live-only, 2026-08-29 redesign)', () => {
  it('shows no ESPN card at all when nothing is live-detected, even with saved ESPN leagues', () => {
    mockAccountHook(null, [savedLeague()]);
    harness();
    expect(screen.queryByTestId('espn-live-detected-card')).toBeNull();
    expect(screen.queryByText('ESPN League')).toBeNull();
  });

  it('never renders a card for a saved ESPN league, live or not — the Draft Room only shows detected drafts', () => {
    mockAccountHook(null, [savedLeague({ name: 'My Saved League' })]);
    useEspnBridgeMock.mockReturnValue({
      status: 'live',
      extensionPresent: true,
      live: {
        schemaVersion: 2, leagueId: 'a-different-league', lastHeartbeatAt: 1, mySlot: 7, streamPicks: [],
        leagueTeams: 10, leagueRounds: 14,
      },
      detectedLeague: null,
    });
    harness();
    expect(screen.queryByText('My Saved League')).toBeNull();
    // Exactly one card — the live-detected one, not a second saved-league card.
    expect(screen.getAllByTestId('espn-live-detected-card')).toHaveLength(1);
  });

  it('blocks entry and offers the explicit override until real ESPN scoring settings land', async () => {
    useEspnBridgeMock.mockReturnValue({
      status: 'live',
      extensionPresent: true,
      live: {
        schemaVersion: 2, leagueId: 'L1', lastHeartbeatAt: 1, mySlot: 7, leagueTeams: 10, leagueRounds: 15,
        domMaxAtStreamStart: 0, domSampledBeforeStream: true,
        streamPicks: [
          { overall: 1, slot: 7, playerId: 'p1' },
          { overall: 2, slot: 3, playerId: 'p2' },
          { overall: 3, slot: 5, playerId: 'p3' },
        ],
      },
      // No detectedLeague yet — the draft page's own settings capture hasn't landed.
      detectedLeague: null,
    });
    harness();
    expect(await screen.findByTestId('espn-live-detected-card')).toBeTruthy();
    expect(screen.getByTestId('espn-settings-status')).toHaveTextContent(/real scoring settings from ESPN/);
    const enter = screen.getByRole('button', { name: 'Enter draft room' }) as HTMLButtonElement;
    expect(enter.disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /Start without ESPN's scoring/ }));
    expect(enter.disabled).toBe(false);
    expect(screen.getByTestId('espn-settings-status')).toHaveTextContent(/guessed PPR scoring preset/);

    await userEvent.click(enter);
    expect(handleEspnStartMock).toHaveBeenCalledTimes(1);
    const [league, seat, usesPresetSettings] = handleEspnStartMock.mock.calls[0]!;
    expect(seat).toBe(1); // derived from the confirmed order (team id 7 made overall pick 1)
    expect(usesPresetSettings).toBe(true);
    // The guide's guessed PPR preset, never the real ESPN scoring map from the other test below.
    expect(league.settings.scoring).not.toEqual({ rec: 1, pass_td: 4 });
  });

  it('enters immediately, no override needed, once the draft page relays real scoring settings', async () => {
    useEspnBridgeMock.mockReturnValue({
      status: 'live',
      extensionPresent: true,
      live: {
        schemaVersion: 2, leagueId: 'L1', lastHeartbeatAt: 1, mySlot: 7, leagueTeams: 10, leagueRounds: 15,
        domMaxAtStreamStart: 0, domSampledBeforeStream: true,
        streamPicks: [
          { overall: 1, slot: 7, playerId: 'p1' },
          { overall: 2, slot: 3, playerId: 'p2' },
          { overall: 3, slot: 5, playerId: 'p3' },
        ],
      },
      detectedLeague: espnLeagueSnapshot({ leagueId: 'L1', teams: 10, rounds: 15, scoring: { rec: 1, pass_td: 4 } }),
    });
    harness();
    expect(await screen.findByTestId('espn-live-detected-card')).toBeTruthy();
    expect(screen.queryByTestId('espn-settings-status')).toBeNull();
    expect(screen.getByText('10 teams')).toBeTruthy();
    expect(screen.getByText('15 rounds')).toBeTruthy();
    const enter = screen.getByRole('button', { name: 'Enter draft room' }) as HTMLButtonElement;
    expect(enter.disabled).toBe(false);

    await userEvent.click(enter);
    const [league, seat, usesPresetSettings] = handleEspnStartMock.mock.calls[0]!;
    expect(seat).toBe(1);
    expect(usesPresetSettings).toBe(false);
    expect(league.settings.scoring).toEqual({ rec: 1, pass_td: 4 });
  });

  it('mid-draft attach: real settings load with an empty stream, once leagueId comes from the detail reconcile alone (2026-08-30)', async () => {
    // The extension no longer waits for a socket frame to learn the league id on a mid-draft
    // attach — the periodic mDraftDetail reconcile stamps `live.leagueId` itself. This snapshot has
    // an EMPTY streamPicks (no socket frame has arrived at all) but a real leagueId and a matching
    // detectedLeague, exactly what that reconcile alone produces. The card must not fall back to
    // the guessed-PPR-preset escape hatch just because the stream is empty.
    useEspnBridgeMock.mockReturnValue({
      status: 'live',
      extensionPresent: true,
      live: {
        schemaVersion: 2, leagueId: 'L1', lastHeartbeatAt: null, mySlot: null, leagueTeams: 10, leagueRounds: 15,
        streamPicks: [],
      },
      detectedLeague: espnLeagueSnapshot({ leagueId: 'L1', teams: 10, rounds: 15, scoring: { rec: 1, pass_td: 4 } }),
    });
    harness();
    expect(await screen.findByTestId('espn-live-detected-card')).toBeTruthy();
    expect(screen.queryByTestId('espn-settings-status')).toBeNull();
    expect(screen.queryByRole('button', { name: /Start without ESPN's scoring/ })).toBeNull();
    expect(screen.getByText('10 teams')).toBeTruthy();
    expect(screen.getByText('15 rounds')).toBeTruthy();
    // No confirmed order yet (empty stream) — the seat is honestly not auto-detected, matching the
    // existing "never presents the team id as a draft position" behavior; the button is still
    // gated on a typed seat, not on scoring settings.
    const seatInput = screen.getByLabelText(/Position/);
    expect(seatInput).toHaveValue(null);
    await userEvent.type(seatInput, '3');
    const button = screen.getByRole('button', { name: 'Start tracking' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('renders nothing while the draft grid is unknown — no half-known card', () => {
    // 2026-08-30: a snapshot with no confirmed teams/rounds yet used to render a compact "pending"
    // card. That read as broken more than "not yet connected", so it now renders nothing at all
    // until the real grid is known.
    useEspnBridgeMock.mockReturnValue({
      status: 'stale',
      extensionPresent: true,
      isStale: true,
      live: { schemaVersion: 2, streamPicks: [], mySlot: 7, leagueId: 'L1', lastHeartbeatAt: 1 },
      detectedLeague: null,
    });
    harness();
    expect(screen.queryByTestId('espn-live-detected-card')).toBeNull();
  });

  it('renders nothing for a STALE live-detected snapshot (dead draft residue), even with a full stream', () => {
    // 2026-08-29: the shared extension key survives a finished/closed draft. A corpse snapshot
    // (status disconnected — dead heartbeat) must not surface a card at all, since `isLive` (and
    // therefore `fullyDetected`) is false for any non-'live' status regardless of stream content.
    useEspnBridgeMock.mockReturnValue({
      status: 'disconnected',
      extensionPresent: true,
      isStale: true,
      live: {
        schemaVersion: 2, leagueId: 'L1', lastHeartbeatAt: 1, mySlot: 1, leagueTeams: 10, leagueRounds: 15,
        domMaxAtStreamStart: 0, domSampledBeforeStream: true,
        streamPicks: [
          { overall: 1, slot: 1, playerId: 'p1' },
          { overall: 2, slot: 4, playerId: 'p2' },
          { overall: 3, slot: 7, playerId: 'p3' },
        ],
      },
      detectedLeague: espnLeagueSnapshot({ leagueId: 'L1', scoring: { rec: 1 } }),
    });
    harness();
    expect(screen.queryByTestId('espn-live-detected-card')).toBeNull();
  });
});

describe('DraftLauncher — Resume', () => {
  it('offers a resume card for an active saved-league draft, named from the saved league', () => {
    mockAccountHook(null, [savedLeague({ id: 'league-doc-1', name: 'Dynasty Warriors' })]);
    useActiveSavedDraftsMock.mockReturnValue({
      drafts: [savedDraft({ leagueId: 'league-doc-1' })],
      loading: false, error: null, refresh: async () => {},
    });
    harness();
    expect(screen.getByText('Resume a draft')).toBeTruthy();
    expect(screen.getByText('Dynasty Warriors')).toBeTruthy();
  });

  it('calls handleResumeDraft with the SavedDraft row when Resume is clicked', async () => {
    const draft = savedDraft({ leagueId: 'league-doc-1' });
    mockAccountHook(null, [savedLeague({ id: 'league-doc-1', name: 'Dynasty Warriors' })]);
    useActiveSavedDraftsMock.mockReturnValue({ drafts: [draft], loading: false, error: null, refresh: async () => {} });
    harness();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(handleResumeDraftMock).toHaveBeenCalledWith(draft);
  });

  it('renders nothing when there is no active draft to resume', () => {
    harness();
    expect(screen.queryByText('Resume a draft')).toBeNull();
  });

  it('offers a Delete per tile that removes the stale transcript and re-fetches', async () => {
    const removeDraftMock = vi.fn(async () => {});
    mockAccountHook(null, [savedLeague({ id: 'league-doc-1', name: 'Dynasty Warriors' })]);
    useActiveSavedDraftsMock.mockReturnValue({
      drafts: [savedDraft({ leagueId: 'league-doc-1' })],
      loading: false, error: null, refresh: async () => {}, removeDraft: removeDraftMock,
    });
    harness();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(removeDraftMock).toHaveBeenCalledWith('draft-doc-1');
  });
});

describe('DraftLauncher — ESPN live-detected draft resume (2026-08-30 re-entry fix)', () => {
  const liveFixture = {
    status: 'live',
    extensionPresent: true,
    live: {
      schemaVersion: 2,
      leagueId: 'L1',
      lastHeartbeatAt: 1,
      mySlot: 1,
      leagueTeams: 10,
      leagueRounds: 15,
      domMaxAtStreamStart: 0,
      domSampledBeforeStream: true,
      streamPicks: [
        { overall: 1, slot: 1, playerId: 'p1' },
        { overall: 2, slot: 4, playerId: 'p2' },
        { overall: 3, slot: 7, playerId: 'p3' },
      ],
    },
    detectedLeague: espnLeagueSnapshot({ leagueId: 'L1' }),
  };

  it('offers to resume the matching active transcript on the live-detected card', async () => {
    const draft = savedDraft({
      mode: 'espn',
      frozenInit: { leagueId: 'L1', provider: 'espn' } as never,
      picks: [{ overall: 1 } as never, { overall: 2 } as never, { overall: 3 } as never],
    });
    useEspnBridgeMock.mockReturnValue({ ...liveFixture });
    useActiveSavedDraftsMock.mockReturnValue({
      drafts: [draft], loading: false, error: null, refresh: async () => {}, removeDraft: async () => {},
    });
    harness();
    const resume = await screen.findByRole('button', { name: 'Resume draft (3 picks logged)' });
    await userEvent.click(resume);
    expect(handleResumeDraftMock).toHaveBeenCalledWith(draft);
  });

  it('does not offer a resume on the live-detected card when no transcript matches this draft', () => {
    useEspnBridgeMock.mockReturnValue({ ...liveFixture });
    harness();
    expect(screen.queryByRole('button', { name: /Resume draft/ })).toBeNull();
  });
});
