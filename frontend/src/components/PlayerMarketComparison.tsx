import { useMemo } from 'react';
import type {
  FantasyProsAdpArtifact,
  PlayerId,
  PlayerMeta,
  ProviderProjectionsArtifact,
  ScoringMap,
} from '../../../shared/types';
import { PROVIDER_BRANDS, type ProviderBrandKey } from '../data/providerBrand';
import { scoreStats } from '../engine/scoring';
import { ProviderBadge } from './ProviderBadge';

export interface BoardAdpAnchor {
  adp: number;
  /** Which upstream actually produced the board's committed ADP (Sleeper / FFC fallback). */
  source: string;
}

/** The engine's projected points for this player (FFToday scored in the user's league). */
export interface FftodayAnchor {
  points: number | null;
  source: string;
}

interface PlayerMarketComparisonProps {
  adpArtifact: FantasyProsAdpArtifact | null;
  playerId: PlayerId;
  boardAdp?: BoardAdpAnchor | null;
  /** Current overall pick, shown as plain context next to Engine ADP. Undefined
   * when no draft is connected; the headline says n/a rather than guessing. */
  currentPick?: number | null;
  projectionsArtifact: ProviderProjectionsArtifact | null;
  player: PlayerMeta;
  scoring: ScoringMap;
  fftoday: FftodayAnchor | null;
}

interface ProjectionRow {
  key: string;
  label: string;
  points: number;
  stale: boolean;
}

interface AdpSourceRow {
  key: string;
  label: string;
  value: number;
  role: 'provider' | 'consensus' | 'engine';
  brandKey: string;
}

function formatAdp(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function brandLabel(key: string): string {
  return PROVIDER_BRANDS[key as ProviderBrandKey]?.label ?? key;
}

/**
 * ADP-by-source tiles plus a plain per-provider projections number tile grid
 * for the Overview tab. Display-only: never an engine input. Both sections are
 * read-at-a-glance grids of numbers — each provider is a compact tile (badge +
 * name above, value below) laid out horizontally with a wrapping responsive
 * grid, no dot plots or derived spread captions.
 * Renders nothing when neither artifact/anchor has a row.
 */
export function PlayerMarketComparison({
  adpArtifact,
  playerId,
  boardAdp,
  currentPick,
  projectionsArtifact,
  player,
  scoring,
  fftoday,
}: PlayerMarketComparisonProps) {
  const adpRows = useMemo(() => buildAdpRows(adpArtifact, playerId), [adpArtifact, playerId]);
  const projectionBuild = useMemo(
    () => buildProjectionRows(projectionsArtifact, player, scoring, fftoday),
    [projectionsArtifact, player, scoring, fftoday],
  );

  const hasAdp = adpRows.length > 0 || boardAdp != null;
  if (!hasAdp && projectionBuild.rows.length === 0 && projectionBuild.caption === '') return null;

  return (
    <section className="market-comparison" aria-label="Market comparison">
      {hasAdp && (
        <div className="adp-summary">
          <h3>Market ADP</h3>
          {boardAdp != null && (
            <p className="adp-headline">
              Engine ADP {formatAdp(boardAdp.adp)}
              {currentPick != null ? <> · current pick {currentPick}</> : <> · current pick n/a</>}
            </p>
          )}
          {adpRows.length > 0 && (
            <dl className="market-tile-grid">
              {adpRows.map((row) => (
                <div key={row.key} className="market-tile" data-role={row.role}>
                  <dt className="market-tile-label">
                    <ProviderBadge brandKey={row.brandKey} size="sm" />
                    <span className="market-tile-name">{row.label}</span>
                  </dt>
                  <dd className="market-tile-value">{formatAdp(row.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {projectionBuild.hasScoring && projectionBuild.rows.length > 0 && (
        <div className="projection-summary">
          <h3>Projections</h3>
          <dl className="market-tile-grid">
            {projectionBuild.rows.map((row) => (
              <div
                key={row.key}
                className="market-tile"
                data-role="provider"
                data-stale={row.stale || undefined}
              >
                <dt className="market-tile-label">
                  <ProviderBadge brandKey={row.key} size="sm" />
                  <span className="market-tile-name">
                    {row.label}
                    {row.stale && <small className="provider-note">stale</small>}
                  </span>
                </dt>
                <dd className="market-tile-value">{formatPoints(row.points)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {!projectionBuild.hasScoring && projectionBuild.caption !== '' && (
        <p className="range-plot-caption">{projectionBuild.caption}</p>
      )}
    </section>
  );
}

function buildAdpRows(
  artifact: FantasyProsAdpArtifact | null,
  playerId: PlayerId,
): AdpSourceRow[] {
  const rows: AdpSourceRow[] = [];
  const row = artifact?.players[playerId];
  if (row?.adp) {
    for (const [key, value] of Object.entries(row.adp)) {
      rows.push({ key, label: brandLabel(key), value, role: 'provider', brandKey: key });
    }
    if (row.avg != null && rows.length > 0) {
      rows.push({
        key: 'fantasypros',
        label: artifact!.consensus.label,
        value: row.avg,
        role: 'consensus',
        brandKey: 'fantasypros',
      });
    }
  }
  return rows.sort((a, b) => a.value - b.value);
}

function buildProjectionRows(
  artifact: ProviderProjectionsArtifact | null,
  player: PlayerMeta,
  scoring: ScoringMap,
  fftoday: FftodayAnchor | null,
): { rows: ProjectionRow[]; caption: string; hasScoring: boolean } {
  if (artifact == null) return { rows: [], caption: '', hasScoring: false };
  const providerStats = artifact.players[player.playerId];
  if (!providerStats) return { rows: [], caption: '', hasScoring: false };

  const hasScoring = Object.values(scoring).some((weight) => Number.isFinite(weight) && weight !== 0);
  const providers = artifact.providers.filter((provider) => {
    if (provider.status === 'error' || provider.rows === 0) return false;
    return providerStats[provider.key] != null;
  });
  if (providers.length === 0 && fftoday?.points == null) {
    return { rows: [], caption: '', hasScoring };
  }

  const rows: ProjectionRow[] = providers.flatMap((provider) => {
    const stats = providerStats[provider.key];
    if (stats == null) return [];
    const diagnostics = scoreStats(stats, scoring, player.position);
    return [{
      key: provider.key,
      label: brandLabel(provider.key),
      points: diagnostics.points,
      stale: provider.status === 'stale',
    }];
  });

  const caption = hasScoring
    ? ''
    : "This league's scoring settings aren't available, so provider points can't be computed — shown as raw stat comparison only.";

  return { rows, caption, hasScoring };
}
