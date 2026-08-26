import { useMemo } from 'react';
import type {
  AdpEntry,
  PlayerMeta,
  ProviderProjectionsArtifact,
  ScoringMap,
} from '../../../shared/types';
import { PROVIDER_BRANDS, type ProviderBrandKey } from '../data/providerBrand';
import { scoreStats } from '../engine/scoring';
import { ProviderBadge } from './ProviderBadge';

export interface BoardAdpAnchor {
  adp: number;
  /** Which upstream actually produced the board's committed ADP (Sleeper / FFC fallback / ESPN).
   * Kept as a free string (not just the brand key) because it carries nuance a brand key can't,
   * e.g. "Sleeper (ESPN board tail)". */
  source: string;
  /** Brand key for the logo badge on this tile — always resolvable to one of the real upstreams
   * ('sleeper' | 'espn' | 'ffc'), never a synthetic key. */
  brandKey: ProviderBrandKey;
}

/** Underdog's best-ball ADP for this player — a separate best-ball, half-PPR, TE-premium lane,
 * never blended into the engine board or the redraft composites (`pipeline/underdog_adp.py`).
 * Deliberately a plain number, not a `BoardAdpAnchor`: it carries none of the redraft board's
 * range/positional-rank context, and showing that shape here would imply a second opinion on
 * redraft value rather than a different format entirely. */
export interface UnderdogAdpAnchor {
  adp: number;
}

/** The engine's projected points for this player (FFToday scored in the user's league). */
export interface FftodayAnchor {
  points: number | null;
  source: string;
}

interface PlayerMarketComparisonProps {
  boardAdp?: BoardAdpAnchor | null;
  underdogAdp?: UnderdogAdpAnchor | null;
  /** Display-only comparison ADP lanes beyond the active board (ESPN PPR, FFC mock drafts —
   * see `useProviderAdpBoards`). Each renders one tile; a player absent from a lane's board
   * shows an em dash rather than silently dropping the tile, so sparse coverage (FFC is
   * ~267 rows vs Sleeper's ~1500) stays visible instead of looking like a broken load. */
  providerAdpLanes?: ReadonlyArray<{
    key: string;
    label: string;
    brandKey: ProviderBrandKey;
    entries: readonly AdpEntry[];
  }>;
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
  /** `'engine'` for the single FFToday row (the number the recommendation engine actually uses,
   * scored in this league); `'provider'` for the display-only Sleeper/ESPN/CBS rows. Drives the
   * same `data-role="engine"` bold/quiet treatment the ADP tile above already uses. */
  role: 'engine' | 'provider';
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
 * A real market-ADP readout (the engine board number + its source, plus Underdog's separate
 * best-ball number when available) and a plain per-provider projections number tile grid —
 * the engine's own FFToday number first — for the Overview tab. Display-only: never an engine
 * input. Both sections are read-at-a-glance grids of numbers — each entry is a compact tile
 * (badge + name above, value below) laid out horizontally with a wrapping responsive grid.
 * Renders nothing when neither anchor/artifact has a row.
 */
export function PlayerMarketComparison({
  boardAdp,
  underdogAdp,
  providerAdpLanes = [],
  projectionsArtifact,
  player,
  scoring,
  fftoday,
}: PlayerMarketComparisonProps) {
  const projectionBuild = useMemo(
    () => buildProjectionRows(projectionsArtifact, player, scoring, fftoday),
    [projectionsArtifact, player, scoring, fftoday],
  );
  // One tile per comparison lane; `undefined` (player has no row on that board) renders as an
  // em dash — honest absence, not a dropped provider.
  const laneValues = providerAdpLanes.map((lane) => ({
    ...lane,
    adp: lane.entries.find((entry) => entry.playerId === player.playerId)?.adp,
  }));

  const hasAdp = boardAdp != null;
  if (!hasAdp && projectionBuild.rows.length === 0 && projectionBuild.caption === '') return null;

  return (
    <section className="market-comparison" aria-label="Market comparison">
      {hasAdp && (
        <div className="adp-summary">
          <h3>Market ADP</h3>
          <dl className="market-tile-grid">
            <div className="market-tile" data-role="engine">
              <dt className="market-tile-label">
                <ProviderBadge brandKey={boardAdp!.brandKey} size="sm" />
                <span className="market-tile-name">{boardAdp!.source}</span>
              </dt>
              <dd className="market-tile-value">{formatAdp(boardAdp!.adp)}</dd>
            </div>
            {laneValues.map((lane) => (
              <div key={lane.key} className="market-tile" data-role="provider" data-missing={lane.adp == null || undefined}>
                <dt className="market-tile-label">
                  <ProviderBadge brandKey={lane.brandKey} size="sm" />
                  <span className="market-tile-name">{lane.label}</span>
                </dt>
                <dd className="market-tile-value">{lane.adp != null ? formatAdp(lane.adp) : '\u2014'}</dd>
              </div>
            ))}
            {underdogAdp != null && (
              <div
                className="market-tile"
                data-role="provider"
                // Third-party attribution stays load-bearing (DECISIONS.md) but moves to the
                // accessible title/label instead of visible text or a prose note.
                title="Underdog best-ball ADP, republished by Sharp Football Analysis (a third party — Underdog exposes no public ADP API). A separate best-ball format, never blended into this board."
              >
                <dt className="market-tile-label">
                  <ProviderBadge brandKey="underdog" size="sm" />
                  <span className="market-tile-name">Underdog</span>
                </dt>
                <dd className="market-tile-value">{formatAdp(underdogAdp.adp)}</dd>
              </div>
            )}
          </dl>
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
                data-role={row.role}
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

function buildProjectionRows(
  artifact: ProviderProjectionsArtifact | null,
  player: PlayerMeta,
  scoring: ScoringMap,
  fftoday: FftodayAnchor | null,
): { rows: ProjectionRow[]; caption: string; hasScoring: boolean } {
  const hasScoring = Object.values(scoring).some((weight) => Number.isFinite(weight) && weight !== 0);

  // The engine row doesn't depend on the display-only providers artifact at all — it's the
  // recommendation's own `projectedPoints`, already scored in this league. It renders whenever
  // that number exists, even with no provider artifact loaded or no row for this player in it.
  const engineRows: ProjectionRow[] = fftoday?.points != null
    ? [{ key: 'fftoday', label: brandLabel('fftoday'), points: fftoday.points, stale: false, role: 'engine' }]
    : [];

  const providerStats = artifact?.players[player.playerId];
  if (artifact == null || !providerStats) {
    return engineRows.length > 0
      ? { rows: engineRows, caption: '', hasScoring }
      : { rows: [], caption: '', hasScoring: false };
  }

  const providers = artifact.providers.filter((provider) => {
    if (provider.status === 'error' || provider.rows === 0) return false;
    return providerStats[provider.key] != null;
  });
  if (providers.length === 0 && engineRows.length === 0) {
    return { rows: [], caption: '', hasScoring };
  }

  const providerRows: ProjectionRow[] = providers.flatMap((provider) => {
    const stats = providerStats[provider.key];
    if (stats == null) return [];
    const diagnostics = scoreStats(stats, scoring, player.position);
    return [{
      key: provider.key,
      label: brandLabel(provider.key),
      points: diagnostics.points,
      stale: provider.status === 'stale',
      role: 'provider' as const,
    }];
  });

  const caption = hasScoring
    ? ''
    : "This league's scoring settings aren't available, so provider points can't be computed — shown as raw stat comparison only.";

  return { rows: [...engineRows, ...providerRows], caption, hasScoring };
}
