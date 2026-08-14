import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, DraftInit, DraftPicks, LeagueSettings, Pick, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { estimateAvailability } from './availability';
import { optimizeLineup } from './eligibility';
import { replacementLevels } from './replacement';
import { buildRecommendationBoard, buildRecommendations, selectCandidates, type RecommendationResult } from './recommend';
import { comparePlayersByScoreDesc } from './ranking';
import { scoreProjection } from './scoring';
import { buildTiers } from './tiers';

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'fixture', name: 'Fixture', season: '2026', teams: 12,
  startingSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX'], rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1 },
  scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function player(playerId: string, position: 'QB' | 'RB' | 'WR' | 'TE'): PlayerMeta {
  return { playerId, name: playerId, position, eligiblePositions: [position], team: 'BUF', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
}

// A single-team league (teams: 1) makes replacementRank() arithmetic small enough to verify by
// hand: named(1) + flexShare(ceil(1*1/3)=1) + 1 = 3, so RB replacement is always "3rd-best RB in
// the pool being measured" unless clamped by consumedByPosition.
const smallLeagueSettings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'small', name: 'Small', season: '2026', teams: 1,
  startingSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX'], rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1 },
  scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

/** Every scoring key present with weight 0 so no key ever lands in `unsupportedScoringKeys` —
 * keeps these fixture players' `approximate`/warnings clean unless a test wants otherwise. */
function statLine(overrides: Partial<Record<string, number>> = {}): Record<string, number> {
  return { pass_yd: 0, pass_td: 0, pass_int: 0, rush_yd: 0, rec: 0, rec_yd: 0, rec_td: 0, fum_lost: 0, ...overrides };
}

const smallPlayers: PlayerMeta[] = [
  player('rb1', 'RB'), player('rb2', 'RB'), player('rb3', 'RB'), player('rb4', 'RB'),
  player('wr1', 'WR'), player('te1', 'TE'),
];
const smallProjections: SeasonProjection[] = [
  { playerId: 'rb1', source: 'fftoday', stats: statLine({ rush_yd: 1000 }) }, // 100 pts
  { playerId: 'rb2', source: 'fftoday', stats: statLine({ rush_yd: 700 }) }, // 70 pts
  { playerId: 'rb3', source: 'fftoday', stats: statLine({ rush_yd: 500 }) }, // 50 pts
  { playerId: 'rb4', source: 'fftoday', stats: statLine({ rush_yd: 300 }) }, // 30 pts
  { playerId: 'wr1', source: 'fftoday', stats: statLine({ rec_yd: 900 }) }, // 90 pts
  { playerId: 'te1', source: 'fftoday', stats: statLine({ rec_yd: 800 }) }, // 80 pts
];

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'sleeper');
function readFixture<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, fileName), 'utf-8')) as T;
}

// Validates against the real, committed pipeline output in data/ — not a fixture.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
function loadRealData<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

describe('deterministic S2 engine', () => {
  it('recomputes supported scoring and reports missing FFToday components', () => {
    const projection: SeasonProjection = { playerId: 'qb', source: 'fftoday', stats: { pass_yd: 4000, pass_td: 30, pass_int: 10 } };
    const result = scoreProjection(projection, settings, 'QB');
    expect(result.points).toBe(260);
    expect(result.unsupportedScoringKeys).toEqual(['rush_yd', 'fum_lost']);
    expect(result.rawMissingScoringKeys).toEqual(['rush_yd', 'rec', 'rec_yd', 'rec_td', 'fum_lost']);
    expect(result.componentDiagnostics.find((component) => component.key === 'rec')?.applicability).toBe('non-applicable');
    expect(result.approximate).toBe(true);
  });

  it('recomputes the five observed player totals exactly under standard PPR', () => {
    const players = loadRealData<PlayerMeta[]>('players.json');
    const projections = loadRealData<SeasonProjection[]>('projections-season.json');
    const playersByName = new Map(players.map((entry) => [entry.name, entry]));
    const projectionsById = new Map(projections.map((entry) => [entry.playerId, entry]));
    const pprSettings: LeagueSettings = {
      ...settings,
      scoring: {
        pass_yd: 0.04, pass_td: 4, pass_int: -2,
        rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2,
      },
    };
    const expected = new Map([
      ['Harold Fannin', 187.1],
      ['Bhayshul Tuten', 226.3],
      ['Kyle Pitts', 185.6],
      ['Travis Kelce', 174.1],
      ['Sam LaPorta', 165.5],
    ]);

    for (const [name, points] of expected) {
      const meta = playersByName.get(name);
      const projection = meta ? projectionsById.get(meta.playerId) : undefined;
      expect(meta, `missing player metadata for ${name}`).toBeDefined();
      expect(projection, `missing projection for ${name}`).toBeDefined();
      expect(scoreProjection(projection!, pprSettings, meta!.position).points).toBeCloseTo(points, 6);
    }
  });

  it('omits QB, K, and DEF scoring keys from TE missing-component warnings', () => {
    const teSettings: LeagueSettings = {
      ...settings,
      scoring: {
        pass_td: 4, rush_yd: 0.1, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2,
        fgm_0_19: 3, pts_allow_0: 10,
      },
    };
    const projection: SeasonProjection = {
      playerId: 'te', source: 'fftoday', stats: { rec: 70, rec_yd: 800, rec_td: 5 },
    };
    const result = scoreProjection(projection, teSettings, 'TE');
    expect(result.unsupportedScoringKeys).toEqual(['rush_yd', 'fum_lost']);
    for (const key of ['pass_td', 'fgm_0_19', 'pts_allow_0'] as const) {
      expect(result.unsupportedScoringKeys).not.toContain(key);
    }
    expect(result.rawMissingScoringKeys).toEqual(expect.arrayContaining(['pass_td', 'fgm_0_19', 'pts_allow_0']));
  });

  it('classifies two-point/fumble gaps as minor and custom scoring gaps as material', () => {
    const projection: SeasonProjection = {
      playerId: 'te', source: 'fftoday', stats: { rec: 70, rec_yd: 800, rec_td: 5 },
    };
    const minor = scoreProjection(projection, {
      ...settings, scoring: { rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2 },
    }, 'TE');
    expect(minor.severity).toBe('minor');
    expect(minor.componentDiagnostics.filter((component) => component.applicability === 'applicable'))
      .toEqual(expect.arrayContaining([
        { key: 'rec_2pt', applicability: 'applicable', severity: 'minor' },
        { key: 'fum_lost', applicability: 'applicable', severity: 'minor' },
      ]));

    const material = scoreProjection(projection, {
      ...settings, scoring: { rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 1 },
    }, 'TE');
    expect(material.severity).toBe('material');
    expect(material.unsupportedScoringKeys).toEqual(['bonus_rec_te']);
  });

  it('builds leader-anchored TE tiers and distinguishes boundary from adjacent gaps', () => {
    const tePlayers = ['fannin', 'pitts', 'kelce', 'laporta'].map((id) => player(id, 'TE'));
    const points = new Map([
      ['fannin', 187.1],
      ['pitts', 185.6],
      ['kelce', 174.1],
      ['laporta', 163.5],
    ]);
    const tiers = buildTiers(tePlayers, points);

    expect(['fannin', 'pitts', 'kelce'].map((id) => tiers.get(id)?.tier)).toEqual([1, 1, 1]);
    expect(tiers.get('laporta')?.tier).toBe(2);
    expect(tiers.get('fannin')?.remainingInTier).toBe(3);
    expect(tiers.get('fannin')?.gapToNextPlayer).toBeCloseTo(1.5, 6);
    expect(tiers.get('pitts')?.gapToNextPlayer).toBeCloseTo(11.5, 6);
    expect(tiers.get('fannin')?.tierBoundaryGap).toBeCloseTo(10.6, 6);
    expect(tiers.get('kelce')?.tierBoundaryGap).toBeCloseTo(10.6, 6);
    expect(tiers.get('kelce')?.isTierLast).toBe(true);
  });

  it('explains the shared tier cliff and the last player at the tier boundary', () => {
    const tePlayers = ['fannin', 'pitts', 'kelce', 'laporta'].map((id) => player(id, 'TE'));
    const projected = new Map([
      ['fannin', 187.1],
      ['pitts', 185.6],
      ['kelce', 174.1],
      ['laporta', 163.5],
    ]);
    const teProjections: SeasonProjection[] = tePlayers.map((entry) => ({
      playerId: entry.playerId,
      source: 'fftoday',
      stats: { rec_yd: (projected.get(entry.playerId) ?? 0) * 10 },
    }));
    const teSettings: LeagueSettings = {
      ...smallLeagueSettings,
      startingSlots: ['TE'],
      rosterSlots: { TE: 1 },
      scoring: { rec_yd: 0.1 },
    };
    const board = buildRecommendations({
      settings: teSettings,
      players: tePlayers,
      projections: teProjections,
      adp: [],
      picks: [],
      myTeamId: 'me',
      nextPick: 2,
      limit: 4,
    });
    expect(board.find((entry) => entry.playerId === 'fannin')?.reasons)
      .toContain('3 tier-1 TEs remain; the cliff after this tier is 10.6 points.');
    expect(board.find((entry) => entry.playerId === 'kelce')?.reasons)
      .toContain('Last tier-1 TE; the next tier starts 10.6 points lower.');
  });

  it('uses the optimal FLEX assignment instead of a positional cutoff', () => {
    // Classic counterexample: the WR belongs in FLEX while the RB fills the dedicated RB slot.
    // A positional-cutoff heuristic that refuses to put a WR in FLEX (or fills FLEX before RB)
    // cannot reach 190.
    const flexSettings: LeagueSettings = { ...settings, startingSlots: ['RB', 'FLEX'], rosterSlots: { RB: 1, FLEX: 1 } };
    const players = [player('rb', 'RB'), player('wr', 'WR')];
    const result = optimizeLineup(flexSettings, players, new Map([['rb', 80], ['wr', 110]]));
    expect(result.value).toBe(190);
    expect(result.assignments).toEqual(expect.arrayContaining([
      { playerId: 'rb', slot: 'RB', value: 80 },
      { playerId: 'wr', slot: 'FLEX', value: 110 },
    ]));
  });

  it('handles deterministic availability boundaries', () => {
    const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 20, stdev: 0, high: 0, low: 0, timesDrafted: 1, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' };
    // Strict `>`: ADP equal to nextPick is already gone; ADP just past nextPick is still available.
    expect(estimateAvailability(entry, { currentPick: 1, nextPick: 19 })?.probability).toBe(1);
    expect(estimateAvailability(entry, { currentPick: 1, nextPick: 20 })?.probability).toBe(0);
    expect(estimateAvailability(entry, { currentPick: 1, nextPick: 21 })?.probability).toBe(0);
  });

  describe('recommendations respond to the draft, not just raw points (regression: all-QB board)', () => {
    it('A: re-ranks after an opponent drafts the prior best player; an opponent pick never fills my roster', () => {
      const base = { settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], myTeamId: 'me', nextPick: 2, limit: 4 };
      const before = buildRecommendations({ ...base, picks: [] });
      expect(before[0]?.playerId).toBe('rb1');

      const opponentPick: Pick = { overall: 1, round: 1, slot: 1, teamId: 'opponent', playerId: 'rb1', providerPlayerId: 'rb1' };
      const after = buildRecommendations({ ...base, picks: [opponentPick] });
      expect(after.some((r) => r.playerId === 'rb1')).toBe(false);
      expect(after[0]?.playerId).not.toBe(before[0]?.playerId);
      // Empty roster + open slot: ranking value still equals raw projected points — the opponent's
      // pick changed who's available, not what my (still-empty) roster is worth.
      expect(after[0]?.marginalRosterValue).toBe(after[0]?.projectedPoints);
    });

    it('B: myTeamId null behaves identically to a valid team that has made no picks', () => {
      const base = { settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: [], nextPick: 2, limit: 6 };
      const nullTeam = buildRecommendations({ ...base, myTeamId: null });
      const namedTeamNoPicks = buildRecommendations({ ...base, myTeamId: 'ghost-team' });
      expect(nullTeam.map((r) => r.playerId)).toEqual(namedTeamNoPicks.map((r) => r.playerId));
      expect(nullTeam.length).toBeGreaterThan(0);
      expect(nullTeam.every((r) => r.marginalRosterValue === r.projectedPoints)).toBe(true);
    });

    it('marginal roster value only degenerates to raw points when a slot is truly open', () => {
      const openSlot = buildRecommendations({ settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: [], myTeamId: null, nextPick: 2, limit: 6 });
      const rb2Open = openSlot.find((r) => r.playerId === 'rb2');
      expect(rb2Open?.marginalRosterValue).toBe(70);

      // My own RB (100) and RB (30) fill both RB-type slots (RB + FLEX). A third RB (70) must now
      // displace the weaker of the two (30) rather than simply landing in an open slot.
      const filledSlots: Pick[] = [
        { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
        { overall: 2, round: 1, slot: 1, teamId: 'me', playerId: 'rb4', providerPlayerId: 'rb4' },
      ];
      const filled = buildRecommendations({ settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: filledSlots, myTeamId: 'me', nextPick: 3, limit: 6 });
      const rb2Filled = filled.find((r) => r.playerId === 'rb2');
      expect(rb2Filled?.marginalRosterValue).toBe(40); // {rb1,rb2}=170 vs {rb1,rb4}=130
      expect(rb2Filled?.marginalRosterValue).toBeLessThan(rb2Open?.marginalRosterValue ?? Infinity);
    });
  });

  it('C: positional diversity on the real committed data set (the reported symptom)', () => {
    const players = loadRealData<PlayerMeta[]>('players.json');
    const projections = loadRealData<SeasonProjection[]>('projections-season.json');
    const adp = loadRealData<AdpEntry[]>('adp-ppr.json');

    const realSettings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'real', name: 'Real', season: '2026', teams: 10,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
      scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };

    // 12 picks in ADP order, snake-assigned to 10 teams with "me" holding slot 3 — matches a real
    // 10-team mock's round-1/round-2 boundary (picks 11-12 land on slots 10 and 9).
    const teams = 10;
    const topByAdp = adp.filter((entry): entry is AdpEntry & { playerId: string } => entry.playerId != null)
      .sort((a, b) => a.adp - b.adp).slice(0, 12);
    const slotForOverall = (overall: number) => {
      const round = Math.ceil(overall / teams);
      const posInRound = overall - (round - 1) * teams;
      return round % 2 === 0 ? teams - posInRound + 1 : posInRound;
    };
    const picks: Pick[] = topByAdp.map((entry, index) => {
      const overall = index + 1;
      const slot = slotForOverall(overall);
      const teamId = slot === 3 ? 'me' : `opp-${slot}`;
      return { overall, round: Math.ceil(overall / teams), slot, teamId, playerId: entry.playerId, providerPlayerId: entry.playerId };
    });

    const top5 = buildRecommendations({ settings: realSettings, players, projections, adp, picks, myTeamId: 'me', nextPick: 18, currentPick: 13, limit: 5 });
    expect(top5.length).toBe(5);
    const qbCount = top5.slice(0, 3).filter((r) => players.find((p) => p.playerId === r.playerId)?.position === 'QB').length;
    expect(qbCount).toBeLessThanOrEqual(1);

    // The reported symptom was a position (WR) getting recommended once, early, and then never
    // again — its replacement baseline had degenerated to its own best remaining player, pinning
    // replacementAdjustedValue at exactly 0 forever (replacement.ts's ADP-derived demand fixes
    // this; see the pick-67 regression below for the exhaustion case directly). At this early,
    // nothing-exhausted-yet snapshot, RB legitimately sweeping the top of the board is expected S2
    // behavior, not a bug: this dataset's RB point curve edges out WR's at every comparable depth,
    // and QB/TE are correctly deprioritized early since only 1 named slot each is under real
    // pressure (vs RB's 2 and WR's 3). A single top-5 position-count snapshot doesn't distinguish
    // "legitimately scarce" from "invisible" — the real invariant is that no position with actual
    // remaining value is pinned non-positive across the whole board.
    const wide = buildRecommendations({ settings: realSettings, players, projections, adp, picks, myTeamId: 'me', nextPick: 18, currentPick: 13, limit: 60 });
    for (const position of ['QB', 'RB', 'WR', 'TE']) {
      const best = wide.find((r) => players.find((p) => p.playerId === r.playerId)?.position === position);
      expect(best, `no ${position} appeared anywhere in a 60-deep board`).toBeDefined();
      expect(best!.replacementAdjustedValue, `${position}'s best player has non-positive value`).toBeGreaterThan(0);
    }
  });

  describe('D: dynamic replacement over a draining pool', () => {
    const scores = new Map(smallProjections.map((p) => [p.playerId, scoreProjection(p, smallLeagueSettings).points]));

    it('static (full pool) replacement level', () => {
      const levels = replacementLevels(smallLeagueSettings, smallPlayers, scores);
      const rb = levels.find((l) => l.position === 'RB');
      expect(rb?.rank).toBe(3);
      expect(rb?.points).toBe(50); // 3rd-best RB of [100,70,50,30] = rb3
    });

    it('removing exactly the top-consumed players reproduces the static level (the invariance property)', () => {
      const remaining = smallPlayers.filter((p) => p.playerId !== 'rb1');
      const levels = replacementLevels(smallLeagueSettings, remaining, scores, { consumedByPosition: new Map([['RB', 1]]) });
      const rb = levels.find((l) => l.position === 'RB');
      expect(rb?.rank).toBe(2); // leagueDemandRank(3) - consumed(1)
      expect(rb?.points).toBe(50); // same rb3 as the static level above
      expect(rb?.exhausted).toBe(false);
      expect(rb?.floored).toBe(false); // 3-1=2 already meets MIN_REPLACEMENT_RANK; the floor didn't have to act
    });

    it('floors the remaining rank so the best player left is never the replacement level', () => {
      const remaining = smallPlayers.filter((p) => p.playerId === 'rb4' || p.playerId === 'wr1' || p.playerId === 'te1');
      const levels = replacementLevels(smallLeagueSettings, remaining, scores, { consumedByPosition: new Map([['RB', 3]]) });
      const rb = levels.find((l) => l.position === 'RB');
      // Demand (2) is fully consumed (3-2=1 < MIN_REPLACEMENT_RANK), so MIN_REPLACEMENT_RANK=2 raises
      // the rank rather than letting it clamp to 1 — the old exhaustion pathology this module now
      // prevents (see replacement.ts's ReplacementLevel.exhausted doc). Only rb4 remains in this
      // fixture's pool, so the rank-1-fallback still resolves to rb4 — the *rank* changes, not the
      // resolved player, because a 2-RB pool would be needed to show the floor picking a worse player.
      expect(rb?.rank).toBe(2);
      expect(rb?.exhausted).toBe(true);
      expect(rb?.floored).toBe(true);
      expect(rb?.points).toBe(30); // only rb4 left
    });

    it('floored rank picks the 2nd-best remaining player, not the best, once a real 2-player pool exists', () => {
      const remaining = smallPlayers.filter((p) => p.playerId === 'rb3' || p.playerId === 'rb4');
      const levels = replacementLevels(smallLeagueSettings, remaining, scores, { consumedByPosition: new Map([['RB', 3]]) });
      const rb = levels.find((l) => l.position === 'RB');
      expect(rb?.rank).toBe(2);
      expect(rb?.floored).toBe(true);
      expect(rb?.points).toBe(30); // rb4 (2nd-best of [rb3=50, rb4=30]) — never rb3, the best remaining player
      expect(rb?.playerId).toBe('rb4');
    });
  });

  describe('E: survival-conditioned availability', () => {
    it('climbs (never falls) for a fixed nextPick as the pick clock advances', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 25, stdev: 6, high: 10, low: 40, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' };
      const nextPick = 40;
      let previous = -1;
      for (const currentPick of [5, 10, 15, 20, 25, 30]) {
        const estimate = estimateAvailability(entry, { currentPick, nextPick });
        expect(estimate).not.toBeNull();
        expect(estimate!.probability).toBeGreaterThanOrEqual(estimate!.unconditionalProbability - 1e-9);
        expect(estimate!.probability).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = estimate!.probability;
      }
      expect(previous).toBeGreaterThan(0);
    });

    it('is a non-increasing sequence as currentPick advances with a fixed lookahead window', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 25, stdev: 6, high: 10, low: 40, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' };
      const probabilities = [5, 10, 15, 20, 25, 30].map(
        (currentPick) => estimateAvailability(entry, { currentPick, nextPick: currentPick + 8 })!.probability,
      );
      for (let i = 1; i < probabilities.length; i += 1) {
        expect(probabilities[i]).toBeLessThanOrEqual((probabilities[i - 1] ?? 1) + 1e-9);
      }
    });

    it('handles the nextPick<=currentPick and degenerate-denominator guards without NaN', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 25, stdev: 6, high: 10, low: 40, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' };
      expect(estimateAvailability(entry, { currentPick: 10, nextPick: 10 })?.probability).toBe(1);
      const farOut = estimateAvailability(entry, { currentPick: 200, nextPick: 210 });
      expect(farOut?.degenerate).toBe(true);
      expect(farOut?.probability).toBe(0);
      expect(Number.isNaN(farOut?.probability)).toBe(false);
    });

    it('preserves the existing stdev<=0 boundary behavior', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 20, stdev: 0, high: 0, low: 0, timesDrafted: 1, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' };
      expect(estimateAvailability(entry, { currentPick: 1, nextPick: 19 })?.probability).toBe(1);
      expect(estimateAvailability(entry, { currentPick: 1, nextPick: 20 })?.probability).toBe(0);
      expect(estimateAvailability(entry, { currentPick: 1, nextPick: 21 })?.probability).toBe(0);
    });
  });

  describe('E2: lowConfidence rebased off stdevSource, not just null timesDrafted', () => {
    it('a Sleeper-sourced entry (timesDrafted null, stdev fitted) is lowConfidence even with a well-drafted adp', () => {
      const entry: AdpEntry = {
        playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 5, stdev: 1.2,
        high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'sleeper', stdevSource: 'fitted',
      };
      const estimate = estimateAvailability(entry, { currentPick: 1, nextPick: 8 });
      expect(estimate?.sampleSize).toBeNull();
      expect(estimate?.lowConfidence).toBe(true);
    });

    it('an FFC-sourced entry with a real large sample is not lowConfidence merely for being FFC', () => {
      const entry: AdpEntry = {
        playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 5, stdev: 1.2,
        high: 1, low: 10, timesDrafted: 500, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
      };
      const estimate = estimateAvailability(entry, { currentPick: 1, nextPick: 8 });
      expect(estimate?.sampleSize).toBe(500);
      expect(estimate?.lowConfidence).toBe(false);
    });

    it('an FFC-sourced entry with a genuinely sparse sample is still lowConfidence (existing threshold preserved)', () => {
      const entry: AdpEntry = {
        playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 5, stdev: 1.2,
        high: 1, low: 10, timesDrafted: 5, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
      };
      const estimate = estimateAvailability(entry, { currentPick: 1, nextPick: 8 });
      expect(estimate?.lowConfidence).toBe(true);
    });

    it('fitted stdev keeps availability lowConfidence but does not demote Recommendation.confidence', () => {
      // Regression: mapping availability.lowConfidence (true for every fitted-stdev
      // Sleeper row) straight into Recommendation.confidence made the whole board
      // uniformly "medium" while players missing ADP stayed "high".
      const sleeperAdp: AdpEntry = {
        playerId: 'rb1', name: 'rb1', position: 'RB', team: 'BUF', adp: 3, stdev: 0.9,
        high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'sleeper', stdevSource: 'fitted',
      };
      const estimate = estimateAvailability(sleeperAdp, { currentPick: 1, nextPick: 6 });
      expect(estimate?.lowConfidence).toBe(true);
      expect(estimate?.degenerate).toBe(false);
      expect(estimate?.probability).toBeGreaterThan(0);
      expect(estimate?.probability).toBeLessThan(1);

      const board = buildRecommendations({
        settings: smallLeagueSettings,
        players: smallPlayers,
        projections: smallProjections,
        adp: [sleeperAdp],
        picks: [],
        myTeamId: null,
        nextPick: 6,
        currentPick: 1,
        limit: 6,
      });
      const rb1 = board.find((recommendation) => recommendation.playerId === 'rb1');
      expect(rb1).toBeDefined();
      expect(rb1!.confidence).toBe('high');
      expect(rb1!.warnings.some((warning) => /spread is estimated/i.test(warning))).toBe(true);
    });

    it('a genuinely sparse observed ADP sample still demotes Recommendation.confidence', () => {
      const sparseFfc: AdpEntry = {
        playerId: 'rb1', name: 'rb1', position: 'RB', team: 'BUF', adp: 3, stdev: 0.9,
        high: 1, low: 10, timesDrafted: 5, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
      };
      const board = buildRecommendations({
        settings: smallLeagueSettings,
        players: smallPlayers,
        projections: smallProjections,
        adp: [sparseFfc],
        picks: [],
        myTeamId: null,
        nextPick: 6,
        currentPick: 1,
        limit: 6,
      });
      expect(board.find((recommendation) => recommendation.playerId === 'rb1')?.confidence).toBe('medium');
    });
  });

  describe('E3: null nextPick (final user pick — no follow-up availability target)', () => {
    const brokenStdevAdp: AdpEntry = {
      playerId: 'rb1', name: 'rb1', position: 'RB', team: 'BUF', adp: 3, stdev: 0,
      high: 1, low: 8, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
    };

    it('skips availability: null fields, no ADP reason string, and no ADP-spread confidence demotion', () => {
      const base = {
        settings: smallLeagueSettings,
        players: smallPlayers,
        projections: smallProjections,
        adp: [brokenStdevAdp],
        picks: [] as Pick[],
        myTeamId: 'me' as string | null,
        currentPick: 5,
        limit: 6,
      };

      // Control: a real nextPick still estimates availability and demotes on broken stdev.
      const withNext = buildRecommendationBoard({ ...base, nextPick: 6 });
      const control = withNext.recommendations.find((recommendation) => recommendation.playerId === 'rb1');
      expect(control).toBeDefined();
      expect(control!.availableNextPickProbability).not.toBeNull();
      expect(control!.availabilityAdp).toBe(3);
      expect(control!.availabilityAdpHigh).toBe(1);
      expect(control!.availabilityAdpLow).toBe(8);
      expect(control!.availabilityStdev).toBe(0);
      expect(control!.availabilitySampleSize).toBe(100);
      expect(control!.confidence).toBe('medium');
      expect(control!.reasons.some((reason) => /ADP model estimates/i.test(reason))).toBe(true);

      const finalPick = buildRecommendationBoard({ ...base, nextPick: null });
      expect(finalPick.recommendations.length).toBeGreaterThan(0);
      for (const recommendation of finalPick.recommendations) {
        expect(recommendation.availableNextPickProbability).toBeNull();
        expect(recommendation.availabilityAdp).toBeNull();
        expect(recommendation.availabilityAdpHigh).toBeNull();
        expect(recommendation.availabilityAdpLow).toBeNull();
        expect(recommendation.availabilityStdev).toBeNull();
        expect(recommendation.availabilitySampleSize).toBeNull();
        expect(recommendation.reasons.some((reason) => /ADP model estimates/i.test(reason))).toBe(false);
        expect(recommendation.reasons.some((reason) => /\d+% next-pick availability/i.test(reason))).toBe(false);
      }
      // Broken stdev must not demote when availability was skipped — ADP is present but unused.
      expect(finalPick.recommendations.find((recommendation) => recommendation.playerId === 'rb1')?.confidence).toBe('high');
    });
  });

  it('F: surfaces crosswalk-miss picks in diagnostics and demotes confidence for every recommendation', () => {
    const draftInit = readFixture<DraftInit>('draft-init.json');
    const draftPicks = readFixture<DraftPicks>('picks-partial.json');
    const players = readFixture<PlayerMeta[]>('players-sample.json');
    const projections = readFixture<SeasonProjection[]>('projections-sample.json');
    const adp = readFixture<AdpEntry[]>('adp-sample.json');

    const result = buildRecommendationBoard({
      settings: draftInit.settings,
      players,
      projections,
      adp,
      picks: draftPicks.picks,
      myTeamId: draftInit.myTeamId,
      nextPick: 16,
      currentPick: draftPicks.onTheClock?.overall ?? draftPicks.picks.length + 1,
      limit: 5,
    });

    expect(result.diagnostics.unmatchedPickCount).toBe(1);
    expect(result.diagnostics.unmatchedPickOveralls).toEqual([4]);
    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of result.recommendations) {
      expect(recommendation.confidence).not.toBe('high');
      expect(recommendation.warnings.some((warning) => warning.includes('could not be matched'))).toBe(true);
    }
  });

  describe('G: replacementAdjustedValue identities', () => {
    it('equals VOR when the candidate fills a genuinely open slot', () => {
      const board = buildRecommendationBoard({ settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: [], myTeamId: null, nextPick: 2, limit: 6 });
      const rb2 = board.recommendations.find((r) => r.playerId === 'rb2');
      expect(rb2).toBeDefined();
      expect(rb2!.replacementAdjustedValue).toBeCloseTo(rb2!.vor, 6);
      expect(rb2!.replacementAdjustedValue).toBe(20); // vor = 70 - replacement(rb3=50)
    });

    it('is exactly 0 for a candidate who is the replacement level for himself, and still cannot displace anyone on a full roster', () => {
      // My roster (rb1=100, rb4=30) fills RB+FLEX. Remaining RB pool for replacement purposes is
      // {rb2=70, rb3=50} — only 2 players. With MIN_REPLACEMENT_RANK=2, the replacement rank for RB
      // lands on rank 2 of that 2-player pool, i.e. rb3 himself: this tiny fixture's pool is too
      // small to distinguish "the floor picked a real 2nd-best player" from "the floor landed on the
      // candidate being evaluated." That self-reference makes rb3's RAV exactly 0, not negative —
      // still correctly <= his positive MRV, which is the actual property under test (naive MRV
      // looks positive; rv correctly disagrees). See replacement.test.ts for the floor picking a
      // genuine 2nd-best player in a larger pool.
      const rosterPicks: Pick[] = [
        { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
        { overall: 2, round: 1, slot: 1, teamId: 'me', playerId: 'rb4', providerPlayerId: 'rb4' },
      ];
      const board = buildRecommendationBoard({ settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: rosterPicks, myTeamId: 'me', nextPick: 3, limit: 6 });
      const rb3 = board.recommendations.find((r) => r.playerId === 'rb3');
      expect(rb3).toBeDefined();
      expect(rb3!.replacementAdjustedValue).toBe(0);
      // He still beats my weakest starter (30), so naive MRV looks positive — rv correctly
      // disagrees, which is the whole point of ranking on rv instead of raw MRV.
      expect(rb3!.marginalRosterValue).toBeGreaterThan(0);
      expect(rb3!.replacementAdjustedValue).toBeLessThan(rb3!.marginalRosterValue);
    });

    it('never exceeds marginalRosterValue (a synthetic replacement can only weakly help a roster, so the baseline is >= currentValue)', () => {
      const boards = [
        buildRecommendationBoard({ settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: [], myTeamId: null, nextPick: 2, limit: 6 }),
        buildRecommendationBoard({
          settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], myTeamId: 'me', nextPick: 3, limit: 6,
          picks: [
            { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
            { overall: 2, round: 1, slot: 1, teamId: 'me', playerId: 'rb4', providerPlayerId: 'rb4' },
          ],
        }),
      ];
      for (const board of boards) {
        for (const recommendation of board.recommendations) {
          expect(recommendation.replacementAdjustedValue).toBeLessThanOrEqual(recommendation.marginalRosterValue + 1e-9);
        }
      }
    });
  });

  it('H: the candidate prefilter does not drop anyone who belongs in the final board', () => {
    // With every slot open and identical eligibility, ranking value is a strictly monotonic
    // function of raw points, so the true top 5 is independently knowable by hand — a pool of 12
    // forces selectCandidates's take-(limit+2)=7 cutoff to actually truncate something.
    const manyRbs: PlayerMeta[] = Array.from({ length: 12 }, (_, index) => player(`bulk-rb-${index}`, 'RB'));
    const manyProjections: SeasonProjection[] = manyRbs.map((p, index) => ({
      playerId: p.playerId, source: 'fftoday', stats: statLine({ rush_yd: (120 - index * 5) * 10 }),
    }));
    const board = buildRecommendations({ settings: smallLeagueSettings, players: manyRbs, projections: manyProjections, adp: [], picks: [], myTeamId: null, nextPick: 2, limit: 5 });
    expect(board.map((r) => r.playerId)).toEqual(['bulk-rb-0', 'bulk-rb-1', 'bulk-rb-2', 'bulk-rb-3', 'bulk-rb-4']);
  });

  it('H (unit): selectCandidates keeps exactly the top limit+2 per eligibility group', () => {
    const scores = new Map(smallProjections.map((p) => [p.playerId, scoreProjection(p, smallLeagueSettings).points]));
    const selected = selectCandidates(smallPlayers, scores, 1); // take = 3 per group
    const rbIds = selected.filter((p) => p.position === 'RB').map((p) => p.playerId);
    expect(rbIds).toEqual(['rb1', 'rb2', 'rb3']); // top 3 of [rb1,rb2,rb3,rb4] by points, rb4 dropped
  });

  it('I: changing availability alone does not reorder deterministic S2 values', () => {
    const adp = (reverse: boolean): AdpEntry[] => smallPlayers.map((entry, index) => ({
      playerId: entry.playerId,
      name: entry.name,
      position: entry.position ?? '',
      team: entry.team,
      adp: reverse ? 200 - index * 20 : 5 + index * 20,
      stdev: 2,
      high: 1,
      low: 220,
      timesDrafted: 100,
      byeWeek: null,
      adpSource: 'ffc',
      stdevSource: 'observed',
    }));
    const base = {
      settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections,
      picks: [], myTeamId: 'me', currentPick: 1, nextPick: 20, limit: 6,
    };
    const earlyAdp = buildRecommendations({ ...base, adp: adp(false) });
    const lateAdp = buildRecommendations({ ...base, adp: adp(true) });
    // Availability never changes *value* — every row's replacementAdjustedValue set is identical,
    // and every row outside a near-tie band keeps its exact position. The one documented exception
    // (validated decisions) is that near-tied members reorder by next-pick survival — rb1 and wr1
    // land in the same band here, so flipping ADP (and hence survival) legitimately swaps just that
    // pair, never the rest of the board.
    expect(new Set(lateAdp.map((entry) => entry.playerId))).toEqual(new Set(earlyAdp.map((entry) => entry.playerId)));
    expect([...lateAdp.map((entry) => entry.replacementAdjustedValue)].sort())
      .toEqual([...earlyAdp.map((entry) => entry.replacementAdjustedValue)].sort());
    for (const id of ['te1', 'rb2', 'rb3', 'rb4']) {
      expect(lateAdp.findIndex((entry) => entry.playerId === id)).toBe(earlyAdp.findIndex((entry) => entry.playerId === id));
    }
    expect(new Set(lateAdp.slice(0, 2).map((entry) => entry.playerId))).toEqual(new Set(['rb1', 'wr1']));
    expect(lateAdp.some((entry, index) => entry.availableNextPickProbability !== earlyAdp[index]?.availableNextPickProbability)).toBe(true);
  });

  it('J: uses honest open-slot and bench-only explanation wording', () => {
    const open = buildRecommendations({
      settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections,
      adp: [], picks: [], myTeamId: 'me', nextPick: 2, limit: 6,
    });
    const rb2Open = open.find((entry) => entry.playerId === 'rb2');
    expect(rb2Open?.reasons[0]).toBe(
      'Adds 70.0 total roster utility: 70.0 starter value and 0.0 depth-portfolio value.',
    );
    expect(rb2Open?.reasons.some((reason) => (
      reason.startsWith('Projects for 70.0 PPR points and currently fits ')
      && !reason.includes('bench-only')
    ))).toBe(true);

    const rosterPicks: Pick[] = [
      { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
      { overall: 2, round: 1, slot: 1, teamId: 'me', playerId: 'rb2', providerPlayerId: 'rb2' },
    ];
    const full = buildRecommendations({
      settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections,
      adp: [], picks: rosterPicks, myTeamId: 'me', nextPick: 3, limit: 6,
    });
    const rb3Bench = full.find((entry) => entry.playerId === 'rb3');
    expect(rb3Bench?.reasons[0]).toMatch(
      /^Adds -?\d+\.\d total roster utility: -?\d+\.\d starter value and -?\d+\.\d depth-portfolio value\.$/,
    );
    expect(rb3Bench?.reasons.some((reason) => reason.includes('bench-only'))).toBe(true);
  });

  it('K: is deterministic after picks — identical input produces identical output including tie order', () => {
    const picks: Pick[] = [
      { overall: 1, round: 1, slot: 1, teamId: 'opponent', playerId: 'rb1', providerPlayerId: 'rb1' },
      { overall: 2, round: 1, slot: 1, teamId: 'me', playerId: 'wr1', providerPlayerId: 'wr1' },
    ];
    const input = { settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: [], myTeamId: 'me', nextPick: 2, limit: 6 };
    const first = buildRecommendations({ ...input, picks });
    const second = buildRecommendations({ ...input, picks });
    expect(second).toEqual(first);
  });

  describe('L: S2.2 regression — replacement-exhaustion clamp and K/DEF gate (the live-mock symptom)', () => {
    // 12-team PPR, 66 ADP-ordered picks — reproduces the exact scenario reported from a real
    // Sleeper mock: at pick 67, the pre-fix board pinned the best remaining WR's
    // replacementAdjustedValue to exactly 0 (rank #52) and put five DEF/K in the top 13.
    const teams = 12;
    const l2Settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'l2', name: 'L2', season: '2026', teams,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
      scoring: {
        pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
        rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
        rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2,
        fgm: 3, xpm: 1, sack: 1, int: 2, fum_rec: 2, def_td: 6, def_kr_td: 6,
      },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    function slotForOverall(overall: number): number {
      const round = Math.ceil(overall / teams);
      const posInRound = overall - (round - 1) * teams;
      return round % 2 === 0 ? teams - posInRound + 1 : posInRound;
    }
    function pick67Fixture() {
      const players = loadRealData<PlayerMeta[]>('players.json');
      const projections = loadRealData<SeasonProjection[]>('projections-season.json');
      const adp = loadRealData<AdpEntry[]>('adp-ppr.json');
      const topByAdp = adp.filter((entry): entry is AdpEntry & { playerId: string } => entry.playerId != null)
        .sort((a, b) => a.adp - b.adp).slice(0, 66);
      // 'me' holds slot 7 — a mid-pack slot with a partial (not full, not empty) roster by pick 67.
      const picks: Pick[] = topByAdp.map((entry, index) => {
        const overall = index + 1;
        const slot = slotForOverall(overall);
        const teamId = slot === 7 ? 'me' : `opp-${slot}`;
        return { overall, round: Math.ceil(overall / teams), slot, teamId, playerId: entry.playerId, providerPlayerId: entry.playerId };
      });
      return { players, projections, adp, picks };
    }
    function scoreOf(players: PlayerMeta[], projections: SeasonProjection[], settings: LeagueSettings, playerId: string): number {
      const projection = projections.find((p) => p.playerId === playerId);
      const meta = players.find((p) => p.playerId === playerId);
      return projection ? scoreProjection(projection, settings, meta?.position).points : 0;
    }

    it('L1: no position with >=2 remaining scored players has its replacement level pinned to the best remaining player', () => {
      const { players, projections, adp, picks } = pick67Fixture();
      const board = buildRecommendationBoard({ settings: l2Settings, players, projections, adp, picks, myTeamId: 'me', nextPick: 74, currentPick: 67, limit: 60 });
      // Production only creates score rows for actual projections. Mirroring that boundary keeps
      // unprojected metadata rows from masquerading as scored zero-point survivors.
      const scores = new Map(projections.map((projection) => [
        projection.playerId,
        scoreOf(players, projections, l2Settings, projection.playerId),
      ]));
      const drafted = new Set(picks.map((p) => p.playerId));

      for (const level of board.diagnostics.replacementLevels) {
        const remainingAtPosition = players
          .filter((p) => p.position === level.position && !drafted.has(p.playerId) && scores.has(p.playerId))
          .sort(comparePlayersByScoreDesc(scores));
        if (remainingAtPosition.length < 2) continue; // the level legitimately IS the only player left
        expect(level.rank, `${level.position} rank clamped below the floor`).toBeGreaterThanOrEqual(2);
        expect(level.playerId, `${level.position}'s replacement level is the best remaining player`).not.toBe(remainingAtPosition[0]?.playerId);
      }

      // Positive WR value is an engine invariant only when the roster leaves an open lineup path.
      // The slot-7 roster has stronger incumbents that can legitimately make candidate and
      // replacement both add zero, so exercise the same pick-67 survivor board with no user picks.
      const openRosterBoard = buildRecommendationBoard({
        settings: l2Settings, players, projections, adp, picks,
        myTeamId: 'ghost-team', nextPick: 74, currentPick: 67, limit: 60,
      });
      const bestWr = openRosterBoard.recommendations.find((r) => players.find((p) => p.playerId === r.playerId)?.position === 'WR');
      expect(bestWr).toBeDefined();
      expect(bestWr!.replacementAdjustedValue).toBeGreaterThan(0);
    });

    it('L2: K/DEF gate — reserves D/ST for the penultimate selection and kicker for the final selection', () => {
      const oneTeamSettings: LeagueSettings = {
        provider: 'sleeper', leagueId: 'gate', name: 'Gate', season: '2026', teams: 1,
        startingSlots: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'], rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1, BN: 3 },
        scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
        format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
      };
      const gatePlayers: PlayerMeta[] = [
        player('qb1', 'QB'), player('rb1', 'RB'), player('wr1', 'WR'), player('te1', 'TE'),
        player('bench1', 'RB'), player('bench2', 'WR'), player('bench3', 'RB'),
        { ...player('k1', 'QB'), position: 'K', eligiblePositions: ['K'] },
        { ...player('k2', 'QB'), position: 'K', eligiblePositions: ['K'] },
        { ...player('def1', 'QB'), position: 'DEF', eligiblePositions: ['DEF'] },
        { ...player('def2', 'QB'), position: 'DEF', eligiblePositions: ['DEF'] },
      ];
      // K/DEF deliberately out-score nobody — if they rank first anyway, that's purely the gate
      // being inactive, not raw value winning fairly.
      const gateProjections: SeasonProjection[] = [
        { playerId: 'qb1', source: 'fftoday', stats: statLine({ pass_yd: 3000 }) }, // 120
        { playerId: 'rb1', source: 'fftoday', stats: statLine({ rush_yd: 900 }) }, // 90
        { playerId: 'wr1', source: 'fftoday', stats: statLine({ rec_yd: 900 }) }, // 90
        { playerId: 'te1', source: 'fftoday', stats: statLine({ rec_yd: 700 }) }, // 70
        { playerId: 'bench1', source: 'fftoday', stats: statLine({ rush_yd: 600 }) },
        { playerId: 'bench2', source: 'fftoday', stats: statLine({ rec_yd: 600 }) },
        { playerId: 'bench3', source: 'fftoday', stats: statLine({ rush_yd: 500 }) },
        { playerId: 'k1', source: 'fftoday', stats: statLine() },
        { playerId: 'k2', source: 'fftoday', stats: statLine() },
        { playerId: 'def1', source: 'fftoday', stats: statLine() },
        { playerId: 'def2', source: 'fftoday', stats: statLine() },
      ];
      const positionOf = (playerId: string) => gatePlayers.find((entry) => entry.playerId === playerId)?.position;

      const empty = buildRecommendationBoard({ settings: oneTeamSettings, players: gatePlayers, projections: gateProjections, adp: [], picks: [], myTeamId: 'me', nextPick: 2, limit: 11, draftRounds: 9 });
      expect(empty.diagnostics.coreStartingSlotsFilled).toBe(false);
      expect(empty.recommendations.slice(0, 4).some((r) => r.playerId === 'k1' || r.playerId === 'def1')).toBe(false);
      expect(empty.recommendations.find((r) => r.playerId === 'k1')?.deprioritized).toBe(true);

      const corePicks: Pick[] = [
        { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'qb1', providerPlayerId: 'qb1' },
        { overall: 2, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
        { overall: 3, round: 1, slot: 1, teamId: 'me', playerId: 'wr1', providerPlayerId: 'wr1' },
        { overall: 4, round: 1, slot: 1, teamId: 'me', playerId: 'te1', providerPlayerId: 'te1' },
      ];
      const coreFilledEarly = buildRecommendationBoard({ settings: oneTeamSettings, players: gatePlayers, projections: gateProjections, adp: [], picks: corePicks, myTeamId: 'me', nextPick: 6, limit: 11, draftRounds: 9 });
      expect(coreFilledEarly.diagnostics.coreStartingSlotsFilled).toBe(true);
      expect(coreFilledEarly.diagnostics.specialTeamsDraft.remainingPicks).toBe(5);
      expect(coreFilledEarly.diagnostics.specialTeamsDraft.due).toEqual([]);
      expect(coreFilledEarly.recommendations.find((r) => r.playerId === 'k1')?.deprioritized).toBe(true);
      expect(coreFilledEarly.recommendations.find((r) => r.playerId === 'def1')?.deprioritized).toBe(true);

      const benchPicks: Pick[] = ['bench1', 'bench2', 'bench3'].map((playerId, index) => ({
        overall: index + 5, round: index + 5, slot: 1, teamId: 'me', playerId, providerPlayerId: playerId,
      }));
      const penultimatePicks = [...corePicks, ...benchPicks];
      const penultimate = buildRecommendationBoard({ settings: oneTeamSettings, players: gatePlayers, projections: gateProjections, adp: [], picks: penultimatePicks, myTeamId: 'me', nextPick: 9, limit: 11, draftRounds: 9 });
      expect(penultimate.diagnostics.specialTeamsDraft.remainingPicks).toBe(2);
      expect(penultimate.diagnostics.specialTeamsDraft.due).toEqual(['DEF']);
      expect(positionOf(penultimate.recommendations[0]!.playerId)).toBe('DEF');
      expect(penultimate.recommendations[0]?.deprioritized).toBe(false);
      expect(penultimate.recommendations.find((r) => positionOf(r.playerId) === 'K')?.deprioritized).toBe(true);

      const finalPicks: Pick[] = [
        ...penultimatePicks,
        { overall: 8, round: 8, slot: 1, teamId: 'me', playerId: 'def1', providerPlayerId: 'def1' },
      ];
      const final = buildRecommendationBoard({ settings: oneTeamSettings, players: gatePlayers, projections: gateProjections, adp: [], picks: finalPicks, myTeamId: 'me', nextPick: 10, limit: 11, draftRounds: 9 });
      expect(final.diagnostics.specialTeamsDraft.remainingPicks).toBe(1);
      expect(final.diagnostics.specialTeamsDraft.due).toEqual(['K']);
      expect(positionOf(final.recommendations[0]!.playerId)).toBe('K');
      expect(final.recommendations[0]?.confidence).toBe('low');

      const filledPicks: Pick[] = [
        ...finalPicks,
        { overall: 9, round: 9, slot: 1, teamId: 'me', playerId: 'k1', providerPlayerId: 'k1' },
      ];
      const filled = buildRecommendationBoard({ settings: oneTeamSettings, players: gatePlayers, projections: gateProjections, adp: [], picks: filledPicks, myTeamId: 'me', nextPick: 10, limit: 11, draftRounds: 9 });
      expect(filled.diagnostics.specialTeamsDraft.remaining).toEqual({ K: 0, DEF: 0 });
      expect(filled.recommendations.some((recommendation) => ['K', 'DEF'].includes(positionOf(recommendation.playerId) ?? ''))).toBe(false);
    });

    it('L2b: K/DEF timing follows draft depth and preserves the core-starter gate inside the reserved window', () => {
      const timingSettings: LeagueSettings = {
        ...l2Settings,
        teams: 1,
        startingSlots: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
        rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1, BN: 12 },
      };
      const timingPlayers: PlayerMeta[] = [
        player('t-qb', 'QB'), player('t-rb', 'RB'), player('t-wr', 'WR'), player('t-te', 'TE'),
        { ...player('t-k', 'QB'), position: 'K', eligiblePositions: ['K'] },
        { ...player('t-def', 'QB'), position: 'DEF', eligiblePositions: ['DEF'] },
      ];
      const timingProjections: SeasonProjection[] = timingPlayers.map((entry) => ({
        playerId: entry.playerId, source: 'fftoday', stats: statLine(entry.position === 'QB' ? { pass_yd: 1000 } : entry.position === 'RB' ? { rush_yd: 500 } : entry.position === 'WR' || entry.position === 'TE' ? { rec_yd: 500 } : {}),
      }));
      const core: Pick[] = ['t-qb', 't-rb', 't-wr', 't-te'].map((playerId, index) => ({
        overall: index + 1, round: index + 1, slot: 1, teamId: 'me', playerId, providerPlayerId: playerId,
      }));
      const padTo = (count: number, base: Pick[] = core): Pick[] => [
        ...base,
        ...Array.from({ length: Math.max(0, count - base.length) }, (_, index) => ({
          overall: base.length + index + 1,
          round: base.length + index + 1,
          slot: 1,
          teamId: 'me',
          playerId: null,
          providerPlayerId: `unknown-${base.length + index + 1}`,
        } satisfies Pick)),
      ];

      for (const draftRounds of [12, 15, 18]) {
        const beforeWindow = buildRecommendationBoard({ settings: timingSettings, players: timingPlayers, projections: timingProjections, adp: [], picks: padTo(draftRounds - 3), myTeamId: 'me', nextPick: draftRounds, limit: 6, draftRounds });
        expect(beforeWindow.diagnostics.specialTeamsDraft.remainingPicks, `${draftRounds} rounds`).toBe(3);
        expect(beforeWindow.diagnostics.specialTeamsDraft.due, `${draftRounds} rounds`).toEqual([]);

        const penultimate = buildRecommendationBoard({ settings: timingSettings, players: timingPlayers, projections: timingProjections, adp: [], picks: padTo(draftRounds - 2), myTeamId: 'me', nextPick: draftRounds, limit: 6, draftRounds });
        expect(penultimate.diagnostics.specialTeamsDraft.remainingPicks, `${draftRounds} rounds`).toBe(2);
        expect(penultimate.diagnostics.specialTeamsDraft.due, `${draftRounds} rounds`).toEqual(['DEF']);
        expect(timingPlayers.find((entry) => entry.playerId === penultimate.recommendations[0]?.playerId)?.position).toBe('DEF');
      }

      const incompleteCore = core.filter((pick) => pick.playerId !== 't-te');
      const lateIncomplete = buildRecommendationBoard({ settings: timingSettings, players: timingPlayers, projections: timingProjections, adp: [], picks: padTo(13, incompleteCore), myTeamId: 'me', nextPick: 15, limit: 6, draftRounds: 15 });
      expect(lateIncomplete.diagnostics.coreStartingSlotsFilled).toBe(false);
      expect(lateIncomplete.diagnostics.specialTeamsDraft.due).toEqual(['DEF']);
      expect(lateIncomplete.recommendations[0]?.playerId).toBe('t-te');
      expect(lateIncomplete.recommendations.find((entry) => entry.playerId === 't-def')?.deprioritized).toBe(true);
    });

    it('L2c: K/DEF timing handles absent, filled, multiple, overdue, and unknown-clock settings', () => {
      const baseSettings: LeagueSettings = {
        ...l2Settings,
        teams: 1,
        startingSlots: ['QB', 'DEF', 'DEF', 'K'],
        rosterSlots: { QB: 1, DEF: 2, K: 1, BN: 3 },
      };
      const specialPlayers: PlayerMeta[] = [
        player('s-qb', 'QB'),
        { ...player('s-k', 'QB'), position: 'K', eligiblePositions: ['K'] },
        { ...player('s-k2', 'QB'), position: 'K', eligiblePositions: ['K'] },
        { ...player('s-def1', 'QB'), position: 'DEF', eligiblePositions: ['DEF'] },
        { ...player('s-def2', 'QB'), position: 'DEF', eligiblePositions: ['DEF'] },
        { ...player('s-def3', 'QB'), position: 'DEF', eligiblePositions: ['DEF'] },
      ];
      const specialProjections: SeasonProjection[] = specialPlayers.map((entry) => ({
        playerId: entry.playerId, source: 'fftoday', stats: statLine(entry.position === 'QB' ? { pass_yd: 1000 } : {}),
      }));
      const pick = (overall: number, playerId: string | null): Pick => ({ overall, round: overall, slot: 1, teamId: 'me', playerId, providerPlayerId: playerId ?? `unknown-${overall}` });
      const padded = (count: number, selected: string[] = ['s-qb']): Pick[] => [
        ...selected.map((playerId, index) => pick(index + 1, playerId)),
        ...Array.from({ length: Math.max(0, count - selected.length) }, (_, index) => pick(selected.length + index + 1, null)),
      ];

      const firstDef = buildRecommendationBoard({ settings: baseSettings, players: specialPlayers, projections: specialProjections, adp: [], picks: padded(4), myTeamId: 'me', nextPick: 6, limit: 6, draftRounds: 7 });
      expect(firstDef.diagnostics.specialTeamsDraft.remaining).toEqual({ K: 1, DEF: 2 });
      expect(firstDef.diagnostics.specialTeamsDraft.due).toEqual(['DEF']);
      expect(specialPlayers.find((entry) => entry.playerId === firstDef.recommendations[0]?.playerId)?.position).toBe('DEF');

      const secondDef = buildRecommendationBoard({ settings: baseSettings, players: specialPlayers, projections: specialProjections, adp: [], picks: padded(5, ['s-qb', 's-def1']), myTeamId: 'me', nextPick: 7, limit: 6, draftRounds: 7 });
      expect(secondDef.diagnostics.specialTeamsDraft.remaining).toEqual({ K: 1, DEF: 1 });
      expect(secondDef.diagnostics.specialTeamsDraft.due).toEqual(['DEF']);

      const finalK = buildRecommendationBoard({ settings: baseSettings, players: specialPlayers, projections: specialProjections, adp: [], picks: padded(6, ['s-qb', 's-def1', 's-def2']), myTeamId: 'me', nextPick: 8, limit: 6, draftRounds: 7 });
      expect(finalK.diagnostics.specialTeamsDraft.due).toEqual(['K']);
      expect(specialPlayers.find((entry) => entry.playerId === finalK.recommendations[0]?.playerId)?.position).toBe('K');

      const overdueDef = buildRecommendationBoard({ settings: baseSettings, players: specialPlayers, projections: specialProjections, adp: [], picks: padded(6), myTeamId: 'me', nextPick: 8, limit: 6, draftRounds: 7 });
      expect(overdueDef.diagnostics.specialTeamsDraft.due).toEqual(['DEF', 'K']);
      expect(overdueDef.diagnostics.specialTeamsDraft.overdue).toEqual(['DEF']);
      expect(overdueDef.diagnostics.specialTeamsDraft.impossibleToFill).toBe(true);
      expect(specialPlayers.find((entry) => entry.playerId === overdueDef.recommendations[0]?.playerId)?.position).toBe('DEF');

      const noSpecialSettings: LeagueSettings = { ...baseSettings, startingSlots: ['QB'], rosterSlots: { QB: 1, BN: 6 } };
      const noSpecial = buildRecommendationBoard({ settings: noSpecialSettings, players: specialPlayers, projections: specialProjections, adp: [], picks: [pick(1, 's-qb')], myTeamId: 'me', nextPick: 2, limit: 6, draftRounds: 7 });
      expect(noSpecial.diagnostics.specialTeamsDraft.configured).toEqual({ K: 0, DEF: 0 });
      expect(noSpecial.recommendations.some((entry) => ['K', 'DEF'].includes(specialPlayers.find((player) => player.playerId === entry.playerId)?.position ?? ''))).toBe(false);

      const unknownClock = buildRecommendationBoard({ settings: baseSettings, players: specialPlayers, projections: specialProjections, adp: [], picks: [pick(1, 's-qb')], myTeamId: 'me', nextPick: 2, limit: 6 });
      expect(unknownClock.diagnostics.specialTeamsDraft.remainingPicks).toBeNull();
      expect(unknownClock.recommendations.some((entry) => entry.deprioritized)).toBe(false);
    });

    it('L3: K/DEF gate — real data, zero K/DEF in the top 13 at pick 67 (the observed symptom)', () => {
      const { players, projections, adp, picks } = pick67Fixture();
      const board = buildRecommendationBoard({ settings: l2Settings, players, projections, adp, picks, myTeamId: 'me', nextPick: 74, currentPick: 67, limit: 60 });
      expect(board.diagnostics.coreStartingSlotsFilled).toBe(false);

      const isKD = (r: (typeof board.recommendations)[number]) => {
        const position = players.find((p) => p.playerId === r.playerId)?.position;
        return position === 'K' || position === 'DEF';
      };
      const top13 = board.recommendations.slice(0, 13);
      expect(top13.filter(isKD).length).toBe(0);
      expect(top13.filter((recommendation) => recommendation.deprioritized).length).toBe(0);
      const skillValues = top13.filter((recommendation) => !isKD(recommendation))
        .map((recommendation) => recommendation.replacementAdjustedValue);
      expect(skillValues.some((value) => value > 0)).toBe(true);
      expect(new Set(skillValues.map((value) => value.toFixed(6))).size).toBeGreaterThan(1);
      expect(board.diagnostics.positionalDemand.source).toBe('adp');
    });

    it('L4: the K/DEF demotion is order-preserving — removing K/DEF from the pool does not reorder anyone else', () => {
      const { players, projections, adp, picks } = pick67Fixture();
      const withKd = buildRecommendationBoard({ settings: l2Settings, players, projections, adp, picks, myTeamId: 'me', nextPick: 74, currentPick: 67, limit: 60 });
      const withoutKd = buildRecommendationBoard({
        settings: l2Settings, players: players.filter((p) => p.position !== 'K' && p.position !== 'DEF'),
        projections, adp, picks, myTeamId: 'me', nextPick: 74, currentPick: 67, limit: 60,
      });
      const nonKdSequence = (board: RecommendationResult) => board.recommendations
        .filter((r) => { const pos = players.find((p) => p.playerId === r.playerId)?.position; return pos !== 'K' && pos !== 'DEF'; })
        .map((r) => r.playerId);
      expect(nonKdSequence(withoutKd)).toEqual(nonKdSequence(withKd));
    });

  });
});
