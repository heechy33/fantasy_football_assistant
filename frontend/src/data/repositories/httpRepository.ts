import type { SavedDraft, SavedLeague } from '../../../../shared/types';
import type { SavedLeaguesRepository } from '../savedLeaguesRepository';

/** The only implementation of `SavedLeaguesRepository` today (Branch A: Clerk + Cosmos +
 * authenticated Functions, DECISIONS.md 2026-08-25/26) — calls the `/api/leagues`/`/api/drafts`
 * Functions with a Clerk bearer token. `getToken` is injected rather than imported from
 * `auth/AuthProvider` directly, so this module stays testable without mounting React context. */
export function createHttpRepository(getToken: () => Promise<string | null>): SavedLeaguesRepository {
  async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    if (!token) throw new Error(`Cannot call ${path}: not signed in.`);
    const response = await fetch(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    return response;
  }

  return {
    async listLeagues() {
      return (await authedFetch('/api/leagues')).json() as Promise<SavedLeague[]>;
    },
    async upsertLeague(league) {
      return (await authedFetch('/api/leagues', { method: 'POST', body: JSON.stringify(league) })).json() as Promise<SavedLeague>;
    },
    async deleteLeague(id) {
      await authedFetch(`/api/leagues/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async listDrafts(leagueId) {
      const query = leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : '';
      return (await authedFetch(`/api/drafts${query}`)).json() as Promise<SavedDraft[]>;
    },
    async upsertDraft(draft) {
      return (await authedFetch('/api/drafts', { method: 'POST', body: JSON.stringify(draft) })).json() as Promise<SavedDraft>;
    },
    async deleteDraft(id) {
      await authedFetch(`/api/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
