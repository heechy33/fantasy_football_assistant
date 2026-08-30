import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SavedDraft } from '../../../shared/types';
import type { SavedLeaguesRepository } from './savedLeaguesRepository';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

const { draftToDisplay, useActiveSavedDrafts } = await import('./useSavedDrafts');

function draft(overrides: Partial<SavedDraft> = {}): SavedDraft {
  return {
    id: 'draft-1',
    userId: 'user-1',
    leagueId: 'league-1',
    provider: 'espn',
    providerDraftId: 'espn-draft-1',
    mode: 'espn',
    frozenInit: null,
    overrides: [],
    status: 'active',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function repoStub(drafts: SavedDraft[]): SavedLeaguesRepository {
  return {
    listLeagues: vi.fn(async () => []),
    upsertLeague: vi.fn(),
    deleteLeague: vi.fn(),
    listDrafts: vi.fn(async () => drafts),
    upsertDraft: vi.fn(),
    deleteDraft: vi.fn(),
  } as unknown as SavedLeaguesRepository;
}

describe('useActiveSavedDrafts', () => {
  it('keeps only ESPN/manual drafts with status active', async () => {
    const repo = repoStub([
      draft({ id: 'd-active-espn', status: 'active', provider: 'espn' }),
      draft({ id: 'd-complete-espn', status: 'complete', provider: 'espn' }),
      draft({ id: 'd-active-manual', status: 'active', provider: 'manual' }),
    ]);
    const { result } = renderHook(() => useActiveSavedDrafts(repo));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.drafts.map((d) => d.id).sort()).toEqual(['d-active-espn', 'd-active-manual']);
  });

  // A real (non-mock) Sleeper league's in-progress draft DOES sync with status: 'active'
  // (shouldSyncDraft only excludes Sleeper mocks) — this filter exists to avoid a confusing,
  // broken second resume path: the Sleeper section already resumes any live Sleeper draft
  // straight from Sleeper's own API, and a synced Sleeper row's frozenInit is always null anyway.
  it('excludes active Sleeper drafts even though they do sync', async () => {
    const repo = repoStub([
      draft({ id: 'd-sleeper', status: 'active', provider: 'sleeper', mode: 'live' }),
      draft({ id: 'd-espn', status: 'active', provider: 'espn' }),
    ]);
    const { result } = renderHook(() => useActiveSavedDrafts(repo));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.drafts.map((d) => d.id)).toEqual(['d-espn']);
  });

  it('surfaces a load failure as an error, not a silent empty list', async () => {
    const repo = {
      listLeagues: vi.fn(async () => []),
      upsertLeague: vi.fn(),
      deleteLeague: vi.fn(),
      listDrafts: vi.fn(async () => { throw new Error('network down'); }),
      upsertDraft: vi.fn(),
      deleteDraft: vi.fn(),
    } as unknown as SavedLeaguesRepository;
    const { result } = renderHook(() => useActiveSavedDrafts(repo));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('network down');
  });
});

describe('draftToDisplay', () => {
  it('prefers a completed transcript over a stale active one', () => {
    const active = draft({ id: 'active', status: 'active', updatedAt: '2026-08-29T02:00:00.000Z' });
    const complete = draft({ id: 'complete', status: 'complete', updatedAt: '2026-08-29T01:00:00.000Z' });
    expect(draftToDisplay([active, complete])?.id).toBe('complete');
  });

  it('falls back to the most recently updated row when none are complete', () => {
    const older = draft({ id: 'older', updatedAt: '2026-08-29T01:00:00.000Z' });
    const newer = draft({ id: 'newer', updatedAt: '2026-08-29T02:00:00.000Z' });
    expect(draftToDisplay([older, newer])?.id).toBe('newer');
  });

  it('returns null for an empty list', () => {
    expect(draftToDisplay([])).toBeNull();
  });
});
