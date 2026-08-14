import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdpEntry, PlayerMeta } from '../../../shared/types';
import { __resetPlayerPoolCache, loadKnownPlayerIds, loadPlayerPool, loadRankedPlayers, rankPlayers } from './loadPlayerPool';

const SAMPLE: PlayerMeta[] = [
  {
    playerId: '1001',
    name: 'Aaron Rushmore',
    position: 'RB',
    eligiblePositions: ['RB'],
    team: 'SF',
    byeWeek: 9,
    age: 25,
    yearsExp: 3,
    injuryStatus: null,
    ids: {},
  },
  {
    playerId: 'SF',
    name: 'San Francisco 49ers',
    position: 'DEF',
    eligiblePositions: ['DEF'],
    team: 'SF',
    byeWeek: 9,
    age: null,
    yearsExp: null,
    injuryStatus: null,
    ids: {},
  },
];

beforeEach(() => {
  __resetPlayerPoolCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadPlayerPool', () => {
  it('fetches /data/players.json and returns the parsed array', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadPlayerPool();

    expect(result).toEqual(SAMPLE);
    expect(fetchMock).toHaveBeenCalledWith('/data/players.json');
  });

  it('memoizes: repeated calls issue exactly one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadPlayerPool();
    await loadPlayerPool();
    await loadPlayerPool();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) }),
    );

    await expect(loadPlayerPool()).rejects.toThrow(/404/);
  });

  it('does not poison the cache after a failure — a later call retries and can succeed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve(null) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(SAMPLE) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadPlayerPool()).rejects.toThrow(/500/);
    await expect(loadPlayerPool()).resolves.toEqual(SAMPLE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('loadKnownPlayerIds', () => {
  it('derives a set of player ids, including team-abbreviation DEF ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SAMPLE) }));

    const ids = await loadKnownPlayerIds();

    expect(ids.has('1001')).toBe(true);
    expect(ids.has('SF')).toBe(true);
    expect(ids.has('unmatched-2099')).toBe(false);
  });

  it('shares the memoized fetch with loadPlayerPool', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SAMPLE) });
    vi.stubGlobal('fetch', fetchMock);

    await loadPlayerPool();
    await loadKnownPlayerIds();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
describe('rankPlayers', () => {
  it('uses ascending ADP as the displayed rank and omits unresolved player ids', () => {
    const adp: AdpEntry[] = [
      { playerId: 'SF', name: 'San Francisco', position: 'DEF', team: 'SF', adp: 9.2, stdev: 1, high: 8, low: 11, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
      { playerId: 'missing', name: 'Missing Player', position: 'WR', team: 'NO', adp: 4.2, stdev: 1, high: 3, low: 5, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
      { playerId: '1001', name: 'Aaron Rushmore', position: 'RB', team: 'SF', adp: 2.1, stdev: 1, high: 1, low: 3, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
    ];

    expect(rankPlayers(SAMPLE, adp)).toMatchObject([
      { playerId: '1001', rank: 1, adp: 2.1 },
      { playerId: 'SF', rank: 3, adp: 9.2 },
    ]);
  });

  it('breaks equal ADP ties by name and skips null playerId rows', () => {
    const tied: AdpEntry[] = [
      { playerId: 'SF', name: 'San Francisco', position: 'DEF', team: 'SF', adp: 5, stdev: 1, high: 4, low: 6, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
      { playerId: null, name: 'Unmatched', position: 'WR', team: 'NO', adp: 1, stdev: 1, high: 1, low: 1, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
      { playerId: '1001', name: 'Aaron Rushmore', position: 'RB', team: 'SF', adp: 5, stdev: 1, high: 4, low: 6, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
    ];
    expect(rankPlayers(SAMPLE, tied).map((p) => p.playerId)).toEqual(['1001', 'SF']);
  });
});

describe('loadRankedPlayers', () => {
  const adpPpr: AdpEntry[] = [
    { playerId: '1001', name: 'Aaron Rushmore', position: 'RB', team: 'SF', adp: 2.1, stdev: 1, high: 1, low: 3, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
    { playerId: 'SF', name: 'San Francisco', position: 'DEF', team: 'SF', adp: 9.2, stdev: 1, high: 8, low: 11, timesDrafted: 12, byeWeek: 9, adpSource: 'ffc', stdevSource: 'observed' },
  ];

  it('joins players.json with the format-specific ADP board and memoizes per format', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return { ok: true, json: async () => SAMPLE };
      if (url === '/data/adp-ppr.json') return { ok: true, json: async () => adpPpr };
      if (url === '/data/adp-half-ppr.json') {
        return {
          ok: true,
          json: async () => [
            { ...adpPpr[1], adp: 3.0 },
            { ...adpPpr[0], adp: 7.0 },
          ],
        };
      }
      return { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal('fetch', fetchMock);

    const ppr = await loadRankedPlayers('ppr');
    expect(ppr).toMatchObject([
      { playerId: '1001', rank: 1, adp: 2.1 },
      { playerId: 'SF', rank: 2, adp: 9.2 },
    ]);
    await loadRankedPlayers('ppr');
    expect(fetchMock).toHaveBeenCalledWith('/data/adp-ppr.json');
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/data/adp-ppr.json')).toHaveLength(1);

    const half = await loadRankedPlayers('half-ppr');
    expect(half).toMatchObject([
      { playerId: 'SF', rank: 1, adp: 3.0 },
      { playerId: '1001', rank: 2, adp: 7.0 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/data/adp-half-ppr.json');
  });

  it('does not poison the per-format cache after a failed ADP fetch', async () => {
    let adpAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/players.json') return { ok: true, json: async () => SAMPLE };
      if (url === '/data/adp-ppr.json') {
        adpAttempts += 1;
        if (adpAttempts === 1) return { ok: false, status: 503, json: async () => null };
        return { ok: true, json: async () => adpPpr };
      }
      return { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadRankedPlayers('ppr')).rejects.toThrow(/503/);
    const ranked = await loadRankedPlayers('ppr');
    expect(ranked).toMatchObject([
      { playerId: '1001', rank: 1, adp: 2.1 },
      { playerId: 'SF', rank: 2, adp: 9.2 },
    ]);
    expect(adpAttempts).toBe(2);
    // players.json stays memoized across the failed ranked join.
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/data/players.json')).toHaveLength(1);
  });
});
