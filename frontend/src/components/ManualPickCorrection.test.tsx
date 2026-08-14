import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RankedPlayer } from '../data/loadPlayerPool';
import { ManualPickCorrection } from './ManualPickCorrection';

function ranked(overrides: Partial<RankedPlayer> & Pick<RankedPlayer, 'playerId' | 'name' | 'rank' | 'adp'>): RankedPlayer {
  return {
    position: 'RB',
    eligiblePositions: ['RB'],
    team: 'BUF',
    byeWeek: 7,
    age: 24,
    yearsExp: 3,
    injuryStatus: null,
    ids: {},
    ...overrides,
  };
}

const BOARD: RankedPlayer[] = [
  ranked({ playerId: 'rb1', name: 'Rush One', rank: 1, adp: 2.1 }),
  ranked({ playerId: 'wr1', name: 'Catch One', rank: 2, adp: 4.5, position: 'WR', eligiblePositions: ['WR'] }),
  ranked({ playerId: 'te1', name: 'Tight One', rank: 3, adp: 8.0, position: 'TE', eligiblePositions: ['TE'] }),
];

describe('ManualPickCorrection accessibility', () => {
  it('closes on Escape and moves initial focus into the dialog', () => {
    const onClose = vi.fn();
    render(
      <ManualPickCorrection
        mode="correct-existing"
        overall={5}
        rankedPlayers={BOARD}
        unavailablePlayerIds={new Set()}
        onSubmit={vi.fn()}
        onUndo={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus between distinct controls inside the dialog', () => {
    render(
      <ManualPickCorrection
        mode="correct-existing"
        overall={5}
        rankedPlayers={BOARD}
        unavailablePlayerIds={new Set()}
        onSubmit={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    expect(first).not.toBe(last);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes when the backdrop is clicked, but not when the dialog panel is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ManualPickCorrection
        mode="correct-existing"
        overall={5}
        rankedPlayers={BOARD}
        unavailablePlayerIds={new Set()}
        onSubmit={vi.fn()}
        onUndo={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector('.dialog-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ManualPickCorrection behavior', () => {
  it('hides unavailable players and submits a correction override for the selected player', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(
      <ManualPickCorrection
        mode="correct-existing"
        overall={5}
        round={1}
        slot={5}
        teamId="team-3"
        currentProviderName="Wrong Player"
        rankedPlayers={BOARD}
        unavailablePlayerIds={new Set(['wr1'])}
        onSubmit={onSubmit}
        onUndo={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/Wrong Player/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Catch One/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save pick' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Rush One/ }));
    expect(screen.getByText(/Selected: #1 Rush One/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save pick' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const override = onSubmit.mock.calls[0]![0];
    expect(override).toMatchObject({
      overall: 5,
      round: 1,
      slot: 5,
      teamId: 'team-3',
      playerId: 'rb1',
      providerPlayerName: 'Rush One',
      source: 'manual-correction',
    });
    expect(typeof override.correctedAt).toBe('number');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires team + round + draft slot for add-manual and submits a manual-entry override', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ManualPickCorrection
        mode="add-manual"
        overall={12}
        rankedPlayers={BOARD}
        unavailablePlayerIds={new Set()}
        onSubmit={onSubmit}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Tight One/ }));
    expect(screen.getByRole('button', { name: 'Save pick' })).toBeDisabled();

    await user.type(screen.getByLabelText('Team'), 'owner-7');
    await user.clear(screen.getByLabelText('Round'));
    await user.type(screen.getByLabelText('Round'), '2');
    await user.clear(screen.getByLabelText('Draft slot'));
    await user.type(screen.getByLabelText('Draft slot'), '3');
    await user.click(screen.getByRole('button', { name: 'Save pick' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      overall: 12,
      round: 2,
      slot: 3,
      teamId: 'owner-7',
      playerId: 'te1',
      providerPlayerName: 'Tight One',
      source: 'manual-entry',
    }));
  });

  it('undoes a correction and closes without submitting', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(
      <ManualPickCorrection
        mode="correct-existing"
        overall={5}
        rankedPlayers={BOARD}
        unavailablePlayerIds={new Set()}
        onSubmit={onSubmit}
        onUndo={onUndo}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Undo correction' }));
    expect(onUndo).toHaveBeenCalledWith(5);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
