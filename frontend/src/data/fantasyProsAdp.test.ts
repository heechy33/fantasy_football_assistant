import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetFantasyProsAdpCache, fantasyProsAdpForPlayer, loadFantasyProsAdp } from './fantasyProsAdp';

const VALID = {
  schemaVersion: 1,
  generatedAt: '2026-08-12T00:00:00Z',
  season: 2026,
  source: {
    name: 'fantasypros-overall-adp-csv' as const,
    file: 'FantasyPros_2026_Overall_ADP_Rankings.csv',
    rows: 1,
    matched: 1,
    unmatched: 0,
    emptyColumns: ['NFL'],
    status: 'ok' as const,
  },
  providers: [
    { key: 'espn' as const, label: 'ESPN', rows: 1, matchedRows: 1 },
    { key: 'sleeper' as const, label: 'Sleeper', rows: 1, matchedRows: 1 },
  ],
  consensus: { key: 'avg' as const, label: 'FantasyPros AVG', rows: 1 },
  realTime: { key: 'realTime' as const, label: 'FantasyPros Real-Time', rows: 1 },
  players: {
    '7564': {
      rank: 1,
      positionRank: 'WR1',
      avg: 14.1,
      realTime: { rank: 14, delta: -1 },
      adp: { espn: 14.5, sleeper: 15.2 },
    },
  },
  unmatched: [],
};

beforeEach(() => {
  __resetFantasyProsAdpCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadFantasyProsAdp', () => {
  it('preserves the complete validated artifact including source metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    }));

    const result = await loadFantasyProsAdp();

    expect(result).toEqual({ status: 'ready', artifact: VALID });
    if (result.status === 'ready') {
      expect(result.artifact.source.file).toBe('FantasyPros_2026_Overall_ADP_Rankings.csv');
      expect(result.artifact.source.emptyColumns).toEqual(['NFL']);
    }
  });

  it('memoizes: repeated calls issue exactly one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadFantasyProsAdp();
    await loadFantasyProsAdp();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/fantasypros-adp.json');
  });

  it('treats HTTP 404 as unavailable and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) }));

    await expect(loadFantasyProsAdp()).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats validation failure as unavailable and caches the miss', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...VALID, source: { ...VALID.source, status: 'bad' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadFantasyProsAdp()).resolves.toEqual({ status: 'unavailable' });
    await expect(loadFantasyProsAdp()).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats network errors as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(loadFantasyProsAdp()).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('fantasyProsAdpForPlayer', () => {
  it('returns the player row or null without inventing ADPs', () => {
    expect(fantasyProsAdpForPlayer(VALID, '7564')?.adp?.espn).toBe(14.5);
    expect(fantasyProsAdpForPlayer(VALID, 'missing')).toBeNull();
    expect(fantasyProsAdpForPlayer(null, '7564')).toBeNull();
  });
});
