import type { AdpEntry } from '../../../shared/types';
import { validateAdpProvenance, validateAdpRanges } from './dataInvariants';

export type UnderdogAdpLoadResult =
  | { status: 'ready'; entries: AdpEntry[] }
  | { status: 'unavailable' };

let cached: Promise<UnderdogAdpLoadResult> | null = null;

/** Same content-type guard as `adpBoard.ts`'s `isJsonResponse` — a dev-server SPA fallback for a
 * missing file 200s with `index.html`, which would otherwise throw out of `response.json()`. */
function isJsonResponse(response: Response): boolean {
  return response.ok && (response.headers.get('content-type') ?? '').includes('json');
}

/**
 * Session-memoized, fail-open loader for the Underdog best-ball ADP board
 * (`data/adp-underdog-bestball.json`). Deliberately NOT routed through `AdpBoardKey` /
 * `fetchAdpBoard` (`adpBoard.ts`) — that selector picks the board the *engine* runs on, and
 * Underdog's best-ball half-PPR TE-premium lane is never selected as an engine board and never
 * blended into redraft composites (see `pipeline/underdog_adp.py`'s header comment). A separate
 * loader keeps that guarantee structural rather than a convention callers have to remember.
 *
 * The file may not exist yet — as of 2026-08-24 the pipeline writes it but no committed snapshot
 * has run since. A 404, a non-JSON response, a malformed body, or a board that fails the same
 * `AdpEntry` invariants the rest of the app checks all resolve to `'unavailable'`, never a thrown
 * error — the same fail-open contract as `loadWeeklyStats.ts`.
 */
export function loadUnderdogAdp(): Promise<UnderdogAdpLoadResult> {
  if (cached) return cached;
  cached = (async (): Promise<UnderdogAdpLoadResult> => {
    try {
      const response = await fetch('/data/adp-underdog-bestball.json');
      if (!isJsonResponse(response)) return { status: 'unavailable' };
      const entries = (await response.json()) as unknown;
      if (!Array.isArray(entries)) return { status: 'unavailable' };
      const typed = entries as AdpEntry[];
      const issues = [...validateAdpRanges(typed), ...validateAdpProvenance(typed)];
      if (issues.length > 0) return { status: 'unavailable' };
      return { status: 'ready', entries: typed };
    } catch {
      return { status: 'unavailable' };
    }
  })();
  return cached;
}

/** Test-only: clears the memoized fetch. */
export function __resetUnderdogAdpCache(): void {
  cached = null;
}
