import { describe, expect, it } from 'vitest';
import type { IdpPlayer } from './idpProjections';
import { buildIdpPercentileRankings, percentileOf } from './idpPercentileRankings';

const mockPlayer: IdpPlayer = {
  id: 'test-1',
  name: 'Test Linebacker',
  pos: 'LB',
  slot: 'D',
  team: 'SF',
  rank: 1,
  projectedPoints: 120,
  fptsRaw: 120,
  tackles: 80,
  assists: 40,
  sacks: 5,
  pd: 4,
  int: 1,
  ff: 2,
  fr: 1,
  bye: 9,
  role: {
    gamesPlayed: 17,
    gamesStarted: 17,
    snapPct: 92,
    snapsPerGame: 65,
    tacklesPerGame: 8.5,
    soloPerGame: 5.5,
    astPerGame: 3.0,
    sacksPerGame: 0.5,
    totalSacks: 8.5,
    tflPerGame: 1.1,
    qbHitsPerGame: 1.5,
    pdPerGame: 0.5,
    intPerGame: 0.1,
    totalInt: 2,
    forcedFumbles: 2,
    fumbleRecoveries: 1,
    fptsPerGame: 10.5,
    last5FptsPerGame: 11.2,
    formRating: 'Rising',
    ceiling: 18.0,
    floor: 5.0,
  },
};

const peerPlayer: IdpPlayer = {
  id: 'test-2',
  name: 'Peer Defender',
  pos: 'DE',
  slot: 'D',
  team: 'DAL',
  rank: 2,
  projectedPoints: 110,
  fptsRaw: 110,
  tackles: 50,
  assists: 20,
  sacks: 12,
  pd: 2,
  int: 0,
  ff: 1,
  fr: 0,
  bye: 7,
  role: {
    gamesPlayed: 17,
    gamesStarted: 17,
    snapPct: 80,
    snapsPerGame: 55,
    tacklesPerGame: 4.5,
    soloPerGame: 3.5,
    astPerGame: 1.0,
    sacksPerGame: 0.8,
    totalSacks: 13.5,
    tflPerGame: 1.4,
    qbHitsPerGame: 2.2,
    pdPerGame: 0.2,
    intPerGame: 0.0,
    totalInt: 0,
    forcedFumbles: 1,
    fumbleRecoveries: 0,
    fptsPerGame: 9.8,
    last5FptsPerGame: 9.0,
    formRating: 'Steady',
    ceiling: 22.0,
    floor: 3.0,
  },
};

describe('idpPercentileRankings', () => {
  it('computes percentileOf with ties counting in player favor', () => {
    expect(percentileOf([10, 20, 30, 40, 50], 30)).toBe(60);
    expect(percentileOf([0, 0, 1, 2], 0)).toBe(50);
  });

  it('builds 5 shortened percentile groups for an active IDP player', () => {
    const rankings = buildIdpPercentileRankings(mockPlayer, [mockPlayer, peerPlayer]);
    expect(rankings).not.toBeNull();
    expect(rankings!.cohortSize).toBe(2);

    const labels = rankings!.groups.map((g) => g.label);
    expect(labels).toEqual(['Snaps', 'Tackles', 'Pass Rush', 'Coverage', 'Form']);

    // Check Snaps
    const snapsGroup = rankings!.groups.find((g) => g.id === 'snaps')!;
    expect(snapsGroup.stats).toHaveLength(3);
    const snapPct = snapsGroup.stats.find((s) => s.key === 'snapPct')!;
    expect(snapPct.display).toBe('92%');
    expect(snapPct.percentile).toBe(100); // 92 vs 80 -> top of cohort

    // Check Tackles
    const tklGroup = rankings!.groups.find((g) => g.id === 'tackles')!;
    const tklPerGame = tklGroup.stats.find((s) => s.key === 'tacklesPerGame')!;
    expect(tklPerGame.display).toBe('8.5');
    expect(tklPerGame.percentile).toBe(100); // 8.5 vs 4.5

    // Check Pass Rush
    const prGroup = rankings!.groups.find((g) => g.id === 'passRush')!;
    const sacks = prGroup.stats.find((s) => s.key === 'totalSacks')!;
    expect(sacks.display).toBe('8.5');
    expect(sacks.percentile).toBe(50); // 8.5 vs 13.5 -> below peer

    // Check Form
    const formGroup = rankings!.groups.find((g) => g.id === 'form')!;
    const fpts = formGroup.stats.find((s) => s.key === 'fptsPerGame')!;
    expect(fpts.display).toBe('10.5');
    expect(fpts.percentile).toBe(100);
  });

  it('returns null for rookie or player with 0 games played', () => {
    const rookie: IdpPlayer = {
      ...mockPlayer,
      id: 'rookie-1',
      role: {
        ...mockPlayer.role!,
        gamesPlayed: 0,
      },
    };
    expect(buildIdpPercentileRankings(rookie, [mockPlayer, peerPlayer])).toBeNull();
  });
});
