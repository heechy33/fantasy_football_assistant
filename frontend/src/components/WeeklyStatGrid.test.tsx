import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerWeeklyStatsArtifact } from '../../../shared/types';
import { buildGameLogRows } from '../data/weeklyGameLog';
import { WeeklyStatGrid } from './WeeklyStatGrid';

const RB_COLUMNS = ['pts', 'opp', 'snp', 'fin', 'rush_att', 'rush_yd', 'rush_ypa', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'fum_lost'] as const;

function rbRow(week: number, values: Partial<Record<(typeof RB_COLUMNS)[number], number | string | null>>): (number | string | null)[] {
  return [week, ...RB_COLUMNS.map((key) => values[key] ?? 0)];
}

function artifact(overrides: Partial<PlayerWeeklyStatsArtifact> = {}): PlayerWeeklyStatsArtifact {
  return {
    schemaVersion: 1,
    season: 2025,
    weeksFetched: Array.from({ length: 18 }, (_, i) => i + 1),
    columns: { RB: [...RB_COLUMNS] },
    players: {
      rb1: {
        p: 'RB',
        bye: 9,
        w: [
          rbRow(1, { pts: 14.2, opp: '@KC', snp: 55, fin: 5, rush_att: 12, rush_yd: 60, rush_ypa: 5.0 }),
          rbRow(4, { pts: 0.0, opp: 'DAL', snp: 40, fin: 30, rush_att: 3, rush_yd: -2, rush_ypa: -0.7 }),
        ],
      },
    },
    heat: { RB: { rush_yd: [10, 20, 30, 40] } },
    ...overrides,
  };
}

describe('WeeklyStatGrid', () => {
  it('always renders 18 body rows', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    render(<WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />);
    expect(screen.getAllByRole('row')).toHaveLength(2 + 18); // 2 header rows + 18 body rows
  });

  it('renders BYE in the OPP cell and blanks the rest of that row', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    render(<WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />);
    const byeRow = screen.getByText('9', { selector: 'th' }).closest('tr')!;
    expect(byeRow).toHaveAttribute('data-row-kind', 'bye');
    expect(byeRow.textContent).toContain('BYE');
  });

  it('renders an em dash across every cell for a nodata (unfetched) week', () => {
    const rows = buildGameLogRows(artifact({ weeksFetched: [1, 2, 3, 4] }), 'rb1', 'RB');
    render(<WeeklyStatGrid rows={rows} weeksFetched={[1, 2, 3, 4]} position="RB" status="ready" season={2025} />);
    const week5Row = screen.getByText('5', { selector: 'th' }).closest('tr')!;
    expect(week5Row).toHaveAttribute('data-row-kind', 'nodata');
    // Every td in that row reads "–".
    const cells = week5Row.querySelectorAll('td');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.textContent).toBe('–');
    }
  });

  it('leaves a genuinely inactive (fetched, no row, not the bye) week blank', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    render(<WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />);
    const week2Row = screen.getByText('2', { selector: 'th' }).closest('tr')!;
    expect(week2Row).toHaveAttribute('data-row-kind', 'inactive');
    const opponentCell = week2Row.querySelectorAll('td')[0]!;
    expect(opponentCell.textContent).toBe('');
  });

  it('carries data-heat from the row cells onto the rendered <td>', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    render(<WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />);
    const week1Row = screen.getByText('1', { selector: 'th' }).closest('tr')!;
    // rush_yd=60 for week 1, breakpoints [10,20,30,40] -> bucket 5.
    const heated = week1Row.querySelector('td[data-heat="5"]');
    expect(heated).not.toBeNull();
  });

  it('renders a proportional five-bucket legend above the table', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const { container } = render(
      <WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />,
    );
    const legend = container.querySelector('.weekly-stat-grid-legend')!;
    expect(legend.querySelector('.weekly-stat-grid-legend-bar')).not.toBeNull();
    const labels = legend.querySelector('.weekly-stat-grid-legend-labels')!;
    expect(labels.textContent).toContain('Below avg');
    expect(labels.textContent).toContain('Average');
    expect(labels.textContent).toContain('Above avg');
    expect(legend.nextElementSibling).toHaveClass('weekly-stat-grid-scroll');
  });

  it('a scored-zero played week shows its real cells, not blanks', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    render(<WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />);
    const week4Row = screen.getByText('4', { selector: 'th' }).closest('tr')!;
    expect(week4Row).toHaveAttribute('data-row-kind', 'played');
    expect(week4Row.textContent).toContain('DAL');
  });

  it('marks the WK column sticky and wraps the table in a scroll container', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const { container } = render(
      <WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />,
    );
    expect(container.querySelector('.weekly-stat-grid-scroll')).not.toBeNull();
    expect(container.querySelectorAll('.weekly-stat-grid-sticky').length).toBeGreaterThan(0);
  });

  it('shows a loading message and no table while loading', () => {
    render(<WeeklyStatGrid rows={[]} weeksFetched={[]} position="RB" status="loading" season={2025} />);
    expect(screen.getByText('Loading weekly game log…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an unavailable message and no table when unavailable', () => {
    render(<WeeklyStatGrid rows={[]} weeksFetched={[]} position="RB" status="unavailable" season={2025} />);
    expect(screen.getByText(/Weekly game log unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explicitly distinguishes "no weeks were ever fetched" from "fetched but no data for this player"', () => {
    render(<WeeklyStatGrid rows={[]} weeksFetched={[]} position="RB" status="ready" season={2025} />);
    expect(screen.getByText('No weeks were retrieved for 2025.')).toBeInTheDocument();
  });

  it('shows a player-specific empty state when weeks were fetched but this player never played', () => {
    const rows = buildGameLogRows(artifact({ players: {} }), 'rb1', 'RB');
    render(<WeeklyStatGrid rows={rows} weeksFetched={artifact().weeksFetched} position="RB" status="ready" season={2025} />);
    expect(screen.getByText('No 2025 game log for this player.')).toBeInTheDocument();
  });

  it('renders nothing for a null position', () => {
    const { container } = render(<WeeklyStatGrid rows={[]} weeksFetched={[1]} position={null} status="ready" season={2025} />);
    expect(container).toBeEmptyDOMElement();
  });
});
