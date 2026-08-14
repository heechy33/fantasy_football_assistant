import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetFantasyProsAdpCache } from '../data/fantasyProsAdp';
import { __resetFantasyProsStarsCache } from '../data/fantasyProsStars';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';
import { __resetProviderProjectionsCache } from '../data/providerProjections';
import { usePlayerBoardData } from './usePlayerBoardData';

const PLAYERS = [{
  playerId: '1001', name: 'Aaron Rushmore', position: 'RB', eligiblePositions: ['RB'],
  team: 'SF', byeWeek: 9, age: 25, yearsExp: 3, injuryStatus: null, ids: {},
}];

const VALID_STARS = {
  schemaVersion: 1,
  generatedAt: '2026-08-12T00:00:00Z',
  season: 2026,
  source: {
    name: 'fantasypros-draft-rankings-csv' as const,
    file: 'FantasyPros_2026_Draft_ALL_Rankings.csv',
    rows: 1, droppedNonRankRows: 0, matched: 1, unmatched: 0, status: 'ok' as const,
  },
  players: {
    '1001': { rank: 1, tier: 1, upside: 5, bust: 1, sos: 4, ecrVsAdp: 2, positionRank: 'RB1' },
  },
  unmatched: [],
};

const VALID_ADP = {
  schemaVersion: 1,
  generatedAt: '2026-08-12T00:00:00Z',
  season: 2026,
  source: {
    name: 'fantasypros-overall-adp-csv' as const,
    file: 'FantasyPros_2026_Overall_ADP_Rankings.csv',
    rows: 1, matched: 1, unmatched: 0, emptyColumns: ['NFL'], status: 'ok' as const,
  },
  providers: [{ key: 'espn' as const, label: 'ESPN', rows: 1, matchedRows: 1 }],
  consensus: { key: 'avg' as const, label: 'FantasyPros AVG', rows: 1 },
  realTime: { key: 'realTime' as const, label: 'FantasyPros Real-Time', rows: 1 },
  players: { '1001': { rank: 1, positionRank: 'RB1', avg: 14.1, adp: { espn: 14.5 } } },
  unmatched: [],
};

function jsonOk(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  __resetFantasyProsAdpCache();
  __resetFantasyProsStarsCache();
  __resetProviderProjectionsCache();
  __resetPlayerPoolCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePlayerBoardData FantasyPros effect', () => {
  it('treats a 404 as unavailable without blocking core board data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/fantasypros-stars.json') return { ok: false, status: 404, json: () => Promise.resolve(null) };
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('ppr'));
    await waitFor(() => expect(result.current.players).toEqual(PLAYERS));
    await waitFor(() => expect(result.current.fantasyProsStatus).toBe('unavailable'));
    expect(result.current.fantasyProsArtifact).toBeNull();
    expect(result.current.loadError).toBeNull();
  });

  it('treats invalid FantasyPros JSON as unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/fantasypros-stars.json') {
        return jsonOk({ ...VALID_STARS, source: { ...VALID_STARS.source, status: 'bad' } });
      }
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('ppr'));
    await waitFor(() => expect(result.current.fantasyProsStatus).toBe('unavailable'));
    expect(result.current.fantasyProsArtifact).toBeNull();
  });

  it('preserves a valid artifact independently of the core board fetch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/fantasypros-stars.json') return jsonOk(VALID_STARS);
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('ppr'));
    await waitFor(() => expect(result.current.fantasyProsStatus).toBe('ready'));
    expect(result.current.fantasyProsArtifact?.source.file).toBe('FantasyPros_2026_Draft_ALL_Rankings.csv');
    expect(result.current.players).toEqual(PLAYERS);
  });
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

    const { result } = renderHook(() => usePlayerBoardData('ppr'));
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

    const { result } = renderHook(() => usePlayerBoardData('ppr'));
    await waitFor(() => expect(result.current.providerProjectionsStatus).toBe('ready'));
    expect(result.current.providerProjectionsArtifact?.players['1001']?.sleeper?.rush_yd).toBe(100);
    expect(result.current.players).toEqual(PLAYERS);
  });
});

describe('usePlayerBoardData per-site ADP effect', () => {
  it('treats a missing local artifact as unavailable without blocking the core board', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/fantasypros-adp.json') return { ok: false, status: 404, json: () => Promise.resolve(null) };
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('ppr'));
    await waitFor(() => expect(result.current.adpProvidersStatus).toBe('unavailable'));
    expect(result.current.adpProvidersArtifact).toBeNull();
    expect(result.current.players).toEqual(PLAYERS);
    expect(result.current.loadError).toBeNull();
  });

  it('preserves a valid per-site ADP artifact as its own independent effect', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonOk(PLAYERS);
      if (url === '/data/projections-season.json') return jsonOk([]);
      if (url === '/data/adp-ppr.json') return jsonOk([]);
      if (url === '/data/player-usage.json') return jsonOk({});
      if (url === '/data/fantasypros-adp.json') return jsonOk(VALID_ADP);
      return { ok: false, status: 404, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePlayerBoardData('ppr'));
    await waitFor(() => expect(result.current.adpProvidersStatus).toBe('ready'));
    expect(result.current.adpProvidersArtifact?.source.emptyColumns).toEqual(['NFL']);
    expect(result.current.adpProvidersArtifact?.players['1001']?.adp?.espn).toBe(14.5);
    expect(result.current.players).toEqual(PLAYERS);
  });
});
