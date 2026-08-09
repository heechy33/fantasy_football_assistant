import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerId } from '../../../shared/types';
import { positionalDemand, rosterSpotsPerTeam, starterReplacementRank } from './replacement';

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'demand-fixture', name: 'Demand Fixture', season: '2026', teams: 12,
  startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
  scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

/** teams(12) x rosterSpotsPerTeam(15, matching `settings.rosterSlots`'s sum) = 180. */
const N = settings.teams * rosterSpotsPerTeam(settings);

function syntheticAdp(counts: Record<string, number>): AdpEntry[] {
  const rows: AdpEntry[] = [];
  let adp = 1;
  for (const [position, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) {
      const playerId = `${position}-${i}` as PlayerId;
      rows.push({ playerId, name: playerId, position, team: null, adp, stdev: 5, high: 1, low: 1, timesDrafted: 50, byeWeek: null });
      adp += 1;
    }
  }
  return rows;
}

describe('positionalDemand', () => {
  it('full ADP coverage: uses real positional counts of the top N rows, K/DEF capped at one named slot per team', () => {
    // 180 usable rows, deliberately over-representing K/DEF to exercise the cap.
    const adp = syntheticAdp({ RB: 50, WR: 55, QB: 15, TE: 20, DEF: 20, K: 20 });
    expect(adp.length).toBe(N);
    const demand = positionalDemand({ settings, adp, scoredPlayerIds: new Set(adp.map((e) => e.playerId as PlayerId)) });
    expect(demand.source).toBe('adp');
    expect(demand.usableRows).toBe(N);
    expect(demand.byPosition.get('RB')).toBe(50);
    expect(demand.byPosition.get('WR')).toBe(55);
    expect(demand.byPosition.get('QB')).toBe(15);
    expect(demand.byPosition.get('TE')).toBe(20);
    // K/DEF: raw ADP count (20) exceeds one named slot per team (12), so the cap wins.
    expect(demand.byPosition.get('K')).toBe(12);
    expect(demand.byPosition.get('DEF')).toBe(12);
  });

  it('starter floor: a raw ADP undercount never drops demand below starters-only capacity', () => {
    // Only 5 QB rows in the ADP list — fewer than the 12 QB starters this league actually needs.
    const adp = syntheticAdp({ RB: 60, WR: 66, QB: 5, TE: 25, DEF: 12, K: 12 });
    expect(adp.length).toBe(N);
    const demand = positionalDemand({ settings, adp, scoredPlayerIds: new Set(adp.map((e) => e.playerId as PlayerId)) });
    expect(demand.source).toBe('adp');
    const starterFloor = starterReplacementRank(settings, 'QB') - 1;
    expect(starterFloor).toBe(12); // named(12) + flexShare(0, one-qb) + 1 - 1
    expect(demand.byPosition.get('QB')).toBe(starterFloor);
    expect(demand.byPosition.get('QB')).toBeGreaterThan(5);
  });

  it('superflex: the starter floor rises to reflect QB sharing FLEX pressure, above the ADP-observed count', () => {
    const superflexSettings: LeagueSettings = {
      ...settings,
      startingSlots: ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, SUPER_FLEX: 1, K: 1, DEF: 1, BN: 6 },
      format: { reception: 'ppr', qb: 'superflex', draft: 'snake' },
    };
    const spots = rosterSpotsPerTeam(superflexSettings);
    expect(spots).toBe(13); // QB+RB+WR+TE+SUPER_FLEX+K+DEF+BN(6) named counts sum to 13
    const total = superflexSettings.teams * spots; // 156
    // QB deliberately under-represented in raw ADP (10 rows) relative to what superflex actually needs.
    const adp = syntheticAdp({ RB: 45, WR: 50, QB: 10, TE: 20, DEF: 15, K: 16 });
    expect(adp.length).toBe(total);

    const demand = positionalDemand({ settings: superflexSettings, adp });
    const starterFloor = starterReplacementRank(superflexSettings, 'QB') - 1;
    // named(1) x teams(12) + flexShare(ceil(1*12/3)=4) = 16, well above the raw ADP count of 10.
    expect(starterFloor).toBe(16);
    expect(demand.byPosition.get('QB')).toBe(starterFloor);
    expect(demand.byPosition.get('QB')).toBeGreaterThan(10);
  });

  it('extrapolation: exactly 50% usable ADP coverage scales proportions up to the full roster universe', () => {
    // Exactly half the universe's rows, in the same rough proportions as the full-coverage case
    // above (RB/WR the two biggest shares; K/DEF deliberately over-represented to keep exercising
    // the cap after largest-remainder scaling).
    const half = syntheticAdp({ RB: 25, WR: 27, QB: 8, TE: 10, DEF: 10, K: 10 });
    expect(half.length).toBe(N / 2);
    const demand = positionalDemand({ settings, adp: half, scoredPlayerIds: new Set(half.map((e) => e.playerId as PlayerId)) });
    expect(demand.source).toBe('adp-extrapolated');
    expect(demand.usableRows).toBe(half.length);
    // Scaling preserves relative order: RB and WR (the two largest raw shares) demand more than
    // QB and TE (the two smallest), same as the raw input's ordering.
    expect(demand.byPosition.get('RB')).toBeGreaterThan(demand.byPosition.get('QB') ?? 0);
    expect(demand.byPosition.get('WR')).toBeGreaterThan(demand.byPosition.get('TE') ?? 0);
    // Scaling doubles the raw counts (180/90 = 2) before independent starter floors and K/DEF caps.
    expect(demand.byPosition.get('RB')).toBeGreaterThan(25);
    expect(demand.byPosition.get('WR')).toBeGreaterThan(27);
    // K/DEF's scaled share (10 x 2 = 20) exceeds one named slot per team, so the cap wins.
    expect(demand.byPosition.get('K')).toBe(12);
    expect(demand.byPosition.get('DEF')).toBe(12);
  });

  it('falls back to the default mix one usable row below the 50% coverage boundary', () => {
    const belowHalf = syntheticAdp({ RB: 25, WR: 26, QB: 8, TE: 10, DEF: 10, K: 10 });
    expect(belowHalf.length).toBe(N / 2 - 1);

    const demand = positionalDemand({ settings, adp: belowHalf });
    const fallback = positionalDemand({ settings, adp: [] });
    expect(demand.source).toBe('default-mix');
    expect(demand.usableRows).toBe(N / 2 - 1);
    expect([...demand.byPosition.entries()]).toEqual([...fallback.byPosition.entries()]);
  });

  it('does not extrapolate an extremely sparse, one-position ADP sample', () => {
    const sparse = syntheticAdp({ RB: 12 });
    const demand = positionalDemand({ settings, adp: sparse });
    const fallback = positionalDemand({ settings, adp: [] });

    expect(demand.source).toBe('default-mix');
    expect(demand.usableRows).toBe(12);
    expect([...demand.byPosition.entries()]).toEqual([...fallback.byPosition.entries()]);
    expect(demand.byPosition.get('WR')).toBeGreaterThan(0);
  });

  it('rejects non-finite, non-positive, and undersized roster-spots overrides', () => {
    const startingSpots = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR').length;
    expect(startingSpots).toBe(9);

    for (const rosterSpotsOverride of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, startingSpots - 1]) {
      const demand = positionalDemand({ settings, adp: [], rosterSpotsPerTeam: rosterSpotsOverride });
      expect(demand.rosterSpots, `override ${rosterSpotsOverride}`).toBe(N);
    }
  });

  it('accepts a finite positive roster-spots override at the starting-slot floor', () => {
    const startingSpots = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR').length;
    const demand = positionalDemand({ settings, adp: [], rosterSpotsPerTeam: startingSpots });
    expect(demand.rosterSpots).toBe(settings.teams * startingSpots);
  });

  it('default mix: no ADP at all falls back to the frozen proportional table, every position >= 1', () => {
    const demand = positionalDemand({ settings, adp: [] });
    expect(demand.source).toBe('default-mix');
    expect(demand.usableRows).toBe(0);
    for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
      expect(demand.byPosition.get(position)).toBeGreaterThanOrEqual(1);
    }
    // WR (named x2 + biggest DEFAULT_POSITION_MIX share) comfortably outdemands TE.
    expect(demand.byPosition.get('WR')).toBeGreaterThan(demand.byPosition.get('TE') ?? 0);
  });

  it('never clamps to 1 at any position with a starting slot, across all three tiers', () => {
    for (const adp of [syntheticAdp({ RB: 50, WR: 55, QB: 15, TE: 20, DEF: 20, K: 20 }), syntheticAdp({ RB: 25, WR: 27, QB: 8, TE: 10, DEF: 6, K: 6 }), []]) {
      const demand = positionalDemand({ settings, adp });
      for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
        expect(demand.byPosition.get(position)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('deterministic under input reordering: shuffling ADP rows does not change the resulting demand', () => {
    const rows = syntheticAdp({ RB: 50, WR: 55, QB: 15, TE: 20, DEF: 20, K: 20 });
    const shuffled = [...rows].reverse();
    // Interleave a second shuffle so this isn't just testing symmetric reversal.
    const interleaved: AdpEntry[] = [];
    for (let i = 0; i < rows.length; i += 1) interleaved.push(rows[(i * 37) % rows.length] as AdpEntry);

    const a = positionalDemand({ settings, adp: rows });
    const b = positionalDemand({ settings, adp: shuffled });
    const c = positionalDemand({ settings, adp: interleaved });
    expect([...b.byPosition.entries()]).toEqual([...a.byPosition.entries()]);
    expect([...c.byPosition.entries()]).toEqual([...a.byPosition.entries()]);
  });

  it('ties at the boundary break on (adp, name, playerId), independent of input array order', () => {
    // Three RB rows tied at adp=100, right at a boundary — only some of them should make the cut
    // depending on N, and the choice must be the same regardless of how the caller ordered them.
    const base = syntheticAdp({ RB: N - 2, WR: 0, QB: 0, TE: 0, DEF: 0, K: 0 });
    const tied: AdpEntry[] = [
      { playerId: 'tie-b' as PlayerId, name: 'B Player', position: 'WR', team: null, adp: base.length + 1, stdev: 5, high: 1, low: 1, timesDrafted: 50, byeWeek: null },
      { playerId: 'tie-a' as PlayerId, name: 'A Player', position: 'WR', team: null, adp: base.length + 1, stdev: 5, high: 1, low: 1, timesDrafted: 50, byeWeek: null },
      { playerId: 'tie-c' as PlayerId, name: 'A Player', position: 'TE', team: null, adp: base.length + 1, stdev: 5, high: 1, low: 1, timesDrafted: 50, byeWeek: null },
    ];
    const forward = positionalDemand({ settings, adp: [...base, ...tied] });
    const reversed = positionalDemand({ settings, adp: [...base, ...tied].reverse() });
    expect([...reversed.byPosition.entries()]).toEqual([...forward.byPosition.entries()]);
  });
});
