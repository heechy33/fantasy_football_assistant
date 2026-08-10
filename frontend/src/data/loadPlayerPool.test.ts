import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdpEntry, PlayerMeta } from '../../../shared/types';
import { __resetPlayerPoolCache, loadKnownPlayerIds, loadPlayerPool, rankPlayers } from './loadPlayerPool';

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
});
