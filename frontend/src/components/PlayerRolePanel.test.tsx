import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OpportunityPeriod, PlayerMeta, PlayerUsage, PlayerWeeklyStatsArtifact } from '../../../shared/types';
import type { WeeklyStatsState } from '../hooks/useWeeklyStats';
import { PlayerRolePanel } from './PlayerRolePanel';

const rb: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

function period(overrides: Partial<OpportunityPeriod> = {}): OpportunityPeriod {
  return {
    season: 2025, games: 16, targets: 40, carries: 180, touches: 220,
    targetsPerGame: 2.5, carriesPerGame: 11.25, touchesPerGame: 10.4,
    targetShare: 0.08, carryShare: 0.28, airYards: null, airYardsPerGame: null,
    airYardsShare: null, receivingYardsAfterCatch: 120,
    redZoneTargets: 10, endZoneTargets: 1, goalLineCarries: 9, snapPct: 0.55,
    ...overrides,
  };
}

const usage: PlayerUsage = {
  season: 2025, usageSeasonObserved: true, snapPct: 0.55, targetShare: 0.08, carryShare: 0.28,
  gamesWithAnySnap: 16, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
  availabilityRate: 16 / 17, seasons: [], injuryHistory: [], durabilityScore: null,
  opportunity: {
    season: period(),
    finalFive: period({ games: 5, targetsPerGame: 1.8, touchesPerGame: 7.0 }),
    roleEvolution: {
      targetsPerGameDelta: -0.8,
      targetShareDelta: -0.024,
      airYardsShareDelta: null,
      touchesPerGameDelta: -3.4,
    },
  },
  production: {
    games: 16,
    pointsPpr: 240.4,
    pointsPprPerGame: 15.0,
    receptions: 24,
    receivingYards: 180,
    receivingTds: 1,
    rushingYards: 1125,
    rushingTds: 9,
  },
};

const rbWeeklyArtifact: PlayerWeeklyStatsArtifact = {
  schemaVersion: 1, season: 2025, weeksFetched: [1],
  columns: {
    RB: ['pts', 'opp', 'snp', 'fin', 'rush_att', 'rush_yd', 'rush_ypa', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'fum_lost'],
  },
  players: {
    rb1: { p: 'RB', bye: 7, w: [[1, 14.2, 'KC', 55, 5, 12, 60, 5.0, 0, 2, 1, 8, 0, 0]] },
  },
  heat: {},
};

function readyWeeklyStats(artifact: PlayerWeeklyStatsArtifact): WeeklyStatsState {
  return { artifact, status: 'ready' };
}

describe('PlayerRolePanel', () => {
  it('shows RB carry share, YPC/YPR, goal-line carries, and a falling role-change chip', () => {
    render(
      <PlayerRolePanel
        player={rb}
        usage={usage}
        feedStatus="ready"
        weeklyStats={readyWeeklyStats(rbWeeklyArtifact)}
      />,
    );
    expect(screen.getByText('Carry share')).toBeInTheDocument();
    expect(screen.getByText('28%')).toBeInTheDocument();
    // YPC = 1125 rushing yds / 180 carries; YPR = 180 rec yds / 24 receptions.
    expect(screen.getByText('YPC')).toBeInTheDocument();
    expect(screen.getByText('6.3')).toBeInTheDocument();
    expect(screen.getByText('YPR')).toBeInTheDocument();
    expect(screen.getByText('7.5')).toBeInTheDocument();
    expect(screen.getByText('Goal-line carries')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getAllByText('-0.8').length).toBeGreaterThan(0);
    expect(screen.getByText(/PPR\/g/)).toBeInTheDocument();
  });

  it('hides goal-line carries for WR', () => {
    render(
      <PlayerRolePanel
        player={{ ...rb, position: 'WR', eligiblePositions: ['WR'] }}
        usage={usage}
        feedStatus="ready"
      />,
    );
    expect(screen.queryByText('Goal-line carries')).not.toBeInTheDocument();
    expect(screen.getByText('End-zone targets')).toBeInTheDocument();
    expect(screen.getByText('Air-yard share')).toBeInTheDocument();
  });

  it('fail-opens when production is absent and still shows opportunity', () => {
    render(<PlayerRolePanel player={rb} usage={{ ...usage, production: undefined }} feedStatus="ready" />);
    expect(screen.getByText('Carry share')).toBeInTheDocument();
    expect(screen.queryByText('Receptions')).not.toBeInTheDocument();
  });

  it('explains missing history instead of fabricating zeros', () => {
    render(<PlayerRolePanel player={rb} usage={undefined} feedStatus="ready" />);
    expect(screen.getByText('No verifiable prior-season roster history is available.')).toBeInTheDocument();
  });

  it('builds QB Passing/Rushing/Efficiency/Form columns from the weekly game log, not opportunity', () => {
    const qb: PlayerMeta = { ...rb, playerId: 'qb1', position: 'QB', eligiblePositions: ['QB'] };
    const artifact: PlayerWeeklyStatsArtifact = {
      schemaVersion: 1, season: 2025, weeksFetched: [1],
      columns: {
        QB: ['pts', 'opp', 'snp', 'fin', 'pass_cmp', 'pass_att', 'cmp_pct', 'pass_yd', 'pass_ypa', 'pass_td',
          'pass_int', 'pass_air_yd', 'pass_sack', 'pass_rtg', 'rush_att', 'rush_yd', 'rush_td'],
      },
      players: {
        qb1: { p: 'QB', bye: 9, w: [[1, 25.0, '@KC', 95, 3, 22, 30, 73.3, 280, 9.3, 2, 1, 200, 2, 110.5, 3, 15, 0]] },
      },
      heat: {},
    };
    // QB has no usage.opportunity data at all -- the weekly path must not need it.
    render(<PlayerRolePanel player={qb} usage={undefined} feedStatus="ready" weeklyStats={readyWeeklyStats(artifact)} />);
    expect(screen.getByText('Passing')).toBeInTheDocument();
    expect(screen.getByText('Rushing')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Form')).toBeInTheDocument();
    expect(screen.getByText('Pass yd/g')).toBeInTheDocument();
    // Completion % replaces the old snap-share stat (22/30 = 73.3%), and attempts/g
    // fill the slot Cmp% vacated in Passing so nothing is duplicated.
    expect(screen.getByText('Cmp%')).toBeInTheDocument();
    expect(screen.getByText('73.3%')).toBeInTheDocument();
    expect(screen.getByText('Att/g')).toBeInTheDocument();
    expect(screen.queryByText('Snap share')).not.toBeInTheDocument();
    expect(screen.queryByText('Role stats are for offensive skill positions.')).not.toBeInTheDocument();
  });

  it('builds K Volume/Accuracy/Distance/Form columns from the weekly game log', () => {
    const k: PlayerMeta = { ...rb, playerId: 'k1', position: 'K', eligiblePositions: ['K'] };
    const artifact: PlayerWeeklyStatsArtifact = {
      schemaVersion: 1, season: 2025, weeksFetched: [1],
      columns: { K: ['pts', 'opp', 'snp', 'fin', 'fgm', 'fga', 'fgm_pct', 'fgm_lng', 'fgm_50p', 'fgm_yds', 'xpm', 'xpa'] },
      players: { k1: { p: 'K', bye: 7, w: [[1, 10.0, 'DAL', 20, 2, 2, 2, 100.0, 45, 0, 80, 4, 4]] } },
      heat: {},
    };
    render(<PlayerRolePanel player={k} usage={undefined} feedStatus="ready" weeklyStats={readyWeeklyStats(artifact)} />);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('Accuracy')).toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('FGA/g')).toBeInTheDocument();
    expect(screen.queryByText('Role stats are for offensive skill positions.')).not.toBeInTheDocument();
  });

  it('builds DEF Pressure/Takeaways/Prevention/Form columns and no longer dead-ends', () => {
    const def: PlayerMeta = { ...rb, playerId: 'SF', position: 'DEF', eligiblePositions: ['DEF'] };
    const artifact: PlayerWeeklyStatsArtifact = {
      schemaVersion: 1, season: 2025, weeksFetched: [1],
      columns: {
        DEF: ['pts', 'opp', 'fin', 'sack', 'int', 'fum_rec', 'ff', 'def_td', 'blk_kick', 'safe', 'qb_hit', 'def_pass_def', 'pts_allow', 'yds_allow'],
      },
      players: { SF: { p: 'DEF', bye: 14, w: [[1, 9.0, 'NYG', 5, 2, 1, 0, 1, 0, 0, 0, 3, 2, 17, 310]] } },
      heat: {},
    };
    render(<PlayerRolePanel player={def} usage={undefined} feedStatus="ready" weeklyStats={readyWeeklyStats(artifact)} />);
    expect(screen.getByText('Pressure')).toBeInTheDocument();
    expect(screen.getByText('Takeaways')).toBeInTheDocument();
    expect(screen.getByText('Prevention')).toBeInTheDocument();
    expect(screen.getByText('Pts allowed/g')).toBeInTheDocument();
    expect(screen.queryByText('Role stats are for offensive skill positions.')).not.toBeInTheDocument();
  });

  it('shows a weekly-specific fallback for QB/K/DEF when there is no weekly series, not the opportunity fallback', () => {
    const k: PlayerMeta = { ...rb, playerId: 'k-nodata', position: 'K', eligiblePositions: ['K'] };
    const artifact: PlayerWeeklyStatsArtifact = {
      schemaVersion: 1, season: 2025, weeksFetched: [1],
      columns: { K: ['pts', 'opp', 'snp', 'fin', 'fgm', 'fga', 'fgm_pct', 'fgm_lng', 'fgm_50p', 'fgm_yds', 'xpm', 'xpa'] },
      players: {},
      heat: {},
    };
    render(<PlayerRolePanel player={k} usage={undefined} feedStatus="ready" weeklyStats={readyWeeklyStats(artifact)} />);
    expect(screen.getByText('No 2025 weekly game log for this player.')).toBeInTheDocument();
  });
});
