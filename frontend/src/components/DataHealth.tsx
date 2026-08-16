import { useEffect, useState, type RefObject } from 'react';
import type { DataManifest, Pick } from '../../../shared/types';
import { resolveDataMode, type DataMode } from '../data/dataHealth';
import type { AdpFormat } from '../data/loadPlayerPool';
import { computeStaleness, type PollHealth } from '../hooks/useDraftPoll';
import type { LandingActiveProvider } from './LandingPage';

export interface DataHealthProps {
  manifest: DataManifest | null;
  effectivePicks: Pick[];
  isStale: boolean;
  dataAgeMs: number | null;
  consecutiveFailures: number;
  lastError: unknown;
  /** Ref-backed live health avoids re-rendering the full workspace on no-op polls. */
  pollHealthRef?: RefObject<PollHealth> | null;
  adpFormat: AdpFormat;
  /** Which provider owns the session — on an ESPN PPR session whose ESPN board actually shipped
   * (manifest `adp_active_espn_ppr` healthy), health resolves against that key instead of
   * `adp_active_ppr`; a fail-open ESPN→Sleeper fallback keeps the plain key. */
  activeProvider: LandingActiveProvider;
  /** Draft-day honesty: unmodeled custom-scoring categories, rendered as banner items. */
  scoringDiagnostics?: string[];
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
  pollHealthRef = null,
  adpFormat,
  activeProvider,
  scoringDiagnostics,
}: DataHealthProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (pollHealthRef == null) return;
    const id = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [pollHealthRef]);

  const liveHealth = pollHealthRef?.current;
  const freshness = liveHealth == null
    ? { isStale, dataAgeMs }
    : computeStaleness(liveHealth.lastSuccessfulPollAt, 2000, Date.now());
  const liveFailures = liveHealth?.consecutiveFailures ?? consecutiveFailures;
  const liveError = liveHealth?.lastError ?? lastError;
  // An ESPN PPR session resolves health against `adp_active_espn_ppr` only when that board actually
  // shipped (the manifest entry is written exactly when the pipeline committed `adp-espn-ppr.json`,
  // which is precisely the case `fetchAdpBoard` resolves to 'espn-ppr'). On an ESPN fetch-failure
  // day the app fell back to the Sleeper board, so health must keep the plain format key — the same
  // never-switch-sources-silently rule as the disclosure surfaces.
  const adpSourceKey = activeProvider === 'espn' && adpFormat === 'ppr'
    && manifest?.sources.adp_active_espn_ppr?.status === 'ok'
    ? 'adp_active_espn_ppr'
    : `adp_active_${adpFormat}`;
  const dataMode: DataMode | 'unknown' = manifest
    ? resolveDataMode(manifest, { adpSourceKey })
    : 'unknown';
  const duplicates = findDuplicatePlayerIds(effectivePicks);
  const isHealthy = dataMode === 'full' && !freshness.isStale && liveFailures === 0 && duplicates.length === 0;

  if (isHealthy) {
    return <p className="data-health data-health-ok">Data healthy — static data full, live poll current.</p>;
  }

  return (
    <div className="data-health data-health-warning" role="status">
      <strong>Data health warning</strong>
      <ul>
        {dataMode !== 'full' && (
          <li>Static projection/ADP data is in &quot;{dataMode}&quot; mode.</li>
        )}
        {freshness.isStale && (
          <li>Live draft data is stale{freshness.dataAgeMs != null ? ` (${Math.round(freshness.dataAgeMs / 1000)}s old)` : ''}.</li>
        )}
        {liveFailures > 0 && (
          <li>
            {liveFailures} consecutive poll failure{liveFailures === 1 ? '' : 's'}
            {liveError instanceof Error ? `: ${liveError.message}` : ''}.
          </li>
        )}
        {duplicates.length > 0 && (
          <li>{duplicates.length} player(s) appear drafted more than once: {duplicates.join(', ')}.</li>
        )}
        {scoringDiagnostics?.map((diagnostic) => (
          <li key={diagnostic}>{diagnostic}</li>
        ))}
      </ul>
    </div>
  );
}
