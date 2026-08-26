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

  it('renders the STACKED QB percentile rankings from the weekly game log cohort', () => {
    const qb: PlayerMeta = { ...rb, playerId: 'qb1', position: 'QB', eligiblePositions: ['QB'] };
    const artifact: PlayerWeeklyStatsArtifact = {
      schemaVersion: 1, season: 2025, weeksFetched: [1],
      columns: {
        QB: ['pts', 'opp', 'snp', 'fin', 'pass_cmp', 'pass_att', 'cmp_pct', 'pass_yd', 'pass_ypa', 'pass_td',
          'pass_int', 'pass_air_yd', 'pass_sack', 'pass_rtg', 'rush_att', 'rush_yd', 'rush_td'],
      },
      players: {
        // qb1 is the passing-yards cohort max; qb2..qb6 step down so the cohort ranks.
        qb1: { p: 'QB', bye: 9, w: [[1, 25.0, '@KC', 95, 3, 22, 30, 73.3, 280, 9.3, 2, 1, 200, 2, 110.5, 3, 15, 0]] },
        qb2: { p: 'QB', bye: 6, w: [[1, 22.0, 'DAL', 92, 4, 20, 30, 66.7, 260, 8.7, 2, 0, 190, 1, 105.0, 2, 12, 0]] },
        qb3: { p: 'QB', bye: 5, w: [[1, 20.0, 'NYG', 90, 5, 19, 30, 63.3, 240, 8.0, 1, 1, 180, 1, 100.0, 2, 10, 0]] },
        qb4: { p: 'QB', bye: 8, w: [[1, 18.0, 'CHI', 88, 6, 18, 30, 60.0, 220, 7.3, 1, 1, 170, 0, 95.0, 1, 8, 0]] },
        qb5: { p: 'QB', bye: 11, w: [[1, 16.0, 'LV', 85, 7, 17, 30, 56.7, 200, 6.7, 1, 2, 160, 0, 90.0, 1, 5, 0]] },
        qb6: { p: 'QB', bye: 12, w: [[1, 14.0, 'TEN', 82, 8, 16, 30, 53.3, 180, 6.0, 0, 2, 150, 0, 85.0, 0, 2, 0]] },
      },
      heat: {},
    };
    render(<PlayerRolePanel player={qb} usage={undefined} feedStatus="ready" weeklyStats={readyWeeklyStats(artifact)} />);
    expect(screen.getByRole('heading', { name: '2025 QB percentile rankings' })).toBeInTheDocument();
    expect(screen.getByText('Passing Volume')).toBeInTheDocument();
    expect(screen.getByText('Passing Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Rushing')).toBeInTheDocument();
    const yardsRow = screen.getByText('Passing Yards').closest('.percentile-row')!;
    expect(yardsRow.querySelector('.percentile-badge')?.textContent).toBe('100');
    expect(yardsRow.querySelector('.percentile-value')?.textContent).toBe('280.00');
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

  describe('with usageArtifact + players (STACKED percentile rankings)', () => {
    const cohortPlayers: PlayerMeta[] = ['rb1', 'rb2', 'rb3', 'rb4', 'rb5', 'rb6'].map((id) => ({
      ...rb, playerId: id, name: `Rush ${id}`,
    }));

    function cohortUsage(): Record<string, PlayerUsage> {
      const artifact: Record<string, PlayerUsage> = {};
      cohortPlayers.forEach((player, index) => {
        artifact[player.playerId] = {
          ...usage,
          opportunity: {
            ...usage.opportunity!,
            season: period({ carriesPerGame: 11.25 - index * 2.1 }),
          },
        };
      });
      return artifact;
    }

    it('renders the STACKED layout for an RB: heading, group headers, and percentile badges', () => {
      render(
        <PlayerRolePanel
          player={rb}
          usage={usage}
          feedStatus="ready"
          usageArtifact={cohortUsage()}
          players={cohortPlayers}
        />,
      );
      expect(screen.getByRole('heading', { name: '2025 RB percentile rankings' })).toBeInTheDocument();
      expect(screen.getByText('Fantasy')).toBeInTheDocument();
      expect(screen.getByText('Backfield Volume')).toBeInTheDocument();
      expect(screen.getByText('Rushing Efficiency')).toBeInTheDocument();
      expect(screen.getByText('Goal Line & Red Zone')).toBeInTheDocument();
      expect(screen.getByText('Fantasy Points')).toBeInTheDocument();
      expect(screen.getByText('Rush EPA / Carry')).toBeInTheDocument();
      // rb1 is the carries/g cohort max → badge 100, raw AVG value shown beside it.
      const carriesRow = screen.getByText('Carries').closest('.percentile-row')!;
      expect(carriesRow.querySelector('.percentile-badge')?.textContent).toBe('100');
      expect(carriesRow.querySelector('.percentile-value')?.textContent).toBe('11.25');
    });

    it('renders the receiving-only shape for a WR and keeps QB on the weekly columns', () => {
      render(
        <PlayerRolePanel
          player={{ ...rb, position: 'WR', eligiblePositions: ['WR'] }}
          usage={usage}
          feedStatus="ready"
          usageArtifact={cohortUsage()}
          players={cohortPlayers.map((player) => ({ ...player, position: 'WR' as const }))}
        />,
      );
      expect(screen.getByRole('heading', { name: '2025 WR percentile rankings' })).toBeInTheDocument();
      expect(screen.getByText('Target Earners')).toBeInTheDocument();
      expect(screen.queryByText('Backfield Volume')).not.toBeInTheDocument();
      expect(screen.queryByText('Carries')).not.toBeInTheDocument();
    });

    it('falls back to the legacy columns when the cohort is too thin to rank', () => {
      render(
        <PlayerRolePanel
          player={rb}
          usage={usage}
          feedStatus="ready"
          usageArtifact={cohortUsage()}
          players={cohortPlayers.slice(0, 3)}
        />,
      );
      expect(screen.queryByText(/percentile rankings/)).not.toBeInTheDocument();
      expect(screen.getByText('Carry share')).toBeInTheDocument();
    });
  });
});
