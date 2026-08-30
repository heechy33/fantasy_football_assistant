import { useMemo } from 'react';
import type { SavedLeague } from '../../../shared/types';
import { useSavedLeagues } from './useSavedLeagues';
import type { SavedLeaguesRepository } from './savedLeaguesRepository';

/** The Sleeper identity remembered from a previously saved league: the canonical userId that hub
 * cards already use to re-track drafts, plus the human username (`providerUsername`) for display.
 * `username` is null for leagues saved before the field existed — no migration; the next save
 * fills it in, and callers fall back to showing the raw id. */
export interface SleeperAccount {
  userId: string;
  username: string | null;
}

/**
 * ONE named rule for "which Sleeper account is signed in": the most recently `updatedAt` saved
 * Sleeper league carrying a `providerUserId`. This replaces the launcher's arbitrary
 * `sleeperLeagues[0]!` pick (DraftLauncher, pre-2026-08-28) with a deterministic, tested choice.
 */
export function deriveSleeperAccount(leagues: SavedLeague[]): SleeperAccount | null {
  const sleepers = leagues
    .filter((league) => league.provider === 'sleeper' && league.providerUserId)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const first = sleepers[0];
  return first?.providerUserId ? { userId: first.providerUserId, username: first.providerUsername ?? null } : null;
}

/** `useSavedLeagues` plus the derived Sleeper account — one hook, one HTTP fetch, so the connect
 * surface and the Draft Room launcher share a single definition of the signed-in identity. */
export function useSleeperAccount(repositoryOverride?: SavedLeaguesRepository) {
  const saved = useSavedLeagues(repositoryOverride);
  const account = useMemo(() => deriveSleeperAccount(saved.leagues), [saved.leagues]);
  return { ...saved, account };
}
