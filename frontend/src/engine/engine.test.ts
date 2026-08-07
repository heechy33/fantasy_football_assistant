import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, DraftInit, DraftPicks, LeagueSettings, Pick, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { estimateAvailability } from './availability';
import { optimizeLineup } from './eligibility';
import { replacementLevels } from './replacement';
import { buildRecommendationBoard, buildRecommendations, selectCandidates } from './recommend';
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
      ['Sam LaPorta', 163.5],
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
    expect(result.unsupportedScoringKeys).not.toEqual(expect.arrayContaining(['pass_td', 'fgm_0_19', 'pts_allow_0']));
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
    const players = [player('rb', 'RB'), player('wr', 'WR'), player('te', 'TE')];
    const result = optimizeLineup(settings, players, new Map([['rb', 100], ['wr', 90], ['te', 80]]));
    expect(result.value).toBe(270);
    expect(result.assignments).toEqual(expect.arrayContaining([
      { playerId: 'rb', slot: 'FLEX', value: 100 },
      { playerId: 'wr', slot: 'WR', value: 90 },
      { playerId: 'te', slot: 'TE', value: 80 },
    ]));
  });

  it('handles deterministic availability boundaries', () => {
    const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 20, stdev: 0, high: 0, low: 0, timesDrafted: 1, byeWeek: null };
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

    const result = buildRecommendations({ settings: realSettings, players, projections, adp, picks, myTeamId: 'me', nextPick: 18, currentPick: 13, limit: 5 });
    expect(result.length).toBe(5);

    const positions = new Set(result.map((r) => players.find((p) => p.playerId === r.playerId)?.position));
    expect(positions.size).toBeGreaterThanOrEqual(2);
    const qbCount = result.slice(0, 3).filter((r) => players.find((p) => p.playerId === r.playerId)?.position === 'QB').length;
    expect(qbCount).toBeLessThanOrEqual(1);
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
      const levels = replacementLevels(smallLeagueSettings, remaining, scores, new Map([['RB', 1]]));
      const rb = levels.find((l) => l.position === 'RB');
      expect(rb?.rank).toBe(2); // leagueDemandRank(3) - consumed(1)
      expect(rb?.points).toBe(50); // same rb3 as the static level above
      expect(rb?.exhausted).toBe(false);
    });

    it('clamps to the single best remaining player once demand is fully consumed', () => {
      const remaining = smallPlayers.filter((p) => p.playerId === 'rb4' || p.playerId === 'wr1' || p.playerId === 'te1');
      const levels = replacementLevels(smallLeagueSettings, remaining, scores, new Map([['RB', 3]]));
      const rb = levels.find((l) => l.position === 'RB');
      expect(rb?.rank).toBe(1);
      expect(rb?.exhausted).toBe(true);
      expect(rb?.points).toBe(30); // only rb4 left
    });
  });

  describe('E: survival-conditioned availability', () => {
    it('climbs (never falls) relative to the unconditional estimate as the pick clock advances', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 25, stdev: 6, high: 10, low: 40, timesDrafted: 100, byeWeek: null };
      for (const currentPick of [5, 10, 15, 20, 25, 30]) {
        const estimate = estimateAvailability(entry, { currentPick, nextPick: currentPick + 8 });
        expect(estimate).not.toBeNull();
        expect(estimate!.probability).toBeGreaterThanOrEqual(estimate!.unconditionalProbability - 1e-9);
      }
    });

    it('is a non-increasing sequence as currentPick advances with a fixed lookahead window', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 25, stdev: 6, high: 10, low: 40, timesDrafted: 100, byeWeek: null };
      const probabilities = [5, 10, 15, 20, 25, 30].map(
        (currentPick) => estimateAvailability(entry, { currentPick, nextPick: currentPick + 8 })!.probability,
      );
      for (let i = 1; i < probabilities.length; i += 1) {
        expect(probabilities[i]).toBeLessThanOrEqual((probabilities[i - 1] ?? 1) + 1e-9);
      }
    });

    it('handles the nextPick<=currentPick and degenerate-denominator guards without NaN', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 25, stdev: 6, high: 10, low: 40, timesDrafted: 100, byeWeek: null };
      expect(estimateAvailability(entry, { currentPick: 10, nextPick: 10 })?.probability).toBe(1);
      const farOut = estimateAvailability(entry, { currentPick: 200, nextPick: 210 });
      expect(farOut?.degenerate).toBe(true);
      expect(farOut?.probability).toBe(0);
      expect(Number.isNaN(farOut?.probability)).toBe(false);
    });

    it('preserves the existing stdev<=0 boundary behavior', () => {
      const entry: AdpEntry = { playerId: 'p', name: 'P', position: 'WR', team: 'BUF', adp: 20, stdev: 0, high: 0, low: 0, timesDrafted: 1, byeWeek: null };
      expect(estimateAvailability(entry, { currentPick: 1, nextPick: 20 })?.probability).toBe(0);
      expect(estimateAvailability(entry, { currentPick: 1, nextPick: 21 })?.probability).toBe(0);
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

    it('is <= 0 for a candidate below replacement who cannot displace anyone on a full roster', () => {
      // My roster (rb1=100, rb4=30) fills RB+FLEX. Remaining RB pool for replacement purposes is
      // {rb2=70, rb3=50}, so the (non-self) replacement level is rb2's 70 points.
      const rosterPicks: Pick[] = [
        { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
        { overall: 2, round: 1, slot: 1, teamId: 'me', playerId: 'rb4', providerPlayerId: 'rb4' },
      ];
      const board = buildRecommendationBoard({ settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections, adp: [], picks: rosterPicks, myTeamId: 'me', nextPick: 3, limit: 6 });
      const rb3 = board.recommendations.find((r) => r.playerId === 'rb3');
      expect(rb3).toBeDefined();
      expect(rb3!.replacementAdjustedValue).toBeLessThanOrEqual(0);
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
    }));
    const base = {
      settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections,
      picks: [], myTeamId: 'me', currentPick: 1, nextPick: 20, limit: 6,
    };
    const earlyAdp = buildRecommendations({ ...base, adp: adp(false) });
    const lateAdp = buildRecommendations({ ...base, adp: adp(true) });
    expect(lateAdp.map((entry) => entry.playerId)).toEqual(earlyAdp.map((entry) => entry.playerId));
    expect(lateAdp.map((entry) => entry.replacementAdjustedValue))
      .toEqual(earlyAdp.map((entry) => entry.replacementAdjustedValue));
    expect(lateAdp.some((entry, index) => entry.availableNextPickProbability !== earlyAdp[index]?.availableNextPickProbability)).toBe(true);
  });

  it('J: uses honest open-slot and bench-only explanation wording', () => {
    const open = buildRecommendations({
      settings: smallLeagueSettings, players: smallPlayers, projections: smallProjections,
      adp: [], picks: [], myTeamId: 'me', nextPick: 2, limit: 6,
    });
    const rb2Open = open.find((entry) => entry.playerId === 'rb2');
    expect(rb2Open?.reasons[0]).toBe('Provides 20.0 points over the modeled RB replacement option.');
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
    expect(rb3Bench?.reasons[0]).toMatch(/^Provides -?\d+\.\d points over the modeled RB replacement option\.$/);
    expect(rb3Bench?.reasons.some((reason) => reason.includes('bench-only') && reason.includes('does not yet price bench depth'))).toBe(true);
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
});
