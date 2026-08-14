import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetProviderProjectionsCache, loadProviderProjections, providerProjectionsForPlayer } from './providerProjections';

const VALID = {
  schemaVersion: 1,
  generatedAt: '2026-08-13T00:00:00Z',
  season: 2026,
  displayOnly: true as const,
  providers: [
    {
      key: 'sleeper', label: 'Sleeper (Rotowire)', attribution: 'x',
      status: 'ok' as const, fetchedAt: '2026-08-13T00:00:00Z', upstreamUpdatedAt: null,
      rows: 636, positionRows: { RB: 137 }, positionsExcluded: [],
      staleSinceDays: 0, diagnostic: null,
    },
  ],
  players: {
    '7564': { sleeper: { rush_yd: 1200, rush_td: 11 } },
  },
};

beforeEach(() => {
  __resetProviderProjectionsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadProviderProjections', () => {
  it('preserves the complete validated artifact', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(VALID) }));
    const result = await loadProviderProjections();
    expect(result).toEqual({ status: 'ready', artifact: VALID });
  });

  it('memoizes: repeated calls issue exactly one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(VALID) });
    vi.stubGlobal('fetch', fetchMock);
    await loadProviderProjections();
    await loadProviderProjections();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/projections-providers.json');
  });

  it('treats HTTP 404 as unavailable and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) }));
    await expect(loadProviderProjections()).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats validation failure as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...VALID, displayOnly: false }) }));
    await expect(loadProviderProjections()).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('providerProjectionsForPlayer', () => {
  it('returns the player provider map or null', () => {
    expect(providerProjectionsForPlayer(VALID, '7564')?.sleeper?.rush_yd).toBe(1200);
    expect(providerProjectionsForPlayer(VALID, 'missing')).toBeNull();
    expect(providerProjectionsForPlayer(null, '7564')).toBeNull();
  });
});
