import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MOCK_SCORING } from '../adapters/sleeper';
import { buildManualDraftInit, ManualDraftSetup } from './ManualDraftSetup';

describe('buildManualDraftInit', () => {
  it('constructs a complete DraftInit with identity slot mapping and a real seat', () => {
    const init = buildManualDraftInit({ leagueName: 'LeAgUe', teams: 10, rounds: 14, mySlot: 2 });

    expect(init.provider).toBe('manual');
    expect(init.draftId).toBe('manual-session');
    expect(init.draftType).toBe('snake');
    expect(init.teams).toBe(10);
    expect(init.rounds).toBe(14);
    expect(init.slotToTeam[1]).toBe('1');
    expect(init.slotToTeam[10]).toBe('10');
    expect(Object.keys(init.slotToTeam)).toHaveLength(10);
    expect(init.slotToTeamName?.[3]).toBe('Team 3');
    // The seat is what drives boardKind off the 'no-seat' path — must be non-null.
    expect(init.myTeamId).toBe('2');
    expect(init.mySlot).toBe(2);

    expect(init.settings.provider).toBe('manual');
    expect(init.settings.teams).toBe(10);
    expect(init.settings.startingSlots).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K']);
    expect(init.settings.rosterSlots.BN).toBe(5);
    expect(init.settings.rosterSlots.IR).toBe(1);
    expect(init.settings.scoring).toBe(DEFAULT_MOCK_SCORING.ppr);
    expect(init.settings.format).toEqual({ reception: 'ppr', qb: 'one-qb', draft: 'snake' });
  });

  it('maps any valid slot to its identity team id (the edit-mySlot invariant)', () => {
    const init = buildManualDraftInit({ leagueName: 'x', teams: 10, rounds: 14, mySlot: 10 });
    expect(init.myTeamId).toBe('10');
  });
});

describe('ManualDraftSetup', () => {
  it('prefills the target league config and requires a draft slot before submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ManualDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/League name/)).toHaveValue('ESPN draft — LeAgUe');
    expect(screen.getByLabelText(/Teams/)).toHaveValue(10);
    expect(screen.getByLabelText(/Rounds/)).toHaveValue(14);

    const submit = screen.getByRole('button', { name: 'Start draft' });
    expect(submit).toBeDisabled(); // mySlot is required and unknown until the order reveal.

    await user.type(screen.getByLabelText(/My draft slot/), '2');
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const init = onSubmit.mock.calls[0]?.[0];
    expect(init.mySlot).toBe(2);
    expect(init.myTeamId).toBe('2');
    expect(init.settings.name).toBe('ESPN draft — LeAgUe');
  });

  it('starts from an existing DraftInit in edit mode and preserves picks (slot-only change)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = buildManualDraftInit({ leagueName: 'Existing', teams: 10, rounds: 14, mySlot: 5 });
    render(<ManualDraftSetup initial={initial} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/My draft slot/)).toHaveValue(5);

    const submit = screen.getByRole('button', { name: 'Save setup' });
    await user.clear(screen.getByLabelText(/My draft slot/));
    await user.type(screen.getByLabelText(/My draft slot/), '7');
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const init = onSubmit.mock.calls[0]?.[0];
    expect(init.mySlot).toBe(7);
    expect(init.myTeamId).toBe('7');
    expect(init.settings.name).toBe('Existing');
  });

  it('rejects a slot outside the team count', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ManualDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);

    const submit = screen.getByRole('button', { name: 'Start draft' });
    await user.type(screen.getByLabelText(/My draft slot/), '11'); // 10-team league
    expect(submit).toBeDisabled();
  });
});
