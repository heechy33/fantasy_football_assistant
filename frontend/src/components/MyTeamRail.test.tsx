import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LeagueSettings, Pick, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { MyTeamRail } from './MyTeamRail';

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'l1', name: 'Fixture', season: '2026', teams: 2,
  startingSlots: ['QB', 'RB', 'RB', 'WR', 'TE'],
  rosterSlots: { QB: 1, RB: 2, WR: 1, TE: 1, BN: 4 },
  scoring: { rush_yd: 0.1, rec_yd: 0.1, rec: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function player(playerId: string, name: string, position: PlayerMeta['position']): PlayerMeta {
  return { playerId, name, position, eligiblePositions: position ? [position] : [], team: 'BUF', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
}

const players = [
  player('rb1', 'Rush One', 'RB'),
  player('wr1', 'Wide One', 'WR'),
  player('wr2', 'Wide Two', 'WR'),
  player('wr3', 'Wide Three', 'WR'),
];
const playersById = new Map(players.map((p) => [p.playerId, p]));
const projections: SeasonProjection[] = [
  { playerId: 'rb1', source: 'fftoday', stats: { rush_yd: 500 } }, // 50 pts
  { playerId: 'wr1', source: 'fftoday', stats: { rec_yd: 800, rec: 60 } }, // 140 pts
  { playerId: 'wr2', source: 'fftoday', stats: { rec_yd: 100, rec: 10 } }, // 20 pts
  { playerId: 'wr3', source: 'fftoday', stats: { rec_yd: 50, rec: 5 } }, // 10 pts
];

function pick(overall: number, teamId: string, playerId: string): Pick {
  return { overall, round: 1, slot: 1, teamId, playerId, providerPlayerId: playerId };
}

function baseProps(overrides: Partial<Parameters<typeof MyTeamRail>[0]> = {}) {
  return { settings, effectivePicks: [] as Pick[], myTeamId: 'me', playersById, projections, rounds: 15, ...overrides };
}

function groupFor(buttonName: RegExp): HTMLElement {
  return screen.getByRole('button', { name: buttonName }).closest('.my-team-group') as HTMLElement;
}

describe('MyTeamRail', () => {
  it('fills only one of two RB slots and shows the other explicitly empty (diffed by count, not by set)', () => {
    render(<MyTeamRail {...baseProps({ effectivePicks: [pick(1, 'me', 'rb1')] })} />);

    const rbGroup = groupFor(/Running Backs/);
    expect(within(rbGroup).getAllByRole('listitem')).toHaveLength(2);
    expect(within(rbGroup).getAllByText('Rush One')).toHaveLength(1);
    expect(within(rbGroup).getAllByText('Empty')).toHaveLength(1);
  });

  it('groups the roster by position with the drafted/total header counter', () => {
    render(<MyTeamRail {...baseProps({ effectivePicks: [pick(1, 'me', 'rb1')] })} />);

    expect(screen.getByText('1/15')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quarterbacks \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Running Backs \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wide Receivers \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tight Ends \(1\)/ })).toBeInTheDocument();
  });

  it('starts the higher-value WR and lists multiple bench players in draft order', () => {
    // wr1 (140 pts, pick 3) starts; wr2 (20 pts, pick 1) and wr3 (10 pts, pick 2) bench.
    // Bench must follow draft overall ascending — wr2 before wr3 — not projection order.
    const effectivePicks = [pick(1, 'me', 'wr2'), pick(2, 'me', 'wr3'), pick(3, 'me', 'wr1')];
    render(<MyTeamRail {...baseProps({ effectivePicks })} />);

    const wrGroup = groupFor(/Wide Receivers/);
    expect(within(wrGroup).getByText('Wide One')).toBeInTheDocument();

    const benchGroup = groupFor(/Bench/);
    const benchNames = within(benchGroup).getAllByRole('listitem').map((li) => li.textContent);
    expect(benchNames[0]).toContain('Wide Two');
    expect(benchNames[1]).toContain('Wide Three');
  });

  it('ignores picks belonging to other teams', () => {
    render(<MyTeamRail {...baseProps({ effectivePicks: [pick(1, 'me', 'rb1'), pick(2, 'them', 'wr1')] })} />);
    expect(screen.queryByText('Wide One')).not.toBeInTheDocument();
  });

  it('renders no player portrait image — team identity replaces headshots', () => {
    const { container } = render(<MyTeamRail {...baseProps({ effectivePicks: [pick(1, 'me', 'rb1')] })} />);
    expect(container.querySelectorAll('.player-portrait')).toHaveLength(0);
  });

  it('each filled row carries data-team and a --team-logo custom property', () => {
    render(<MyTeamRail {...baseProps({ effectivePicks: [pick(1, 'me', 'rb1')] })} />);
    const filledSlot = screen.getByText('Rush One').closest('li')!;
    expect(filledSlot).toHaveAttribute('data-team', 'BUF');
    expect(filledSlot.getAttribute('style')).toContain('--team-logo');
    expect(filledSlot.getAttribute('style')).toContain('sleepercdn.com/images/team_logos/nfl/buf.png');
  });

  it('a free-agent player renders without data-team and with --team-logo: none', () => {
    const freeAgent = { playerId: 'fa1', name: 'Free Agent', position: 'WR' as const, eligiblePositions: ['WR' as const], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
    const byId = new Map([...playersById, [freeAgent.playerId, freeAgent]]);
    render(<MyTeamRail {...baseProps({ effectivePicks: [pick(1, 'me', 'fa1')], playersById: byId })} />);
    const filledSlot = screen.getByText('Free Agent').closest('li')!;
    expect(filledSlot).not.toHaveAttribute('data-team');
    expect(filledSlot.getAttribute('style')).toContain('--team-logo: none');
  });

  it('shows bye week on filled starter and bench rows instead of projected points', () => {
    const byId = new Map(playersById);
    byId.set('wr1', { ...players[1]!, byeWeek: 7 });
    byId.set('wr2', { ...players[2]!, byeWeek: 12 });
    const effectivePicks = [pick(1, 'me', 'wr2'), pick(2, 'me', 'wr3'), pick(3, 'me', 'wr1')];
    render(<MyTeamRail {...baseProps({ effectivePicks, playersById: byId })} />);

    const wrGroup = groupFor(/Wide Receivers/);
    expect(within(wrGroup).getByText('Bye 7')).toBeInTheDocument();
    expect(screen.queryByText('140.0')).not.toBeInTheDocument();
    expect(screen.queryByText('20.0')).not.toBeInTheDocument();

    const benchGroup = groupFor(/Bench/);
    expect(within(benchGroup).getByText('Bye 12')).toBeInTheDocument();
    expect(within(benchGroup).getByText('Bye —')).toBeInTheDocument();
  });

  it('keeps the bench height with an empty-state placeholder row', () => {
    render(<MyTeamRail {...baseProps({ effectivePicks: [] })} />);
    const benchGroup = groupFor(/Bench/);
    expect(within(benchGroup).getByText('No bench players yet.')).toBeInTheDocument();
  });

  it('opens the player drawer when a filled row is clicked', async () => {
    const onViewPlayer = vi.fn();
    const user = userEvent.setup();
    render(<MyTeamRail {...baseProps({ effectivePicks: [pick(1, 'me', 'rb1')], onViewPlayer })} />);
    await user.click(screen.getByText('Rush One'));
    expect(onViewPlayer).toHaveBeenCalledWith('rb1');
  });
});
