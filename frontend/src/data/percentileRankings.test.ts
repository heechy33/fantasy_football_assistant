import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OpportunityPeriod, PlayerMeta, PlayerUsage, PlayerUsageArtifact } from '../../../shared/types';
import { buildPercentileRankings } from './percentileRankings';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

function meta(id: string, position: 'RB' | 'WR' | 'TE' | 'QB'): PlayerMeta {
  return { playerId: id, name: `Player ${id}`, position, eligiblePositions: [position], team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {} };
}

function period(overrides: Partial<OpportunityPeriod> = {}): OpportunityPeriod {
  return {
    season: 2025, games: 16, targets: 40, carries: 180, touches: 220,
    targetsPerGame: 2.5, carriesPerGame: 11.25, touchesPerGame: 13.75,
    targetShare: 0.08, carryShare: 0.28, airYards: 120, airYardsPerGame: 7.5,
    airYardsShare: 0.1, receivingYardsAfterCatch: 120,
    redZoneTargets: 10, endZoneTargets: 1, goalLineCarries: 9, snapPct: 0.55,
    rushingEpa: 12.8, rushingEpaPerGame: 0.8, receivingEpa: 3.2, receivingEpaPerGame: 0.2,
    ...overrides,
  };
}

function observed(overrides: Partial<PlayerUsage> = {}, periodOverrides: Partial<OpportunityPeriod> = {}): PlayerUsage {
  return {
    season: 2025, usageSeasonObserved: true, snapPct: 0.55, targetShare: 0.08, carryShare: 0.28,
    gamesWithAnySnap: 16, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
    availabilityRate: 1, seasons: [], injuryHistory: [], durabilityScore: null,
    opportunity: { season: period(periodOverrides), finalFive: null, roleEvolution: { targetsPerGameDelta: null, targetShareDelta: null, airYardsShareDelta: null, touchesPerGameDelta: null } },
    production: {
      games: 16, pointsPpr: 240, pointsPprPerGame: 15, receptions: 24, receivingYards: 180,
      receivingTds: 1, rushingYards: 1125, rushingTds: 9,
    },
    ...overrides,
  };
}

/** Six RBs whose carriesPerGame descend 11.25 → 0.75, so rb1 is the cohort max and rb6 the min. */
function rbCohort(): { players: PlayerMeta[]; usage: PlayerUsageArtifact } {
  const players = ['rb1', 'rb2', 'rb3', 'rb4', 'rb5', 'rb6'].map((id) => meta(id, 'RB'));
  const usage: PlayerUsageArtifact = {};
  players.forEach((player, index) => {
    usage[player.playerId] = observed({}, { carriesPerGame: 11.25 - index * 2.1, carries: 180 - index * 33.6, rushingEpaPerGame: 0.8 - index * 0.2, rushingEpa: 12.8 - index * 3.2 });
  });
  return { players, usage };
}

describe('buildPercentileRankings', () => {
  it('returns null for QB/K/DEF and for players without an observed usage season', () => {
    const { players, usage } = rbCohort();
    expect(buildPercentileRankings({ player: meta('q1', 'QB'), usage, players })).toBeNull();
    expect(buildPercentileRankings({
      player: meta('rb1', 'RB'),
      usage: { ...usage, rb1: observed({ usageSeasonObserved: false, opportunity: null }) },
      players,
    })).toBeNull();
    expect(buildPercentileRankings({ player: meta('rb1', 'RB'), usage: {}, players })).toBeNull();
  });

  it('returns null below the minimum cohort size instead of a noisy rank', () => {
    const { players, usage } = rbCohort();
    expect(buildPercentileRankings({
      player: meta('rb1', 'RB'),
      usage,
      players: players.slice(0, 3),
    })).toBeNull();
  });

  it('shapes RB groups as a backfield profile with per-attempt efficiency', () => {
    const { players, usage } = rbCohort();
    const { groups, cohortSize } = buildPercentileRankings({ player: meta('rb1', 'RB'), usage, players })!;
    expect(cohortSize).toBe(6);
    expect(groups.map((group) => group.id)).toEqual([
      'fantasy', 'backfield-volume', 'rushing-efficiency', 'receiving-workload', 'goal-line',
    ]);
    const labels = groups.flatMap((group) => group.stats.map((stat) => stat.label));
    expect(labels).toEqual([
      'Fantasy Points',
      'Carries', 'Carry Share', 'Rushing Yards', 'Snap %',
      'Yards / Carry', 'Rush EPA / Carry',
      'Targets', 'Target Share', 'Receptions',
      'Goal-Line Carries', 'Red-Zone Targets', 'Rushing TDs',
    ]);
  });

  it('shapes WR groups as a pass-game profile and TE differently from both RB and WR', () => {
    const players = ['wr1', 'wr2', 'wr3', 'wr4', 'wr5', 'wr6'].map((id) => meta(id, 'WR'));
    const usage: PlayerUsageArtifact = {};
    for (const player of players) usage[player.playerId] = observed();
    const { groups } = buildPercentileRankings({ player: meta('wr1', 'WR'), usage, players })!;
    expect(groups.map((group) => group.id)).toEqual([
      'fantasy', 'target-earners', 'receiving-production', 'ball-winning', 'red-zone',
    ]);
    const labels = groups.flatMap((group) => group.stats.map((stat) => stat.label));
    expect(labels).not.toContain('Carries');
    expect(labels).not.toContain('Rush EPA / Carry');
    expect(labels).toContain('Targets');
    expect(labels).toContain('Target Share');
    expect(labels).toEqual(
      expect.arrayContaining(['Air-Yard Share', 'Catch Rate', 'Yards / Reception', 'YAC / Reception', 'aDOT', 'Rec EPA / Target']),
    );

    // TE shares the WR skeleton but diverges: snaps join Volume, deep-ball aDOT drops out,
    // and the group set is its own — never a copy of the WR shape.
    const tePlayers = ['te1', 'te2', 'te3', 'te4', 'te5', 'te6'].map((id) => meta(id, 'TE'));
    const teUsage: PlayerUsageArtifact = {};
    for (const player of tePlayers) teUsage[player.playerId] = observed();
    const teRankings = buildPercentileRankings({ player: meta('te1', 'TE'), usage: teUsage, players: tePlayers })!;
    expect(teRankings.groups.map((group) => group.id)).toEqual([
      'fantasy', 'volume', 'receiving-production', 'reliability', 'red-zone',
    ]);
    const teLabels = teRankings.groups.flatMap((group) => group.stats.map((stat) => stat.label));
    expect(teLabels).not.toContain('aDOT');
    expect(teLabels).not.toContain('Air-Yard Share');
    expect(teLabels).not.toEqual(labels);
  });

  it('ranks the cohort max at 100 and formats AVG per-game values with shares as percent', () => {
    const { players, usage } = rbCohort();
    const { groups } = buildPercentileRankings({ player: meta('rb1', 'RB'), usage, players })!;
    const carries = groups.find((group) => group.id === 'backfield-volume')!.stats.find((stat) => stat.key === 'carries')!;
    expect(carries.percentile).toBe(100);
    expect(carries.display).toBe('11.25');
    // Efficiency reads are per-attempt ratios: EPA/carry and YPC, not per-game totals that let
    // volume masquerade as efficiency. rbCohort's descending carries/EPA keep rb1 on top of both.
    const efficiency = groups.find((group) => group.id === 'rushing-efficiency')!.stats;
    const rushEpaPerCarry = efficiency.find((stat) => stat.key === 'rushEpaPerCarry')!;
    expect(rushEpaPerCarry.percentile).toBe(100);
    expect(rushEpaPerCarry.ratio).toBe(true);
    expect(rushEpaPerCarry.display).toBe('0.07'); // 12.8 EPA / 180 carries
    const ypc = efficiency.find((stat) => stat.key === 'yardsPerCarry')!;
    expect(ypc.display).toBe('6.25'); // 1125 yards / 180 carries
    // The cohort min still reads its at-or-below rank (ties count in the player's favor), not 0.
    const { groups: minGroups } = buildPercentileRankings({ player: meta('rb6', 'RB'), usage, players })!;
    const minCarries = minGroups.find((group) => group.id === 'backfield-volume')!.stats.find((stat) => stat.key === 'carries')!;
    expect(minCarries.percentile).toBeGreaterThan(0);
    const share = groups.find((group) => group.id === 'receiving-workload')!.stats.find((stat) => stat.key === 'targetShare')!;
    expect(share.display).toBe('8.0%');
    // Shares render as percentages on the same row shape.
    const volume = groups.find((group) => group.id === 'backfield-volume')!.stats;
    expect(volume.find((stat) => stat.key === 'carryShare')!.display).toBe('28.0%');
    expect(volume.find((stat) => stat.key === 'snapShare')!.display).toBe('55.0%');
    // Ratio metrics (aDOT/catch rate/yards-per-reception/YAC-per-reception) are season-long
    // rates, not per-game averages — flagged so the panel doesn't call them "per game".
    const wrPlayers = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((id) => meta(id, 'WR'));
    const wrUsage: PlayerUsageArtifact = {};
    for (const player of wrPlayers) wrUsage[player.playerId] = observed();
    const wrGroups = buildPercentileRankings({ player: meta('w1', 'WR'), usage: wrUsage, players: wrPlayers })!.groups;
    const ballWinning = wrGroups.find((group) => group.id === 'ball-winning')!.stats;
    const catchRate = ballWinning.find((stat) => stat.key === 'catchRate')!;
    expect(catchRate.ratio).toBe(true);
    expect(catchRate.display).toBe('60.0%'); // 24 receptions / 40 targets
    const adot = ballWinning.find((stat) => stat.key === 'adot')!;
    expect(adot.display).toBe('3.00'); // 120 air yards / 40 targets
    expect(ballWinning.find((stat) => stat.key === 'recEpaPerTarget')!.display).toBe('0.08'); // 3.2 EPA / 40 targets
  });

  it('degrades a metric with no cohort data to a null percentile, never a fabricated rank', () => {
    const { players, usage } = rbCohort();
    // Every cohort row lacks production → fantasy-points percentile is null but the raw
    // opportunity metrics still rank.
    const stripped: PlayerUsageArtifact = Object.fromEntries(
      Object.entries(usage).map(([id, value]) => [id, { ...value, production: null }]),
    );
    const { groups } = buildPercentileRankings({ player: meta('rb1', 'RB'), usage: stripped, players })!;
    const fantasy = groups.find((group) => group.id === 'fantasy')!.stats[0]!;
    expect(fantasy.percentile).toBeNull();
    expect(fantasy.display).toBeNull();
    const carries = groups.find((group) => group.id === 'backfield-volume')!.stats.find((stat) => stat.key === 'carries')!;
    expect(carries.percentile).toBe(100);
    // Ratio metrics that divide by `production` (yards/carry, catch rate, yards/reception,
    // YAC/reception) degrade to null on a zero/missing denominator, never NaN or Infinity.
    const efficiency = groups.find((group) => group.id === 'rushing-efficiency')!.stats;
    expect(efficiency.find((stat) => stat.key === 'yardsPerCarry')!.percentile).toBeNull();
    expect(efficiency.find((stat) => stat.key === 'yardsPerCarry')!.display).toBeNull();
    // …while EPA/carry only needs opportunity fields, so it still ranks.
    expect(efficiency.find((stat) => stat.key === 'rushEpaPerCarry')!.percentile).not.toBeNull();
  });

  it('ranks within the real committed player-usage.json cohort, percentiles inside 0-100', () => {
    const players = JSON.parse(readFileSync(join(dataDir, 'players.json'), 'utf-8')) as PlayerMeta[];
    const usage = JSON.parse(readFileSync(join(dataDir, 'player-usage.json'), 'utf-8')) as PlayerUsageArtifact;
    const observedRbs = players.filter((player) => player.position === 'RB' && usage[player.playerId]?.usageSeasonObserved && usage[player.playerId]?.opportunity != null);
    expect(observedRbs.length).toBeGreaterThanOrEqual(5);
    const { groups, cohortSize } = buildPercentileRankings({ player: observedRbs[0]!, usage, players })!;
    expect(cohortSize).toBeGreaterThanOrEqual(5);
    for (const group of groups) {
      for (const stat of group.stats) {
        if (stat.percentile != null) {
          expect(stat.percentile).toBeGreaterThanOrEqual(0);
          expect(stat.percentile).toBeLessThanOrEqual(100);
        }
      }
    }
    expect(groups.find((group) => group.id === 'backfield-volume')).toBeTruthy();
  });
});
