import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BoardRows } from './BoardRows';
import { PlayerBoardRow } from './PlayerBoardRow';

describe('BoardRows', () => {
  it('exposes the complete row region without a progressive-load control', () => {
    render(
      <BoardRows itemCount={24} label="Recommendation players">
        <div>Player 1</div>
      </BoardRows>,
    );

    expect(screen.getByRole('region', { name: 'Recommendation players' })).toBeInTheDocument();
    expect(screen.getByText('Showing 24 players')).toHaveClass('visually-hidden');
    expect(screen.queryByRole('button', { name: 'Load more players' })).not.toBeInTheDocument();
  });

  it('includes an Avail column header alongside Player/Role/Proj/ADP/Usage (no Rank column)', () => {
    render(
      <BoardRows itemCount={1} label="Recommendation players">
        <div>Player 1</div>
      </BoardRows>,
    );
    expect(screen.getByText('Avail')).toBeInTheDocument();
    expect(screen.queryByText('Rank')).not.toBeInTheDocument();
  });
});

describe('PlayerBoardRow', () => {
  it('opens details by click or keyboard and labels market-only players', async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    render(<PlayerBoardRow playerId="p1" player={undefined} recommendation={null} onViewDetails={onViewDetails} />);

    const row = screen.getByRole('button', { name: 'View details for p1' });
    // No mode-dependent rank cell — see PlayerCard's board-rank-removal note.
    expect(row.querySelector('.player-board-row-rank')).toBeNull();
    expect(screen.queryByText('ADP only')).not.toBeInTheDocument();
    await user.click(row);
    await user.keyboard('{Enter}');
    expect(onViewDetails).toHaveBeenCalledTimes(2);
  });

  it('renders an em dash for the Avail cell when no probability is available', () => {
    render(<PlayerBoardRow playerId="p1" player={undefined} recommendation={null} onViewDetails={vi.fn()} />);
    const row = screen.getByRole('button', { name: 'View details for p1' });
    const cells = row.querySelectorAll('.player-board-row-cell');
    expect(cells[cells.length - 1]).toHaveTextContent('\u2014');
  });

  it('hides the Avail percentage off the clock even when an estimate exists', () => {
    render(
      <PlayerBoardRow
        playerId="p1"
        player={undefined}
        recommendation={null}
        availableNextPickProbability={0.256}
        availabilityVisible={false}
        onViewDetails={vi.fn()}
      />,
    );
    const row = screen.getByRole('button', { name: 'View details for p1' });
    const cells = row.querySelectorAll('.player-board-row-cell');
    expect(cells[cells.length - 1]).toHaveTextContent('\u2014');
  });

  it('shows the per-player ADP provenance suffix in the ADP cell', () => {
    render(
      <PlayerBoardRow
        playerId="p1"
        player={undefined}
        recommendation={null}
        adp={73}
        adpSource="espn"
        onViewDetails={vi.fn()}
      />,
    );
    const row = screen.getByRole('button', { name: 'View details for p1' });
    const cells = row.querySelectorAll('.player-board-row-cell');
    expect(cells[2]).toHaveTextContent('73.0');
    expect(cells[2]!.querySelector('.player-board-row-adp-source')?.textContent).toBe('ESPN');
  });

  it('renders the fallback availability percentage in the Avail cell when recommendation is null', () => {
    render(
      <PlayerBoardRow
        playerId="p1"
        player={undefined}
        recommendation={null}
        availableNextPickProbability={0.256}
        onViewDetails={vi.fn()}
      />,
    );
    const row = screen.getByRole('button', { name: 'View details for p1' });
    expect(within(row).getByText('26%')).toBeInTheDocument();
  });
});
