import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerId, PlayerMeta, Position } from '../../../shared/types';
import { prepareLineup } from './eligibility';
import { buildOpponentPool, computeScenarioPriorities, needBonusFromLineup, pickForTeam, type OpponentModelConfig } from './opponentModel';
import { createRng, deriveStream, hashStateSeed } from './rng';

const CONFIG: OpponentModelConfig = {
  shockScale: 1,
  needBonusCap: 8,
  candidateWindow: 60,
  fallbackStdev: 10,
  syntheticStep: 0.5,
  noAdpAtAllFallback: 180,
};

function player(id: string, position: Position | null, eligiblePositions: Position[] = position ? [position] : []): PlayerMeta {
  return { playerId: id, name: id, position, eligiblePositions, team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
}

function adpEntry(overrides: Partial<AdpEntry> & { playerId: PlayerId }): AdpEntry {
  return { name: overrides.playerId, position: 'RB', team: null, adp: 50, stdev: 10, high: 40, low: 60, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed', ...overrides };
}

describe('buildOpponentPool', () => {
  it('excludes an unscored positioned player instead of treating it as opponent-draftable', () => {
    const players = [player('scored', 'RB'), player('missing-score', 'WR')];
    const pool = buildOpponentPool(players, new Map([['scored', 10]]), [adpEntry({ playerId: 'scored', adp: 10 })], CONFIG);
    expect(pool.entries.map((entry) => entry.playerId)).toEqual(['scored']);
    expect(pool.syntheticAdpCount).toBe(0);
  });

  it('uses the real ADP row when one exists, substituting fallbackStdev only for a non-positive stdev', () => {
    const players = [player('p1', 'RB'), player('p2', 'RB')];
    const adp = [adpEntry({ playerId: 'p1', adp: 10, stdev: 4 }), adpEntry({ playerId: 'p2', adp: 20, stdev: 0 })];
    const pool = buildOpponentPool(players, new Map([['p1', 1], ['p2', 1]]), adp, CONFIG);
    const p1 = pool.entries.find((e) => e.playerId === 'p1');
    const p2 = pool.entries.find((e) => e.playerId === 'p2');
    expect(p1).toMatchObject({ adp: 10, stdev: 4, synthetic: false });
    expect(p2).toMatchObject({ adp: 20, stdev: CONFIG.fallbackStdev, synthetic: false });
  });

  it('assigns synthetic ADP past the deepest observed ADP at that position, ordered by points desc', () => {
    const players = [player('rb1', 'RB'), player('rb2', 'RB'), player('rb3', 'RB')];
    // rb1 has a real ADP row; rb2 and rb3 need synthetic ADP, ordered by points (rb3 > rb2).
    const adp = [adpEntry({ playerId: 'rb1', adp: 30, stdev: 5 })];
    const scores = new Map([['rb2', 10], ['rb3', 20]]);
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const rb3 = pool.entries.find((e) => e.playerId === 'rb3')!;
    const rb2 = pool.entries.find((e) => e.playerId === 'rb2')!;
    expect(rb3.synthetic).toBe(true);
    expect(rb2.synthetic).toBe(true);
    // Higher points -> earlier synthetic slot (closer to the deepest observed ADP).
    expect(rb3.adp).toBeLessThan(rb2.adp);
    expect(rb3.adp).toBeGreaterThan(30); // past the deepest observed RB ADP (30)
  });

  it('uses drafted observed players to establish synthetic ADP depth and spread', () => {
    const draftedObserved = player('rb-drafted', 'RB');
    const remainingSynthetic = player('rb-remaining', 'RB');
    const scores = new Map([['rb-drafted', 30], ['rb-remaining', 20]]);
    const adp = [adpEntry({ playerId: 'rb-drafted', adp: 180, stdev: 12 })];
    const pool = buildOpponentPool([remainingSynthetic], scores, adp, CONFIG, [draftedObserved, remainingSynthetic]);
    const synthetic = pool.entries[0]!;
    expect(synthetic.synthetic).toBe(true);
    expect(synthetic.adp).toBe(180 + CONFIG.syntheticStep);
    expect(synthetic.stdev).toBe(12);
  });

  it('breaks a projected-points tie in synthetic ordering by playerId ascending', () => {
    const players = [player('rbB', 'RB'), player('rbA', 'RB')];
    const scores = new Map([['rbA', 10], ['rbB', 10]]);
    const pool = buildOpponentPool(players, scores, [], CONFIG);
    const rbA = pool.entries.find((e) => e.playerId === 'rbA')!;
    const rbB = pool.entries.find((e) => e.playerId === 'rbB')!;
    expect(rbA.adp).toBeLessThan(rbB.adp); // 'rbA' < 'rbB' ascending
  });

  it('falls back to a position with no observed ADP using the global deepest/spread across positions', () => {
    const players = [player('rb1', 'RB'), player('te1', 'TE')];
    const adp = [adpEntry({ playerId: 'rb1', adp: 15, stdev: 6 })];
    const scores = new Map([['rb1', 20], ['te1', 5]]);
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const te1 = pool.entries.find((e) => e.playerId === 'te1')!;
    expect(te1.synthetic).toBe(true);
    expect(te1.stdev).toBe(6); // global max observed stdev (only RB observed)
    expect(te1.adp).toBeGreaterThan(15); // global deepest observed ADP
  });

  it('falls back to noAdpAtAllFallback when there is no ADP data at all', () => {
    const players = [player('rb1', 'RB')];
    const scores = new Map([['rb1', 5]]);
    const pool = buildOpponentPool(players, scores, [], CONFIG);
    const rb1 = pool.entries[0]!;
    expect(rb1.adp).toBeGreaterThan(CONFIG.noAdpAtAllFallback);
    expect(rb1.stdev).toBe(CONFIG.fallbackStdev);
  });

  it('excludes a null-position scored player entirely and counts it distinctly', () => {
    const players = [player('rb1', 'RB'), player('mystery', null)];
    const adp = [adpEntry({ playerId: 'rb1', adp: 10, stdev: 4 })];
    const pool = buildOpponentPool(players, new Map([['rb1', 1], ['mystery', 1]]), adp, CONFIG);
    expect(pool.entries.find((e) => e.playerId === 'mystery')).toBeUndefined();
    expect(pool.unscoredPositionCount).toBe(1);
  });

  it('scopes syntheticAdpCount to the pool passed in, not a static dataset-wide figure', () => {
    const players = [player('rb1', 'RB'), player('rb2', 'RB')];
    const adp = [adpEntry({ playerId: 'rb1', adp: 10, stdev: 4 })]; // rb2 needs synthetic
    const scores = new Map([['rb2', 5]]);
    const smallPool = buildOpponentPool(players, scores, adp, CONFIG);
    expect(smallPool.syntheticAdpCount).toBe(1);
    // Same players, but rb2 already has an ADP row this time -> 0 synthetic, even though "the
    // dataset" conceptually didn't change size.
    const fullAdp = [...adp, adpEntry({ playerId: 'rb2', adp: 20, stdev: 4 })];
    const fullPool = buildOpponentPool(players, scores, fullAdp, CONFIG);
    expect(fullPool.syntheticAdpCount).toBe(0);
  });

  it('entries are sorted by playerId ascending (canonical order for reproducible shock draws)', () => {
    const players = [player('zzz', 'RB'), player('aaa', 'RB')];
    const pool = buildOpponentPool(players, new Map([['zzz', 1], ['aaa', 1]]), [], CONFIG);
    expect(pool.entries.map((e) => e.playerId)).toEqual(['aaa', 'zzz']);
  });
});

describe('computeScenarioPriorities + pickForTeam', () => {
  const players = [player('p1', 'RB'), player('p2', 'RB'), player('p3', 'WR')];
  const adp = [
    adpEntry({ playerId: 'p1', adp: 10, stdev: 3, position: 'RB' }),
    adpEntry({ playerId: 'p2', adp: 12, stdev: 3, position: 'RB' }),
    adpEntry({ playerId: 'p3', adp: 50, stdev: 3, position: 'WR' }),
  ];
  const scores = new Map([['p1', 1], ['p2', 1], ['p3', 1]]);

  it('is deterministic for a fixed seed', () => {
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const seed = deriveStream(hashStateSeed(['draft', 'team-1', '5']), 0);
    const a = computeScenarioPriorities(pool, createRng(seed), CONFIG);
    const b = computeScenarioPriorities(pool, createRng(seed), CONFIG);
    expect(a).toEqual(b);
  });

  it('common random numbers: the same scenario priorities are reused for multiple pickForTeam calls', () => {
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const rng = createRng(1n);
    const priorities = computeScenarioPriorities(pool, rng, CONFIG);
    // Calling pickForTeam twice with different `drafted` sets must not redraw shocks — the
    // priorities array is reused as-is, exactly as simulate.ts will use it across a scenario.
    const first = pickForTeam(priorities, new Set(), new Map(), CONFIG.candidateWindow);
    const second = pickForTeam(priorities, new Set(['p3']), new Map(), CONFIG.candidateWindow);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // priorities array itself is untouched between calls.
    expect(priorities.some((p) => p.playerId === 'p3')).toBe(true);
  });

  it('respects the candidate window: a player outside the window is never picked regardless of need', () => {
    // p3 (WR, adp 50) is far behind p1/p2 (adp ~10-12) in the base order. With a window of 1, only
    // the single best-ranked undrafted entry is ever considered.
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const priorities = computeScenarioPriorities(pool, createRng(1n), { ...CONFIG, shockScale: 0 }); // no noise: pure ADP order
    const need = new Map<Position, number>([['WR', 1000]]); // absurd need bonus, still shouldn't matter outside the window
    const picked = pickForTeam(priorities, new Set(), need, 1);
    expect(picked).toBe('p1'); // best ADP, window too narrow to reach p3
  });

  it('a large enough need bonus can promote a player within the window over a better-ADP one', () => {
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const priorities = computeScenarioPriorities(pool, createRng(1n), { ...CONFIG, shockScale: 0 });
    const need = new Map<Position, number>([['WR', 1000]]);
    const picked = pickForTeam(priorities, new Set(), need, CONFIG.candidateWindow);
    expect(picked).toBe('p3');
  });

  it('skips already-drafted entries', () => {
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const priorities = computeScenarioPriorities(pool, createRng(1n), { ...CONFIG, shockScale: 0 });
    const picked = pickForTeam(priorities, new Set(['p1']), new Map(), CONFIG.candidateWindow);
    expect(picked).toBe('p2');
  });

  it('returns null when every entry is drafted', () => {
    const pool = buildOpponentPool(players, scores, adp, CONFIG);
    const priorities = computeScenarioPriorities(pool, createRng(1n), CONFIG);
    const picked = pickForTeam(priorities, new Set(['p1', 'p2', 'p3']), new Map(), CONFIG.candidateWindow);
    expect(picked).toBeNull();
  });

  it('breaks an exact adjusted-value tie by playerId ascending', () => {
    const tiedPlayers = [player('b', 'RB'), player('a', 'RB')];
    const tiedAdp = [adpEntry({ playerId: 'a', adp: 10, stdev: 0 }), adpEntry({ playerId: 'b', adp: 10, stdev: 0 })];
    const pool = buildOpponentPool(tiedPlayers, new Map([['a', 1], ['b', 1]]), tiedAdp, { ...CONFIG, shockScale: 0 });
    const priorities = computeScenarioPriorities(pool, createRng(1n), { ...CONFIG, shockScale: 0 });
    const picked = pickForTeam(priorities, new Set(), new Map(), CONFIG.candidateWindow);
    expect(picked).toBe('a');
  });
});

describe('needBonusFromLineup', () => {
  const settings: LeagueSettings = {
    provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
    startingSlots: ['QB', 'RB', 'RB', 'WR', 'FLEX'], rosterSlots: {}, scoring: {},
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  };

  function prepared(settingsOverride: LeagueSettings, roster: PlayerMeta[], scores: ReadonlyMap<PlayerId, number>) {
    const points = new Map(roster.map((p) => [p.playerId, scores.get(p.playerId) ?? 0]));
    return prepareLineup(settingsOverride, roster, points);
  }

  it('reports zero need for a fully staffed dedicated position, nonzero for an empty one', () => {
    // No FLEX slot in this settings variant, so there's no ambiguity about whether an RB could
    // have been routed through FLEX instead of its dedicated slot (see the next test for that case).
    const noFlexSettings: LeagueSettings = { ...settings, startingSlots: ['QB', 'RB', 'RB', 'WR'] };
    const roster = [player('qb1', 'QB'), player('rb1', 'RB'), player('rb2', 'RB')];
    const scores = new Map([['qb1', 20], ['rb1', 15], ['rb2', 10]]);
    const bonus = needBonusFromLineup(prepared(noFlexSettings, roster, scores), CONFIG);
    expect(bonus.get('QB')).toBe(0);
    expect(bonus.get('RB')).toBe(0); // both dedicated RB slots filled
    expect(bonus.get('WR')).toBe(CONFIG.needBonusCap); // 1 of 1 WR slots unfilled -> full cap
  });

  it('a FLEX-eligible surplus can leave a dedicated slot of the same position unfilled', () => {
    // With FLEX present, the underlying solver may route one of two RBs through FLEX instead of
    // the second dedicated RB slot (see eligibility.ts's Stage A tie-break notes) — need accounting
    // must reflect the *actual* assignment, not an assumption that same-position players always
    // fill their own dedicated slots first.
    const roster = [player('rb1', 'RB'), player('rb2', 'RB')];
    const scores = new Map([['rb1', 15], ['rb2', 10]]);
    const bonus = needBonusFromLineup(prepared(settings, roster, scores), CONFIG); // settings includes FLEX
    expect(bonus.get('RB')).toBe(CONFIG.needBonusCap / 2); // 1 of 2 dedicated RB slots unfilled
  });

  it('does not double-count a multi-position-eligible player against two positions', () => {
    // A single RB/WR-eligible player fills one slot in the optimal assignment; it must not zero
    // out need for BOTH RB and WR simultaneously by being tallied against each independently.
    const hybrid = player('hybrid1', 'RB', ['RB', 'WR']);
    const scores = new Map([['hybrid1', 15]]);
    const bonus = needBonusFromLineup(prepared(settings, [hybrid], scores), CONFIG);
    // The optimizer will place the hybrid in exactly one slot (RB or FLEX/WR-eligible), leaving at
    // least one of RB's two dedicated slots and WR's one dedicated slot still needing a bonus > 0.
    const rbBonus = bonus.get('RB') ?? 0;
    const wrBonus = bonus.get('WR') ?? 0;
    // Both cannot be fully satisfied (0) by a single player occupying a single slot.
    expect(rbBonus > 0 || wrBonus > 0).toBe(true);
  });

  it('never reports need for a FLEX-family slot (dedicated positions only)', () => {
    const bonus = needBonusFromLineup(prepared(settings, [], new Map()), CONFIG);
    expect(bonus.has('FLEX' as Position)).toBe(false);
  });

  it('an unmatched pick (excluded by the caller) contributes zero need, never guessed at', () => {
    // Simulates the caller's contract: an unmatched historical pick is filtered out before this
    // roster list is built. A roster missing one player must produce the same result as if that
    // slot had simply never been filled — no phantom position gets credited.
    const roster = [player('qb1', 'QB')]; // as if a second, unmatched RB pick was excluded
    const scores = new Map([['qb1', 20]]);
    const bonus = needBonusFromLineup(prepared(settings, roster, scores), CONFIG);
    expect(bonus.get('RB')).toBe(CONFIG.needBonusCap); // both RB slots still read as unfilled
  });
});
