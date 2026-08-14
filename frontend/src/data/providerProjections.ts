import type { PlayerId, ProviderProjectionsArtifact } from '../../../shared/types';
import { validateProviderProjections } from './dataInvariants';

export type ProviderProjectionsLoadResult =
  | { status: 'ready'; artifact: ProviderProjectionsArtifact }
  | { status: 'unavailable' };

let loadPromise: Promise<ProviderProjectionsLoadResult> | null = null;

/**
 * Session-memoized fail-open loader for the committed multi-provider projections
 * artifact. HTTP failure, malformed JSON, and validation failure are all
 * `unavailable` — never a board error, never thrown. Production serves the
 * committed artifact; a missing file just hides the comparison section.
 */
export function loadProviderProjections(): Promise<ProviderProjectionsLoadResult> {
  if (!loadPromise) {
    loadPromise = (async (): Promise<ProviderProjectionsLoadResult> => {
      try {
        const response = await fetch('/data/projections-providers.json');
        if (!response.ok) return { status: 'unavailable' };
        const raw: unknown = await response.json();
        if (validateProviderProjections(raw).length > 0) return { status: 'unavailable' };
        return { status: 'ready', artifact: raw as ProviderProjectionsArtifact };
      } catch {
        return { status: 'unavailable' };
      }
    })();
  }
  return loadPromise;
}

export function providerProjectionsForPlayer(
  artifact: ProviderProjectionsArtifact | null,
  playerId: PlayerId,
): Record<string, Record<string, number>> | null {
  if (!artifact) return null;
  return artifact.players[playerId] ?? null;
}

/** Test-only: clears the memoized artifact fetch. */
export function __resetProviderProjectionsCache(): void {
  loadPromise = null;
}
