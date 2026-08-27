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
});
