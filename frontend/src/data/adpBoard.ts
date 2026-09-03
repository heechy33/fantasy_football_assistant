import type { AdpEntry } from '../../../shared/types';
import type { AdpFormat } from './loadPlayerPool';

/**
 * Which ADP artifact the session's board should read. Every base `AdpFormat`
 * maps to its own file; `'espn-ppr'` and `'yahoo-half-ppr'` are the additive
 * provider-specific boards — ESPN's public default-league (PPR) average draft
 * position, selected only for ESPN sessions; Yahoo's draft-analysis half-PPR
 * board, selected only for Yahoo half-PPR sessions. See {@link adpBoardKeyFor}.
 * The **key** is what travels through the data layer, not the provider string,
 * so no data module ever imports a component type.
 */
export type AdpBoardKey = AdpFormat | 'espn-ppr' | 'yahoo-half-ppr' | 'yahoo-ppr' | 'yahoo-standard';

/**
 * Collapses the ADP URL selection that used to be hardcoded in three places
 * (`usePlayerBoardData`, the recommendation worker, `loadRankedPlayers`) into
 * one function. Returns:
 * - `'espn-ppr'` for `provider === 'espn'` and `format === 'ppr'`
 * - `'yahoo-half-ppr'` for `provider === 'yahoo'` and `format === 'half-ppr'`
 *   (the only Yahoo lane wired today; the chip stays on the half-PPR preset
 *   so this single selector covers the from-scratch Yahoo draft case in full)
 * Every other combination stays on the plain format key (Sleeper connected and
 * Sleeper-manual sessions are unchanged). When the requested additive board's
 * file is missing, `fetchAdpBoard`'s fail-open already falls back to the plain
 * `/data/adp-${format}.json` board, so a Phase 2 pipeline gap never errors
 * the whole session.
 *
 * `provider` is deliberately a plain string — the data layer must not import
 * `LandingActiveProvider` from a component.
 */
export function adpBoardKeyFor(provider: string, format: AdpFormat): AdpBoardKey {
  if (provider === 'espn' && format === 'ppr') return 'espn-ppr';
  if (provider === 'yahoo' && format === 'half-ppr') return 'yahoo-half-ppr';
  // 2026-09-XX (Phase 2): close the PPR/Standard gap so a Yahoo user on a non-half-ppr
  // format doesn't silently fall back to Sleeper's adp-ppr.json. Until the Yahoo PPR
  // and Yahoo standard artifacts are committed, the fail-open in fetchAdpBoard below
  // keeps the draft-day session working -- the user just sees a Sleeper board labeled
  // correctly via the manifest's adp_active_yahoo_<fmt> key, not a silent wrong label.
  if (provider === 'yahoo' && format === 'ppr') return 'yahoo-ppr';
  if (provider === 'yahoo' && format === 'standard') return 'yahoo-standard';
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
