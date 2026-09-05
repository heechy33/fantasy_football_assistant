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
    await user.clear(screen.getByLabelText('Draft position'));
    await user.type(screen.getByLabelText('Draft position'), '4');
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
    await user.clear(screen.getByLabelText('Draft position'));
    await user.type(screen.getByLabelText('Draft position'), '13');
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

  it('renders vertical Sleeper-style roster slots with default rows', () => {
    render(<YahooDraftSetup onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Roster Settings')).toBeInTheDocument();
    expect(screen.getByText('Set roster positions')).toBeInTheDocument();
    expect(screen.getAllByTestId('roster-slot-row-qb')).toHaveLength(1);
    expect(screen.getAllByTestId('roster-slot-row-rb')).toHaveLength(2);
    expect(screen.getAllByTestId('roster-slot-row-wr')).toHaveLength(2);
    expect(screen.getAllByTestId('roster-slot-row-te')).toHaveLength(1);
    expect(screen.getAllByTestId('roster-slot-row-flex')).toHaveLength(1);
    expect(screen.getAllByTestId('roster-slot-row-k')).toHaveLength(1);
    expect(screen.getAllByTestId('roster-slot-row-def')).toHaveLength(1);
    expect(screen.getAllByTestId('roster-slot-row-d')).toHaveLength(1);
    expect(screen.getAllByTestId('roster-slot-row-s')).toHaveLength(1);
    expect(screen.getAllByTestId('roster-slot-row-bn')).toHaveLength(6);
  });

  it("configures Herbert's league with 2 Flex, 6 Bench, 1 D and 1 S yielding 18 rounds", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<YahooDraftSetup onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.clear(screen.getByLabelText('League name'));
    await user.type(screen.getByLabelText('League name'), "Herbert's League");
    await user.selectOptions(screen.getByLabelText('Teams'), '10');
    await user.selectOptions(screen.getByLabelText('Scoring'), 'ppr');

    // Increase Flex: from default 1 to 2 -> creates another FLEX row
    await user.click(screen.getByRole('button', { name: 'Increase FLEX (W/R/T)' }));
    expect(screen.getAllByTestId('roster-slot-row-flex')).toHaveLength(2);

    // Increase D: from default 0 to 1 -> activates 1 D row
    await user.click(screen.getByRole('button', { name: 'Increase D' }));
    expect(screen.getAllByTestId('roster-slot-row-d')).toHaveLength(1);

    // Increase S: from default 0 to 1 -> activates 1 S row
    await user.click(screen.getByRole('button', { name: 'Increase S' }));
    expect(screen.getAllByTestId('roster-slot-row-s')).toHaveLength(1);

    // Bench: default is 6

    expect(screen.getByTestId('yahoo-rounds-summary')).toHaveTextContent('Draft Rounds: 18');
    expect(screen.getByTestId('yahoo-rounds-summary')).toHaveTextContent('(10 starters + 6 bench + 1 D + 1 S)');

    await user.clear(screen.getByLabelText('Draft position'));
    await user.type(screen.getByLabelText('Draft position'), '8');
    await user.click(screen.getByRole('button', { name: 'Start draft' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const init: DraftInit = onSubmit.mock.calls[0]?.[0];
    expect(init.teams).toBe(10);
    expect(init.rounds).toBe(18);
    expect(init.mySlot).toBe(8);
    expect(init.myTeamId).toBe('8');
    expect(init.settings.format.reception).toBe('ppr');

    // Starters: QB, RB, RB, WR, WR, TE, FLEX, FLEX, K, DEF (10 starters)
    expect(init.settings.startingSlots.filter((s) => s === 'FLEX')).toHaveLength(2);
    expect(init.settings.startingSlots).toHaveLength(10);

    // Bench + D + S combined capacity in BN
    expect(init.settings.rosterSlots.BN).toBe(8); // 6 bench + 1 D + 1 S
  });
});
