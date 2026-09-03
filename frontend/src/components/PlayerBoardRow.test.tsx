import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerMeta } from '../../../shared/types';
import { PlayerBoardRow } from './PlayerBoardRow';

const player: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 25, yearsExp: 4, injuryStatus: null, ids: {},
};

describe('PlayerBoardRow', () => {
  it('is a div with role=button so a real nested button (Draft) is valid HTML', () => {
    const { container } = render(
      <PlayerBoardRow playerId="rb1" player={player} recommendation={null} adp={5} onViewDetails={vi.fn()} />,
    );
    const row = container.querySelector('.player-board-row')!;
    expect(row.tagName).toBe('DIV');
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('tabindex')).toBe('0');
  });

  it('Enter on the row triggers onViewDetails (the old real-button behavior, now a keydown shim)', () => {
    const onViewDetails = vi.fn();
    render(
      <PlayerBoardRow playerId="rb1" player={player} recommendation={null} adp={5} onViewDetails={onViewDetails} />,
    );
    const row = screen.getByRole('button', { name: 'View details for Rush One' });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('Space on the row triggers onViewDetails too (real-button parity)', () => {
    const onViewDetails = vi.fn();
    render(
      <PlayerBoardRow playerId="rb1" player={player} recommendation={null} adp={5} onViewDetails={onViewDetails} />,
    );
    const row = screen.getByRole('button', { name: 'View details for Rush One' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('omits the "Draft" affordance when no handler is passed', () => {
    render(
      <PlayerBoardRow playerId="rb1" player={player} recommendation={null} adp={5} onViewDetails={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Draft Rush One' })).toBeNull();
    // The role=button row is itself an a11y button; the inner "Draft" button is a second one.
    expect(screen.getAllByRole('button').length).toBe(1);
  });

  it('renders the "Draft" affordance and stops propagation so the row does not also fire', async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    const onDraftPlayer = vi.fn();
    render(
      <PlayerBoardRow
        playerId="rb1"
        player={player}
        recommendation={null}
        adp={5}
        onViewDetails={onViewDetails}
        onDraftPlayer={onDraftPlayer}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Draft Rush One' }));
    expect(onDraftPlayer).toHaveBeenCalledTimes(1);
    expect(onViewDetails).not.toHaveBeenCalled();
  });
});
