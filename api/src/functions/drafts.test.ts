import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';

const requireUserMock = vi.fn();
vi.mock('./authGuard.js', () => ({ requireUser: (...args: unknown[]) => requireUserMock(...args) }));

const fetchAllMock = vi.fn();
const upsertMock = vi.fn();
const deleteMock = vi.fn();
const queryMock = vi.fn(() => ({ fetchAll: fetchAllMock }));
const itemMock = vi.fn(() => ({ delete: deleteMock }));
vi.mock('../data/cosmos.js', () => ({
  draftsContainer: () => ({
    items: { query: queryMock, upsert: upsertMock },
    item: itemMock,
  }),
}));

const { listDrafts, upsertDraft, deleteDraft } = await import('./drafts.js');
const ctx = {} as InvocationContext;

function req(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    headers: { get: () => null },
    params: {},
    query: new URLSearchParams(),
    json: async () => ({}),
    ...overrides,
  } as unknown as HttpRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ ok: true, user: { userId: 'user_1' } });
});

describe('drafts functions', () => {
  it('listDrafts scopes to userId only when no leagueId query param is given', async () => {
    fetchAllMock.mockResolvedValue({ resources: [] });
    await listDrafts(req(), ctx);
    const querySpec = queryMock.mock.calls[0]?.[0];
    expect(querySpec.query).not.toContain('leagueId');
    expect(querySpec.parameters).toEqual([{ name: '@userId', value: 'user_1' }]);
  });

  it('listDrafts additionally scopes to leagueId when the query param is present', async () => {
    fetchAllMock.mockResolvedValue({ resources: [] });
    const params = new URLSearchParams({ leagueId: 'league-1' });
    await listDrafts(req({ query: params }), ctx);
    const querySpec = queryMock.mock.calls[0]?.[0];
    expect(querySpec.query).toContain('leagueId');
    expect(querySpec.parameters).toContainEqual({ name: '@leagueId', value: 'league-1' });
  });

  it('upsertDraft requires leagueId and rejects a client-supplied userId', async () => {
    const missing = await upsertDraft(req({ json: async () => ({}) }), ctx);
    expect(missing.status).toBe(400);

    upsertMock.mockResolvedValue({ resource: {} });
    await upsertDraft(
      req({ json: async () => ({ leagueId: 'league-1', userId: 'someone-else', status: 'active' }) }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.userId).toBe('user_1');
    expect(written.leagueId).toBe('league-1');
    expect(written.status).toBe('active');
  });

  it('upsertDraft normalizes enum fields against the SavedDraft unions instead of trusting them', async () => {
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertDraft(
      req({ json: async () => ({ leagueId: 'league-1', provider: 'yahoo', mode: 'something-else', status: 'complete' }) }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.provider).toBe('manual');
    expect(written.mode).toBe('manual');
    expect(written.status).toBe('complete');
  });

  it('deleteDraft deletes scoped to (id, userId) — the mechanism draftSync.ts uses on completion', async () => {
    deleteMock.mockResolvedValue(undefined);
    const res = await deleteDraft(req({ params: { id: 'd1' } }), ctx);
    expect(itemMock).toHaveBeenCalledWith('d1', 'user_1');
    expect(res.status).toBe(204);
  });

  it('deleteDraft returns 404 for a genuine missing-item Cosmos 404', async () => {
    deleteMock.mockRejectedValue(Object.assign(new Error('NotFound'), { code: 404 }));
    const res = await deleteDraft(req({ params: { id: 'd1' } }), ctx);
    expect(res.status).toBe(404);
  });

  it('deleteDraft rethrows throttles/transients instead of lying "not found"', async () => {
    deleteMock.mockRejectedValue(Object.assign(new Error('Too many requests'), { code: 429 }));
    await expect(deleteDraft(req({ params: { id: 'd1' } }), ctx)).rejects.toThrow();
  });
});
