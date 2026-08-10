import type { DataManifest, Pick } from '../../../shared/types';
import { resolveDataMode, type DataMode } from '../data/dataHealth';
import type { AdpFormat } from '../data/loadPlayerPool';

export interface DataHealthProps {
  manifest: DataManifest | null;
  effectivePicks: Pick[];
  isStale: boolean;
  dataAgeMs: number | null;
  consecutiveFailures: number;
  lastError: unknown;
  adpFormat: AdpFormat;
}

function findDuplicatePlayerIds(picks: Pick[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const pick of picks) {
    if (pick.playerId == null) continue;
    if (seen.has(pick.playerId)) duplicates.add(pick.playerId);
    seen.add(pick.playerId);
  }
  return [...duplicates];
}

/**
 * Combines static-data health (P0.6's four degraded states, unmodified) with
 * live-poll health into one honest banner — never lets a stale live poll look
 * healthy just because the static data is fine, or vice versa. The duplicate-
 * playerId check is a cheap, direct guard on the "manual correction never
 * corrupts availability" invariant.
 */
export function DataHealth({
  manifest,
  effectivePicks,
  isStale,
  dataAgeMs,
  consecutiveFailures,
  lastError,
  adpFormat,
}: DataHealthProps) {
  const dataMode: DataMode | 'unknown' = manifest
    ? resolveDataMode(manifest, { adpSourceKey: `adp_active_${adpFormat}` })
    : 'unknown';
  const duplicates = findDuplicatePlayerIds(effectivePicks);
  const isHealthy = dataMode === 'full' && !isStale && consecutiveFailures === 0 && duplicates.length === 0;

  if (isHealthy) {
    return <p>Data healthy — static data full, live poll current.</p>;
  }

  return (
    <div role="status">
      <strong>Data health warning</strong>
      <ul>
        {dataMode !== 'full' && (
          <li>Static projection/ADP data is in &quot;{dataMode}&quot; mode.</li>
        )}
        {isStale && (
          <li>Live draft data is stale{dataAgeMs != null ? ` (${Math.round(dataAgeMs / 1000)}s old)` : ''}.</li>
        )}
        {consecutiveFailures > 0 && (
          <li>
            {consecutiveFailures} consecutive poll failure{consecutiveFailures === 1 ? '' : 's'}
            {lastError instanceof Error ? `: ${lastError.message}` : ''}.
          </li>
        )}
        {duplicates.length > 0 && (
          <li>{duplicates.length} player(s) appear drafted more than once: {duplicates.join(', ')}.</li>
        )}
      </ul>
    </div>
  );
}
