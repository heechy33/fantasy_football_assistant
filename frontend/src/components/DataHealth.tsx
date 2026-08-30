import { useEffect, useState, type RefObject } from 'react';
import type { DataManifest, Pick } from '../../../shared/types';
import { resolveDataMode, type DataMode } from '../data/dataHealth';
import type { AdpFormat } from '../data/loadPlayerPool';
import { computeStaleness, type PollHealth } from '../hooks/useDraftPoll';
import type { ActiveProvider } from '../session/activeProvider';

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
  activeProvider: ActiveProvider;
  /** Draft-day honesty: unmodeled custom-scoring categories, rendered as banner items. */
  scoringDiagnostics?: string[];
  /** Bridge sessions only (2026-08-29): a raw view of the extension's captured live stream, so a
   * board-numbering disagreement is diagnosable directly instead of by inference — the exact fields
   * that would have named the "duplicate pick / stuck on an abandoned draft" bug in seconds. */
  espnCapture?: EspnCaptureSummary | null;
}

export interface EspnCaptureSummary {
  leagueId: string | null;
  epoch: number;
  resetReason: string | null;
  streamPicks: number;
  detailPicks: number;
  detailIdentified: number;
  domPicks: number;
  currentPickNumber: number | null;
  offsetSource: string | null;
  offsetValue: number | null;
  offsetConfirmed: boolean;
  offsetReason: string | null;
  onReset: () => void;
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
  espnCapture,
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

  return (
    <>
      {isHealthy ? (
        <p className="data-health data-health-ok">Data healthy — static data full, live poll current.</p>
      ) : (
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
      )}
      {espnCapture && <EspnCapturePanel capture={espnCapture} />}
    </>
  );
}

/** Collapsible raw view of the extension's captured live stream — see `DataHealthProps.espnCapture`'s
 * doc. Closed by default so it never adds visual weight to the healthy path; the numbers it shows
 * are read straight off the snapshot, not re-derived, so they can never disagree with the board. */
function EspnCapturePanel({ capture }: { capture: EspnCaptureSummary }) {
  return (
    <details className="data-health-espn-capture">
      <summary>ESPN capture</summary>
      <dl>
        <dt>League</dt>
        <dd>{capture.leagueId ?? '—'}</dd>
        <dt>Epoch / reset reason</dt>
        <dd>{capture.epoch}{capture.resetReason ? ` (${capture.resetReason})` : ''}</dd>
        <dt>Stream picks</dt>
        <dd>{capture.streamPicks}</dd>
        <dt>Detail picks</dt>
        <dd>{capture.detailPicks} ({capture.detailIdentified} identified)</dd>
        <dt>DOM picks</dt>
        <dd>{capture.domPicks}</dd>
        <dt>Current pick #</dt>
        <dd>{capture.currentPickNumber ?? '—'}</dd>
        <dt>Offset</dt>
        <dd>
          {capture.offsetConfirmed
            ? `${capture.offsetValue} (${capture.offsetSource})`
            : `unconfirmed${capture.offsetReason ? ` — ${capture.offsetReason}` : ''}`}
        </dd>
      </dl>
      <button type="button" className="quiet-button" onClick={capture.onReset}>Reset ESPN capture</button>
    </details>
  );
}
