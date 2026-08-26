import type { PlayerMeta, PlayerWeeklyStatsArtifact, PlayerWeeklyStatSeries } from '../../../shared/types';
import { formatMetric, percentileOf, type PercentileGroup, type PercentileRankings } from './percentileRankings';
import { columnValues, mean, sum } from './weeklyRoleColumns';

/**
 * STACKED-style QB percentile rankings for the Role panel and the card-bottom role stats —
 * the QB counterpart to `percentileRankings.ts`'s RB/WR/TE view (2026-08-25 user request:
 * "create a percentile ranking for QBs", mirroring the app.fantasyplaybook.ai STACKED layout
 * they pasted). QB passing/rushing numbers don't exist in `player-usage.json` (its opportunity
 * builder has no passing/defense fields by design — see `weeklyRoleColumns.ts`'s provenance
 * note), so both the per-player AVG values and the cohort percentiles are computed from the
 * weekly game log artifact (`weekly-stats.json`): each metric is the player's per-game mean
 * (or summed ratio) percent-ranked 0-100 within every QB with observed weeks in the artifact.
 *
 * Deliberately absent rather than approximated (the honesty rule `percentileRankings.ts`
 * established): Passing EPA and Rushing EPA — the weekly artifact carries no EPA columns.
 *
 * Pure: no fetching, no mutation. A stale/absent/thin artifact (fewer than MIN_COHORT QBs
 * with weeks) degrades to `null`, never a fabricated rank.
 */

/** Below this many QBs with observed weeks, a percentile is noise — same floor as
 * `percentileRankings.ts`'s MIN_COHORT. */
const MIN_COHORT = 5;

interface QbMetricSpec {
  key: string;
  label: string;
  /** Weekly column key in `artifact.columns.QB`. */
  column: string;
  /** `mean` → per-game average over appearance weeks; `sum` → season total. */
  aggregate: 'mean' | 'sum';
  /** When set, the value is sum(column) / sum(denominatorColumn) — a season-long rate. */
  denominatorColumn?: string;
  /** true → the value is a 0-1 fraction displayed as a percentage. */
  share?: boolean;
  /** true → a season-long ratio rather than a per-game average. */
  ratio?: boolean;
}

type QbMetricKey =
  | 'fantasyPoints' | 'attempts' | 'completions' | 'passingYards' | 'passingTds' | 'interceptions'
  | 'cmpPct' | 'yardsPerAttempt' | 'airYards' | 'sacksTaken'
  | 'carries' | 'rushingYards' | 'rushingTds';

const METRICS: Readonly<Record<QbMetricKey, QbMetricSpec>> = {
  fantasyPoints: { key: 'fantasyPoints', label: 'Fantasy Points', column: 'pts', aggregate: 'mean' },
  attempts: { key: 'attempts', label: 'Attempts', column: 'pass_att', aggregate: 'mean' },
  completions: { key: 'completions', label: 'Completions', column: 'pass_cmp', aggregate: 'mean' },
  passingYards: { key: 'passingYards', label: 'Passing Yards', column: 'pass_yd', aggregate: 'mean' },
  passingTds: { key: 'passingTds', label: 'Passing TDs', column: 'pass_td', aggregate: 'mean' },
  interceptions: { key: 'interceptions', label: 'Interceptions', column: 'pass_int', aggregate: 'mean' },
  cmpPct: {
    key: 'cmpPct', label: 'Cmp%', column: 'pass_cmp', aggregate: 'mean',
    denominatorColumn: 'pass_att', share: true, ratio: true,
  },
  yardsPerAttempt: { key: 'yardsPerAttempt', label: 'Yards / Attempt', column: 'pass_ypa', aggregate: 'mean', ratio: true },
  airYards: { key: 'airYards', label: 'Air Yards', column: 'pass_air_yd', aggregate: 'mean' },
  sacksTaken: { key: 'sacksTaken', label: 'Sacks Taken', column: 'pass_sack', aggregate: 'mean' },
  carries: { key: 'carries', label: 'Carries', column: 'rush_att', aggregate: 'mean' },
  rushingYards: { key: 'rushingYards', label: 'Rushing Yards', column: 'rush_yd', aggregate: 'mean' },
  rushingTds: { key: 'rushingTds', label: 'Rushing TDs', column: 'rush_td', aggregate: 'mean' },
};

/**
 * Group layout mirrors the user's STACKED example (Fantasy / Passing Volume / Passing
 * Efficiency / Pressure / Rushing) minus the EPA rows our data cannot source.
 */
const QB_GROUPS: ReadonlyArray<{ id: string; label: string; metrics: readonly QbMetricKey[] }> = [
  { id: 'fantasy', label: 'Fantasy', metrics: ['fantasyPoints'] },
  { id: 'passing-volume', label: 'Passing Volume', metrics: ['attempts', 'completions', 'passingYards', 'passingTds', 'interceptions'] },
  { id: 'passing-efficiency', label: 'Passing Efficiency', metrics: ['cmpPct', 'yardsPerAttempt', 'airYards'] },
  { id: 'pressure', label: 'Pressure', metrics: ['sacksTaken'] },
  { id: 'rushing', label: 'Rushing', metrics: ['carries', 'rushingYards', 'rushingTds'] },
];

function metricValue(series: PlayerWeeklyStatSeries, columns: string[], metric: QbMetricSpec): number | null {
  if (metric.denominatorColumn != null) {
    const denominator = sum(columnValues(series, columns, metric.denominatorColumn));
    return denominator > 0 ? sum(columnValues(series, columns, metric.column)) / denominator : null;
  }
  const values = columnValues(series, columns, metric.column);
  if (values.length === 0) return null;
  return metric.aggregate === 'sum' ? sum(values) : mean(values);
}

/**
 * Build the QB percentile groups for one player, or null when the panel/card shouldn't render
 * them: a non-QB player, no QB column map, no weekly series for the player, or a cohort thinner
 * than MIN_COHORT (callers fall back to the weekly game-log columns — never a fabricated rank).
 */
export function buildQbPercentileRankings(input: {
  player: PlayerMeta;
  artifact: PlayerWeeklyStatsArtifact;
}): PercentileRankings | null {
  if (input.player.position !== 'QB') return null;
  const columns = input.artifact.columns.QB;
  if (columns == null) return null;
  const self = input.artifact.players[input.player.playerId];
  if (self == null || self.p !== 'QB' || self.w.length === 0) return null;

  // Cohort: every QB in the artifact with at least one observed week — the artifact is the
  // committed league-wide game log, so this is the full position cohort, not just the board.
  const cohort: PlayerWeeklyStatSeries[] = Object.values(input.artifact.players)
    .filter((series) => series.p === 'QB' && series.w.length > 0);
  if (!cohort.includes(self)) cohort.push(self);
  if (cohort.length < MIN_COHORT) return null;

  const groups: PercentileGroup[] = QB_GROUPS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    stats: spec.metrics.map((metricKey) => {
      const metric = METRICS[metricKey];
      const value = metricValue(self, columns, metric);
      const display = value == null ? null : formatMetric(value, metric.share);
      let percentile: number | null = null;
      if (value != null) {
        const cohortValues = cohort
          .map((series) => metricValue(series, columns, metric))
          .filter((candidate): candidate is number => candidate != null);
        if (cohortValues.length >= MIN_COHORT) percentile = percentileOf(cohortValues, value);
      }
      return { key: metric.key, label: metric.label, display, percentile, ratio: metric.ratio };
    }),
  }));
  return { cohortSize: cohort.length, groups };
}

