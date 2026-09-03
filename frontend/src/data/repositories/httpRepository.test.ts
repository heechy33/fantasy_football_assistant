import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedDraft, SavedLeague } from '../../../../shared/types';
import { createHttpRepository } from './httpRepository';

const fetchMock = vi.fn();
const getToken = vi.fn();

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function repo() {
  return createHttpRepository(getToken);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  getToken.mockReset().mockResolvedValue('token-1');
  fetchMock.mockReset().mockResolvedValue(okResponse([]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHttpRepository', () => {
  it('listLeagues sends the bearer token and returns the parsed body', async () => {
    const leagues = [{ id: 'l1' }] as unknown as SavedLeague[];
    fetchMock.mockResolvedValue(okResponse(leagues));

    await expect(repo().listLeagues()).resolves.toEqual(leagues);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/leagues');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['x-clerk-authorization']).toBe('Bearer token-1');
    expect(headers['x-authorization']).toBe('Bearer token-1');
    // GET carries no body, so no Content-Type should be forced on.
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('upsertLeague posts a JSON body with the bearer token and Content-Type', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'l1' }));

    await repo().upsertLeague({ id: 'l1', name: 'My League' });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/leagues');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ id: 'l1', name: 'My League' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['x-clerk-authorization']).toBe('Bearer token-1');
    expect(headers['x-authorization']).toBe('Bearer token-1');
  });

  it('refuses to call the API when getToken yields no token (signed out)', async () => {
    getToken.mockResolvedValue(null);

    await expect(repo().listLeagues()).rejects.toThrow(/not signed in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a path+status error on a non-ok response instead of parsing it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(repo().upsertDraft({ leagueId: 'l1' } as never)).rejects.toThrow('/api/drafts failed: 500');
  });

  it('scopes listDrafts with an encoded leagueId query param when given one', async () => {
    fetchMock.mockResolvedValue(okResponse([]));

    await repo().listDrafts('league/with spaces');

    const [path] = fetchMock.mock.calls[0] as [string];
    expect(path).toBe('/api/drafts?leagueId=league%2Fwith%20spaces');
  });

  it('requests all drafts without a query when no leagueId is given', async () => {
    const drafts = [{ id: 'd1' }] as unknown as SavedDraft[];
    fetchMock.mockResolvedValue(okResponse(drafts));

    await expect(repo().listDrafts()).resolves.toEqual(drafts);

    const [path] = fetchMock.mock.calls[0] as [string];
    expect(path).toBe('/api/drafts');
  });

  it('encodes ids into DELETE paths for both resources', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    await repo().deleteLeague('id/1');
    await repo().deleteDraft('id/2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const leagueCall = calls[0];
    const draftCall = calls[1];
    if (!leagueCall || !draftCall) throw new Error('expected both DELETEs to be recorded');
    expect(leagueCall[0]).toBe('/api/leagues/id%2F1');
    expect(leagueCall[1].method).toBe('DELETE');
    expect(draftCall[0]).toBe('/api/drafts/id%2F2');
    expect(draftCall[1].method).toBe('DELETE');
  });
});
