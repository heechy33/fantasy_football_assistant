import type { PlayerWeeklyStatsArtifact } from '../../../shared/types';
import { validateWeeklyStats } from './dataInvariants';

export type WeeklyStatsLoadResult =
  | { status: 'ready'; artifact: PlayerWeeklyStatsArtifact }
  | { status: 'unavailable' };

let rawPromise: Promise<unknown | 'unavailable'> | null = null;
const validatedBySeason = new Map<number, Promise<WeeklyStatsLoadResult>>();

async function fetchRawArtifact(): Promise<unknown | 'unavailable'> {
  try {
    const response = await fetch('/data/weekly-stats.json');
    if (!response.ok) return 'unavailable';
    return await response.json();
  } catch {
    return 'unavailable';
  }
}

/**
 * Session-memoized loader for the committed weekly game-log artifact
 * (`data/weekly-stats.json`, replacing `weekly-ppr.json`/`loadWeeklyScoring`).
 * Failures (404, network, malformed JSON, validation) are cached as unavailable
 * and never thrown to the UI. The JSON is fetched at most once per session;
 * validation is keyed by the current draft season.
 */
export function loadWeeklyStats(draftSeason: number): Promise<WeeklyStatsLoadResult> {
  const cached = validatedBySeason.get(draftSeason);
  if (cached) return cached;

  const promise = (async (): Promise<WeeklyStatsLoadResult> => {
    if (!rawPromise) rawPromise = fetchRawArtifact();
    const raw = await rawPromise;
    if (raw === 'unavailable') return { status: 'unavailable' };
    const issues = validateWeeklyStats(raw, draftSeason);
    if (issues.length > 0) return { status: 'unavailable' };
    return { status: 'ready', artifact: raw as PlayerWeeklyStatsArtifact };
  })();

  validatedBySeason.set(draftSeason, promise);
  return promise;
}

/** Test-only: clears the memoized fetch and per-season validation cache. */
export function __resetWeeklyStatsCache(): void {
  rawPromise = null;
  validatedBySeason.clear();
}
