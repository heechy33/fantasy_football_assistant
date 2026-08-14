import type { PlayerWeeklyStatSeries, Position } from '../../../shared/types';
import { deltaTone, formatCount, formatWhole, type RoleColumn, type RoleStat } from './roleColumn';

/**
 * QB/K/DEF role columns for the player-detail role panel, built entirely from
 * the weekly game log rather than the season `opportunity` aggregate RB/WR/TE
 * use (see playerRole.ts). This is a deliberate provenance split, not an
 * oversight: `player-usage.json`'s opportunity builder nulls QB target share
 * on purpose (pipeline/context.py) and has no passing/kicking/defense fields
 * at all, so weekly is the only source that can populate these positions
 * without a pipeline/artifact schema change. The cost is that these columns
 * can express per-game rates ("22 att/g") but not season *shares* ("38% of
 * team air yards") -- share denominators live only in the opportunity path.
 * Display-only, same as playerRole.ts: nothing here feeds planValue,
 * or any sort comparator.
 */

const FORM_WINDOW = 5;

function columnValues(series: PlayerWeeklyStatSeries, columns: string[], key: string): number[] {
  const index = columns.indexOf(key);
  if (index < 0) return [];
  const values: number[] = [];
  for (const row of series.w) {
    const value = row[index + 1];
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  return values;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(numerator: number[], denominator: number[]): number | null {
  const denom = sum(denominator);
  return denom > 0 ? (100 * sum(numerator)) / denom : null;
}

function clamp01(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function capFill(value: number | null, cap: number): number | null {
  return value == null ? null : clamp01(value / cap);
}

function rateLabel(value: number | null, elite: number, strong: number): string {
  if (value == null) return 'Unavailable';
  if (value >= elite) return 'Elite';
  if (value >= strong) return 'Strong';
  if (value >= strong / 2) return 'Average';
  return 'Limited';
}

function formRating(delta: number | null): string {
  if (delta == null) return 'Unavailable';
  if (delta >= 2) return 'Rising';
  if (delta <= -2) return 'Falling';
  return 'Steady';
}

function seasonPpg(series: PlayerWeeklyStatSeries, columns: string[]): number | null {
  return mean(columnValues(series, columns, 'pts'));
}

function last5Ppg(series: PlayerWeeklyStatSeries, columns: string[]): number | null {
  const values = columnValues(series, columns, 'pts');
  return mean(values.slice(-FORM_WINDOW));
}

function formColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const seasonAvg = seasonPpg(series, columns);
  const recentAvg = last5Ppg(series, columns);
  const delta = seasonAvg != null && recentAvg != null ? recentAvg - seasonAvg : null;
  const stats: RoleStat[] = [
    {
      label: `Last ${FORM_WINDOW} PPR/g`,
      display: recentAvg == null ? 'n/a' : recentAvg.toFixed(1),
      fill: capFill(recentAvg, 30),
      delta: delta == null ? undefined : {
        text: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`,
        tone: deltaTone(delta),
      },
    },
    {
      label: 'Season PPR/g',
      display: seasonAvg == null ? 'n/a' : seasonAvg.toFixed(1),
      fill: capFill(seasonAvg, 30),
    },
  ];
  return {
    id: 'form',
    label: 'Form',
    rating: formRating(delta),
    fill: capFill(recentAvg, 30),
    result: `Last ${Math.min(FORM_WINDOW, columnValues(series, columns, 'pts').length)} observed games`,
    stats,
  };
}

function qbPassingColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const attPerGame = mean(columnValues(series, columns, 'pass_att'));
  const ydPerGame = mean(columnValues(series, columns, 'pass_yd'));
  const tdPerGame = mean(columnValues(series, columns, 'pass_td'));
  const intPerGame = mean(columnValues(series, columns, 'pass_int'));
  return {
    id: 'passing',
    label: 'Passing',
    rating: rateLabel(ydPerGame, 260, 200),
    fill: capFill(ydPerGame, 300),
    stats: [
      { label: 'Pass yd/g', display: formatWhole(ydPerGame), fill: capFill(ydPerGame, 300) },
      { label: 'Att/g', display: formatCount(attPerGame), fill: capFill(attPerGame, 40) },
      {
        label: 'TD : INT',
        display: tdPerGame == null && intPerGame == null ? 'n/a' : `${formatCount(tdPerGame ?? 0)} : ${formatCount(intPerGame ?? 0)}`,
        fill: capFill(tdPerGame, 3),
      },
    ],
  };
}

function qbRushingColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const attPerGame = mean(columnValues(series, columns, 'rush_att'));
  const ydPerGame = mean(columnValues(series, columns, 'rush_yd'));
  const tdPerGame = mean(columnValues(series, columns, 'rush_td'));
  return {
    id: 'rushing',
    label: 'Rushing',
    rating: rateLabel(ydPerGame, 30, 15),
    fill: capFill(ydPerGame, 45),
    stats: [
      { label: 'Rush att/g', display: formatCount(attPerGame), fill: capFill(attPerGame, 10) },
      { label: 'Rush yd/g', display: formatWhole(ydPerGame), fill: capFill(ydPerGame, 45) },
      { label: 'Rush TD/g', display: formatCount(tdPerGame), fill: capFill(tdPerGame, 1) },
    ],
  };
}

function qbEfficiencyColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  // Completion percentage replaces the old snap-share stat: snap share is a usage
  // metric, not an efficiency one, and QB usage is better read from the volume
  // columns. Cmp% is computed from raw completions/attempts (same source the
  // artifact's `cmp_pct` column comes from) so it survives schema drift.
  const cmpPct = ratio(columnValues(series, columns, 'pass_cmp'), columnValues(series, columns, 'pass_att'));
  const ypa = mean(columnValues(series, columns, 'pass_ypa'));
  const airYdPerAtt = ratio(columnValues(series, columns, 'pass_air_yd'), columnValues(series, columns, 'pass_att')) as number | null;
  // `ratio` returns a percentage (×100); air yards/attempt is a plain per-attempt count.
  const airYdPerAttValue = airYdPerAtt == null ? null : airYdPerAtt / 100;
  const sacksPerGame = mean(columnValues(series, columns, 'pass_sack'));
  return {
    id: 'efficiency',
    label: 'Efficiency',
    rating: rateLabel(ypa, 8, 7),
    fill: capFill(ypa, 9),
    stats: [
      { label: 'Cmp%', display: cmpPct == null ? 'n/a' : `${cmpPct.toFixed(1)}%`, fill: capFill(cmpPct, 75) },
      { label: 'Yards/att', display: ypa == null ? 'n/a' : ypa.toFixed(1), fill: capFill(ypa, 9) },
      { label: 'Air yd/att', display: airYdPerAttValue == null ? 'n/a' : airYdPerAttValue.toFixed(1), fill: capFill(airYdPerAttValue, 9) },
      { label: 'Sacks taken/g', display: formatCount(sacksPerGame), fill: capFill(sacksPerGame, 4) },
    ],
  };
}

function kVolumeColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const fgaPerGame = mean(columnValues(series, columns, 'fga'));
  const xpaPerGame = mean(columnValues(series, columns, 'xpa'));
  return {
    id: 'kicking-volume',
    label: 'Volume',
    rating: rateLabel(fgaPerGame, 2.5, 1.5),
    fill: capFill(fgaPerGame, 3.5),
    stats: [
      { label: 'FGA/g', display: formatCount(fgaPerGame), fill: capFill(fgaPerGame, 3.5) },
      { label: 'XPA/g', display: formatCount(xpaPerGame), fill: capFill(xpaPerGame, 4) },
    ],
  };
}

function kAccuracyColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const fgPct = ratio(columnValues(series, columns, 'fgm'), columnValues(series, columns, 'fga'));
  const xpPct = ratio(columnValues(series, columns, 'xpm'), columnValues(series, columns, 'xpa'));
  return {
    id: 'accuracy',
    label: 'Accuracy',
    rating: rateLabel(fgPct, 90, 75),
    fill: capFill(fgPct, 100),
    stats: [
      { label: 'FG%', display: fgPct == null ? 'n/a' : `${fgPct.toFixed(1)}%`, fill: capFill(fgPct, 100) },
      { label: 'XP%', display: xpPct == null ? 'n/a' : `${xpPct.toFixed(1)}%`, fill: capFill(xpPct, 100) },
    ],
  };
}

function kDistanceColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const made50p = sum(columnValues(series, columns, 'fgm_50p'));
  const longs = columnValues(series, columns, 'fgm_lng');
  const long = longs.length > 0 ? Math.max(...longs) : null;
  const ydPerGame = mean(columnValues(series, columns, 'fgm_yds'));
  return {
    id: 'distance',
    label: 'Distance',
    rating: rateLabel(made50p, 5, 2),
    fill: capFill(made50p, 8),
    stats: [
      { label: '50+ makes', display: formatWhole(made50p), fill: capFill(made50p, 8) },
      { label: 'Long', display: formatWhole(long), fill: capFill(long, 60) },
      { label: 'FG yd/g', display: formatWhole(ydPerGame), fill: capFill(ydPerGame, 120) },
    ],
  };
}

function defPressureColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const sacksPerGame = mean(columnValues(series, columns, 'sack'));
  const hitsPerGame = mean(columnValues(series, columns, 'qb_hit'));
  return {
    id: 'pressure',
    label: 'Pressure',
    rating: rateLabel(sacksPerGame, 2.5, 1.5),
    fill: capFill(sacksPerGame, 4),
    stats: [
      { label: 'Sacks/g', display: formatCount(sacksPerGame), fill: capFill(sacksPerGame, 4) },
      { label: 'QB hits/g', display: formatCount(hitsPerGame), fill: capFill(hitsPerGame, 6) },
    ],
  };
}

function defTakeawaysColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const intPerGame = mean(columnValues(series, columns, 'int'));
  const frPerGame = mean(columnValues(series, columns, 'fum_rec'));
  const ffPerGame = mean(columnValues(series, columns, 'ff'));
  const takeawaysPerGame = (intPerGame ?? 0) + (frPerGame ?? 0);
  return {
    id: 'takeaways',
    label: 'Takeaways',
    rating: rateLabel(takeawaysPerGame, 1.5, 0.8),
    fill: capFill(takeawaysPerGame, 2),
    stats: [
      { label: 'INT/g', display: formatCount(intPerGame), fill: capFill(intPerGame, 1.5) },
      { label: 'Fum. rec./g', display: formatCount(frPerGame), fill: capFill(frPerGame, 1.5) },
      { label: 'Forced fum./g', display: formatCount(ffPerGame), fill: capFill(ffPerGame, 1.5) },
    ],
  };
}

function defPreventionColumn(series: PlayerWeeklyStatSeries, columns: string[]): RoleColumn {
  const ptsAllowedPerGame = mean(columnValues(series, columns, 'pts_allow'));
  const ydsAllowedPerGame = mean(columnValues(series, columns, 'yds_allow'));
  // Lower is better for both -- invert the fill so a stingy defense still reads "full".
  const fill = ptsAllowedPerGame == null ? null : clamp01(1 - ptsAllowedPerGame / 35);
  return {
    id: 'prevention',
    label: 'Prevention',
    rating: ptsAllowedPerGame == null ? 'Unavailable' : ptsAllowedPerGame <= 15 ? 'Elite' : ptsAllowedPerGame <= 21 ? 'Strong' : ptsAllowedPerGame <= 27 ? 'Average' : 'Limited',
    fill,
    stats: [
      // `fill` is pre-inverted above (1 = stingy/good) rather than carrying a
      // polarity flag -- RoleStat/StatBar have no polarity concept, so the
      // inversion has to happen here.
      { label: 'Pts allowed/g', display: formatCount(ptsAllowedPerGame), fill },
      {
        label: 'Yds allowed/g',
        display: formatWhole(ydsAllowedPerGame),
        fill: ydsAllowedPerGame == null ? null : clamp01(1 - ydsAllowedPerGame / 420),
      },
    ],
  };
}

/** Builds the position-appropriate weekly-derived RoleColumns. Returns `[]` for
 * a position this module doesn't cover (RB/WR/TE stay on the opportunity path
 * in playerRole.ts) or when there's no weekly series for this player at all. */
export function buildWeeklyRoleColumns(input: {
  position: Position;
  series: PlayerWeeklyStatSeries | undefined;
  columns: Record<string, string[]>;
}): RoleColumn[] {
  const { position, series } = input;
  if (series == null || series.p !== position) return [];
  const columns = input.columns[position];
  if (columns == null) return [];

  if (position === 'QB') {
    return [
      qbPassingColumn(series, columns),
      qbRushingColumn(series, columns),
      qbEfficiencyColumn(series, columns),
      formColumn(series, columns),
    ];
  }
  if (position === 'K') {
    return [
      kVolumeColumn(series, columns),
      kAccuracyColumn(series, columns),
      kDistanceColumn(series, columns),
      formColumn(series, columns),
    ];
  }
  if (position === 'DEF') {
    return [
      defPressureColumn(series, columns),
      defTakeawaysColumn(series, columns),
      defPreventionColumn(series, columns),
      formColumn(series, columns),
    ];
  }
  return [];
}
