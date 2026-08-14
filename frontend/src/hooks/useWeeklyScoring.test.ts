import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetWeeklyScoringCache } from '../data/loadWeeklyScoring';
import { useWeeklyScoring } from './useWeeklyScoring';

const ARTIFACT = {
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

describe('useWeeklyScoring', () => {
  it('returns idle and performs no request when playerId is null', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWeeklyScoring(null, 2026));

    expect(result.current).toEqual({ weeks: [], season: null, status: 'idle' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the artifact after a player detail view opens and returns that player series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ARTIFACT),
    }));

    const { result } = renderHook(() => useWeeklyScoring('4034', 2026));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.season).toBe(2025);
    expect(result.current.weeks).toEqual(ARTIFACT.players['4034']);
  });

  it('returns ready with weeks: [] when the artifact has no series for the player', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ARTIFACT),
    }));

    const { result } = renderHook(() => useWeeklyScoring('rookie', 2026));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.weeks).toEqual([]);
    expect(result.current.season).toBe(2025);
  });

  it('does not zero-fill missing weeks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ARTIFACT),
    }));

    const { result } = renderHook(() => useWeeklyScoring('4034', 2026));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.weeks.map((entry) => entry.week)).toEqual([1, 4]);
    expect(result.current.weeks.some((entry) => entry.week === 2)).toBe(false);
  });

  it('surfaces unavailable when the artifact fails validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ schemaVersion: 1, season: 2026, players: {} }),
    }));

    const { result } = renderHook(() => useWeeklyScoring('4034', 2026));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.weeks).toEqual([]);
  });
});
