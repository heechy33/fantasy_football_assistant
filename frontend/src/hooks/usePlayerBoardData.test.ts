import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';
import { __resetProviderProjectionsCache } from '../data/providerProjections';
import { usePlayerBoardData } from './usePlayerBoardData';

const PLAYERS = [{
  playerId: '1001', name: 'Aaron Rushmore', position: 'RB', eligiblePositions: ['RB'],
  team: 'SF', byeWeek: 9, age: 25, yearsExp: 3, injuryStatus: null, ids: {},
}];

function jsonOk(body: unknown) {
  return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve(body) };
}

beforeEach(() => {
  __resetProviderProjectionsCache();
  __resetPlayerPoolCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePlayerBoardData provider-projections effect', () => {
  it('treats a missing artifact as unavailable without blocking the core board', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/projections-providers.json') return { ok: false, status: 404, json: () => Promise.resolve(null) };
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('ppr', 'ppr'));
    await waitFor(() => expect(result.current.providerProjectionsStatus).toBe('unavailable'));
    expect(result.current.providerProjectionsArtifact).toBeNull();
    expect(result.current.players).toEqual(PLAYERS);
    expect(result.current.loadError).toBeNull();
  });

  it('preserves a valid provider-projections artifact as its own independent effect', async () => {
    const valid = {
      schemaVersion: 1,
      generatedAt: '2026-08-13T00:00:00Z',
      season: 2026,
      displayOnly: true as const,
      providers: [{ key: 'sleeper', label: 'Sleeper (Rotowire)', attribution: 'x', status: 'ok' as const, fetchedAt: 'x', upstreamUpdatedAt: null, rows: 1, positionRows: {}, positionsExcluded: [], staleSinceDays: 0, diagnostic: null }],
      players: { '1001': { sleeper: { rush_yd: 100 } } },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/projections-providers.json') return jsonOk(valid);
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('ppr', 'ppr'));
    await waitFor(() => expect(result.current.providerProjectionsStatus).toBe('ready'));
    expect(result.current.providerProjectionsArtifact?.players['1001']?.sleeper?.rush_yd).toBe(100);
    expect(result.current.players).toEqual(PLAYERS);
  });
});

describe('usePlayerBoardData ESPN board selection', () => {
  it('fetches adp-espn-ppr.json for an espn-ppr board key and reports the resolved key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-espn-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/projections-providers.json') return { ok: false, status: 404, json: () => Promise.resolve(null) };
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('espn-ppr', 'ppr'));
    await waitFor(() => expect(result.current.players).toEqual(PLAYERS));
    expect(fetchMock).toHaveBeenCalledWith('/data/adp-espn-ppr.json');
    expect(result.current.resolvedAdpKey).toBe('espn-ppr');
    expect(result.current.loadError).toBeNull();
  });

  it('falls back to adp-ppr.json and reports the format key when the espn board is missing (fail-open)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-espn-ppr.json') return { ok: false, status: 404, json: () => Promise.resolve(null) };
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/projections-providers.json') return { ok: false, status: 404, json: () => Promise.resolve(null) };
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('espn-ppr', 'ppr'));
    await waitFor(() => expect(result.current.players).toEqual(PLAYERS));
    expect(fetchMock).toHaveBeenCalledWith('/data/adp-espn-ppr.json');
    expect(fetchMock).toHaveBeenCalledWith('/data/adp-ppr.json');
    expect(result.current.resolvedAdpKey).toBe('ppr');
    expect(result.current.loadError).toBeNull();
  });

  // Regression: Vite's dev server (and any static host without SWA's `/data/*`
  // navigationFallback exclusion) 200s a missing /data/*.json with index.html's body instead of
  // 404ing — before adpBoard.ts's isJsonResponse check, that HTML response.json() throw escaped
  // the whole Promise.all and permanently showed "Projection board is unavailable" for the entire
  // draft, never just falling back to the format board. Caught during the 2026-08-15 mock draft.
  it('falls back to adp-ppr.json when the espn board 200s with the SPA-fallback HTML page instead of 404ing', async () => {
    const htmlFallback = { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), json: () => Promise.reject(new SyntaxError('Unexpected token <')) };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-espn-ppr.json') return htmlFallback;
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      return htmlFallback;
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('espn-ppr', 'ppr'));
    await waitFor(() => expect(result.current.players).toEqual(PLAYERS));
    expect(result.current.resolvedAdpKey).toBe('ppr');
    expect(result.current.loadError).toBeNull();
  });
});

