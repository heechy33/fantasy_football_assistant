import { describe, expect, it } from 'vitest';
import type { OpportunityPeriod, PlayerMeta, PlayerUsage, PlayerWeeklyStatSeries } from '../../../shared/types';
import { buildRoleColumns } from './playerRole';

const rb: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

const wr: PlayerMeta = { ...rb, playerId: 'wr1', name: 'Wide One', position: 'WR', eligiblePositions: ['WR'] };
const qb: PlayerMeta = { ...rb, playerId: 'qb1', name: 'Pass One', position: 'QB', eligiblePositions: ['QB'] };
const kicker: PlayerMeta = { ...rb, playerId: 'k1', name: 'Kick One', position: 'K', eligiblePositions: ['K'] };
const def: PlayerMeta = { ...rb, playerId: 'SF', name: 'SF Defense', position: 'DEF', eligiblePositions: ['DEF'] };

function period(overrides: Partial<OpportunityPeriod> = {}): OpportunityPeriod {
  return {
    season: 2025, games: 16, targets: 40, carries: 180, touches: 220,
    targetsPerGame: 2.5, carriesPerGame: 11.25, touchesPerGame: 13.75,
    targetShare: 0.08, carryShare: 0.28, airYards: null, airYardsPerGame: null,
    airYardsShare: null, receivingYardsAfterCatch: 120,
    redZoneTargets: 10, endZoneTargets: 1, goalLineCarries: 9, snapPct: 0.55,
    ...overrides,
  };
}

function usage(overrides: Partial<PlayerUsage> = {}): PlayerUsage {
  return {
    season: 2025, usageSeasonObserved: true, snapPct: 0.55, targetShare: 0.08, carryShare: 0.28,
    gamesWithAnySnap: 16, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
    availabilityRate: 16 / 17, seasons: [], injuryHistory: [], durabilityScore: null,
    opportunity: {
      season: period(),
      finalFive: period({ games: 5, targetsPerGame: 1.8, touchesPerGame: 7.0, targets: 9, carries: 26, touches: 35 }),
      roleEvolution: {
        targetsPerGameDelta: -0.8,
        targetShareDelta: -0.024,
        airYardsShareDelta: null,
        touchesPerGameDelta: -6.75,
      },
    },
    production: {
      games: 16, pointsPpr: 227.2, pointsPprPerGame: 14.2,
      receptions: 32, receivingYards: 240, receivingTds: 1, rushingYards: 980, rushingTds: 9,
    },
    ...overrides,
  };
}

const QB_COLUMNS = ['pts', 'opp', 'snp', 'fin', 'pass_cmp', 'pass_att', 'cmp_pct', 'pass_yd', 'pass_ypa',
  'pass_td', 'pass_int', 'pass_air_yd', 'pass_sack', 'pass_rtg', 'rush_att', 'rush_yd', 'rush_td'];
const K_COLUMNS = ['pts', 'opp', 'snp', 'fin', 'fgm', 'fga', 'fgm_pct', 'fgm_lng', 'fgm_50p', 'fgm_yds', 'xpm', 'xpa'];
const DEF_COLUMNS = ['pts', 'opp', 'fin', 'sack', 'int', 'fum_rec', 'ff', 'def_td', 'blk_kick', 'safe', 'qb_hit', 'def_pass_def', 'pts_allow', 'yds_allow'];

function qbSeries(): PlayerWeeklyStatSeries {
  return { p: 'QB', bye: 9, w: [[1, 25.0, '@KC', 95, 3, 22, 30, 73.3, 280, 9.3, 2, 1, 200, 2, 110.5, 3, 15, 0]] };
}
function kSeries(): PlayerWeeklyStatSeries {
  return { p: 'K', bye: 7, w: [[1, 10.0, 'DAL', 20, 2, 2, 2, 100.0, 45, 0, 80, 4, 4]] };
}
function defSeries(): PlayerWeeklyStatSeries {
  return { p: 'DEF', bye: 14, w: [[1, 9.0, 'NYG', 5, 2, 1, 0, 1, 0, 0, 0, 3, 2, 17, 310]] };
}

describe('buildRoleColumns', () => {
  it('builds RB volume/receiving/scoring/form and pairs touches with PPR/g', () => {
    const columns = buildRoleColumns({
      player: rb,
      usage: usage(),
      weeks: [{ week: 1, pointsPpr: 14.2 }, { week: 2, pointsPpr: 14.2 }],
    });
    expect(columns.map((column) => column.id)).toEqual(['volume', 'receiving', 'scoring', 'form']);
    expect(columns[0]!.stats.some((stat) => stat.label === 'Carry share' && stat.display === '28%')).toBe(true);
    // YPC = 980 rushing yds / 180 carries; YPR = 240 rec yds / 32 receptions.
    expect(columns[0]!.stats.some((stat) => stat.label === 'YPC' && stat.display === '5.4')).toBe(true);
    expect(columns[1]!.stats.some((stat) => stat.label === 'YPR' && stat.display === '7.5')).toBe(true);
    expect(columns[2]!.stats.some((stat) => stat.label === 'Goal-line carries' && stat.display === '9')).toBe(true);
    expect(columns[0]!.result).toContain('PPR/g');
    expect(columns[1]!.result).toContain('PPR from catches');
    expect(columns[3]!.stats.some((stat) => stat.delta?.tone === 'down' && stat.delta.text === '-0.8')).toBe(true);
  });

  it('hides goal-line carries for WR and folds air-yard share into the Receiving column', () => {
    const columns = buildRoleColumns({ player: wr, usage: usage() });
    expect(columns.map((column) => column.id)).toEqual(['volume', 'receiving', 'scoring', 'form']);
    expect(columns.some((column) => column.stats.some((stat) => stat.label === 'Goal-line carries'))).toBe(false);
    // The old standalone "Air" column is gone: air-yard share now lives inside the
    // Receiving column alongside the production stats WR/TE were previously missing.
    expect(columns[1]!.stats.some((stat) => stat.label === 'Air-yard share' && stat.display === 'n/a')).toBe(true);
    expect(columns[1]!.stats.some((stat) => stat.label === 'Rec. yards' && stat.display === '240')).toBe(true);
    expect(columns[2]!.stats.some((stat) => stat.label === 'End-zone targets')).toBe(true);
  });

  it('returns no columns for RB/WR/TE when opportunity is missing', () => {
    expect(buildRoleColumns({ player: rb, usage: undefined })).toEqual([]);
    expect(buildRoleColumns({ player: rb, usage: usage({ opportunity: null }) })).toEqual([]);
  });

  it('still builds opportunity columns when production is absent', () => {
    const columns = buildRoleColumns({
      player: rb,
      usage: usage({ production: undefined }),
      weeks: [{ week: 1, pointsPpr: 10 }],
    });
    expect(columns[0]!.result).toContain('10.0 PPR/g');
    expect(columns[1]!.result).toBeUndefined();
    expect(columns[1]!.stats.some((stat) => stat.label === 'Receptions')).toBe(false);
  });

  // --- QB/K/DEF: delegate entirely to the weekly game log, never `usage.opportunity` ---

  it('QB delegates to weeklyRoleColumns for Passing/Rushing/Efficiency/Form, ignoring usage.opportunity', () => {
    const columns = buildRoleColumns({
      player: qb,
      // usage() has a populated opportunity block -- QB must not use it (its
      // targetShare/carryShare are meaningless for a passer, and
      // pipeline/context.py nulls QB targetShare on purpose anyway).
      usage: usage(),
      weeklyStats: { series: qbSeries(), columns: { QB: QB_COLUMNS } },
    });
    expect(columns.map((column) => column.id)).toEqual(['passing', 'rushing', 'efficiency', 'form']);
    // Completion % replaced the old snap-share stat (22/30 = 73.3%).
    expect(columns[2]!.stats.some((stat) => stat.label === 'Cmp%' && stat.display === '73.3%')).toBe(true);
    expect(columns[0]!.stats.some((stat) => stat.label === 'Att/g' && stat.display === '30.0')).toBe(true);
  });

  it('K delegates to weeklyRoleColumns for Volume/Accuracy/Distance/Form', () => {
    const columns = buildRoleColumns({
      player: kicker,
      usage: usage(),
      weeklyStats: { series: kSeries(), columns: { K: K_COLUMNS } },
    });
    expect(columns.map((column) => column.id)).toEqual(['kicking-volume', 'accuracy', 'distance', 'form']);
  });

  it('DEF delegates to weeklyRoleColumns for Pressure/Takeaways/Prevention/Form', () => {
    const columns = buildRoleColumns({
      player: def,
      usage: undefined, // DEF has no usage.opportunity row at all in the real artifact
      weeklyStats: { series: defSeries(), columns: { DEF: DEF_COLUMNS } },
    });
    expect(columns.map((column) => column.id)).toEqual(['pressure', 'takeaways', 'prevention', 'form']);
  });

  it('QB/K/DEF return no columns when no weeklyStats input is supplied at all', () => {
    expect(buildRoleColumns({ player: qb, usage: usage() })).toEqual([]);
    expect(buildRoleColumns({ player: kicker, usage: usage() })).toEqual([]);
    expect(buildRoleColumns({ player: def, usage: undefined })).toEqual([]);
  });

  it('QB/K/DEF return no columns when weeklyStats has no series for this player', () => {
    const columns = buildRoleColumns({
      player: qb,
      usage: usage(),
      weeklyStats: { series: undefined, columns: { QB: QB_COLUMNS } },
    });
    expect(columns).toEqual([]);
  });

  it('new QB/K/DEF ids never collide with the RB/WR/TE opportunity-derived ids', () => {
    // 'form' is deliberately reused by both provenance paths (never returned
    // twice for the same player, since a player is only ever one position) --
    // excluded here to check only the genuinely position-specific ids.
    const opportunityIds = ['volume', 'receiving', 'scoring', 'snaps'];
    const weeklyIds = [
      ...buildRoleColumns({ player: qb, usage: usage(), weeklyStats: { series: qbSeries(), columns: { QB: QB_COLUMNS } } }),
      ...buildRoleColumns({ player: kicker, usage: usage(), weeklyStats: { series: kSeries(), columns: { K: K_COLUMNS } } }),
      ...buildRoleColumns({ player: def, usage: undefined, weeklyStats: { series: defSeries(), columns: { DEF: DEF_COLUMNS } } }),
    ].map((column) => column.id).filter((id) => id !== 'form');
    expect(weeklyIds.every((id) => !opportunityIds.includes(id))).toBe(true);
    expect(new Set(weeklyIds).size).toBe(weeklyIds.length);
  });
});
