import { describe, expect, it } from 'vitest';
import type { PlayerMeta, PlayerWeeklyStatsArtifact, PlayerWeeklyStatSeries } from '../../../shared/types';
import { buildQbPercentileRankings } from './qbPercentileRankings';

// Real artifact column order for QB (data/weekly-stats.json `columns.QB`).
const QB_COLUMNS = ['pts', 'opp', 'snp', 'fin', 'pass_cmp', 'pass_att', 'cmp_pct', 'pass_yd', 'pass_ypa', 'pass_td',
  'pass_int', 'pass_air_yd', 'pass_sack', 'pass_rtg', 'rush_att', 'rush_yd', 'rush_td'];

function qbMeta(id: string): PlayerMeta {
  return {
    playerId: id, name: `Quarter ${id}`, position: 'QB', eligiblePositions: ['QB'],
    team: 'BUF', byeWeek: 7, age: 25, yearsExp: 5, injuryStatus: null, ids: {},
  };
}

/** One QB week: [week, pts, opp, snp, fin, cmp, att, cmp_pct, yd, ypa, td, int, air_yd, sack, rtg, rush_att, rush_yd, rush_td]. */
function qbRow(week: number, pts: number, cmp: number, att: number, yd: number, td: number, int: number, airYd: number, sack: number, rushAtt: number, rushYd: number, rushTd: number): PlayerWeeklyStatSeries['w'][number] {
  return [
    week, pts, '@KC', 90, 3, cmp, att, att > 0 ? Math.round((cmp / att) * 1000) / 10 : null, yd,
    att > 0 ? Math.round((yd / att) * 100) / 10 : null, td, int, airYd, sack, 100.0, rushAtt, rushYd, rushTd,
  ];
}

/** qb1 is the cohort max in every metric; qb2..qb6 step down. Two observed weeks each. */
function artifact(): PlayerWeeklyStatsArtifact {
  const players: Record<string, PlayerWeeklyStatSeries> = {};
  for (let i = 1; i <= 6; i += 1) {
    const id = `qb${i}`;
    const scale = 1 - (i - 1) * 0.1;
    players[id] = {
      p: 'QB', bye: 7,
      w: [
        qbRow(1, 20 * scale, 20, 30, 250 * scale, 2, 1, 180 * scale, 1, 3, 15 * scale, 0),
        qbRow(2, 22 * scale, 22, 32, 270 * scale, 2, 0, 190 * scale, 2, 4, 20 * scale, 1),
      ],
    };
  }
  return { schemaVersion: 1, season: 2025, weeksFetched: [1, 2], columns: { QB: QB_COLUMNS }, players, heat: {} };
}

describe('buildQbPercentileRankings', () => {
  it('builds the STACKED group order and ranks the cohort max at 100', () => {
    const rankings = buildQbPercentileRankings({ player: qbMeta('qb1'), artifact: artifact() })!;
    expect(rankings.cohortSize).toBe(6);
    expect(rankings.groups.map((group) => group.id)).toEqual([
      'fantasy', 'passing-volume', 'passing-efficiency', 'pressure', 'rushing',
    ]);
    const yards = rankings.groups
      .find((group) => group.id === 'passing-volume')!.stats
      .find((stat) => stat.key === 'passingYards')!;
    // qb1: (250 + 270) / 2 = 260 pass yd/g — the cohort max reads 100.
    expect(yards.display).toBe('260.00');
    expect(yards.percentile).toBe(100);
    const fantasy = rankings.groups.find((group) => group.id === 'fantasy')!.stats[0]!;
    expect(fantasy.label).toBe('Fantasy Points');
    expect(fantasy.percentile).toBe(100);
    // A stepped-down QB still reads its at-or-below rank, not 0.
    const last = buildQbPercentileRankings({ player: qbMeta('qb6'), artifact: artifact() })!;
    const lastYards = last.groups
      .find((group) => group.id === 'passing-volume')!.stats
      .find((stat) => stat.key === 'passingYards')!;
    expect(lastYards.percentile).toBeGreaterThan(0);
    expect(lastYards.percentile!).toBeLessThan(100);
  });

  it('computes the completion-percentage ratio from summed makes / attempts', () => {
    const rankings = buildQbPercentileRankings({ player: qbMeta('qb1'), artifact: artifact() })!;
    const cmpPct = rankings.groups
      .find((group) => group.id === 'passing-efficiency')!.stats
      .find((stat) => stat.key === 'cmpPct')!;
    // qb1 week 1: 20/30, week 2: 22/32 → 42/62 = 67.7%.
    expect(cmpPct.display).toBe('67.7%');
    expect(cmpPct.percentile).not.toBeNull();
  });

  it('returns null for a non-QB player', () => {
    const rb: PlayerMeta = { ...qbMeta('rb1'), position: 'RB', eligiblePositions: ['RB'] };
    expect(buildQbPercentileRankings({ player: rb, artifact: artifact() })).toBeNull();
  });

  it('returns null when the cohort is thinner than five QBs', () => {
    const thin = artifact();
    delete thin.players.qb6;
    delete thin.players.qb5;
    expect(buildQbPercentileRankings({ player: qbMeta('qb1'), artifact: thin })).toBeNull();
  });

  it('returns null when the player has no weekly series at all', () => {
    expect(buildQbPercentileRankings({ player: qbMeta('qb-missing'), artifact: artifact() })).toBeNull();
  });

  it('returns null when the artifact has no QB column map', () => {
    const noQbColumns = { ...artifact(), columns: {} };
    expect(buildQbPercentileRankings({ player: qbMeta('qb1'), artifact: noQbColumns })).toBeNull();
  });
});
