import type { AdpEntry } from '../../../shared/types';
import { validateAdpProvenance, validateAdpRanges } from './dataInvariants';

export type DisplayAdpLoadResult =
  | { status: 'ready'; entries: AdpEntry[] }
  | { status: 'unavailable' };

const cache = new Map<string, Promise<DisplayAdpLoadResult>>();

/** Same content-type guard as `adpBoard.ts`'s `isJsonResponse` — a dev-server SPA fallback for a
 * missing file 200s with `index.html`, which would otherwise throw out of `response.json()`. */
function isJsonResponse(response: Response): boolean {
  return response.ok && (response.headers.get('content-type') ?? '').includes('json');
}

/**
 * Session-memoized, fail-open loader for the display-only comparison ADP boards
 * (`data/adp-espn-ppr.json`, the pipeline's per-format FFC boards). Deliberately NOT routed
 * through `AdpBoardKey` / `fetchAdpBoard` (`adpBoard.ts`) — that selector picks the ONE board
 * the engine runs on; these lanes are never an engine input and never blended into redraft
 * composites. A 404, a non-JSON response, a malformed body, or a board that fails the same
 * `AdpEntry` invariants the rest of the app checks all resolve to `'unavailable'`, never a
 * thrown error — the same fail-open contract as `loadUnderdogAdp.ts`.
 */
export function loadDisplayAdpBoard(fileName: string): Promise<DisplayAdpLoadResult> {
  const cached = cache.get(fileName);
  if (cached) return cached;
  const load = (async (): Promise<DisplayAdpLoadResult> => {
    try {
      const response = await fetch(`/data/${fileName}`);
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
  cache.set(fileName, load);
  return load;
}

/** Test-only: clears the memoized fetches. */
export function __resetDisplayAdpBoardCache(): void {
  cache.clear();
}
