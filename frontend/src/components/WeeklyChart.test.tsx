import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GameLogCell, GameLogRow, GameLogRowKind } from '../data/weeklyGameLog';
import { WeeklyChart } from './WeeklyChart';

function row(
  week: number,
  kind: GameLogRowKind,
  pts: number | null = null,
  extras: Array<{ key: string; raw: number }> = [],
): GameLogRow {
  const cells: GameLogCell[] = [];
  if (pts != null) cells.push({ key: 'pts', display: pts.toFixed(1), heat: null, raw: pts });
  for (const extra of extras) cells.push({ key: extra.key, display: String(extra.raw), heat: null, raw: extra.raw });
  return { week, kind, opponent: kind === 'played' ? 'BUF' : null, pts, cells };
}

/** All 18 week slots, with `played`/`pts` overrides layered on top of a default
 * 'inactive' background -- mirrors the shape `buildGameLogRows` always returns. */
function rows(overrides: Record<number, GameLogRow>): GameLogRow[] {
  return Array.from({ length: 18 }, (_, i) => overrides[i + 1] ?? row(i + 1, 'inactive'));
}

const READY_ROWS = rows({
  1: row(1, 'played', 18.4),
  2: row(2, 'played', 7.1),
  4: row(4, 'played', 0.0),
  7: row(7, 'played', 24.9),
});

describe('WeeklyChart', () => {
  it('renders a played week and an inactive week as different DOM', () => {
    const { container } = render(
      <WeeklyChart rows={READY_ROWS} season={2025} position="RB" status="ready" playerName="Rush One" />,
    );
    // Week 3 has no observed row -> empty tick, no bar.
    expect(container.querySelectorAll('.weekly-chart-bar')).toHaveLength(4);
    expect(container.querySelectorAll('.weekly-chart-empty-tick').length).toBeGreaterThan(0);
  });

  it('renders a scored-zero played week as a stub bar, not an empty tick', () => {
    const { container } = render(
      <WeeklyChart rows={READY_ROWS} season={2025} position="RB" status="ready" playerName="Rush One" />,
    );
    const stubs = container.querySelectorAll('.weekly-chart-bar-stub');
    expect(stubs).toHaveLength(1); // only week 4, scored exactly 0
  });

  it('renders a nodata (unfetched) week as a visually distinct dashed tick, not a bye/inactive tick', () => {
    const withNodata = rows({
      1: row(1, 'played', 18.4),
      2: row(2, 'played', 7.1),
      4: row(4, 'played', 0.0),
      7: row(7, 'played', 24.9),
      18: row(18, 'nodata'),
    });
    const { container } = render(
      <WeeklyChart rows={withNodata} season={2025} position="RB" status="ready" playerName="Rush One" />,
    );
    expect(container.querySelectorAll('.weekly-chart-nodata-tick')).toHaveLength(1);
    // A nodata week must never render a bar (including a stub for a coincidental 0).
    expect(container.querySelectorAll('.weekly-chart-bar')).toHaveLength(4);
  });

  it('distinguishes a bye week from a nodata week', () => {
    const withBye = rows({
      1: row(1, 'played', 18.4),
      9: row(9, 'bye'),
      18: row(18, 'nodata'),
    });
    const { container } = render(
      <WeeklyChart rows={withBye} season={2025} position="RB" status="ready" playerName="Rush One" />,
    );
    expect(container.querySelectorAll('.weekly-chart-nodata-tick')).toHaveLength(1);
    // Bye + every other non-played, non-nodata week share the empty-tick mark.
    expect(container.querySelectorAll('.weekly-chart-empty-tick').length).toBeGreaterThan(0);
  });

  it.each(['idle', 'loading', 'unavailable'] as const)('renders an empty state for status=%s, not a zero-height chart', (status) => {
    const { container } = render(
      <WeeklyChart rows={[]} season={null} position="RB" status={status} playerName="Rush One" />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.weekly-chart-empty')).not.toBeNull();
  });

  it('renders an empty state when ready but no week was ever played', () => {
    const { container } = render(
      <WeeklyChart rows={rows({})} season={2025} position="RB" status="ready" playerName="Rush One" />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('No weekly scoring data for this player')).toBeInTheDocument();
  });

  it('renders a negative-points week below the zero line without breaking the domain', () => {
    const negRows = rows({ 1: row(1, 'played', -2.5), 2: row(2, 'played', 10) });
    const { container } = render(
      <WeeklyChart rows={negRows} season={2025} position="QB" status="ready" playerName="Signal Caller" />,
    );
    const bars = container.querySelectorAll('.weekly-chart-bar');
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(Number.isFinite(Number(bar.getAttribute('y')))).toBe(true);
      expect(Number(bar.getAttribute('height'))).toBeGreaterThan(0);
    }
  });

  it('shows a hover tooltip with week, opponent, and value for a played week', () => {
    const { container } = render(
      <WeeklyChart rows={READY_ROWS} season={2025} position="RB" status="ready" playerName="Rush One" />,
    );
    // Bars render in week order, so the first bar is week 1.
    const bars = container.querySelectorAll('.weekly-chart-bar');
    expect(bars.length).toBeGreaterThan(0);
    fireEvent.mouseEnter(bars[0]!);
    expect(screen.getByText('Wk 1 · BUF')).toBeInTheDocument();
    expect(screen.getByText('18.4 FPTS')).toBeInTheDocument();
  });

  it('renders a horizontal average line for the selected stat', () => {
    const { container } = render(
      <WeeklyChart rows={READY_ROWS} season={2025} position="RB" status="ready" playerName="Rush One" />,
    );
    expect(container.querySelector('.weekly-chart-avg-line')).not.toBeNull();
    expect(container.querySelector('.weekly-chart-avg-label')?.textContent).toMatch(/^avg /);
  });

  it('updates the average line when the metric changes', () => {
    const multiStat = rows({
      1: row(1, 'played', 14.2, [{ key: 'rush_yd', raw: 88 }]),
    });
    render(<WeeklyChart rows={multiStat} season={2025} position="RB" status="ready" playerName="Rush One" />);
    expect(screen.getByText('2025 weekly FPTS')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stat to chart'), { target: { value: 'rush_yd' } });
    expect(screen.getByText('2025 weekly YDS')).toBeInTheDocument();
    expect(screen.getByText('avg 88')).toBeInTheDocument();
  });
});
