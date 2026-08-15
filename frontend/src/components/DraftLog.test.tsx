import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DraftInit, LeagueSettings, Pick, PlayerMeta } from '../../../shared/types';
import { DraftLog } from './DraftLog';

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'l1', name: 'Fixture', season: '2026', teams: 2,
  startingSlots: ['QB'], rosterSlots: { QB: 1 },
  scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};
const draftInit: DraftInit = {
  provider: 'sleeper', draftId: 'd1', leagueId: 'l1', draftType: 'snake', teams: 2, rounds: 2,
  slotToTeam: { 1: 'me', 2: 'them' }, slotToTeamName: { 1: 'My Squad' }, myTeamId: 'me', mySlot: 1, settings,
};

const player: PlayerMeta = { playerId: 'p1', name: 'Known Player', position: 'RB', eligiblePositions: ['RB'], team: 'BUF', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
const playersById = new Map([[player.playerId, player]]);

function pick(overall: number, teamId: string, playerId: string | null, providerPlayerName?: string): Pick {
  return { overall, round: Math.ceil(overall / 2), slot: teamId === 'me' ? 1 : 2, teamId, playerId, providerPlayerId: playerId ?? 'raw-id', providerPlayerName };
}

function baseProps() {
  return {
    draftInit,
    effectivePicks: [] as Pick[],
    playersById,
    onTheClock: null,
    userNextOverall: null as number | null,
    picksUntilUserTurn: null as number | null,
  };
}

describe('DraftLog', () => {
  it('lists every overall pick slot for the draft, not just made picks', () => {
    render(
      <DraftLog
        {...baseProps()}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player')]}
        onTheClock={{ teamId: 'them', slot: 2, round: 1, overall: 2 }}
      />,
    );
    // teams(2) * rounds(2) = 4 total pick slots.
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('Known Player')).toBeInTheDocument();
  });

  it('numbers every pick with the overall pick number (e.g. #97)', () => {
    render(<DraftLog {...baseProps()} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();
  });

  it('shows the resolved team name and falls back to Team {slot} when unresolved', () => {
    render(<DraftLog {...baseProps()} />);
    expect(screen.getAllByText('My Squad').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Team 2').length).toBeGreaterThan(0);
  });

  it('renders a position chip for a matched pick', () => {
    render(<DraftLog {...baseProps()} effectivePicks={[pick(1, 'me', 'p1', 'Known Player')]} />);
    const chip = screen.getByText('RB', { selector: '.draft-log-position-chip' });
    expect(chip).toHaveAttribute('data-position', 'RB');
  });

  it('renders exactly one round separator per round', () => {
    render(<DraftLog {...baseProps()} />);
    const separators = screen.getAllByRole('presentation');
    expect(separators).toHaveLength(2); // teams(2) * rounds(2) = 4 picks / 2 teams = 2 rounds.
    expect(separators[0]).toHaveTextContent('Round 1');
    expect(separators[1]).toHaveTextContent('Round 2');
    // Round separators must not be counted as pick rows by existing list-item queries.
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it("marks the user's upcoming pick with 'You're up in N picks'", () => {
    render(<DraftLog {...baseProps()} userNextOverall={3} picksUntilUserTurn={2} />);
    expect(screen.getByText("You're up in 2 picks")).toBeInTheDocument();
    const row = screen.getByText('#3').closest('li');
    expect(row).toHaveAttribute('data-you-up', 'true');
  });

  it("uses the singular 'pick' when the user is up in one pick", () => {
    render(<DraftLog {...baseProps()} userNextOverall={2} picksUntilUserTurn={1} />);
    expect(screen.getByText("You're up in 1 pick")).toBeInTheDocument();
  });

  it("marks the user's upcoming pick with 'You're on the clock' when the count is zero", () => {
    render(<DraftLog {...baseProps()} userNextOverall={1} picksUntilUserTurn={0} />);
    expect(screen.getByText("You're on the clock")).toBeInTheDocument();
    const row = screen.getByText('#1').closest('li');
    expect(row).toHaveAttribute('data-you-up', 'true');
  });

  it('does not render an empty you-up chip when the countdown is unknown', () => {
    render(<DraftLog {...baseProps()} userNextOverall={3} picksUntilUserTurn={null} />);
    const row = screen.getByText('#3').closest('li');
    expect(row).toHaveAttribute('data-you-up', 'true');
    expect(screen.queryByText(/You're up/)).not.toBeInTheDocument();
    expect(screen.queryByText("You're on the clock")).not.toBeInTheDocument();
  });

  it('uses the landed pick slot for the team name even when it disagrees with snake arithmetic', () => {
    // Arithmetic slot for overall 1 in a 2-team snake is 1; a corrected/landed pick on slot 2
    // must still resolve Team 2, not My Squad.
    render(<DraftLog {...baseProps()} effectivePicks={[pick(1, 'them', 'p1', 'Known Player')]} />);
    expect(screen.getByText('#1').closest('li')).toHaveTextContent('Team 2');
  });

  it('renders a DST chip for a DEF player', () => {
    const defPlayer: PlayerMeta = { ...player, playerId: 'dst1', name: 'Buffalo', position: 'DEF', eligiblePositions: ['DEF'] };
    render(
      <DraftLog
        {...baseProps()}
        playersById={new Map([[defPlayer.playerId, defPlayer]])}
        effectivePicks={[pick(1, 'me', 'dst1', 'Buffalo')]}
      />,
    );
    const chip = screen.getByText('DST', { selector: '.draft-log-position-chip' });
    expect(chip).toHaveAttribute('data-position', 'DEF');
  });

  it('does not render a clock status banner — on-clock state is shown on the row', () => {
    render(
      <DraftLog
        {...baseProps()}
        onTheClock={{ teamId: 'me', slot: 1, round: 1, overall: 1 }}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('#1').closest('li')).toHaveAttribute('data-on-clock', 'true');
  });

  it('marks the on-the-clock row and mine rows for landed picks', () => {
    render(
      <DraftLog
        {...baseProps()}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player'), pick(2, 'them', null, 'Some Rookie')]}
        onTheClock={{ teamId: 'me', slot: 1, round: 2, overall: 3 }}
      />,
    );

    expect(screen.getByText('Unmatched: Some Rookie')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fix' })).not.toBeInTheDocument();

    const onClockRow = screen.getByText('#3').closest('li');
    expect(onClockRow).toHaveAttribute('data-on-clock', 'true');
    expect(onClockRow).toHaveAttribute('data-mine', 'true');
    expect(onClockRow).toHaveAttribute('data-scroll-target', 'true');

    const myPickRow = screen.getByText('#1').closest('li');
    expect(myPickRow).toHaveAttribute('data-mine', 'true');
    expect(myPickRow).not.toHaveAttribute('data-on-clock');
  });

  it('opens player details when a matched pick card is clicked', async () => {
    const onViewPlayer = vi.fn();
    const user = userEvent.setup();
    render(
      <DraftLog
        {...baseProps()}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player')]}
        onViewPlayer={onViewPlayer}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Known Player/ }));
    expect(onViewPlayer).toHaveBeenCalledWith('p1');
  });

  it('invokes the newest onViewPlayer callback after a parent rerender', async () => {
    const onViewPlayerFirst = vi.fn();
    const onViewPlayerSecond = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DraftLog
        {...baseProps()}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player')]}
        onViewPlayer={onViewPlayerFirst}
      />,
    );

    rerender(
      <DraftLog
        {...baseProps()}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player')]}
        onViewPlayer={onViewPlayerSecond}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Known Player/ }));
    expect(onViewPlayerFirst).not.toHaveBeenCalled();
    expect(onViewPlayerSecond).toHaveBeenCalledWith('p1');
  });

  it('go-to-current-pick scrolls the on-the-clock row into view', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <DraftLog
        {...baseProps()}
        effectivePicks={[]}
        onTheClock={{ teamId: 'me', slot: 1, round: 1, overall: 1 }}
      />,
    );
    scrollSpy.mockClear();
    await user.click(screen.getByRole('button', { name: 'Go to current pick' }));
    expect(scrollSpy).toHaveBeenCalled();
    const scrolled = scrollSpy.mock.instances[0] as HTMLElement;
    expect(scrolled).toHaveAttribute('data-scroll-target', 'true');
    expect(scrolled).toHaveAttribute('data-on-clock', 'true');
    expect(scrolled.textContent).toContain('#1');
    scrollSpy.mockRestore();
  });

  it('go-to-current-pick scrolls the final pick when the draft is complete', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const user = userEvent.setup();
    const completePicks = [
      pick(1, 'me', 'p1', 'Known Player'),
      pick(2, 'them', 'p1', 'Known Player'),
      pick(3, 'them', 'p1', 'Known Player'),
      pick(4, 'me', 'p1', 'Known Player'),
    ];
    render(
      <DraftLog
        {...baseProps()}
        effectivePicks={completePicks}
        onTheClock={null}
      />,
    );
    scrollSpy.mockClear();
    await user.click(screen.getByRole('button', { name: 'Go to current pick' }));
    expect(scrollSpy).toHaveBeenCalled();
    const scrolled = scrollSpy.mock.instances[0] as HTMLElement;
    expect(scrolled).toHaveAttribute('data-scroll-target', 'true');
    expect(scrolled).not.toHaveAttribute('data-on-clock');
    expect(scrolled.textContent).toContain('#4');
    scrollSpy.mockRestore();
  });

  it('stops auto-following once the user scrolls the current row out of view', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { rerender } = render(
      <DraftLog
        {...baseProps()}
        onTheClock={{ teamId: 'me', slot: 1, round: 1, overall: 1 }}
      />,
    );
    scrollSpy.mockClear();

    const list = document.querySelector('.draft-log-list')!;
    const row = list.querySelector('[data-scroll-target]')!;
    // jsdom has no layout engine: fake the current row fully below the list's visible band so the
    // manual-scroll detector treats this scroll as "scrolled away."
    Object.defineProperty(list, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 100 }) });
    Object.defineProperty(row, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 500, bottom: 600 }) });
    list.dispatchEvent(new Event('scroll'));

    // Advancing picks move the clock target, but auto-follow must stay silent after the user read away.
    rerender(
      <DraftLog
        {...baseProps()}
        onTheClock={{ teamId: 'them', slot: 2, round: 1, overall: 2 }}
      />,
    );
    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('re-engages auto-follow when the user clicks Go to current pick after scrolling away', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const user = userEvent.setup();
    const { rerender } = render(
      <DraftLog
        {...baseProps()}
        onTheClock={{ teamId: 'me', slot: 1, round: 1, overall: 1 }}
      />,
    );
    scrollSpy.mockClear();

    const list = document.querySelector('.draft-log-list')!;
    const row = list.querySelector('[data-scroll-target]')!;
    Object.defineProperty(list, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 100 }) });
    Object.defineProperty(row, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 500, bottom: 600 }) });
    list.dispatchEvent(new Event('scroll'));

    await user.click(screen.getByRole('button', { name: 'Go to current pick' }));
    expect(scrollSpy).toHaveBeenCalled();

    scrollSpy.mockClear();
    rerender(
      <DraftLog
        {...baseProps()}
        onTheClock={{ teamId: 'them', slot: 2, round: 1, overall: 2 }}
      />,
    );
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('re-engages auto-follow when a new draft connects after the user scrolled away', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const newDraft: DraftInit = { ...draftInit, draftId: 'd2' };
    const { rerender } = render(
      <DraftLog
        {...baseProps()}
        onTheClock={{ teamId: 'me', slot: 1, round: 1, overall: 1 }}
      />,
    );
    scrollSpy.mockClear();

    const list = document.querySelector('.draft-log-list')!;
    const row = list.querySelector('[data-scroll-target]')!;
    Object.defineProperty(list, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 100 }) });
    Object.defineProperty(row, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 500, bottom: 600 }) });
    list.dispatchEvent(new Event('scroll'));

    rerender(
      <DraftLog
        {...baseProps()}
        draftInit={newDraft}
        onTheClock={{ teamId: 'me', slot: 1, round: 1, overall: 1 }}
      />,
    );
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('renders a placeholder when no draft is connected', () => {
    render(<DraftLog {...baseProps()} draftInit={null} />);
    expect(screen.getByText('No draft connected yet.')).toBeInTheDocument();
  });

  it('renders an Edit button only on drafted rows and calls onCorrect with the overall', async () => {
    const user = userEvent.setup();
    const onCorrect = vi.fn();
    render(
      <DraftLog
        {...baseProps()}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player')]}
        onCorrect={onCorrect}
      />,
    );

    const editButton = screen.getByRole('button', { name: 'Edit pick #1' });
    await user.click(editButton);
    expect(onCorrect).toHaveBeenCalledWith(1);
    // Future slots (overall 2-4) must not get an Edit affordance.
    expect(screen.queryByRole('button', { name: 'Edit pick #2' })).not.toBeInTheDocument();
  });
});
