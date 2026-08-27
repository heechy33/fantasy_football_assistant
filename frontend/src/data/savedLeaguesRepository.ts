import type { SavedDraft, SavedLeague } from '../../../shared/types';

/**
 * The single interface `draftSync.ts` and any future Teams page write against — one seam for
 * Phase 5's persistence, matching `ProviderAdapter`'s isolation discipline (shared/types.d.ts):
 * nothing above this boundary knows whether the implementation is Cosmos-backed Functions,
 * Postgres/RLS, or (in tests) an in-memory fake.
 */
export interface SavedLeaguesRepository {
  listLeagues(): Promise<SavedLeague[]>;
  upsertLeague(league: Partial<SavedLeague> & { id?: string }): Promise<SavedLeague>;
  deleteLeague(id: string): Promise<void>;
  listDrafts(leagueId?: string): Promise<SavedDraft[]>;
  upsertDraft(draft: Partial<SavedDraft> & { leagueId: string }): Promise<SavedDraft>;
  deleteDraft(id: string): Promise<void>;
}
