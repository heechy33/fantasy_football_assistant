import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdpEntry, PlayerId, PlayerMeta } from '../../../shared/types';
import type { GuideRow } from '../data/guideBoard';
import { buildPositionRankByPlayer, type GuideLane } from '../data/guideTableColumns';
import { DraftGuideTable } from './DraftGuideTable';

// Pins the STACKED-style table's contracts: per-lane ADP + delta-vs-anchor cells, the
// missing-value contract (same spirit as guideBoard.ts's sortGuideRows — a row absent from a
// lane renders an em-dash, never a fabricated rank, and sorts LAST regardless of direction),
// per-lane sorting, and honest unavailable lanes.

// Pure-ASCII construction of the em-dash the table renders for missing values.
const EM_DASH = String.fromCharCode(0x2014);

function meta(id: string): PlayerMeta {
  return {
    playerId: id,
    name: id.toUpperCase(),
    position: 'RB',
    eligiblePositions: ['RB'],
    team: 'DET',
    byeWeek: null,
    age: null,
    yearsExp: null,
    injuryStatus: null,
    ids: {},
  };
}

function adpEntry(playerId: PlayerId, adp: number): AdpEntry {
  return {
    playerId,
    name: playerId.toUpperCase(),
    position: 'RB',
    team: null,
    adp,
    stdev: 1,
    high: null,
    low: null,
    timesDrafted: null,
    byeWeek: null,
    adpSource: 'ffc',
    stdevSource: 'observed',
  };
}

function rec(points: number): { projectedPoints: number } {
  return { projectedPoints: points };
}

/** alpha/bravo hold anchor ranks 1/2 plus lane data; 'gap' is absent from every lane. */
const ROWS: GuideRow[] = [
  { playerId: 'alpha', player: meta('alpha'), recommendation: rec(20.5) as never, engineRank: 1, adpEntry: adpEntry('alpha', 1.5) },
  { playerId: 'bravo', player: meta('bravo'), recommendation: rec(10.1) as never, engineRank: 2, adpEntry: adpEntry('bravo', 3.0) },
  { playerId: 'gap', player: meta('gap'), recommendation: null, engineRank: null, adpEntry: null },
];

const ANCHOR_RANKS: ReadonlyMap<PlayerId, number> = new Map([['alpha', 1], ['bravo', 2]]);
const LANE_RANKS = new Map([['alpha', 2], ['bravo', 1]]);
const LANE_ADP = new Map([['alpha', 2.5], ['bravo', 1.2]]);

const LANES: GuideLane[] = [
  { key: 'sleeper', label: 'Sleeper ADP', brandKey: 'sleeper', status: 'ready', rankByPlayer: LANE_RANKS, adpByPlayer: LANE_ADP },
  { key: 'ffc', label: 'FFC', brandKey: 'ffc', status: 'unavailable', rankByPlayer: new Map(), adpByPlayer: new Map() },
];

function renderTable(props: Partial<Parameters<typeof DraftGuideTable>[0]> = {}) {
  return render(
    <DraftGuideTable
      rows={ROWS}
      anchorLabel="Engine"
      anchorRankByPlayer={ANCHOR_RANKS}
      positionRankByPlayer={buildPositionRankByPlayer(ROWS)}
      lanes={LANES}
      onSelectPlayer={vi.fn()}
      {...props}
    />,
  );
}

function bodyRows(): Element[] {
  return Array.from(document.querySelectorAll('tbody tr'));
}

function rowId(row: Element): string {
  return row.querySelector('button.guide-player-cell')!.textContent ?? '';
}

describe('DraftGuideTable', () => {
  it('renders each lane cell as ADP + delta vs the anchor, sign-tinted', () => {
    renderTable();
    const rows = bodyRows();
    // alpha: anchor 1, Sleeper ADP 2.5 → delta +1.5 (costs more than the anchor slot).
    const alpha = within(rows[0] as HTMLElement);
    expect(alpha.getByText('2.5')).toBeInTheDocument();
    expect(alpha.getByText('+1.5')).toHaveAttribute('data-sign', 'pos');
    // bravo: anchor 2, Sleeper ADP 1.2 → delta -0.8 (falls earlier than the anchor slot).
    const bravo = within(rows[1] as HTMLElement);
    expect(bravo.getByText('1.2')).toBeInTheDocument();
    expect(bravo.getByText('-0.8')).toHaveAttribute('data-sign', 'neg');
  });

  it('renders em-dashes for rows absent from a lane, and keeps unavailable lanes honest', () => {
    renderTable();
    const gapRow = bodyRows()[2] as HTMLElement;
    expect(within(gapRow).getAllByText(EM_DASH).length).toBeGreaterThanOrEqual(2);
    // The unavailable FFC lane has no sort button — its header explains, it never vanishes.
    expect(screen.queryByRole('button', { name: /FFC/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('FFC').length).toBeGreaterThan(0);
  });

  it('sorts by a lane rank on header click; em-dash rows always sort last', async () => {
    const user = userEvent.setup();
    renderTable();
    // Default: anchor ascending → alpha (1), bravo (2), gap last.
    let ids = bodyRows().map(rowId);
    expect(ids[0]).toContain('ALPHA');
    expect(ids[1]).toContain('BRAVO');
    expect(ids[2]).toContain('GAP');

    // Sort by the Sleeper lane: bravo holds lane rank 1 → leads; gap still last.
    await user.click(screen.getByRole('button', { name: /Sleeper ADP/ }));
    expect(screen.getByRole('columnheader', { name: /Sleeper ADP/ })).toHaveAttribute('aria-sort', 'ascending');
    ids = bodyRows().map(rowId);
    expect(ids[0]).toContain('BRAVO');
    expect(ids[1]).toContain('ALPHA');
    expect(ids[2]).toContain('GAP');

    // Descending keeps em-dash rows last (never reverses them to the top).
    await user.click(screen.getByRole('button', { name: /Sleeper ADP/ }));
    expect(screen.getByRole('columnheader', { name: /Sleeper ADP/ })).toHaveAttribute('aria-sort', 'descending');
    ids = bodyRows().map(rowId);
    expect(ids[2]).toContain('GAP');
  });

  it('renders the rich player cell (avatar, team, positional chip) and selects on click', async () => {
    const user = userEvent.setup();
    const onSelectPlayer = vi.fn();
    renderTable({ onSelectPlayer });
    const firstCell = document.querySelector('button.guide-player-cell')!;
    expect(firstCell.querySelector('.player-portrait')).not.toBeNull();
    expect(firstCell).toHaveTextContent('DET');
    expect(within(firstCell as HTMLElement).getByText('RB1')).toBeInTheDocument(); // positional chip
    await user.click(firstCell);
    expect(onSelectPlayer).toHaveBeenCalledWith('alpha');
  });
});