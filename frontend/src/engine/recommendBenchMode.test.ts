import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, Pick, PlayerId, PlayerMeta, SeasonProjection } from '../../../shared/types';
import {
  benchDepthValue,
  coreStartingSlotsFilled,
  depthPortfolioValue,
  expectedUnavailableFraction,
  prepareLineup,
  rosterUtility,
} from './eligibility';
import { buildRecommendationBoard, clearSimulationCache } from './recommend';

/**
 * Regression coverage for the bench-mode fix (see PLAN.md's bench-mode revision, "What breaks"
 * finding A). Before this fix, once every starting slot filled, `marginalRosterValue`/
 * `lookaheadValue` collapsed to a universal 0 and the board silently fell through to a
 * cross-position VOR ladder (`b.vor - a.vor`) — which, on real committed PPR data at a
 * late-draft state, ranks a redundant QB2 above every remaining WR because QB season totals run
 * mechanically higher than WR totals. `recommendBenchMode.test.ts`'s job is to prove that
 * regression cannot recur: a healthy-QB1 team's second QB must not outrank real roster-depth
 * candidates on the real committed board.
 */

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
function loadRealData<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'bench-mode', name: 'Bench Mode', season: '2026', teams: 12,
  startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 7 },
  scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

/**
 * Builds a plausible late-draft state on real committed data: "me" drafts one clean starter per
 * required slot (the actual best-by-ADP player at each position — an early-rounds-went-well team,
 * not a contrived one), then the market drafts strict ADP order around that until `count` total
 * picks are on the board. A pure round-robin strict-ADP simulation (every team, including "me",
 * autopicking strict ADP) is *not* used here because real ADP-ordered ADP ordering in this
 * committed dataset is heavily position-clustered — a snake-drafting autopicker can land 8 WRs and
 * 1 RB by round 14 at some slots, which is a realistic outcome for that mechanical construction but
 * not what this test is trying to isolate (a team whose starters are genuinely settled). Explicitly
 * seeding "me"'s starters guarantees the precondition deterministically without depending on which
 * snake slot happens to balance out on a given day's data refresh.
 */
function buildLateStateOnRealData(
  adp: AdpEntry[],
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
  scores: ReadonlySet<PlayerId>,
  teams: number,
  count: number,
): { picks: Pick[]; myRosterIds: PlayerId[] } {
  const usable = adp
    .filter((entry): entry is AdpEntry & { playerId: PlayerId } => entry.playerId != null && scores.has(entry.playerId))
    .sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
  const byPosition = (position: string) => usable.filter((entry) => playersById.get(entry.playerId)?.position === position);

  const myRosterIds: PlayerId[] = [
    byPosition('QB')[0], byPosition('RB')[0], byPosition('RB')[1], byPosition('WR')[0],
    byPosition('WR')[1], byPosition('TE')[0], byPosition('RB')[2], // extra RB fills FLEX
  ].map((entry) => {
    if (!entry) throw new Error('real committed ADP data unexpectedly too shallow for this fixture');
    return entry.playerId;
  });
  const myRosterIdSet = new Set(myRosterIds);

  const picks: Pick[] = myRosterIds.map((playerId, index) => ({
    overall: index + 1, round: 1, slot: 1, teamId: 'me', playerId, providerPlayerId: playerId,
  }));
  let overall = picks.length + 1;
  let opponentSlot = 2;
  for (const entry of usable) {
    if (picks.length >= count) break;
    if (myRosterIdSet.has(entry.playerId)) continue;
    picks.push({ overall, round: Math.ceil(overall / teams), slot: opponentSlot, teamId: `opp-${opponentSlot}`, playerId: entry.playerId, providerPlayerId: entry.playerId });
    overall += 1;
    opponentSlot = opponentSlot >= teams ? 1 : opponentSlot + 1;
    if (opponentSlot === 1) opponentSlot = 2; // slot 1 stays open in case "me" is conceptually slot 1
  }
  return { picks, myRosterIds };
}

describe('bench mode on real committed data (PLAN.md bench-mode revision, finding A)', () => {
  it('does not let a redundant QB2 outrank a genuine WR-depth candidate once starters are filled', () => {
    const players = loadRealData<PlayerMeta[]>('players.json');
    const projections = loadRealData<SeasonProjection[]>('projections-season.json');
    const adp = loadRealData<AdpEntry[]>('adp-ppr.json');
    const playersById = new Map(players.map((p) => [p.playerId, p]));
    const scores = new Set(projections.map((p) => p.playerId));

    const teams = 12;
    // Matches the plan's finding-A replay: ~170 picks (~round 14-15) is deep enough that "me"'s
    // starters are settled and plenty of real bench-tier RB/WR depth (plus a real QB2) remain
    // undrafted, but shallow enough that the board isn't just picked clean.
    const { picks, myRosterIds } = buildLateStateOnRealData(adp, playersById, scores, teams, 170);

    clearSimulationCache();
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks, myTeamId: 'me',
      nextPick: null, currentPick: picks.length + 1, limit: 40,
      rosterSpotsPerTeam: 16, draftRounds: 16,
    });

    // Sanity, matching the plan's replay: this scenario must actually exercise bench mode, and
    // "me" must actually already have a starting QB (so a second QB is a genuine redundant
    // pickup, not a real starter need) — otherwise the assertion below wouldn't test anything.
    expect(result.diagnostics.coreStartingSlotsFilled).toBe(true);
    const myQbCount = myRosterIds.filter((id) => playersById.get(id)?.position === 'QB').length;
    expect(myQbCount).toBeGreaterThanOrEqual(1);

    const skillRows = result.recommendations.filter((r) => {
      const position = playersById.get(r.playerId)?.position;
      return position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE';
    });
    expect(skillRows.length).toBeGreaterThan(0);
    expect(skillRows.every((r) => r.recommendationMode === 'bench')).toBe(true);

    const bestQb = skillRows.find((r) => playersById.get(r.playerId)?.position === 'QB');
    const bestFlexDepth = skillRows.find((r) => {
      const position = playersById.get(r.playerId)?.position;
      return position === 'RB' || position === 'WR';
    });
    expect(bestQb).toBeDefined();
    expect(bestFlexDepth).toBeDefined();

    // The regression this guards: before the fix, `bestQb` could out-rank `bestFlexDepth` purely
    // because QB season point totals run mechanically higher than RB/WR totals (a
    // positional-baseline VOR artifact), even though a
    // backup behind an already-rostered, presumably-healthy starting QB is worth very little as
    // real bench asset. Bench mode must not reproduce that: whichever of the two ranks first,
    // it must be because its unified starter-plus-depth utility is higher, not merely its VOR.
    if ((bestQb!.rank) < (bestFlexDepth!.rank)) {
      expect(bestQb!.marginalRosterUtility).toBeGreaterThanOrEqual(bestFlexDepth!.marginalRosterUtility);
    }

    // General invariant across the whole displayed bench-mode board: rank order among skill rows
    // must be non-increasing in unified marginal roster utility — outside a near-tie band. Inside
    // one, the within-band comparator (survival -> ADP -> planValue -> id) can legitimately invert
    // a value-only order by up to the band's own tolerance — the same `max(1, 1% of value)` width
    // `buildRecommendationBoard` itself uses to decide band membership (see recommend.ts's near-tie
    // band construction). This is the intended near-tie behavior, not a regression.
    for (let i = 1; i < skillRows.length; i += 1) {
      const prev = skillRows[i - 1]!;
      const cur = skillRows[i]!;
      const tolerance = prev.nearTie && cur.nearTie
        ? Math.max(1, 0.01 * Math.abs(prev.marginalRosterUtility))
        : 1e-9;
      expect(prev.marginalRosterUtility).toBeGreaterThanOrEqual(cur.marginalRosterUtility - tolerance);
    }
  });
});

describe('benchDepthValue / expectedUnavailableFraction (eligibility.ts)', () => {
  const qbSlotSettings: LeagueSettings = {
    provider: 'sleeper', leagueId: 'unit', name: 'Unit', season: '2026', teams: 12,
    startingSlots: ['QB', 'RB', 'WR'],
    rosterSlots: { QB: 1, RB: 1, WR: 1, BN: 3 },
    scoring: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  };

  function meta(playerId: string, position: 'QB' | 'RB' | 'WR' | 'TE', byeWeek: number | null = null): PlayerMeta {
    return { playerId, name: playerId, position, eligiblePositions: [position], team: null, byeWeek, age: null, yearsExp: null, injuryStatus: null, ids: {} };
  }

  it('returns 0 while a slot is still open — bench value never duplicates starter MRV', () => {
    const roster = prepareLineup(qbSlotSettings, [], new Map());
    expect(coreStartingSlotsFilled(roster)).toBe(false);
    const candidate = meta('qb-backup', 'QB');
    const value = benchDepthValue(roster, candidate, 250, new Map([['QB', 200]]), new Map());
    expect(value).toBe(0);
  });

  it('returns 0 for a position with no reachable starting slot at all', () => {
    const starter = meta('qb-1', 'QB');
    const roster = prepareLineup(qbSlotSettings, [starter, meta('rb-1', 'RB'), meta('wr-1', 'WR')], new Map([
      [starter.playerId, 300], ['rb-1', 200], ['wr-1', 180],
    ]));
    expect(coreStartingSlotsFilled(roster)).toBe(true);
    // TE has no eligible slot at all in this league (startingSlots is only QB/RB/WR) — not merely
    // filled, genuinely ineligible, so there is nothing for `reachableSlotsFor` to find.
    const te = meta('te-1', 'TE');
    const value = benchDepthValue(roster, te, 120, new Map([['TE', 100]]), new Map());
    expect(value).toBe(0);
  });

  it('returns 0 for a genuine starter upgrade so MRV, not insurance, prices it', () => {
    const starter = meta('qb-1', 'QB', 10);
    const roster = prepareLineup(qbSlotSettings, [starter, meta('rb-1', 'RB'), meta('wr-1', 'WR')], new Map([
      [starter.playerId, 200], ['rb-1', 200], ['wr-1', 180],
    ]));
    const upgrade = meta('qb-upgrade', 'QB', 11);
    expect(benchDepthValue(roster, upgrade, 300, new Map([['QB', 150]]), new Map())).toBe(0);
  });

  it('weights the gap by expected games missed — a bye-colliding, injury-prone incumbent raises bench value', () => {
    const starter = meta('qb-1', 'QB', 10);
    const roster = prepareLineup(qbSlotSettings, [starter, meta('rb-1', 'RB', 10), meta('wr-1', 'WR', 10)], new Map([
      [starter.playerId, 300], ['rb-1', 200], ['wr-1', 180],
    ]));
    const replacementPoints = new Map([['QB', 200]]);
    const healthyBackup = meta('qb-healthy-incumbent-view', 'QB', 11); // different bye than starter
    const availability = new Map([[starter.playerId, 0.95]]); // durable starter
    const lowRisk = benchDepthValue(roster, healthyBackup, 260, replacementPoints, availability);

    const fragileAvailability = new Map([[starter.playerId, 0.5]]); // injury-prone starter
    const highRisk = benchDepthValue(roster, healthyBackup, 260, replacementPoints, fragileAvailability);

    expect(highRisk).toBeGreaterThan(lowRisk);
    expect(lowRisk).toBeGreaterThan(0); // bye collision alone still contributes something
  });

  it('falls back to DEFAULT_AVAILABILITY_RATE for an incumbent missing from availabilityByPlayer', () => {
    const starter = meta('qb-1', 'QB', 10);
    const fraction = expectedUnavailableFraction(starter, meta('qb-2', 'QB', 11), new Map());
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
  });

  it('a shared bye week contributes no bye-collision risk (candidate cannot help that week either)', () => {
    const starter = meta('qb-1', 'QB', 10);
    const sameByeBackup = meta('qb-2', 'QB', 10);
    const differentByeBackup = meta('qb-3', 'QB', 11);
    const availability = new Map([[starter.playerId, 1]]); // never misses a game from health
    const sameByeFraction = expectedUnavailableFraction(starter, sameByeBackup, availability);
    const differentByeFraction = expectedUnavailableFraction(starter, differentByeBackup, availability);
    expect(sameByeFraction).toBe(0);
    expect(differentByeFraction).toBeGreaterThan(sameByeFraction);
  });

  it('matches one FLEX-eligible bench player to only one occupied starter slot', () => {
    const flexSettings: LeagueSettings = {
      ...qbSlotSettings,
      startingSlots: ['WR', 'FLEX'],
      rosterSlots: { WR: 1, FLEX: 1, BN: 2 },
    };
    const wrStarter = meta('wr-starter', 'WR');
    const rbStarter = meta('rb-starter', 'RB');
    const wrDepth = meta('wr-depth', 'WR');
    const roster = prepareLineup(flexSettings, [wrStarter, rbStarter, wrDepth], new Map([
      [wrStarter.playerId, 200], [rbStarter.playerId, 190], [wrDepth.playerId, 160],
    ]));
    const replacement = new Map([['WR', 100], ['RB', 100]]);
    const availability = new Map([[wrStarter.playerId, 0], [rbStarter.playerId, 0]]);
    const oneEdge = 60 * 16 / 17;
    expect(depthPortfolioValue(roster, replacement, availability)).toBeCloseTo(oneEdge, 8);
  });

  it('rematches the whole depth portfolio so two bench players can cover WR and FLEX separately', () => {
    const flexSettings: LeagueSettings = {
      ...qbSlotSettings,
      startingSlots: ['WR', 'FLEX'],
      rosterSlots: { WR: 1, FLEX: 1, BN: 2 },
    };
    const starters = [meta('wr-starter', 'WR'), meta('rb-starter', 'RB')];
    const depth = [meta('wr-depth-1', 'WR'), meta('wr-depth-2', 'WR')];
    const roster = prepareLineup(flexSettings, [...starters, ...depth], new Map([
      ['wr-starter', 200], ['rb-starter', 190], ['wr-depth-1', 160], ['wr-depth-2', 150],
    ]));
    const availability = new Map(starters.map((player) => [player.playerId, 0]));
    expect(depthPortfolioValue(roster, new Map([['WR', 100], ['RB', 100]]), availability))
      .toBeCloseTo((60 + 50) * 16 / 17, 8);
  });

  it('keeps a starter upgrade on the starter path while valuing the displaced incumbent as depth', () => {
    const flexSettings: LeagueSettings = {
      ...qbSlotSettings,
      startingSlots: ['WR', 'FLEX'],
      rosterSlots: { WR: 1, FLEX: 1, BN: 2 },
    };
    const roster = prepareLineup(
      flexSettings,
      [meta('wr-starter', 'WR'), meta('rb-starter', 'RB')],
      new Map([['wr-starter', 200], ['rb-starter', 190]]),
    );
    const upgraded = prepareLineup(
      flexSettings,
      [meta('wr-starter', 'WR'), meta('rb-starter', 'RB'), meta('wr-upgrade', 'WR')],
      new Map([['wr-starter', 200], ['rb-starter', 190], ['wr-upgrade', 250]]),
    );
    const replacement = new Map([['WR', 100], ['RB', 100]]);
    const availability = new Map([['wr-upgrade', 0], ['wr-starter', 0], ['rb-starter', 0]]);
    const before = rosterUtility(roster, replacement, availability);
    const after = rosterUtility(upgraded, replacement, availability);
    expect(after.starterValue - before.starterValue).toBe(60);
    expect(after.depthValue).toBeCloseTo(90 * 16 / 17, 8);
    expect(after.total - before.total).toBeCloseTo(60 + 90 * 16 / 17, 8);
  });
});

describe('ADP-reach warning (recommend.ts)', () => {
  const reachSettings: LeagueSettings = {
    provider: 'sleeper', leagueId: 'reach', name: 'Reach', season: '2026', teams: 12,
    startingSlots: ['WR', 'WR'],
    rosterSlots: { WR: 2, BN: 2 },
    scoring: { rec: 1, rec_yd: 0.1, rec_td: 6 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  };
  function wr(playerId: string): PlayerMeta {
    return { playerId, name: playerId, position: 'WR', eligiblePositions: ['WR'], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
  }
  function adpEntry(playerId: string, adp: number): AdpEntry {
    return { playerId, name: playerId, position: 'WR', team: null, adp, stdev: 3, high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'sleeper', stdevSource: 'fitted' };
  }

  it('flags a >=20-pick reach ahead of ADP as a warning, without vetoing the pick', () => {
    const players = [wr('reach-wr'), wr('on-adp-wr')];
    const projections: SeasonProjection[] = [
      { playerId: 'reach-wr', source: 'test', stats: { rec: 10, rec_yd: 100, rec_td: 1 } }, // best score
      { playerId: 'on-adp-wr', source: 'test', stats: { rec: 5, rec_yd: 40, rec_td: 0 } },
    ];
    const adp: AdpEntry[] = [adpEntry('reach-wr', 75), adpEntry('on-adp-wr', 48)];
    clearSimulationCache();
    const result = buildRecommendationBoard({
      settings: reachSettings, players, projections, adp, picks: [], myTeamId: 'me',
      nextPick: 60, currentPick: 50, limit: 2,
    });
    const reachRow = result.recommendations.find((r) => r.playerId === 'reach-wr');
    const onAdpRow = result.recommendations.find((r) => r.playerId === 'on-adp-wr');
    expect(reachRow).toBeDefined();
    expect(reachRow!.warnings.some((w) => /reach of 25 picks/.test(w))).toBe(true);
    expect(reachRow!.warnings.some((w) => /Not a veto/.test(w))).toBe(true);
    // Informational only — the reach candidate still leads on projection, unchanged by the warning.
    expect(result.recommendations[0]?.playerId).toBe('on-adp-wr');
    expect(reachRow!.planValue).toBeLessThan(onAdpRow!.planValue);
    expect(onAdpRow!.warnings.some((w) => /reach of/.test(w))).toBe(false);
  });

  it('never fakes a reach warning or availability for a player missing from the ADP board', () => {
    const players = [wr('no-adp-wr')];
    const projections: SeasonProjection[] = [
      { playerId: 'no-adp-wr', source: 'test', stats: { rec: 8, rec_yd: 80, rec_td: 1 } },
    ];
    clearSimulationCache();
    const result = buildRecommendationBoard({
      settings: reachSettings, players, projections, adp: [], picks: [], myTeamId: 'me',
      nextPick: 60, currentPick: 50, limit: 1,
    });
    const row = result.recommendations.find((r) => r.playerId === 'no-adp-wr');
    expect(row).toBeDefined();
    expect(row!.availableNextPickProbability).toBeNull();
    expect(row!.warnings.some((w) => /reach of/.test(w))).toBe(false);
  });
});

describe('post-core-fill presentation (recommend.ts)', () => {
  const presentationSettings: LeagueSettings = {
    provider: 'sleeper', leagueId: 'presentation', name: 'Presentation', season: '2026', teams: 12,
    startingSlots: ['QB', 'RB', 'WR', 'K'], rosterSlots: { QB: 1, RB: 1, WR: 1, K: 1, BN: 2 },
    scoring: { pass_yd: 0.04, rush_yd: 0.1, rec: 1, rec_yd: 0.1, fgm: 1 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  };
  const starterQb = { playerId: 'starter-qb', name: 'starter-qb', position: 'QB' as const, eligiblePositions: ['QB'] as ('QB')[], team: null, byeWeek: 10, age: null, yearsExp: null, injuryStatus: null, ids: {} };
  const starterRb = { playerId: 'starter-rb', name: 'starter-rb', position: 'RB' as const, eligiblePositions: ['RB'] as ('RB')[], team: null, byeWeek: 10, age: null, yearsExp: null, injuryStatus: null, ids: {} };
  const starterWr = { playerId: 'starter-wr', name: 'starter-wr', position: 'WR' as const, eligiblePositions: ['WR'] as ('WR')[], team: null, byeWeek: 10, age: null, yearsExp: null, injuryStatus: null, ids: {} };
  const upgradeQb = { playerId: 'upgrade-qb', name: 'upgrade-qb', position: 'QB' as const, eligiblePositions: ['QB'] as ('QB')[], team: null, byeWeek: 11, age: null, yearsExp: null, injuryStatus: null, ids: {} };
  const kicker = { playerId: 'kicker', name: 'kicker', position: 'K' as const, eligiblePositions: ['K'] as ('K')[], team: null, byeWeek: 11, age: null, yearsExp: null, injuryStatus: null, ids: {} };
  const players: PlayerMeta[] = [starterQb, starterRb, starterWr, upgradeQb, kicker];
  const projections: SeasonProjection[] = [
    { playerId: 'starter-qb', source: 'test', stats: { pass_yd: 2500 } },
    { playerId: 'starter-rb', source: 'test', stats: { rush_yd: 1000 } },
    { playerId: 'starter-wr', source: 'test', stats: { rec: 50, rec_yd: 900 } },
    { playerId: 'upgrade-qb', source: 'test', stats: { pass_yd: 7500 } },
    { playerId: 'kicker', source: 'test', stats: { fgm: 100 } },
  ];
  const picks: Pick[] = [starterQb, starterRb, starterWr].map((player, index) => ({
    overall: index + 1, round: 1, slot: 1, teamId: 'me', playerId: player.playerId, providerPlayerId: player.playerId,
  }));

  it('keeps a positive-MRV player in starter mode after core slots fill', () => {
    const result = buildRecommendationBoard({
      settings: presentationSettings, players, projections, adp: [], picks, myTeamId: 'me', nextPick: null, limit: 2,
    });
    const row = result.recommendations.find((recommendation) => recommendation.playerId === 'upgrade-qb');
    expect(result.diagnostics.coreStartingSlotsFilled).toBe(true);
    expect(row?.marginalRosterValue).toBeGreaterThan(0);
    expect(row?.benchDepthValue).toBe(0);
    expect(row?.recommendationMode).toBe('starter');
    expect(row?.rankingBasis).toBe('rosterUtility');
  });

  it('keeps an unfilled kicker slot in starter presentation, not Bench Mode', () => {
    const result = buildRecommendationBoard({
      settings: presentationSettings, players, projections, adp: [], picks, myTeamId: 'me', nextPick: null,
      displayPosition: 'K', limit: 1,
    });
    const row = result.recommendations[0];
    expect(row?.playerId).toBe('kicker');
    expect(row?.recommendationMode).toBe('starter');
    expect(row?.rankingBasis).toBe('specialTeams');
  });
});
