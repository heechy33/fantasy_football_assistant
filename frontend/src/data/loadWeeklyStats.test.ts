import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetWeeklyStatsCache, loadWeeklyStats } from './loadWeeklyStats';

const VALID = {
  schemaVersion: 1,
  season: 2025,
  weeksFetched: [1, 4],
  columns: { RB: ['pts', 'opp', 'snp', 'fin'] },
  players: {
    '4034': { p: 'RB', bye: 9, w: [[1, 18.4, '@KC', 55, 5], [4, 0.0, 'DAL', 40, 12]] },
  },
  heat: {},
};

beforeEach(() => {
  __resetWeeklyStatsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadWeeklyStats', () => {
  it('fetches, validates, and returns the artifact', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadWeeklyStats(2026);

    expect(result).toEqual({ status: 'ready', artifact: VALID });
    expect(fetchMock).toHaveBeenCalledWith('/data/weekly-stats.json');
  });

  it('memoizes: repeated calls issue exactly one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadWeeklyStats(2026);
    await loadWeeklyStats(2026);
    await loadWeeklyStats(2026);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats HTTP 404 as unavailable and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) }));

    await expect(loadWeeklyStats(2026)).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats network errors as unavailable and caches the miss', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWeeklyStats(2026)).resolves.toEqual({ status: 'unavailable' });
    await expect(loadWeeklyStats(2026)).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats malformed JSON as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('bad json')),
    }));

    await expect(loadWeeklyStats(2026)).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats validation failure as unavailable and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ schemaVersion: 0, season: 2026, weeksFetched: [], columns: {}, players: {}, heat: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWeeklyStats(2026)).resolves.toEqual({ status: 'unavailable' });
    await expect(loadWeeklyStats(2026)).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
