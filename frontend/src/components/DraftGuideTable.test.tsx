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
  { key: 'sleeper', label: 'Sleeper', brandKey: 'sleeper', status: 'ready', rankByPlayer: LANE_RANKS, adpByPlayer: LANE_ADP },
  { key: 'ffc', label: 'FFC', brandKey: 'ffc', status: 'unavailable', rankByPlayer: new Map(), adpByPlayer: new Map() },
];

function renderTable(props: Partial<Parameters<typeof DraftGuideTable>[0]> = {}) {
  return render(
    <DraftGuideTable
      rows={ROWS}
      anchorLabel="Rank"
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
    await user.click(screen.getByRole('button', { name: /Sleeper/ }));
    expect(screen.getByRole('columnheader', { name: /Sleeper/ })).toHaveAttribute('aria-sort', 'ascending');
    ids = bodyRows().map(rowId);
    expect(ids[0]).toContain('BRAVO');
    expect(ids[1]).toContain('ALPHA');
    expect(ids[2]).toContain('GAP');

    // Descending keeps em-dash rows last (never reverses them to the top).
    await user.click(screen.getByRole('button', { name: /Sleeper/ }));
    expect(screen.getByRole('columnheader', { name: /Sleeper/ })).toHaveAttribute('aria-sort', 'descending');
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

  it('re-ranks the positional chip by the sorted provider lane, beside the player name', async () => {
    const user = userEvent.setup();
    renderTable();
    const chipOf = (index: number) =>
      bodyRows()[index]?.querySelector('.guide-player-name .guide-pos-pill')?.textContent ?? null;

    // Anchor sort: chips follow the engine's projection order — alpha RB1, bravo RB2 — and the
    // chip sits inline next to the name (inside .guide-player-name), not in a trailing tag slot.
    expect(chipOf(0)).toBe('RB1');
    expect(chipOf(1)).toBe('RB2');
    expect(document.querySelector('.guide-grid-tags')).toBeNull();

    // Sleeper sort: bravo holds lane rank 1 → bravo becomes RB1 and alpha RB2.
    await user.click(screen.getByRole('button', { name: /Sleeper/ }));
    expect(chipOf(0)).toBe('RB1'); // bravo
    expect(chipOf(1)).toBe('RB2'); // alpha

    // Back to the anchor: the engine order returns.
    await user.click(screen.getByRole('button', { name: /Rank/ }));
    expect(chipOf(0)).toBe('RB1'); // alpha
    expect(chipOf(1)).toBe('RB2'); // bravo
  });

  it('re-ranks the Rank column densely when sorting by a lane (1..n in display order)', async () => {
    const user = userEvent.setup();
    renderTable();
    const rankOf = (row: Element) => row.querySelector('td.guide-col-rank')!.textContent;

    // Anchor sort on an unfiltered pool: dense 1..n (here it coincides with the anchor ranks).
    let ranks = bodyRows().map(rankOf);
    expect(ranks).toEqual(['1', '2', EM_DASH]);

    // Lane sort: bravo leads, so the Rank column re-ranks to the displayed order (dense 1..n).
    await user.click(screen.getByRole('button', { name: /Sleeper/ }));
    ranks = bodyRows().map(rankOf);
    expect(ranks).toEqual(['1', '2', EM_DASH]); // bravo(1), alpha(2), gap stays an em-dash

    // Descending: dense positions follow the reversed display order; em-dash still last.
    await user.click(screen.getByRole('button', { name: /Sleeper/ }));
    ranks = bodyRows().map(rankOf);
    expect(ranks).toEqual(['1', '2', EM_DASH]); // alpha(1), bravo(2), gap last

    // Back to the anchor column: still dense in display order.
    await user.click(screen.getByRole('button', { name: /Rank/ }));
    ranks = bodyRows().map(rankOf);
    expect(ranks).toEqual(['1', '2', EM_DASH]);
  });

  it('re-ranks Rank and the positional chip densely when the pool arrives pre-filtered', () => {
    // A position filter hands the table a subset: the anchor ranks are the GLOBAL ones
    // (22, 32 — like Josh Allen under a QB filter), but the board must rank them 1..n and
    // re-issue the chips in the displayed order, not show the out-of-order globals.
    renderTable({
      anchorRankByPlayer: new Map([['alpha', 22], ['bravo', 32]] as const),
      positionRankByPlayer: new Map([['alpha', 5], ['bravo', 9], ['gap', 31]] as const),
    });
    expect(bodyRows().map((row) => row.querySelector('td.guide-col-rank')!.textContent))
      .toEqual(['1', '2', EM_DASH]);
    const chips = bodyRows().map((row) => row.querySelector('.guide-pos-pill')?.textContent ?? null);
    // alpha/bravo re-chip densely; gap has no anchor rank (as if absent from the source), so it
    // keeps its global engine chip instead of going blank.
    expect(chips).toEqual(['RB1', 'RB2', 'RB31']);
  });
});