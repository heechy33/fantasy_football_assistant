import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavedLeague } from '../../../shared/types';

const accountMock = vi.fn();
vi.mock('../data/useSleeperAccount', () => ({
  useSleeperAccount: () => accountMock(),
}));
const { listLeaguesMock, resolveUserMock } = vi.hoisted(() => ({
  listLeaguesMock: vi.fn(),
  resolveUserMock: vi.fn(),
}));
vi.mock('../adapters/sleeper', () => ({
  resolveUser: resolveUserMock,
  sleeperAdapter: { listLeagues: listLeaguesMock, settings: vi.fn() },
}));

const { ConnectSleeper } = await import('./ConnectSleeper');

function knownAccount(over: Partial<{ userId: string; username: string | null }> = {}) {
  return {
    leagues: [], loading: false, error: null, refresh: async () => {},
    saveLeague: async () => ({}) as never, saveDraft: async () => ({}) as never,
    removeLeague: async () => {}, account: { userId: 'u-9', username: 'coach_x', ...over },
  };
}

function savedLeagueFixture(over: Partial<SavedLeague> = {}): SavedLeague {
  return {
    id: 'saved-1',
    userId: 'user-1',
    provider: 'sleeper',
    providerLeagueId: 'league-1',
    name: 'Work League',
    season: '2026',
    teams: 12,
    rounds: 15,
    mySlot: null,
    settings: { provider: 'sleeper', leagueId: 'league-1' } as SavedLeague['settings'],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('ConnectSleeper', () => {
  beforeEach(() => {
    listLeaguesMock.mockReset();
    listLeaguesMock.mockResolvedValue([]);
    resolveUserMock.mockReset();
  });

  it('skips the username form entirely when a Sleeper account is already remembered', () => {
    accountMock.mockReturnValue(knownAccount());
    render(<ConnectSleeper />);
    expect(screen.getByText(/Connected as/)).toHaveTextContent('coach_x');
    expect(screen.queryByText(/Sleeper username/)).toBeNull();
    // The escape hatch is present and local-only.
    expect(screen.getByRole('button', { name: 'Use a different account' })).toBeTruthy();
  });

  it('falls back to the raw user id when no username is stored yet', () => {
    accountMock.mockReturnValue(knownAccount({ username: null }));
    render(<ConnectSleeper />);
    expect(screen.getByText(/Connected as/)).toHaveTextContent('u-9');
  });

  it('shows the username form when no account is known', () => {
    accountMock.mockReturnValue({
      leagues: [], loading: false, error: null, refresh: async () => {},
      saveLeague: async () => ({}) as never, saveDraft: async () => ({}) as never,
      removeLeague: async () => {}, account: null,
    });
    render(<ConnectSleeper />);
    expect(screen.getByText('Sleeper username')).toBeTruthy();
  });

  it('offers a way back to the remembered account after "Use a different account"', async () => {
    accountMock.mockReturnValue(knownAccount());
    render(<ConnectSleeper />);
    await userEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    // The username form shows, plus a no-refetch escape back to the stored identity.
    expect(screen.getByText('Sleeper username')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'coach_x' }));
    expect(screen.getByText(/Connected as/)).toHaveTextContent('coach_x');
    expect(screen.queryByText(/Sleeper username/)).toBeNull();
  });

  it('auto-loads leagues for a known account with no button press', async () => {
    accountMock.mockReturnValue(knownAccount());
    listLeaguesMock.mockResolvedValue([
      { leagueId: 'league-1', name: 'Work League', totalTeams: 12, season: '2026', status: 'in_season' },
    ]);
    render(<ConnectSleeper />);
    expect(await screen.findByText('Work League')).toBeInTheDocument();
    expect(listLeaguesMock).toHaveBeenCalledWith({ provider: 'sleeper', userId: 'u-9' }, expect.any(String));
  });

  it('renders a mount-time load failure as an honest error with Retry, never as "no leagues"', async () => {
    accountMock.mockReturnValue(knownAccount());
    listLeaguesMock.mockRejectedValueOnce(new Error('network blip'));
    listLeaguesMock.mockResolvedValueOnce([
      { leagueId: 'league-1', name: 'Recovered League', totalTeams: 10, season: '2026', status: 'in_season' },
    ]);
    render(<ConnectSleeper />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('network blip');
    expect(screen.queryByText(/No .* leagues found/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Recovered League')).toBeInTheDocument();
  });

  it('shows "Saved" instead of a Save button for a league that is already in My Leagues', async () => {
    accountMock.mockReturnValue(knownAccount());
    listLeaguesMock.mockResolvedValue([
      { leagueId: 'league-1', name: 'Work League', totalTeams: 12, season: '2026', status: 'in_season' },
      { leagueId: 'league-2', name: 'Home League', totalTeams: 10, season: '2026', status: 'in_season' },
    ]);
    render(<ConnectSleeper onSaveLeague={async () => {}} savedLeagues={[savedLeagueFixture({ providerLeagueId: 'league-1' })]} />);

    await waitFor(() => expect(screen.getByText('Work League')).toBeInTheDocument());
    const workLeagueCard = screen.getByText('Work League').closest('li')!;
    expect(within(workLeagueCard).getByText('Saved')).toBeInTheDocument();
    expect(within(workLeagueCard).queryByRole('button', { name: 'Save league' })).not.toBeInTheDocument();

    const homeLeagueCard = screen.getByText('Home League').closest('li')!;
    expect(within(homeLeagueCard).getByRole('button', { name: 'Save league' })).toBeInTheDocument();
  });
});
