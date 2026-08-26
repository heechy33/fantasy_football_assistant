import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  OpportunityPeriod, PlayerMeta, PlayerProduction, PlayerUsage, PlayerUsageArtifact,
  PlayerWeeklyStatsArtifact,
} from '../../../shared/types';
import { buildCardRoleStatsIndex } from './cardRoleStats';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

function meta(id: string, position: NonNullable<PlayerMeta['position']>): PlayerMeta {
  return {
    playerId: id, name: `Player ${id}`, position, eligiblePositions: [position],
    team: 'BUF', byeWeek: 7, age: 25, yearsExp: 5, injuryStatus: null, ids: {},
  };
}

function period(overrides: Partial<OpportunityPeriod> = {}): OpportunityPeriod {
  return {
    season: 2025, games: 16, targets: 40, carries: 180, touches: 220,
    targetsPerGame: 2.5, carriesPerGame: 11.25, touchesPerGame: 13.8,
    targetShare: 0.08, carryShare: 0.28, airYards: null, airYardsPerGame: null,
    airYardsShare: null, receivingYardsAfterCatch: 120,
    redZoneTargets: 10, endZoneTargets: 1, goalLineCarries: 9, snapPct: 0.55,
    ...overrides,
  };
}

function usage(
  periodOverrides: Partial<OpportunityPeriod> = {},
  productionOverrides: Partial<PlayerProduction> = {},
  overrides: Partial<PlayerUsage> = {},
): PlayerUsage {
  return {
    season: 2025, usageSeasonObserved: true, snapPct: 0.55, targetShare: 0.08, carryShare: 0.28,
    gamesWithAnySnap: 16, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
    availabilityRate: 16 / 17, seasons: [], injuryHistory: [], durabilityScore: null,
    opportunity: {
      season: period(periodOverrides),
      finalFive: null,
      roleEvolution: { targetsPerGameDelta: null, targetShareDelta: null, airYardsShareDelta: null, touchesPerGameDelta: null },
    },
    production: {
      games: 16, pointsPpr: 240.4, pointsPprPerGame: 15.0, receptions: 24,
      receivingYards: 180, receivingTds: 1, rushingYards: 1125, rushingTds: 9,
      ...productionOverrides,
    },
    ...overrides,
  };
}

/** Six players at one position, each descending in every metric that position's card picks
 * read, so player 0 is the cohort max on all four and player 5 is the min. */
function skillCohort(position: 'RB' | 'WR' | 'TE'): { players: PlayerMeta[]; usage: PlayerUsageArtifact } {
  const ids = [0, 1, 2, 3, 4, 5].map((i) => `${position.toLowerCase()}${i + 1}`);
  const players = ids.map((id) => meta(id, position));
  const usageMap: PlayerUsageArtifact = {};
  players.forEach((player, i) => {
    usageMap[player.playerId] = usage(
      {
        targetsPerGame: 6 - i * 0.8, carries: 180, snapPct: 0.9 - i * 0.1,
        goalLineCarries: 9 - i, redZoneTargets: 10 - i, receivingYardsAfterCatch: 120 - i * 10,
      },
      {
        pointsPprPerGame: 20 - i * 2, rushingYards: 1200 - i * 150, rushingTds: 9 - i,
        receivingYards: 300 - i * 30, receptions: 24,
      },
    );
  });
  return { players, usage: usageMap };
}

const QB_COLUMNS = ['pts', 'opp', 'snp', 'fin', 'pass_cmp', 'pass_att', 'cmp_pct', 'pass_yd', 'pass_ypa', 'pass_td',
  'pass_int', 'pass_air_yd', 'pass_sack', 'pass_rtg', 'rush_att', 'rush_yd', 'rush_td'];

function qbSeries(pts: number, passYd: number, passTd: number, rushYd = 15): PlayerWeeklyStatsArtifact['players'][string] {
  return { p: 'QB', bye: 7, w: [[1, pts, '@KC', 90, 3, 20, 30, 66.7, passYd, 8.3, passTd, 1, 180, 1, 100.0, 3, rushYd, 0]] };
}

function qbArtifact(): PlayerWeeklyStatsArtifact {
  return {
    schemaVersion: 1, season: 2025, weeksFetched: [1],
    columns: { QB: QB_COLUMNS },
    players: {
      qb1: qbSeries(24, 280, 3, 40),
      qb2: qbSeries(18, 230, 1), qb3: qbSeries(16, 210, 1),
      qb4: qbSeries(14, 190, 0), qb5: qbSeries(12, 170, 0), qb6: qbSeries(10, 150, 0),
    },
    heat: {},
  };
}

const K_COLUMNS = ['pts', 'opp', 'snp', 'fin', 'fgm', 'fga', 'fgm_pct', 'fgm_lng', 'fgm_50p', 'fgm_yds', 'xpm', 'xpa'];

function kSeries(fgm: number, fga: number, fgm50p: number): PlayerWeeklyStatsArtifact['players'][string] {
  const fgPct = fga > 0 ? (100 * fgm) / fga : null;
  // Row shape [week, pts, opp, snp, fin, fgm, fga, fgm_pct, fgm_lng, fgm_50p, fgm_yds, xpm, xpa].
  // XPM scales with FGM so the cohort varies (a flat column would make the percentile a tie).
  return { p: 'K', bye: 7, w: [[1, fgm * 3, 'DAL', 20, 3, fgm, fga, fgPct, 45, fgm50p, 80, fgm * 2, fgm * 2]] };
}

function kArtifact(): PlayerWeeklyStatsArtifact {
  return {
    schemaVersion: 1, season: 2025, weeksFetched: [1],
    columns: { K: K_COLUMNS },
    players: {
      k1: kSeries(3, 3, 2), k2: kSeries(2, 2, 1), k3: kSeries(2, 3, 0),
      k4: kSeries(1, 2, 0), k5: kSeries(1, 1, 0),
    },
    heat: {},
  };
}

const DEF_COLUMNS = ['pts', 'opp', 'fin', 'sack', 'int', 'fum_rec', 'ff', 'def_td', 'blk_kick', 'safe', 'qb_hit', 'def_pass_def', 'pts_allow', 'yds_allow'];

function defSeries(sack: number, int: number, fumRec: number, ptsAllow: number, passDef: number): PlayerWeeklyStatsArtifact['players'][string] {
  // Row shape [week, pts, opp, fin, sack, int, fum_rec, ff, def_td, blk_kick, safe, qb_hit, def_pass_def, pts_allow, yds_allow].
  return { p: 'DEF', bye: 14, w: [[1, 9.0, 'NYG', 2, sack, int, fumRec, 0, 1, 0, 0, 3, passDef, ptsAllow, 310]] };
}

function defArtifact(): PlayerWeeklyStatsArtifact {
  return {
    schemaVersion: 1, season: 2025, weeksFetched: [1],
    columns: { DEF: DEF_COLUMNS },
    players: {
      SF: defSeries(4, 2, 1, 10, 4), NE: defSeries(3, 1, 0, 14, 3), LAR: defSeries(2, 1, 0, 20, 2),
      DAL: defSeries(1, 0, 0, 24, 1), NYG: defSeries(0, 0, 0, 30, 0),
    },
    heat: {},
  };
}

describe('buildCardRoleStatsIndex', () => {
  it('RB reads Fantasy Pts/g, YPC, GL Carries/g, and Rush TD/g — no two picks the same measurement', () => {
    const { players, usage: usageMap } = skillCohort('RB');
    const map = buildCardRoleStatsIndex({ players, usage: usageMap, weeklyArtifact: null });
    const stats = map.get('rb1')!;
    expect(stats.map((stat) => stat.label)).toEqual(['Fantasy Pts/g', 'YPC', 'GL Carries/g', 'Rush TD/g']);
    expect(stats.map((stat) => stat.display)).toEqual(['20.0', '6.7', '0.6', '0.6']); // 1200/180 YPC, 9/16 goal-line, 9/16 rush TDs
    // rb1 is the cohort max in every metric → every percentile reads 100.
    for (const stat of stats) {
      expect(stat.percentile).toBe(100);
      expect(stat.title).toContain('player-usage.json');
      expect(stat.title).toContain('never a ranking input');
    }
    // The cohort min still reads its at-or-below rank, not a fabricated 0.
    const last = map.get('rb6')!;
    expect(last[0]!.percentile).toBeGreaterThan(0);
    expect(last[0]!.percentile).toBeLessThan(100);
  });

  it('WR reads Fantasy Pts/g, Targets/g, YAC/Rec, and RZ Tgt/g', () => {
    const { players, usage: usageMap } = skillCohort('WR');
    const map = buildCardRoleStatsIndex({ players, usage: usageMap, weeklyArtifact: null });
    const stats = map.get('wr1')!;
    expect(stats.map((stat) => stat.label)).toEqual(['Fantasy Pts/g', 'Targets/g', 'YAC/Rec', 'RZ Tgt/g']);
    expect(stats.map((stat) => stat.display)).toEqual(['20.0', '6.0', '5.0', '0.6']); // 120/24 YAC/rec, 10/16 RZ targets
    for (const stat of stats) expect(stat.percentile).toBe(100);
  });

  it('TE reads Fantasy Pts/g, Targets/g, YAC/Rec, and RZ Tgt/g', () => {
    const { players, usage: usageMap } = skillCohort('TE');
    const map = buildCardRoleStatsIndex({ players, usage: usageMap, weeklyArtifact: null });
    const stats = map.get('te1')!;
    expect(stats.map((stat) => stat.label)).toEqual(['Fantasy Pts/g', 'Targets/g', 'YAC/Rec', 'RZ Tgt/g']);
    expect(stats.map((stat) => stat.display)).toEqual(['20.0', '6.0', '5.0', '0.6']); // 120/24 YAC/rec, 10/16 RZ targets
    for (const stat of stats) expect(stat.percentile).toBe(100);
  });

  it('QB carries cohort percentiles for Fantasy Pts/g, Pass Yd/g, Rush Yd/g, and Pass TD/g', () => {
    const map = buildCardRoleStatsIndex({ players: [meta('qb1', 'QB')], usage: {}, weeklyArtifact: qbArtifact() });
    const stats = map.get('qb1')!;
    expect(stats.map((stat) => stat.label)).toEqual(['Fantasy Pts/g', 'Pass Yd/g', 'Rush Yd/g', 'Pass TD/g']);
    // qb1 is the cohort max in every metric → every percentile reads 100.
    for (const stat of stats) {
      expect(stat.percentile).toBe(100);
      expect(stat.title).toContain('weekly game log');
      expect(stat.title).toContain('6 QBs');
    }
  });

  it('K ranks against its own weekly-artifact cohort (new — the old version had no percentile at all)', () => {
    const players = [meta('k1', 'K'), meta('k2', 'K'), meta('k3', 'K'), meta('k4', 'K'), meta('k5', 'K')];
    const map = buildCardRoleStatsIndex({ players, usage: {}, weeklyArtifact: kArtifact() });
    const stats = map.get('k1')!;
    expect(stats.map((stat) => stat.label)).toEqual(['FGM/g', 'FG%', '50+ FGM', 'XPM/g']);
    expect(stats.map((stat) => stat.display)).toEqual(['3.0', '100.0%', '2', '6.0']);
    for (const stat of stats) expect(stat.percentile).toBe(100);
    // Below MIN_COHORT (5), the percentile degrades to null rather than a noisy rank.
    const thinMap = buildCardRoleStatsIndex({
      players: [meta('k1', 'K')], usage: {}, weeklyArtifact: { ...kArtifact(), players: { k1: kArtifact().players.k1! } },
    });
    for (const stat of thinMap.get('k1')!) expect(stat.percentile).toBeNull();
  });

  it('DEF ranks sacks, takeaways, and points-allowed (inverted so fewer points reads a better percentile)', () => {
    const players = [meta('SF', 'DEF'), meta('NE', 'DEF'), meta('LAR', 'DEF'), meta('DAL', 'DEF'), meta('NYG', 'DEF')];
    const map = buildCardRoleStatsIndex({ players, usage: {}, weeklyArtifact: defArtifact() });
    const stats = map.get('SF')!;
    expect(stats.map((stat) => stat.label)).toEqual(['Sacks/g', 'Takeaways/g', 'Pts allow/g', 'PD/g']);
    expect(stats.map((stat) => stat.display)).toEqual(['4.0', '3.0', '10.0', '4.0']); // takeaways = 2 int + 1 fum rec
    // SF leads sacks, takeaways, and PD outright — top percentile on each.
    expect(stats[0]!.percentile).toBe(100);
    expect(stats[1]!.percentile).toBe(100);
    expect(stats[3]!.percentile).toBe(100);
    // SF also allows the fewest points (best) — its inverted percentile is the cohort's highest,
    // clearly ahead of NYG, which allows the most (worst) and reads near the bottom.
    const nygPtsAllow = map.get('NYG')!.find((stat) => stat.label === 'Pts allow/g')!;
    expect(stats[2]!.percentile).toBeGreaterThan(nygPtsAllow.percentile!);
    expect(nygPtsAllow.percentile).toBeLessThan(50);
  });

  it('leaves a player with no data out of the map, never fabricating a stat', () => {
    const rb = meta('rb1', 'RB');
    expect(buildCardRoleStatsIndex({
      players: [rb], usage: { rb1: usage({}, {}, { opportunity: null }) }, weeklyArtifact: null,
    }).has('rb1')).toBe(false);
    expect(buildCardRoleStatsIndex({ players: [rb], usage: {}, weeklyArtifact: null }).has('rb1')).toBe(false);
    const qb = meta('qb1', 'QB');
    expect(buildCardRoleStatsIndex({ players: [qb], usage: {}, weeklyArtifact: null }).has('qb1')).toBe(false);
    // A QB missing from the artifact resolves to no entry too (thin/absent cohort).
    const missingSelf = qbArtifact();
    delete missingSelf.players.qb1;
    expect(buildCardRoleStatsIndex({ players: [qb], usage: {}, weeklyArtifact: missingSelf }).has('qb1')).toBe(false);
  });

  it('ranks within the real committed player-usage.json cohort, percentiles inside 0-100', () => {
    const players = JSON.parse(readFileSync(join(dataDir, 'players.json'), 'utf-8')) as PlayerMeta[];
    const usageArtifact = JSON.parse(readFileSync(join(dataDir, 'player-usage.json'), 'utf-8')) as PlayerUsageArtifact;
    const map = buildCardRoleStatsIndex({ players, usage: usageArtifact, weeklyArtifact: null });
    const observedRbs = players.filter((player) => player.position === 'RB' && map.has(player.playerId));
    expect(observedRbs.length).toBeGreaterThanOrEqual(5);
    for (const player of observedRbs.slice(0, 25)) {
      for (const stat of map.get(player.playerId)!) {
        if (stat.percentile != null) {
          expect(stat.percentile).toBeGreaterThanOrEqual(0);
          expect(stat.percentile).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
