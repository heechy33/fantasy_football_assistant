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
  slotToTeam: { 1: 'me', 2: 'them' }, myTeamId: 'me', mySlot: 1, settings,
};

const player: PlayerMeta = { playerId: 'p1', name: 'Known Player', position: 'RB', eligiblePositions: ['RB'], team: 'BUF', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
const playersById = new Map([[player.playerId, player]]);

function pick(overall: number, teamId: string, playerId: string | null, providerPlayerName?: string): Pick {
  return { overall, round: Math.ceil(overall / 2), slot: 1, teamId, playerId, providerPlayerId: playerId ?? 'raw-id', providerPlayerName };
}

describe('DraftLog', () => {
  it('lists every overall pick slot for the draft, not just made picks', () => {
    render(
      <DraftLog
        draftInit={draftInit}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player')]}
        playersById={playersById}
        onTheClock={{ teamId: 'them', slot: 2, round: 1, overall: 2 }}
        status="drafting"
        isStale={false}
        dataAgeMs={null}
        onCorrectPick={vi.fn()}
      />,
    );
    // teams(2) * rounds(2) = 4 total pick slots.
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('Known Player')).toBeInTheDocument();
  });

  it('marks the on-the-clock row and mine rows, and shows Fix only for unmatched picks', () => {
    const onCorrectPick = vi.fn();
    render(
      <DraftLog
        draftInit={draftInit}
        effectivePicks={[pick(1, 'me', 'p1', 'Known Player'), pick(2, 'them', null, 'Some Rookie')]}
        playersById={playersById}
        onTheClock={{ teamId: 'me', slot: 1, round: 2, overall: 3 }}
        status="drafting"
        isStale={false}
        dataAgeMs={null}
        onCorrectPick={onCorrectPick}
      />,
    );

    expect(screen.getByText('Unmatched: Some Rookie')).toBeInTheDocument();
    // Matched picks (Known Player) never get a Fix button — the log is read-only for them.
    expect(screen.getAllByRole('button', { name: 'Fix' })).toHaveLength(1);

    const onClockRow = screen.getByText('#3').closest('li');
    expect(onClockRow).toHaveAttribute('data-on-clock', 'true');
    expect(onClockRow).toHaveAttribute('data-mine', 'true');
    expect(onClockRow).toHaveAttribute('data-scroll-target', 'true');

    const myPickRow = screen.getByText('#1').closest('li');
    expect(myPickRow).toHaveAttribute('data-mine', 'true');
    expect(myPickRow).not.toHaveAttribute('data-on-clock');
  });

  it('calls onCorrectPick with the overall number when Fix is clicked on an unmatched pick', async () => {
    const onCorrectPick = vi.fn();
    const user = userEvent.setup();
    render(
      <DraftLog
        draftInit={draftInit}
        effectivePicks={[pick(2, 'them', null, 'Some Rookie')]}
        playersById={playersById}
        onTheClock={null}
        status="drafting"
        isStale={false}
        dataAgeMs={null}
        onCorrectPick={onCorrectPick}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Fix' }));
    expect(onCorrectPick).toHaveBeenCalledWith(2);
  });

  it('go-to-current-pick scrolls the on-the-clock row into view', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <DraftLog
        draftInit={draftInit}
        effectivePicks={[]}
        playersById={playersById}
        onTheClock={{ teamId: 'me', slot: 1, round: 1, overall: 1 }}
        status="drafting"
        isStale={false}
        dataAgeMs={null}
        onCorrectPick={vi.fn()}
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
        draftInit={draftInit}
        effectivePicks={completePicks}
        playersById={playersById}
        onTheClock={null}
        status="complete"
        isStale={false}
        dataAgeMs={null}
        onCorrectPick={vi.fn()}
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

  it('renders a placeholder when no draft is connected', () => {
    render(
      <DraftLog
        draftInit={null}
        effectivePicks={[]}
        playersById={playersById}
        onTheClock={null}
        status="pre"
        isStale={false}
        dataAgeMs={null}
        onCorrectPick={vi.fn()}
      />,
    );
    expect(screen.getByText('No draft connected yet.')).toBeInTheDocument();
  });
});
