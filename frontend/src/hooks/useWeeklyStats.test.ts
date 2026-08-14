import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetWeeklyStatsCache } from '../data/loadWeeklyStats';
import { useWeeklyStats } from './useWeeklyStats';

const ARTIFACT = {
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

describe('useWeeklyStats', () => {
  it('returns idle and performs no request when playerId is null', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWeeklyStats(null, 2026));

    expect(result.current).toEqual({ artifact: null, status: 'idle' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the whole artifact after a player detail view opens, not a pre-filtered series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ARTIFACT),
    }));

    const { result } = renderHook(() => useWeeklyStats('4034', 2026));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.artifact?.season).toBe(2025);
    // The whole artifact, not just '4034's series -- the role panel needs
    // every position's columns map, and the grid needs weeksFetched/heat.
    expect(result.current.artifact?.players['4034']).toEqual(ARTIFACT.players['4034']);
    expect(result.current.artifact?.weeksFetched).toEqual([1, 4]);
  });

  it('still resolves ready when the artifact has no series for this player', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ARTIFACT),
    }));

    const { result } = renderHook(() => useWeeklyStats('rookie', 2026));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.artifact?.players['rookie']).toBeUndefined();
  });

  it('surfaces unavailable when the artifact fails validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ schemaVersion: 1, season: 2026, weeksFetched: [], columns: {}, players: {}, heat: {} }),
    }));

    const { result } = renderHook(() => useWeeklyStats('4034', 2026));
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.artifact).toBeNull();
  });

  it('resets to idle when playerId becomes null again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ARTIFACT),
    }));

    const { result, rerender } = renderHook(({ playerId }) => useWeeklyStats(playerId, 2026), {
      initialProps: { playerId: '4034' as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ playerId: null });
    expect(result.current).toEqual({ artifact: null, status: 'idle' });
  });
});
