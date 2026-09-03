import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DraftInit } from '../../../shared/types';
import { YahooDraftSetup } from './YahooDraftSetup';

describe('YahooDraftSetup', () => {
  it('submits a complete manual DraftInit with provider=yahoo, half-ppr scoring, and a chosen seat', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<YahooDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.clear(screen.getByLabelText('League name'));
    await user.type(screen.getByLabelText('League name'), 'Friends League');
    // Teams default is 12; switch to 10.
    await user.selectOptions(screen.getByLabelText('Teams'), '10');
    // Rounds default 15; keep.
    // Scoring default half-ppr; keep.
    // QB default 1qb; keep.
    await user.clear(screen.getByLabelText(/Your draft position/));
    await user.type(screen.getByLabelText(/Your draft position/), '4');
    await user.click(screen.getByRole('button', { name: 'Start draft' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const init: DraftInit = onSubmit.mock.calls[0]?.[0];
    expect(init.provider).toBe('yahoo');
    expect(init.draftType).toBe('snake');
    expect(init.teams).toBe(10);
    expect(init.rounds).toBe(15);
    expect(init.mySlot).toBe(4);
    expect(init.myTeamId).toBe('4');
    // Identity slot mapping (the snake-order math the click path depends on).
    expect(init.slotToTeam[1]).toBe('1');
    expect(init.slotToTeam[10]).toBe('10');
    expect(init.slotToTeamName?.[3]).toBe('Team 3');
    // Half-PPR preset (rec: 0.5) — the only scoring map a default Yahoo league uses.
    expect(init.settings.provider).toBe('yahoo');
    expect(init.settings.scoring.rec).toBe(0.5);
    expect(init.settings.format).toEqual({ reception: 'half-ppr', qb: 'one-qb', draft: 'snake' });
    // leagueId/draftId are stable local handles — refresh-resume must land on the same row.
    expect(init.leagueId).toBe('yahoo-manual');
    expect(init.draftId).toBe('yahoo-manual-4');
  });

  it('uses full-PPR scoring when reception=ppr is selected', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<YahooDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Scoring'), 'ppr');
    await user.click(screen.getByRole('button', { name: 'Start draft' }));
    const init: DraftInit = onSubmit.mock.calls[0]?.[0];
    expect(init.settings.scoring.rec).toBe(1);
    expect(init.settings.format.reception).toBe('ppr');
  });

  it('uses standard scoring (rec: 0) when reception=standard is selected', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<YahooDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Scoring'), 'standard');
    await user.click(screen.getByRole('button', { name: 'Start draft' }));
    const init: DraftInit = onSubmit.mock.calls[0]?.[0];
    expect(init.settings.scoring.rec).toBe(0);
  });

  it('rejects a slot outside the team count', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<YahooDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);
    // Default 12 teams.
    await user.clear(screen.getByLabelText(/Your draft position/));
    await user.type(screen.getByLabelText(/Your draft position/), '13');
    const submit = screen.getByRole('button', { name: 'Start draft' });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a blank league name', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<YahooDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.clear(screen.getByLabelText('League name'));
    const submit = screen.getByRole('button', { name: 'Start draft' });
    expect(submit).toBeDisabled();
  });

  it('cancels without submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<YahooDraftSetup onSubmit={onSubmit} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders the half-PPR preset disclosure so the unmodeled-bonuses gap is visible', () => {
    render(<YahooDraftSetup onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('yahoo-preset-disclosure')).toHaveTextContent(/TE premium/);
  });
});
