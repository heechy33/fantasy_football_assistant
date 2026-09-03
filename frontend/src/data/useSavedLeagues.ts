import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EspnLeagueSnapshot, LeagueRef, LeagueSettings, SavedDraft, SavedLeague, SleeperCred } from '../../../shared/types';
import { espnLeagueToSettings } from '../adapters/espnLeague';
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
  saveDraft: (input: Partial<SavedDraft> & { leagueId: string }) => Promise<SavedDraft>;
  removeLeague: (id: string) => Promise<void>;
} {
  const { getToken, status } = useAuth();
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
    // Clerk's auth state can render the guarded route just before its token bridge is ready. Wait
    // for the signed-in transition so the first repository request includes Authorization instead
    // of permanently caching the initial unauthenticated failure.
    if (status !== 'signed-in') return;
    void refresh();
  }, [refresh, status]);

  const saveLeague = useCallback(
    (input: Partial<SavedLeague> & { settings: LeagueSettings }) => repository.upsertLeague(input),
    [repository],
  );
  /** Draft write passthrough for the completed-ESPN-draft import path (espnDraftImport) — the
   * connect surface writes a complete `SavedDraft` (`frozenInit` + `picks`) that /leagues/:id
   * already renders. Same single repository seam as `saveLeague`. */
  const saveDraft = useCallback(
    (input: Parameters<SavedLeaguesRepository['upsertDraft']>[0]) => repository.upsertDraft(input),
    [repository],
  );
  const removeLeague = useCallback(
    async (id: string) => {
      await repository.deleteLeague(id);
      setLeagues((current) => current.filter((league) => league.id !== id));
    },
    [repository],
  );

  return { leagues, loading, error, refresh, saveLeague, saveDraft, removeLeague };
}

/**
 * Build the repository input for a Sleeper league saved from the connect surface. This is the
 * league-first path's season source: `LeagueRef` carries `season`, which `DraftInit` does not,
 * so only here can a real season reach Cosmos (retiring the `season: ''` placeholder for this
 * path while draft-sync still can't supply one — DECISIONS.md 2026-08-26). Also captures the
 * identity a hub card needs to re-track a draft later: `providerUserId` + `latestDraftId`.
 */
export async function buildSleeperLeagueInput(
  cred: SleeperCred,
  ref: LeagueRef,
  username?: string | null,
): Promise<Partial<SavedLeague> & { settings: LeagueSettings }> {
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
    providerUsername: username ?? null,
    latestDraftId: ref.draftId ?? null,
  };
}

/**
 * Build the repository input for an ESPN league saved from the extension-detected snapshot
 * (2026-08-27 connect/start split). This retires the `'manual-session'` placeholder leagueId: the
 * SavedLeague carries the REAL ESPN id, a real season, teams, rounds, and settings translated by
 * `espnLeagueToSettings`. There is no ESPN account to save (`providerUserId: null`) and no draft
 * to point at yet (`latestDraftId: null`) — the seat is typed and the draft tracked from the Draft
 * Room launcher.
 *
 * CONFIRM, DON'T EDIT (2026-08-27): the scrape is authoritative, so there are no field overrides
 * any more — the connect card is read-only. The ONE input is `myTeamId`, the user's pick from the
 * "which team is yours?" dropdown (the capture redacts swid|session, so ownership cannot be read
 * from ESPN); it saves as `providerTeamId` on the SavedLeague.
 */
export function buildEspnLeagueInput(
  snapshot: EspnLeagueSnapshot,
  myTeamId: number | null = null,
  mySlot: number | null = null,
): Partial<SavedLeague> & { settings: LeagueSettings } {
  return {
    provider: 'espn',
    providerLeagueId: snapshot.leagueId,
    name: snapshot.name,
    season: snapshot.season,
    teams: snapshot.teams,
    rounds: snapshot.rounds ?? 0,
    mySlot,
    providerUserId: null,
    providerTeamId: myTeamId,
    providerTeamName: myTeamId == null ? null : snapshot.teamNames.find((team) => team.id === myTeamId)?.name ?? null,
    latestDraftId: null,
    settings: espnLeagueToSettings(snapshot),
  };
}
