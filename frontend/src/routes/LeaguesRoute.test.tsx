import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedLeague } from '../../../shared/types';
import { LeaguesRoute } from './LeaguesRoute';

// The route reads two contexts: auth (through useSavedLeagues' repository seam — stubbed here, no
// HTTP) and the draft session (only handleConnect matters to a hub card). Both are module mocks so
// LeaguesRoute itself runs for real.
const handleConnectMock = vi.hoisted(() => vi.fn());

/** Mutable current stub value — each test installs what its scenario needs. */
const savedLeaguesStub = vi.hoisted(() => ({
  value: {
    leagues: [] as SavedLeague[],
    loading: false,
    error: null as Error | null,
    refresh: async () => {},
    saveLeague: async () => null as never,
    removeLeague: async () => {},
  },
}));

vi.mock('../data/useSavedLeagues', () => ({
  useSavedLeagues: () => savedLeaguesStub.value,
}));

vi.mock('../session/DraftSessionProvider', () => ({
  useDraftSession: () => ({ handleConnect: handleConnectMock }),
}));

function setStub(over: Partial<typeof savedLeaguesStub.value>): void {
  savedLeaguesStub.value = { ...savedLeaguesStub.value, ...over };
}

function leagueFixture(over: Partial<SavedLeague> = {}): SavedLeague {
  return {
    id: 'league-doc-1',
    userId: 'user-1',
    provider: 'sleeper',
    providerLeagueId: 'sleeper-league-1',
    name: 'Work League',
    season: '2026',
    teams: 12,
    rounds: 15,
    mySlot: 4,
    settings: { provider: 'sleeper', leagueId: 'sleeper-league-1' } as SavedLeague['settings'],
    providerUserId: 'sleeper-user-1',
    latestDraftId: 'draft-1',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function renderHub() {
  return render(
    <MemoryRouter>
      <LeaguesRoute />
    </MemoryRouter>,
  );
}

describe('LeaguesRoute', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows an honest empty state with a connect CTA when no leagues exist', async () => {
    setStub({ leagues: [] });
    renderHub();
    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect your first league' })).toHaveAttribute('href', '/leagues/connect');
  });

  it('renders a saved league with name, season, teams, and provider badge', async () => {
    setStub({ leagues: [leagueFixture()] });
    renderHub();

    expect(await screen.findByText('Work League')).toBeInTheDocument();
    expect(screen.getByText(/2026 · 12 teams/)).toBeInTheDocument();
    // No roster/waiver/lineup affordances — scope boundary (DECISIONS.md 2026-08-25).
    expect(screen.queryByText(/roster/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/waiver/i)).not.toBeInTheDocument();
  });

  it('tracks a draft from a card by reconstructing the stored Sleeper credential', async () => {
    const user = userEvent.setup();
    handleConnectMock.mockClear();
    setStub({ leagues: [leagueFixture()] });
    renderHub();

    await screen.findByText('Work League');
    await user.click(screen.getByRole('button', { name: 'Track draft' }));
    expect(handleConnectMock).toHaveBeenCalledWith({ provider: 'sleeper', userId: 'sleeper-user-1' }, 'draft-1');
  });

  it('omits Track draft when the saved identity is incomplete instead of pretending it works', async () => {
    setStub({ leagues: [leagueFixture({ latestDraftId: null })] });
    renderHub();

    await screen.findByText('Work League');
    expect(screen.queryByRole('button', { name: 'Track draft' })).not.toBeInTheDocument();
  });

  it('removes a league after an explicit confirm step', async () => {
    const user = userEvent.setup();
    const removeLeague = vi.fn(async () => {});
    setStub({ leagues: [leagueFixture()], removeLeague });
    renderHub();

    await screen.findByText('Work League');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removeLeague).not.toHaveBeenCalled(); // confirm-first
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(removeLeague).toHaveBeenCalledWith('league-doc-1');
  });
});
