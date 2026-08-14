import { useEffect, useMemo, useState } from 'react';
import type { Position } from '../../../shared/types';
import { formatCell, type GameLogRow } from '../data/weeklyGameLog';
import { WEEKLY_STAT_COLUMNS, type WeeklyStatColumnSpec } from '../data/weeklyStatColumns';

export type WeeklyChartStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface WeeklyChartProps {
  /** Always 18 rows, from `buildGameLogRows` -- the same rows `WeeklyStatGrid` renders. */
  rows: GameLogRow[];
  season: number | null;
  position: Position | null;
  status: WeeklyChartStatus;
  playerName: string;
}

const WEEK_COUNT = 18;
const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 250;
const MARGIN_TOP = 16;
const MARGIN_RIGHT = 14;
const MARGIN_BOTTOM = 26;
const MARGIN_LEFT = 46;

/** Round a positive value up to a "1-2-5" nice number so axis ticks read cleanly. */
function niceMax(value: number): number {
  if (value <= 0 || !Number.isFinite(value)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const norm = value / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

/** 1-2-5 step for a target interval, so gridlines land on clean numbers. */
function niceStep(target: number): number {
  if (target <= 0 || !Number.isFinite(target)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

/** Y-axis gridlines at a 1-2-5 step across the domain, including 0 when it's in range. */
function buildTicks(domainMin: number, domainMax: number): number[] {
  const step = niceStep((domainMax - domainMin) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(domainMin / step) * step; v <= domainMax + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return String(Number(value.toFixed(1)));
}

function placeholderLabel(status: WeeklyChartStatus, rows: GameLogRow[]): string | null {
  switch (status) {
    case 'idle': return 'Weekly stats';
    case 'loading': return 'Loading weekly stats…';
    case 'unavailable': return 'Weekly stats unavailable';
    case 'ready': return rows.every((row) => row.kind !== 'played') ? 'No weekly scoring data for this player' : null;
    default: return 'Weekly stats';
  }
}

/** Chartable columns for a position: anything numeric that isn't the rank (`fin`) or `opp`. */
function chartableSpecs(position: Position | null): WeeklyStatColumnSpec[] {
  if (position == null) return [];
  return (WEEKLY_STAT_COLUMNS[position] ?? []).filter(
    (spec) => spec.format !== 'text' && spec.key !== 'opp' && spec.key !== 'fin',
  );
}

/**
 * The Weekly tab's graph view: an interactive, hand-rolled SVG bar chart of one
 * stat across all 18 weeks (FPTS by default, switchable via the metric select).
 * Replaces the old 44px sparkline strip. No chart library -- same constraint as
 * the code it replaces.
 *
 * Interactivity: hovering or focusing a week highlights its bar and shows an
 * in-chart tooltip (week, opponent, value); the legend semantics are preserved
 * from the sparkline (a blank week is a bye/inactive, a dashed tick means that
 * week's data never fetched, a scored-zero week is a stub bar).
 */
export function WeeklyChart({ rows, season, position, status, playerName }: WeeklyChartProps) {
  const [metric, setMetric] = useState('pts');
  const [hovered, setHovered] = useState<number | null>(null);

  const specs = useMemo(() => chartableSpecs(position), [position]);
  const spec = specs.find((s) => s.key === metric) ?? specs.find((s) => s.key === 'pts');

  // If the position's spec list changes (different player tab), fall back to FPTS.
  useEffect(() => {
    if (metric !== 'pts' && !specs.some((s) => s.key === metric)) setMetric('pts');
  }, [metric, specs]);

  const placeholder = placeholderLabel(status, rows);
  if (placeholder || spec == null) {
    return (
      <div className="weekly-chart weekly-chart-empty">
        <p className="muted">{placeholder ?? 'Weekly stats unavailable for this position'}</p>
      </div>
    );
  }

  const points = rows
    .filter((row) => row.kind === 'played')
    .map((row) => {
      const cell = row.cells.find((c) => c.key === spec.key);
      return { row, raw: cell?.raw ?? null };
    })
    .filter((p) => p.raw != null) as { row: GameLogRow; raw: number }[];

  const rawValues = points.map((p) => p.raw);
  const minRaw = rawValues.length > 0 ? Math.min(0, ...rawValues) : 0;
  const maxRaw = rawValues.length > 0 ? Math.max(1, ...rawValues) : 1;
  const domainMax = niceMax(maxRaw);
  const domainMin = minRaw < 0 ? -niceMax(-minRaw) : 0;
  const range = domainMax - domainMin || 1;

  const plotWidth = VIEW_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const plotHeight = VIEW_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const bandWidth = plotWidth / WEEK_COUNT;
  const yFor = (value: number) => MARGIN_TOP + plotHeight - ((value - domainMin) / range) * plotHeight;
  const zeroY = yFor(0);
  const average = rawValues.length > 0 ? rawValues.reduce((sum, v) => sum + v, 0) / rawValues.length : null;
  const ticks = buildTicks(domainMin, domainMax);

  const hoveredPoint = hovered != null ? points.find((p) => p.row.week === hovered) : null;

  return (
    <div className="weekly-chart">
      <div className="weekly-chart-header">
        <h4>{season != null ? `${season} weekly ${spec.header}` : `Weekly ${spec.header}`}</h4>
        <div className="weekly-chart-controls">
          <label className="weekly-chart-metric">
            <span className="visually-hidden">Stat to chart</span>
            <select value={spec.key} onChange={(event) => setMetric(event.target.value)} aria-label="Stat to chart">
              {specs.map((s) => (
                <option key={s.key} value={s.key}>{s.header}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <svg
        className="weekly-chart-svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`${playerName}'s weekly ${spec.header}${season != null ? ` for ${season}` : ''}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="weekly-chart-grid" x1={MARGIN_LEFT} y1={yFor(tick)} x2={VIEW_WIDTH - MARGIN_RIGHT} y2={yFor(tick)} />
            <text className="weekly-chart-axis" x={MARGIN_LEFT - 6} y={yFor(tick) + 3} textAnchor="end">{formatTick(tick)}</text>
          </g>
        ))}
        <line className="weekly-chart-baseline" x1={MARGIN_LEFT} y1={zeroY} x2={VIEW_WIDTH - MARGIN_RIGHT} y2={zeroY} />

        {average != null && average >= domainMin && average <= domainMax && (
          <line
            className="weekly-chart-avg-line"
            x1={MARGIN_LEFT}
            y1={yFor(average)}
            x2={VIEW_WIDTH - MARGIN_RIGHT}
            y2={yFor(average)}
            aria-hidden="true"
          />
        )}

        {rows.map((row) => {
          const bandX = MARGIN_LEFT + (row.week - 1) * bandWidth;
          const barX = bandX + bandWidth * 0.18;
          const barWidth = bandWidth * 0.64;
          const centerX = bandX + bandWidth / 2;

          if (row.kind === 'played') {
            const point = points.find((p) => p.row.week === row.week);
            if (point == null) {
              // Played but this stat has no value -- render a stub so the week stays visible.
              return (
                <line
                  key={row.week}
                  className="weekly-chart-empty-tick"
                  x1={centerX} y1={zeroY - 2} x2={centerX} y2={zeroY + 2}
                >
                  <title>{`Week ${row.week}: no ${spec.header} recorded`}</title>
                </line>
              );
            }
            const value = point.raw;
            const y = value === 0 ? zeroY - 2 : value > 0 ? yFor(value) : zeroY;
            const height = value === 0 ? 2 : value > 0 ? zeroY - yFor(value) : yFor(value) - zeroY;
            const isActive = hovered === row.week;
            return (
              <rect
                key={row.week}
                className={`weekly-chart-bar${value === 0 ? ' weekly-chart-bar-stub' : ''}${isActive ? ' weekly-chart-bar-active' : ''}`}
                data-position={position ?? undefined}
                x={barX} y={y} width={barWidth} height={Math.max(height, 0.5)} rx={2}
                tabIndex={0}
                onMouseEnter={() => setHovered(row.week)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(row.week)}
                onBlur={() => setHovered(null)}
              >
                <title>{`Week ${row.week} · ${row.opponent ?? '–'}: ${formatCell(value, spec.format)} ${spec.header}`}</title>
              </rect>
            );
          }

          if (row.kind === 'nodata') {
            return (
              <line
                key={row.week}
                className="weekly-chart-nodata-tick"
                x1={centerX - 3} y1={zeroY - 2} x2={centerX + 3} y2={zeroY + 2}
              >
                <title>{`Week ${row.week}: not fetched`}</title>
              </line>
            );
          }

          return (
            <line
              key={row.week}
              className="weekly-chart-empty-tick"
              x1={centerX} y1={zeroY - 2} x2={centerX} y2={zeroY + 2}
            >
              <title>{`Week ${row.week}: ${row.kind === 'bye' ? 'bye' : 'no game data'}`}</title>
            </line>
          );
        })}

        {/* X-axis week labels */}
        {rows.map((row) => (
          <text
            key={row.week}
            className="weekly-chart-axis"
            x={MARGIN_LEFT + (row.week - 1) * bandWidth + bandWidth / 2}
            y={VIEW_HEIGHT - 8}
            textAnchor="middle"
          >
            {row.week}
          </text>
        ))}

        {average != null && average >= domainMin && average <= domainMax && (
          <text
            className="weekly-chart-avg-label"
            x={VIEW_WIDTH - MARGIN_RIGHT - 2}
            y={yFor(average) - 4}
            textAnchor="end"
          >
            {`avg ${formatCell(average, spec.format)}`}
          </text>
        )}

        {/* In-chart hover tooltip */}
        {hoveredPoint != null && (() => {
          const centerX = MARGIN_LEFT + (hoveredPoint.row.week - 1) * bandWidth + bandWidth / 2;
          const value = hoveredPoint.raw;
          const barTop = Math.min(yFor(value), zeroY);
          const tooltipWidth = 116;
          const tooltipHeight = 38;
          const tx = Math.max(MARGIN_LEFT + tooltipWidth / 2 + 4, Math.min(centerX, VIEW_WIDTH - MARGIN_RIGHT - tooltipWidth / 2 - 4));
          let ty = barTop - tooltipHeight - 8;
          if (ty < MARGIN_TOP - 2) ty = barTop + 10;
          return (
            <g className="weekly-chart-tooltip" pointerEvents="none">
              <rect className="weekly-chart-tooltip-bg" x={tx - tooltipWidth / 2} y={ty} width={tooltipWidth} height={tooltipHeight} rx={6} />
              <text className="weekly-chart-tooltip-line" x={tx} y={ty + 14} textAnchor="middle">
                {`Wk ${hoveredPoint.row.week} · ${hoveredPoint.row.opponent ?? '–'}`}
              </text>
              <text className="weekly-chart-tooltip-value" x={tx} y={ty + 30} textAnchor="middle">
                {`${formatCell(value, spec.format)} ${spec.header}`}
              </text>
            </g>
          );
        })()}

      </svg>
    </div>
  );
}

