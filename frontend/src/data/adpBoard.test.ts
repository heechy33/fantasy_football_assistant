import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdpEntry } from '../../../shared/types';
import { adpBoardKeyFor, fetchAdpBoard } from './adpBoard';

const ENTRY: AdpEntry = {
  playerId: '1', name: 'One', position: 'RB', team: 'BUF', adp: 1, stdev: 1,
  high: null, low: null, timesDrafted: null, byeWeek: 7, adpSource: 'sleeper', stdevSource: 'fitted',
};

function jsonOk(body: unknown) {
  return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve(body) };
}

/** What Vite's dev server (and most static hosts without SWA's `/data/*` navigationFallback
 * exclusion) actually returns for a missing `/data/*.json` file: 200 OK with `index.html`'s body,
 * not a 404 — see `isJsonResponse`'s doc in adpBoard.ts. */
function htmlSpaFallback() {
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), json: () => Promise.reject(new SyntaxError('Unexpected token <')) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adpBoardKeyFor', () => {
  it('selects espn-ppr only for ESPN PPR sessions; every other combo stays on the format key', () => {
    expect(adpBoardKeyFor('espn', 'ppr')).toBe('espn-ppr');
    expect(adpBoardKeyFor('espn', 'half-ppr')).toBe('half-ppr');
    expect(adpBoardKeyFor('espn', 'standard')).toBe('standard');
    expect(adpBoardKeyFor('sleeper', 'ppr')).toBe('ppr');
    expect(adpBoardKeyFor('none', 'ppr')).toBe('ppr');
    expect(adpBoardKeyFor('manual', 'ppr')).toBe('ppr');
    expect(adpBoardKeyFor('sleeper', '2qb')).toBe('2qb');
  });

  it('selects a yahoo-<fmt> key for every Yahoo combination (closes the silent Sleeper fallback gap)', () => {
    // Phase 1 only wired yahoo-half-ppr, so Yahoo PPR/standard users were silently getting
    // the plain format board. Phase 2 fixes that for all three Yahoo-served formats.
    expect(adpBoardKeyFor('yahoo', 'half-ppr')).toBe('yahoo-half-ppr');
    expect(adpBoardKeyFor('yahoo', 'ppr')).toBe('yahoo-ppr');
    expect(adpBoardKeyFor('yahoo', 'standard')).toBe('yahoo-standard');
    // Yahoo does not serve 2qb; that combination stays on the format key (a Yahoo user
    // selecting 2qb is an unsupported edge case that the create form doesn't offer).
    expect(adpBoardKeyFor('yahoo', '2qb')).toBe('2qb');
  });
});

describe('fetchAdpBoard', () => {
  it('fetches the requested board and reports the resolved key on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([ENTRY]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAdpBoard('espn-ppr', 'ppr');

    expect(fetchMock).toHaveBeenCalledWith('/data/adp-espn-ppr.json');
    expect(result.entries).toEqual([ENTRY]);
    expect(result.resolvedKey).toBe('espn-ppr');
  });

  it('falls back to the format board and reports the format key on a non-ok response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/adp-espn-ppr.json') return { ok: false, status: 404, json: () => Promise.resolve(null) };
      if (url === '/data/adp-ppr.json') return jsonOk([ENTRY]);
      return { ok: false, status: 500, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAdpBoard('espn-ppr', 'ppr');

    expect(fetchMock).toHaveBeenCalledWith('/data/adp-espn-ppr.json');
    expect(fetchMock).toHaveBeenCalledWith('/data/adp-ppr.json');
    expect(result.entries).toEqual([ENTRY]);
    expect(result.resolvedKey).toBe('ppr');
  });

  it('falls back to the format board when the primary board 200s with the SPA-fallback HTML page instead of 404ing (dev-server/no-SWA-routing case)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/adp-espn-ppr.json') return htmlSpaFallback();
      if (url === '/data/adp-ppr.json') return jsonOk([ENTRY]);
      return htmlSpaFallback();
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAdpBoard('espn-ppr', 'ppr');

    expect(result.entries).toEqual([ENTRY]);
    expect(result.resolvedKey).toBe('ppr');
  });

  it('throws when the format board itself is missing (no fallback available)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/adp-ppr.json') return { ok: false, status: 503, json: () => Promise.resolve(null) };
      return { ok: false, status: 500, json: () => Promise.resolve(null) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAdpBoard('ppr', 'ppr')).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
