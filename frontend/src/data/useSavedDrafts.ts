import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SavedDraft } from '../../../shared/types';
import { useAuth } from '../auth/AuthProvider';
import { createHttpRepository } from './repositories/httpRepository';
import type { SavedLeaguesRepository } from './savedLeaguesRepository';

/**
 * Repository access for a single league's synced drafts (the league-detail page) — mirrors
 * `useSavedLeagues` exactly, including the `repositoryOverride` seam for tests. Uses the
 * already-wired `repository.listDrafts(leagueId)`; no new API surface.
 */
export function useSavedDrafts(leagueId: string | null, repositoryOverride?: SavedLeaguesRepository): {
  drafts: SavedDraft[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const { getToken } = useAuth();
  const repository = useMemo(
    () => repositoryOverride ?? createHttpRepository(getToken),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repositoryOverride],
  );
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(Boolean(leagueId));
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!leagueId) {
      setDrafts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDrafts(await repository.listDrafts(leagueId));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repository, leagueId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { drafts, loading, error, refresh };
}

/**
 * ALL of the signed-in user's active (in-progress) ESPN/manual SavedDraft rows, across every
 * league — the Draft Room launcher's resume affordance (2026-08-29 live-only redesign, see
 * DECISIONS.md): once the launcher stopped listing saved leagues, a saved league's in-progress
 * ESPN/manual draft had no way back in if live detection lapsed (the ESPN tab closed, the
 * extension reloaded, "End draft" pressed by mistake) — `/leagues/:id` cards deliberately never
 * navigate to `/draft`. Calls `repository.listDrafts()` with NO leagueId, unlike `useSavedDrafts`
 * above, since the launcher doesn't know which league's draft it's looking for ahead of time.
 *
 * Sleeper is filtered out deliberately, NOT because it never syncs — a real (non-mock) Sleeper
 * league's IN-PROGRESS draft does sync here with `status: 'active'` (`shouldSyncDraft` only
 * excludes Sleeper *mocks*; only a *completed* real-Sleeper transcript gets deleted). It's excluded
 * because it would be a confusing, broken second entry point: the Sleeper section above already
 * auto-lists every live Sleeper draft straight from Sleeper's own API (`listSleeperDrafts`), and a
 * synced Sleeper row's `frozenInit` is always null (only manual/bridge/complete sessions freeze
 * one — see draftSync.ts), so "Resume" on it would silently do nothing.
 */
export function useActiveSavedDrafts(repositoryOverride?: SavedLeaguesRepository): {
  drafts: SavedDraft[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  /** Deletes one transcript server-side, then re-fetches — the launcher's Resume tiles' "Delete"
   * affordance, so a user can clear stale/ghost in-progress rows (pre-2026-08-30 sessions had no
   * end-draft cleanup and accumulated them) without leaving the Draft Room. */
  removeDraft: (id: string) => Promise<void>;
} {
  const { getToken } = useAuth();
  const repository = useMemo(
    () => repositoryOverride ?? createHttpRepository(getToken),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repositoryOverride],
  );
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await repository.listDrafts();
      setDrafts(all.filter((draft) => draft.status === 'active' && draft.provider !== 'sleeper'));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeDraft = useCallback(async (id: string) => {
    await repository.deleteDraft(id);
    await refresh();
  }, [repository, refresh]);

  return { drafts, loading, error, refresh, removeDraft };
}

/**
 * Which synced draft a league-detail page renders: prefer a completed transcript (a mid-draft
 * reload leaves both an `active` and a later `complete` row — complete is the durable record),
 * falling back to the most recently updated one. Deterministic, never order-dependent.
 */
export function draftToDisplay(drafts: SavedDraft[]): SavedDraft | null {
  if (drafts.length === 0) return null;
  const complete = drafts.filter((draft) => draft.status === 'complete');
  const pool = complete.length > 0 ? complete : drafts;
  return pool.reduce<SavedDraft>((latest, draft) => (draft.updatedAt > latest.updatedAt ? draft : latest), pool[0]!);
}