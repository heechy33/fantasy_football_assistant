import type { AdpEntry } from '../../../shared/types';
import type { AdpFormat } from './loadPlayerPool';

/**
 * Which ADP artifact the session's board should read. Every base `AdpFormat`
 * maps to its own file; `'espn-ppr'` is the only additive board — ESPN's
 * public default-league (PPR) average draft position, selected only for ESPN
 * sessions (see {@link adpBoardKeyFor}). The **key** is what travels through
 * the data layer, not the provider string, so no data module ever imports a
 * component type.
 */
export type AdpBoardKey = AdpFormat | 'espn-ppr';

/**
 * Collapses the ADP URL selection that used to be hardcoded in three places
 * (`usePlayerBoardData`, the recommendation worker, `loadRankedPlayers`) into
 * one function. Returns `'espn-ppr'` only for `provider === 'espn'` and
 * `format === 'ppr'`; every other combination stays on the plain format key
 * (Sleeper connected and Sleeper-manual sessions are unchanged).
 *
 * `provider` is deliberately a plain string — the data layer must not import
 * `LandingActiveProvider` from a component.
 */
export function adpBoardKeyFor(provider: string, format: AdpFormat): AdpBoardKey {
  if (provider === 'espn' && format === 'ppr') return 'espn-ppr';
  return format;
}

export interface AdpBoardLoad {
  entries: AdpEntry[];
  /**
   * The key whose file actually loaded. Differs from the requested `key` only
   * when the requested board was missing (non-ok response) and the caller fell
   * back to the plain `/data/adp-${format}.json` board. Callers must disclose
   * the resolved key — the same never-switch-sources-silently rule as the
   * existing sparse-Sleeper → FFC fallback.
   */
  resolvedKey: AdpBoardKey;
}

/**
 * True only for a response we can safely treat as the JSON board we asked for. `staticwebapp
 * .config.json` excludes `/data/*` from the SPA `navigationFallback` in production, so a missing
 * file 404s there — but Vite's dev server (and `vite preview`, and most static hosts without that
 * exclusion) has no such carve-out: a missing `/data/adp-espn-ppr.json` gets the SPA fallback and
 * comes back `200 OK` with `index.html`. `response.ok` alone can't see that, `response.json()`
 * throws on the HTML body, and that throw isn't part of the not-ok fallback path below — it was
 * escaping straight out of `usePlayerBoardData`'s `Promise.all` and killing the whole board (not
 * just ADP) for the entire draft. Checking `content-type` catches that case the same way a 404
 * would.
 */
function isJsonResponse(response: Response): boolean {
  return response.ok && (response.headers.get('content-type') ?? '').includes('json');
}

/**
 * Fetch the board for `key`, falling back to `/data/adp-${format}.json` on a
 * non-ok (or non-JSON, see `isJsonResponse`) response and reporting which key
 * actually resolved. Fail-open: a missing additive ESPN board degrades to the
 * Sleeper/format board instead of erroring the whole session, exactly like
 * the pipeline's own ESPN fail-open. A missing *format* board (no fallback
 * available) still throws.
 */
export async function fetchAdpBoard(key: AdpBoardKey, format: AdpFormat): Promise<AdpBoardLoad> {
  const primaryUrl = `/data/adp-${key}.json`;
  const response = await fetch(primaryUrl);
  if (isJsonResponse(response)) {
    return { entries: (await response.json()) as AdpEntry[], resolvedKey: key };
  }
  const fallbackUrl = `/data/adp-${format}.json`;
  if (fallbackUrl === primaryUrl) {
    throw new Error(`adp fetch failed: ${primaryUrl} (${response.status})`);
  }
  const fallbackResponse = await fetch(fallbackUrl);
  if (!isJsonResponse(fallbackResponse)) {
    throw new Error(`adp fetch failed: ${fallbackUrl} (${fallbackResponse.status})`);
  }
  return { entries: (await fallbackResponse.json()) as AdpEntry[], resolvedKey: format };
}
