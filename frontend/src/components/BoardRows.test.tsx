import { render, screen } from '@testing-library/react';
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
});

describe('PlayerBoardRow', () => {
  it('opens details by click or keyboard and labels market-only players', async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    render(<PlayerBoardRow playerId="p1" player={undefined} recommendation={null} rank={1} onViewDetails={onViewDetails} />);

    const row = screen.getByRole('button', { name: 'View details for p1' });
    expect(screen.queryByText('ADP only')).not.toBeInTheDocument();
    await user.click(row);
    await user.keyboard('{Enter}');
    expect(onViewDetails).toHaveBeenCalledTimes(2);
  });
});
