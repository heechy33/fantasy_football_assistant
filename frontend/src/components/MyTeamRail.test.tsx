import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

describe('MyTeamRail', () => {
  it('fills only one of two RB slots and shows the other explicitly empty (diffed by count, not by set)', () => {
    const effectivePicks = [pick(1, 'me', 'rb1')];
    render(<MyTeamRail settings={settings} effectivePicks={effectivePicks} myTeamId="me" playersById={playersById} projections={projections} />);

    const slots = screen.getAllByRole('listitem').filter((li) => li.className.includes('my-team-slot') && !li.className.includes('bench'));
    const rbSlots = slots.filter((li) => within(li).queryByText('RB'));
    expect(rbSlots).toHaveLength(2);
    // Which of the two identically-labeled RB slots the solver fills is an implementation detail —
    // the load-bearing assertion is that exactly one is filled and one is explicitly empty (diffed
    // by count), not which index.
    const filledCount = rbSlots.filter((li) => within(li).queryByText('Rush One')).length;
    const emptyCount = rbSlots.filter((li) => within(li).queryByText('Empty')).length;
    expect(filledCount).toBe(1);
    expect(emptyCount).toBe(1);
  });

  it('starts the higher-value WR and lists multiple bench players in draft order', () => {
    // wr1 (140 pts, pick 3) starts; wr2 (20 pts, pick 1) and wr3 (10 pts, pick 2) bench.
    // Bench must follow draft overall ascending — wr2 before wr3 — not projection order.
    const effectivePicks = [pick(1, 'me', 'wr2'), pick(2, 'me', 'wr3'), pick(3, 'me', 'wr1')];
    render(<MyTeamRail settings={settings} effectivePicks={effectivePicks} myTeamId="me" playersById={playersById} projections={projections} />);

    const wrSlot = screen.getAllByRole('listitem').find((li) => within(li).queryByText('WR'));
    expect(wrSlot && within(wrSlot).getByText('Wide One')).toBeInTheDocument();

    const benchList = screen.getByText('Bench').closest('section')?.querySelector('.my-team-bench');
    expect(benchList).toBeTruthy();
    const benchNames = within(benchList as HTMLElement).getAllByRole('listitem').map((li) => li.textContent);
    expect(benchNames[0]).toContain('Wide Two');
    expect(benchNames[1]).toContain('Wide Three');
  });

  it('ignores picks belonging to other teams', () => {
    const effectivePicks = [pick(1, 'me', 'rb1'), pick(2, 'them', 'wr1')];
    render(<MyTeamRail settings={settings} effectivePicks={effectivePicks} myTeamId="me" playersById={playersById} projections={projections} />);
    expect(screen.queryByText('Wide One')).not.toBeInTheDocument();
  });
});
