import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedLeague } from '../../../shared/types';
import { LeaguesRoute } from './LeaguesRoute';

// The route reads auth through useSavedLeagues' repository seam (stubbed here, no HTTP). Since the
// 2026-08-27 connect/start split, the hub card is a LINK to league detail and no longer touches the
// draft session at all — nothing here can start a draft or navigate to /draft.
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

  it('renders a saved league as a LINK to its detail page — never a Track-draft button', async () => {
    setStub({ leagues: [leagueFixture()] });
    renderHub();

    const link = await screen.findByRole('link', { name: /Work League/ });
    expect(link).toHaveAttribute('href', '/leagues/league-doc-1');
    // Drafts start only from the Draft Room — the hub must not offer or imply it.
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
