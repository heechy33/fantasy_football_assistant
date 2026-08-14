import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetFantasyProsStarsCache, fantasyProsStarsForPlayer, loadFantasyProsStars } from './fantasyProsStars';

const VALID = {
  schemaVersion: 1,
  generatedAt: '2026-08-12T00:00:00Z',
  season: 2026,
  source: {
    name: 'fantasypros-draft-rankings-csv' as const,
    file: 'FantasyPros_2026_Draft_ALL_Rankings.csv',
    rows: 1,
    droppedNonRankRows: 0,
    matched: 1,
    unmatched: 0,
    status: 'ok' as const,
  },
  players: {
    '7564': {
      rank: 1,
      tier: 1,
      upside: 5,
      bust: 1,
      sos: 4,
      ecrVsAdp: 2,
      positionRank: 'WR1',
    },
  },
  unmatched: [],
};

beforeEach(() => {
  __resetFantasyProsStarsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadFantasyProsStars', () => {
  it('preserves the complete validated artifact including source metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    }));

    const result = await loadFantasyProsStars();

    expect(result).toEqual({ status: 'ready', artifact: VALID });
    if (result.status === 'ready') {
      expect(result.artifact.source.file).toBe('FantasyPros_2026_Draft_ALL_Rankings.csv');
      expect(result.artifact.source.matched).toBe(1);
    }
  });

  it('memoizes: repeated calls issue exactly one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadFantasyProsStars();
    await loadFantasyProsStars();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/fantasypros-stars.json');
  });

  it('treats HTTP 404 as unavailable and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) }));

    await expect(loadFantasyProsStars()).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats validation failure as unavailable and caches the miss', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...VALID, source: { ...VALID.source, status: 'bad' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadFantasyProsStars()).resolves.toEqual({ status: 'unavailable' });
    await expect(loadFantasyProsStars()).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats network errors as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(loadFantasyProsStars()).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('fantasyProsStarsForPlayer', () => {
  it('returns the player row or null without inventing stars', () => {
    expect(fantasyProsStarsForPlayer(VALID, '7564')?.upside).toBe(5);
    expect(fantasyProsStarsForPlayer(VALID, 'missing')).toBeNull();
    expect(fantasyProsStarsForPlayer(null, '7564')).toBeNull();
  });
});
