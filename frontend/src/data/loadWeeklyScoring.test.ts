import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetWeeklyScoringCache, loadWeeklyScoring } from './loadWeeklyScoring';

const VALID = {
  schemaVersion: 1,
  season: 2025,
  players: {
    '4034': [
      { week: 1, pointsPpr: 18.4 },
      { week: 4, pointsPpr: 0.0 },
    ],
  },
};

beforeEach(() => {
  __resetWeeklyScoringCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadWeeklyScoring', () => {
  it('fetches, validates, and returns the artifact', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadWeeklyScoring(2026);

    expect(result).toEqual({ status: 'ready', artifact: VALID });
    expect(fetchMock).toHaveBeenCalledWith('/data/weekly-ppr.json');
  });

  it('memoizes: repeated calls issue exactly one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadWeeklyScoring(2026);
    await loadWeeklyScoring(2026);
    await loadWeeklyScoring(2026);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats HTTP 404 as unavailable and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) }));

    await expect(loadWeeklyScoring(2026)).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats network errors as unavailable and caches the miss', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWeeklyScoring(2026)).resolves.toEqual({ status: 'unavailable' });
    await expect(loadWeeklyScoring(2026)).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats malformed JSON as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('bad json')),
    }));

    await expect(loadWeeklyScoring(2026)).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats validation failure as unavailable and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ schemaVersion: 0, season: 2026, players: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWeeklyScoring(2026)).resolves.toEqual({ status: 'unavailable' });
    await expect(loadWeeklyScoring(2026)).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
