import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeagueRef, LeagueSettings, SavedLeague, SleeperCred } from '../../../shared/types';
import { sleeperAdapter } from '../adapters/sleeper';
import { useAuth } from '../auth/AuthProvider';
import { createHttpRepository } from './repositories/httpRepository';
import type { SavedLeaguesRepository } from './savedLeaguesRepository';

/**
 * Repository access for UI pages (the league hub, the connect surface) — mirrors `useDraftSync`'s
 * instantiation of `createHttpRepository` exactly, including the `repositoryOverride` seam for
 * tests. There is deliberately one HTTP path (`httpRepository`); this hook adds none.
 */
export function useSavedLeagues(repositoryOverride?: SavedLeaguesRepository): {
  leagues: SavedLeague[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  saveLeague: (input: Partial<SavedLeague> & { settings: LeagueSettings }) => Promise<SavedLeague>;
  removeLeague: (id: string) => Promise<void>;
} {
  const { getToken } = useAuth();
  const repository = useMemo(
    () => repositoryOverride ?? createHttpRepository(getToken),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repositoryOverride],
  );
  const [leagues, setLeagues] = useState<SavedLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLeagues(await repository.listLeagues());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveLeague = useCallback(
    (input: Partial<SavedLeague> & { settings: LeagueSettings }) => repository.upsertLeague(input),
    [repository],
  );
  const removeLeague = useCallback(
    async (id: string) => {
      await repository.deleteLeague(id);
      setLeagues((current) => current.filter((league) => league.id !== id));
    },
    [repository],
  );

  return { leagues, loading, error, refresh, saveLeague, removeLeague };
}

/**
 * Build the repository input for a Sleeper league saved from the connect surface. This is the
 * league-first path's season source: `LeagueRef` carries `season`, which `DraftInit` does not,
 * so only here can a real season reach Cosmos (retiring the `season: ''` placeholder for this
 * path while draft-sync still can't supply one — DECISIONS.md 2026-08-26). Also captures the
 * identity a hub card needs to re-track a draft later: `providerUserId` + `latestDraftId`.
 */
export async function buildSleeperLeagueInput(cred: SleeperCred, ref: LeagueRef): Promise<Partial<SavedLeague> & { settings: LeagueSettings }> {
  const settings = await sleeperAdapter.settings(cred, ref.leagueId);
  return {
    provider: 'sleeper',
    providerLeagueId: ref.leagueId,
    name: ref.name,
    season: ref.season,
    teams: ref.totalTeams,
    // rounds/mySlot stay unset; draft sync fills them in when a tracked draft actually runs.
    rounds: 0,
    mySlot: null,
    settings,
    providerUserId: cred.userId,
    latestDraftId: ref.draftId ?? null,
  };
}