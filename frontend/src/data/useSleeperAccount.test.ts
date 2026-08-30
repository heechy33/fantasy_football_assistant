import { describe, expect, it } from 'vitest';
import type { SavedLeague } from '../../../shared/types';
import { deriveSleeperAccount } from './useSleeperAccount';

function league(overrides: Partial<SavedLeague>): SavedLeague {
  return {
    id: 'doc-1',
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
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveSleeperAccount', () => {
  it('derives the account from the most recently updated Sleeper league carrying a providerUserId', () => {
    const account = deriveSleeperAccount([
      league({ id: 'old', providerUserId: 'u-old', providerUsername: 'old_name', updatedAt: '2026-08-01T00:00:00.000Z' }),
      league({ id: 'new', providerUserId: 'u-new', providerUsername: 'new_name', updatedAt: '2026-08-27T00:00:00.000Z' }),
    ]);
    expect(account).toEqual({ userId: 'u-new', username: 'new_name' });
  });

  it('falls back to a null username for leagues saved before providerUsername existed', () => {
    expect(deriveSleeperAccount([league({ providerUserId: 'u-9', providerUsername: null })]))
      .toEqual({ userId: 'u-9', username: null });
  });

  it('ignores ESPN/manual leagues and Sleeper leagues without a stored userId', () => {
    expect(deriveSleeperAccount([
      league({ provider: 'espn', providerUserId: 'not-a-sleeper-id' }),
      league({ providerUserId: null }),
    ])).toBeNull();
  });

  it('returns null for an empty league list', () => {
    expect(deriveSleeperAccount([])).toBeNull();
  });
});
