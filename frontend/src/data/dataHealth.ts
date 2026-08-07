import type { DataManifest } from '../../../shared/types';

/**
 * The four states from PLAN.md's "Define degraded behavior": never silently
 * substitute one signal for another, so the UI must know explicitly which of
 * these it's in rather than inferring it from missing fields deep in the
 * board/recommendation code.
 */
export type DataMode = 'full' | 'projection-only' | 'adp-only' | 'unavailable';

export interface DataHealthOptions {
  /** manifest.sources key for the projection feed. */
  projectionSourceKey?: string;
  /** manifest.sources key for the ADP feed. */
  adpSourceKey?: string;
  /** A source older than this is treated the same as missing. Default 48h. */
  maxAgeMs?: number;
  /** Injectable for tests; defaults to the real clock. */
  now?: number;
}

const DEFAULT_PROJECTION_SOURCE_KEY = 'sleeper_season_projections';
const DEFAULT_ADP_SOURCE_KEY = 'ffc_adp_ppr';
const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function isSourceHealthy(
  manifest: DataManifest,
  key: string,
  maxAgeMs: number,
  now: number,
): boolean {
  const source = manifest.sources[key];
  if (!source || source.status !== 'ok') return false;

  const fetchedAt = Date.parse(source.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;

  return now - fetchedAt <= maxAgeMs;
}

/**
 * Projection + ADP available -> full engine. Projection only -> projected-value
 * board, no availability claim. ADP only -> market-rank board, no "best roster"
 * claim. Neither -> manual board with a blocking data-health warning.
 */
export function resolveDataMode(manifest: DataManifest, options: DataHealthOptions = {}): DataMode {
  const {
    projectionSourceKey = DEFAULT_PROJECTION_SOURCE_KEY,
    adpSourceKey = DEFAULT_ADP_SOURCE_KEY,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    now = Date.now(),
  } = options;

  const hasProjection = isSourceHealthy(manifest, projectionSourceKey, maxAgeMs, now);
  const hasAdp = isSourceHealthy(manifest, adpSourceKey, maxAgeMs, now);

  if (hasProjection && hasAdp) return 'full';
  if (hasProjection) return 'projection-only';
  if (hasAdp) return 'adp-only';
  return 'unavailable';
}
