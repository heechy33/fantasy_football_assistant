import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerId } from '../../../shared/types';
import { DraftGuideBoard } from './DraftGuideBoard';
import { buildPositionRankByPlayer } from '../data/guideTableColumns';
import type { GuideRow } from '../data/guideBoard';

// Component contract for the guide's Draft View (the route test pins URL wiring; this pins the
// board itself): snake layout in the DOM, cell click selection, honest empty cells, and the
// avatar/positional-rank chrome.

function row(playerId: string, name: string, position: string, seed: number): GuideRow {
  return {
    playerId,
    player: { playerId, name, position, eligiblePositions: [position], team: 'DET', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} } as GuideRow['player'],
    recommendation: null,
    engineRank: seed,
    adpEntry: null,
  };
}

const ROWS: GuideRow[] = [
  row('a', 'Amon-Ra St. Brown', 'WR', 1),
  row('b', 'Jahmyr Gibbs', 'RB', 2),
  row('c', 'Sam LaPorta', 'TE', 3),
  row('d', 'Jared Goff', 'QB', 4),
  row('e', 'David Montgomery', 'RB', 5),
  row('f', 'Jameson Williams', 'WR', 6),
  row('g', 'Kirby Joseph', 'S', 7),
  row('h', 'Jake Bates', 'K', 8),
];

function rankMap(rows: readonly GuideRow[]): ReadonlyMap<PlayerId, number> {
  return new Map(rows.map((r, i) => [r.playerId, i + 1]));
}

function renderBoard(props: Partial<Parameters<typeof DraftGuideBoard>[0]> = {}) {
  return render(
    <DraftGuideBoard
      rows={ROWS}
      teams={4}
      rounds={2}
      sourceRankByPlayer={rankMap(ROWS)}
      onSelectPlayer={vi.fn()}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe('DraftGuideBoard', () => {
  it('labels team-slot columns and round rows', () => {
    renderBoard();
    expect(screen.getByRole('columnheader', { name: 'Round' })).toBeInTheDocument();
    for (const slot of ['1', '2', '3', '4']) {
      expect(screen.getByRole('columnheader', { name: slot })).toBeInTheDocument();
    }
  });

  it('renders the snake layout: round 2 runs against the grain (4 teams → 8,7,6,5)', () => {
    const { container } = renderBoard();
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
    const overalls = (row: Element) =>
      Array.from(row.querySelectorAll('.guide-grid-overall')).map((el) => Number(el.textContent!.replace('#', '')));
    expect(overalls(bodyRows[0]!)).toEqual([1, 2, 3, 4]);
    expect(overalls(bodyRows[1]!)).toEqual([8, 7, 6, 5]); // the turn
  });

  it('selects a player when a filled cell is clicked', () => {
    const onSelectPlayer = vi.fn();
    const { container } = renderBoard({ onSelectPlayer });
    fireEvent.click(container.querySelectorAll('button.guide-grid-cell')[0]!);
    expect(onSelectPlayer).toHaveBeenCalledWith('a');
  });

  it('renders empty picks without buttons and with visually-hidden pick labels', () => {
    const short = ROWS.slice(0, 3);
    const { container } = renderBoard({ rows: short, sourceRankByPlayer: rankMap(short) });
    // 4 teams × 2 rounds = 8 picks; 3 ranked rows → 5 empty cells, zero buttons among them.
    const emptyCells = container.querySelectorAll('td[data-empty]');
    expect(emptyCells).toHaveLength(5);
    expect(emptyCells[0]!.querySelector('button')).toBeNull();
    expect(screen.getByText('Pick 4: unranked')).toBeInTheDocument(); // visually-hidden but queryable
  });

  it('shows real headshots, team logo, and positional-rank chips', () => {
    const { container } = renderBoard({ positionRankByPlayer: buildPositionRankByPlayer(ROWS) });
    const cell = container.querySelector('button.guide-grid-cell')!;
    expect(cell).toHaveAttribute('data-team', 'DET');
    const portrait = cell.querySelector('img.guide-grid-portrait')!;
    expect(portrait.getAttribute('src')).toContain('sleepercdn.com/content/nfl/players/a.jpg');
    expect(cell.querySelector('img.guide-grid-team-logo')).toHaveAttribute('src', '/team-logos/det.png');
    // Pick 1 is the top-ranked row overall, but chips are PER-POSITION: pick 2 (Gibbs) is RB1.
    expect(screen.getByText('RB1')).toBeInTheDocument();
    expect(screen.getByText('WR1')).toBeInTheDocument();
  });
});