import type { FantasyProsAdpArtifact, PlayerId } from '../../../shared/types';
import { validateFantasyProsAdp } from './dataInvariants';

export type FantasyProsAdpLoadResult =
  | { status: 'ready'; artifact: FantasyProsAdpArtifact }
  | { status: 'unavailable' };

let loadPromise: Promise<FantasyProsAdpLoadResult> | null = null;

/**
 * Session-memoized fail-open loader for the optional local-only per-site ADP
 * artifact. HTTP 404, network failure, malformed JSON, and validation failure
 * are all `unavailable` — never a board error, and never thrown to the UI. In
 * production this artifact is gitignored and simply 404s, so the ADP-by-provider
 * section must render nothing at all when unavailable.
 */
export function loadFantasyProsAdp(): Promise<FantasyProsAdpLoadResult> {
  if (!loadPromise) {
    loadPromise = (async (): Promise<FantasyProsAdpLoadResult> => {
      try {
        const response = await fetch('/data/fantasypros-adp.json');
        if (!response.ok) return { status: 'unavailable' };
        const raw: unknown = await response.json();
        if (validateFantasyProsAdp(raw).length > 0) return { status: 'unavailable' };
        return { status: 'ready', artifact: raw as FantasyProsAdpArtifact };
      } catch {
        return { status: 'unavailable' };
      }
    })();
  }
  return loadPromise;
}

export function fantasyProsAdpForPlayer(
  artifact: FantasyProsAdpArtifact | null,
  playerId: PlayerId,
): FantasyProsAdpArtifact['players'][PlayerId] | null {
  if (!artifact) return null;
  return artifact.players[playerId] ?? null;
}

/** Test-only: clears the memoized optional-artifact fetch. */
export function __resetFantasyProsAdpCache(): void {
  loadPromise = null;
}
