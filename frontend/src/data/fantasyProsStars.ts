import type { FantasyProsArtifact, FantasyProsStars, PlayerId } from '../../../shared/types';
import { validateFantasyProsStars } from './dataInvariants';

export type FantasyProsLoadResult =
  | { status: 'ready'; artifact: FantasyProsArtifact }
  | { status: 'unavailable' };

let loadPromise: Promise<FantasyProsLoadResult> | null = null;

/**
 * Session-memoized loader for the optional local-only FantasyPros decoration.
 * HTTP 404, network failure, malformed JSON, and validation failure are all
 * `unavailable` — never a board error, and never thrown to the UI.
 */
export function loadFantasyProsStars(): Promise<FantasyProsLoadResult> {
  if (!loadPromise) {
    loadPromise = (async (): Promise<FantasyProsLoadResult> => {
      try {
        const response = await fetch('/data/fantasypros-stars.json');
        if (!response.ok) return { status: 'unavailable' };
        const raw: unknown = await response.json();
        if (validateFantasyProsStars(raw).length > 0) return { status: 'unavailable' };
        return { status: 'ready', artifact: raw as FantasyProsArtifact };
      } catch {
        return { status: 'unavailable' };
      }
    })();
  }
  return loadPromise;
}

export function fantasyProsStarsForPlayer(
  artifact: FantasyProsArtifact | null,
  playerId: PlayerId,
): FantasyProsStars | null {
  if (!artifact) return null;
  return artifact.players[playerId] ?? null;
}

/** Test-only: clears the memoized optional-artifact fetch. */
export function __resetFantasyProsStarsCache(): void {
  loadPromise = null;
}
