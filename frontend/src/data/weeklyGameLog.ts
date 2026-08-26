import type {
  PlayerId,
  PlayerWeeklyStatsArtifact,
  Position,
  WeeklyFantasyPoints,
  WeeklyStatBreakpoints,
} from '../../../shared/types';
import { WEEKLY_STAT_COLUMNS, type WeeklyStatFormat, type WeeklyStatPolarity } from './weeklyStatColumns';

const REGULAR_SEASON_WEEKS = 18;

export type GameLogRowKind = 'played' | 'bye' | 'inactive' | 'nodata';

export interface GameLogCell {
  key: string;
  display: string;
  heat: 1 | 2 | 3 | 4 | 5 | null;
  /** Raw numeric value for charting/tooltips; null for text columns (`opp`, `fin`). */
  raw: number | null;
}

export interface GameLogRow {
  week: number;
  kind: GameLogRowKind;
  opponent: string | null;
  /** Raw PPR points for a `played` week (including a genuine 0.0), else null.
   * Kept alongside `cells` (which only carries the formatted `display` string)
   * so a chart can plot this row without parsing a string back to a number. */
  pts: number | null;
  cells: GameLogCell[];
}

/**
 * Bucket a raw stat value against its position's [p20,p40,p60,p80] breakpoints.
 * A value exactly equal to a breakpoint lands in the HIGHER bucket (the `>=`
 * comparison below), matching the pipeline's documented boundary rule.
 * `lower-better` columns (pts allowed, interceptions thrown, ...) invert the
 * result so a low raw value still shades warm/green.
 */
export function heatBucket(
  value: number | null | undefined,
  breakpoints: WeeklyStatBreakpoints | null | undefined,
  polarity: WeeklyStatPolarity,
): 1 | 2 | 3 | 4 | 5 | null {
  if (value == null || !Number.isFinite(value) || breakpoints == null) return null;
  let raw = 1;
  for (const breakpoint of breakpoints) {
    if (value >= breakpoint) raw += 1;
  }
  const bucket = polarity === 'lower-better' ? 6 - raw : raw;
  return bucket as 1 | 2 | 3 | 4 | 5;
}

export function formatCell(raw: number | string | null | undefined, format: WeeklyStatFormat): string {
  if (raw == null) return 'n/a';
  if (format === 'text') return String(raw);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'n/a';
  if (format === 'dec1') return raw.toFixed(1);
  if (format === 'pct') return `${Math.round(raw)}%`;
  return String(Math.round(raw));
}

/**
 * All 18 regular-season week slots, always. A week's `kind` distinguishes four
 * cases that must never collapse into each other:
 *   - `nodata`  the pipeline's weekly fetch for that week failed (rendered `–`)
 *   - `bye`     the player's team had no game that week
 *   - `inactive` the week was fetched, the player just has no scoring row
 *                (didn't play, wasn't rostered yet, etc.)
 *   - `played`  a real row, including a genuine 0.0-point game
 * `nodata` must be checked first: a week absent from `weeksFetched` says
 * nothing about whether it was a bye, so treating it as one would silently
 * misrepresent a failed upstream fetch as real schedule data.
 */
export function buildGameLogRows(
  artifact: PlayerWeeklyStatsArtifact,
  playerId: PlayerId,
  position: Position | null,
): GameLogRow[] {
  if (position == null) return [];
  const series = artifact.players[playerId];
  const columns = artifact.columns[position] ?? [];
  const specs = WEEKLY_STAT_COLUMNS[position] ?? [];
  const heatByColumn = artifact.heat[position] ?? {};
  const weeksFetched = new Set(artifact.weeksFetched);
  const columnIndex = new Map(columns.map((key, index) => [key, index + 1])); // +1: row[0] is week

  const rowsByWeek = new Map<number, PlayerWeeklyStatsArtifact['players'][string]['w'][number]>();
  if (series && series.p === position) {
    for (const row of series.w) rowsByWeek.set(row[0] as number, row);
  }
  const bye = series?.p === position ? series.bye : null;

  const ptsIndex = columnIndex.get('pts');

  const rows: GameLogRow[] = [];
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week += 1) {
    if (!weeksFetched.has(week)) {
      rows.push({ week, kind: 'nodata', opponent: null, pts: null, cells: [] });
      continue;
    }

    const row = rowsByWeek.get(week);
    if (!row) {
      rows.push({
        week,
        kind: bye === week ? 'bye' : 'inactive',
        opponent: null,
        pts: null,
        cells: [],
      });
      continue;
    }

    const opponentIndex = columnIndex.get('opp');
    const opponent = opponentIndex != null ? (row[opponentIndex] as string | null) : null;
    const ptsRaw = ptsIndex != null ? row[ptsIndex] : null;
    const pts = typeof ptsRaw === 'number' && Number.isFinite(ptsRaw) ? ptsRaw : null;

    const cells: GameLogCell[] = [];
    for (const spec of specs) {
      if (spec.key === 'opp') continue; // surfaced via `opponent`, not rendered as a cell
      const index = columnIndex.get(spec.key);
      const raw = index != null ? row[index] : null;
      const display = spec.key === 'fin' && typeof raw === 'number' ? `${position}${raw}` : formatCell(raw, spec.format);
      cells.push({
        key: spec.key,
        display,
        heat: spec.shade ? heatBucket(typeof raw === 'number' ? raw : null, heatByColumn[spec.key], spec.polarity) : null,
        raw: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
      });
    }
    rows.push({ week, kind: 'played', opponent, pts, cells });
  }
  return rows;
}

export interface RecentGame {
  week: number;
  opponent: string | null;
  points: number;
}

/** Only `played` weeks -- the same no-zero-fill contract the old WeeklyPointsChart
 * enforced against `weekly-ppr.json` (a missing week is never assumed to be a 0). */
export function buildSparklinePoints(
  artifact: PlayerWeeklyStatsArtifact,
  playerId: PlayerId,
): WeeklyFantasyPoints[] {
  const series = artifact.players[playerId];
  if (!series) return [];
  const columns = artifact.columns[series.p] ?? [];
  const ptsIndex = columns.indexOf('pts');
  if (ptsIndex < 0) return [];
  const points: WeeklyFantasyPoints[] = [];
  for (const row of series.w) {
    const value = row[ptsIndex + 1];
    if (typeof value === 'number' && Number.isFinite(value)) {
      points.push({ week: row[0] as number, pointsPpr: value });
    }
  }
  return points;
}
