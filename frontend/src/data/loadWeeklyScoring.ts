import type { PlayerWeeklyScoringArtifact } from '../../../shared/types';
import { validateWeeklyScoring } from './dataInvariants';

export type WeeklyScoringLoadResult =
  | { status: 'ready'; artifact: PlayerWeeklyScoringArtifact }
  | { status: 'unavailable' };

let rawPromise: Promise<unknown | 'unavailable'> | null = null;
const validatedBySeason = new Map<number, Promise<WeeklyScoringLoadResult>>();

async function fetchRawArtifact(): Promise<unknown | 'unavailable'> {
  try {
    const response = await fetch('/data/weekly-ppr.json');
    if (!response.ok) return 'unavailable';
    return await response.json();
  } catch {
    return 'unavailable';
  }
}

/**
 * Session-memoized loader for the committed weekly PPR chart artifact.
 * Failures (404, network, malformed JSON, validation) are cached as unavailable
 * and never thrown to the UI. The JSON is fetched at most once per session;
 * validation is keyed by the current draft season.
 */
export function loadWeeklyScoring(draftSeason: number): Promise<WeeklyScoringLoadResult> {
  const cached = validatedBySeason.get(draftSeason);
  if (cached) return cached;

  const promise = (async (): Promise<WeeklyScoringLoadResult> => {
    if (!rawPromise) rawPromise = fetchRawArtifact();
    const raw = await rawPromise;
    if (raw === 'unavailable') return { status: 'unavailable' };
    const issues = validateWeeklyScoring(raw, draftSeason);
    if (issues.length > 0) return { status: 'unavailable' };
    return { status: 'ready', artifact: raw as PlayerWeeklyScoringArtifact };
  })();

  validatedBySeason.set(draftSeason, promise);
  return promise;
}

/** Test-only: clears the memoized fetch and per-season validation cache. */
export function __resetWeeklyScoringCache(): void {
  rawPromise = null;
  validatedBySeason.clear();
}
