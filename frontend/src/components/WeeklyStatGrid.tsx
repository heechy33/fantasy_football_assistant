import type { Position } from '../../../shared/types';
import type { GameLogRow } from '../data/weeklyGameLog';
import { WEEKLY_STAT_COLUMNS, WEEKLY_STAT_GROUP_LABEL, type WeeklyStatColumnSpec } from '../data/weeklyStatColumns';

export type WeeklyStatGridStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface WeeklyStatGridProps {
  /** Always 18 rows, from `buildGameLogRows`. */
  rows: GameLogRow[];
  /** Distinguishes "the whole fetch failed" (empty) from "fetched, this player has no rows". */
  weeksFetched: number[];
  position: Position | null;
  status: WeeklyStatGridStatus;
  season: number | null;
}

interface RenderedRow {
  week: number;
  kind: GameLogRow['kind'];
  opp: string;
  cells: string[];
  heats: (1 | 2 | 3 | 4 | 5 | null)[];
}

function renderRow(row: GameLogRow, statSpecs: WeeklyStatColumnSpec[]): RenderedRow {
  if (row.kind === 'played') {
    const byKey = new Map(row.cells.map((cell) => [cell.key, cell]));
    return {
      week: row.week,
      kind: row.kind,
      opp: row.opponent ?? 'n/a',
      cells: statSpecs.map((spec) => byKey.get(spec.key)?.display ?? 'n/a'),
      heats: statSpecs.map((spec) => byKey.get(spec.key)?.heat ?? null),
    };
  }
  if (row.kind === 'bye') {
    return { week: row.week, kind: row.kind, opp: 'BYE', cells: statSpecs.map(() => ''), heats: statSpecs.map(() => null) };
  }
  if (row.kind === 'nodata') {
    return { week: row.week, kind: row.kind, opp: '–', cells: statSpecs.map(() => '–'), heats: statSpecs.map(() => null) };
  }
  return { week: row.week, kind: row.kind, opp: '', cells: statSpecs.map(() => ''), heats: statSpecs.map(() => null) };
}

/** Groups consecutive same-group specs into [group, span] runs for the header's colSpan row. */
function groupRuns(specs: WeeklyStatColumnSpec[]): { group: string; label: string; span: number }[] {
  const runs: { group: string; label: string; span: number }[] = [];
  for (const spec of specs) {
    const last = runs[runs.length - 1];
    if (last && last.group === spec.group) {
      last.span += 1;
    } else {
      runs.push({ group: spec.group, label: WEEKLY_STAT_GROUP_LABEL[spec.group], span: 1 });
    }
  }
  return runs;
}

/**
 * The primary weekly view: an 18-row FantasyPros-style game log with a
 * position-appropriate stat set and league-relative heat shading (see
 * pipeline/weekly_stats.py's heat breakpoints). Five equal percentile buckets
 * map to a diverging ramp; the number is always the primary signal and heat is
 * decoration via `data-heat`, never the sole encoding.
 */
export function WeeklyStatGrid({ rows, weeksFetched, position, status, season }: WeeklyStatGridProps) {
  if (status === 'loading') {
    return (
      <div className="weekly-stat-grid weekly-stat-grid-empty">
        <p className="muted">Loading weekly game log…</p>
      </div>
    );
  }
  if (status === 'unavailable') {
    return (
      <div className="weekly-stat-grid weekly-stat-grid-empty">
        <p className="muted">Weekly game log unavailable. Core projections and ADP are unaffected.</p>
      </div>
    );
  }
  if (position == null) return null;
  if (weeksFetched.length === 0) {
    return (
      <div className="weekly-stat-grid weekly-stat-grid-empty">
        <p className="muted">No weeks were retrieved for {season ?? 'this season'}.</p>
      </div>
    );
  }
  if (!rows.some((row) => row.kind === 'played')) {
    return (
      <div className="weekly-stat-grid weekly-stat-grid-empty">
        <p className="muted">No {season ?? ''} game log for this player.</p>
      </div>
    );
  }

  const specs = WEEKLY_STAT_COLUMNS[position] ?? [];
  const statSpecs = specs.filter((spec) => spec.key !== 'opp');
  const runs = groupRuns(statSpecs);
  const rendered = rows.map((row) => renderRow(row, statSpecs));

  return (
    <div className="weekly-stat-grid">
      <div className="weekly-stat-grid-legend" aria-hidden="true">
        <div className="weekly-stat-grid-legend-bar" />
        <div className="weekly-stat-grid-legend-labels">
          <span>Below avg</span>
          <span>Average</span>
          <span>Above avg</span>
        </div>
      </div>
      <div className="weekly-stat-grid-scroll">
        <table>
          <caption className="visually-hidden">
            {season != null ? `${season} ` : ''}weekly game log for {position}. Cell shading is
            relative to other {position}s' startable weeks that season; the number is always the
            primary signal.
          </caption>
          <thead>
            <tr className="weekly-stat-grid-group-row">
              <th scope="col" rowSpan={2} className="weekly-stat-grid-sticky">WK</th>
              <th scope="col" rowSpan={2}>OPP</th>
              {runs.map((run, index) => (
                <th key={`${run.group}-${index}`} scope="colgroup" colSpan={run.span}>{run.label}</th>
              ))}
            </tr>
            <tr>
              {statSpecs.map((spec, index) => {
                const groupStart = index > 0 && spec.group !== statSpecs[index - 1]!.group;
                return (
                  <th
                    key={spec.key}
                    scope="col"
                    className={groupStart ? 'weekly-stat-grid-group-start' : undefined}
                  >
                    {spec.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rendered.map((row) => (
              <tr key={row.week} data-row-kind={row.kind}>
                <th scope="row" className="weekly-stat-grid-sticky">{row.week}</th>
                <td className="weekly-stat-grid-opp">{row.opp}</td>
                {row.cells.map((value, index) => {
                  const spec = statSpecs[index]!;
                  const groupStart = index > 0 && spec.group !== statSpecs[index - 1]!.group;
                  return (
                    <td
                      key={spec.key}
                      className={[
                        'weekly-stat-grid-stat',
                        groupStart ? 'weekly-stat-grid-group-start' : '',
                      ].filter(Boolean).join(' ')}
                      data-heat={row.heats[index] ?? undefined}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
