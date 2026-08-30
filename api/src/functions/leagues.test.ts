import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';

const requireUserMock = vi.fn();
vi.mock('./authGuard.js', () => ({ requireUser: (...args: unknown[]) => requireUserMock(...args) }));

const fetchAllMock = vi.fn();
const upsertMock = vi.fn();
const deleteMock = vi.fn();
const readMock = vi.fn();
const queryMock = vi.fn(() => ({ fetchAll: fetchAllMock }));
const itemMock = vi.fn(() => ({ delete: deleteMock, read: readMock }));
vi.mock('../data/cosmos.js', () => ({
  leaguesContainer: () => ({
    items: { query: queryMock, upsert: upsertMock },
    item: itemMock,
  }),
}));

const { listLeagues, upsertLeague, deleteLeague } = await import('./leagues.js');
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

describe('leagues functions', () => {
  it('listLeagues returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue({ ok: false, response: { status: 401, jsonBody: { code: 'unauthenticated' } } });
    const res = await listLeagues(req(), ctx);
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('listLeagues scopes the query to the verified userId', async () => {
    fetchAllMock.mockResolvedValue({ resources: [{ id: 'l1', userId: 'user_1' }] });
    const res = await listLeagues(req(), ctx);
    expect(res.status).toBe(200);
    expect(res.jsonBody).toEqual([{ id: 'l1', userId: 'user_1' }]);
    const querySpec = queryMock.mock.calls[0]?.[0];
    expect(querySpec.parameters).toContainEqual({ name: '@userId', value: 'user_1' });
  });

  it('upsertLeague ignores a client-supplied userId and always writes the verified one', async () => {
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertLeague(
      req({ json: async () => ({ userId: 'someone-else', name: 'My League', provider: 'sleeper', settings: { name: 'My League' } }) }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.userId).toBe('user_1');
    expect(written.name).toBe('My League');
  });

  it('upsertLeague requires settings rather than storing a doc missing the required field', async () => {
    const res = await upsertLeague(req({ json: async () => ({ name: 'No settings' }) }), ctx);
    expect(res.status).toBe(400);
    expect((res.jsonBody as { code: string }).code).toBe('bad_request');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('upsertLeague normalizes an out-of-union provider to manual instead of storing it verbatim', async () => {
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertLeague(
      req({ json: async () => ({ provider: 'yahoo', settings: { name: 'L' } }) }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.provider).toBe('manual');
  });

  it('deleteLeague deletes scoped to (id, userId) as the partition key', async () => {
    deleteMock.mockResolvedValue(undefined);
    const res = await deleteLeague(req({ params: { id: 'l1' } }), ctx);
    expect(itemMock).toHaveBeenCalledWith('l1', 'user_1');
    expect(res.status).toBe(204);
  });

  it('deleteLeague returns 404 when the item is missing or belongs to another user', async () => {
    // Cosmos signals a missing item via a numeric `code` — only that maps to a 404 response.
    deleteMock.mockRejectedValue(Object.assign(new Error('NotFound'), { code: 404 }));
    const res = await deleteLeague(req({ params: { id: 'l1' } }), ctx);
    expect(res.status).toBe(404);
  });

  it('deleteLeague rethrows throttles/transients instead of lying "not found"', async () => {
    deleteMock.mockRejectedValue(Object.assign(new Error('Too many requests'), { code: 429 }));
    await expect(deleteLeague(req({ params: { id: 'l1' } }), ctx)).rejects.toThrow();
  });

  it('deleteLeague returns 400 with no id param', async () => {
    const res = await deleteLeague(req({ params: {} }), ctx);
    expect(res.status).toBe(400);
  });

  // --- MERGE RULE (2026-08-28): undefined keeps what is stored; explicit null clears. ---

  const storedDoc = {
    id: 'league-doc-1',
    userId: 'user_1',
    provider: 'sleeper',
    providerLeagueId: 'league-1',
    name: 'Work League',
    season: '2026',
    teams: 12,
    rounds: 15,
    mySlot: 4,
    settings: { provider: 'sleeper', leagueId: 'league-1' },
    providerUserId: 'sleeper-user-9',
    providerUsername: 'coach_hodgetwins',
    providerTeamId: null,
    providerTeamName: null,
    latestDraftId: 'draft-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  it('upsertLeague keeps stored identity/metadata a partial writer did not send (dedupe-query path)', async () => {
    // The draft-sync tick shape: it sends its own fields and OMITS providerUserId/username,
    // season, name, teams — previously each omission silently nulled (or zeroed) the stored doc.
    fetchAllMock.mockResolvedValue({ resources: [storedDoc] });
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertLeague(
      req({
        json: async () => ({
          provider: 'sleeper',
          providerLeagueId: 'league-1',
          settings: { provider: 'sleeper', leagueId: 'league-1' },
          mySlot: 5,
          rounds: 15,
        }),
      }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.id).toBe('league-doc-1'); // dedupe query found the existing doc
    expect(written.providerUserId).toBe('sleeper-user-9');
    expect(written.providerUsername).toBe('coach_hodgetwins');
    expect(written.season).toBe('2026');
    expect(written.name).toBe('Work League');
    expect(written.teams).toBe(12);
    expect(written.createdAt).toBe('2026-08-01T00:00:00.000Z');
    expect(written.mySlot).toBe(5); // fields the writer DID send still win
  });

  it('upsertLeague clears a stored field only on an explicit null', async () => {
    fetchAllMock.mockResolvedValue({ resources: [storedDoc] });
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertLeague(
      req({
        json: async () => ({
          provider: 'sleeper',
          providerLeagueId: 'league-1',
          settings: { provider: 'sleeper', leagueId: 'league-1' },
          providerUserId: null,
          providerUsername: null,
          latestDraftId: null,
        }),
      }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.providerUserId).toBeNull();
    expect(written.providerUsername).toBeNull();
    expect(written.latestDraftId).toBeNull();
    expect(written.season).toBe('2026'); // untouched fields still kept
  });

  it('upsertLeague merges against a point read when the client supplies id', async () => {
    readMock.mockResolvedValue({ resource: storedDoc });
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertLeague(
      req({
        json: async () => ({
          id: 'league-doc-1',
          provider: 'sleeper',
          providerLeagueId: 'league-1',
          settings: { provider: 'sleeper', leagueId: 'league-1' },
          latestDraftId: 'draft-2',
        }),
      }),
      ctx,
    );
    expect(itemMock).toHaveBeenCalledWith('league-doc-1', 'user_1');
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.providerUserId).toBe('sleeper-user-9');
    expect(written.latestDraftId).toBe('draft-2');
    expect(queryMock).not.toHaveBeenCalled(); // id known → no dedupe query needed
  });

  it('upsertLeague keeps the stored provider when a partial write omits it (never coerces to manual)', async () => {
    fetchAllMock.mockResolvedValue({ resources: [storedDoc] });
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertLeague(
      req({
        json: async () => ({
          providerLeagueId: 'league-1',
          settings: { provider: 'sleeper', leagueId: 'league-1' },
          mySlot: 3,
        }),
      }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.provider).toBe('sleeper'); // normalizeProvider(undefined) would say 'manual'
  });

  it('upsertLeague treats provider as immutable once stored, even on an explicit null', async () => {
    fetchAllMock.mockResolvedValue({ resources: [storedDoc] });
    upsertMock.mockResolvedValue({ resource: {} });
    await upsertLeague(
      req({
        json: async () => ({
          provider: null,
          providerLeagueId: 'league-1',
          settings: { provider: 'sleeper', leagueId: 'league-1' },
        }),
      }),
      ctx,
    );
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.provider).toBe('sleeper'); // null must NOT blank it to 'manual' — provider is
    // half the dedupe key, so changing it would orphan the document from future lookups.
  });

  it('upsertLeague treats a point-read 404 on a supplied id as a first write', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('NotFound'), { code: 404 }));
    upsertMock.mockResolvedValue({ resource: {} });
    const res = await upsertLeague(
      req({
        json: async () => ({
          id: 'brand-new',
          provider: 'sleeper',
          providerLeagueId: 'league-1',
          settings: { provider: 'sleeper', leagueId: 'league-1' },
          providerUserId: 'u-1',
        }),
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const written = upsertMock.mock.calls[0]?.[0];
    expect(written.providerUserId).toBe('u-1');
    expect(written.name).toBe('Untitled league'); // create-time default, nothing stored to keep
  });
});
