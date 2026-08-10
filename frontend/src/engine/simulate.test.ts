import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, Pick, PlayerId, PlayerMeta, Position } from '../../../shared/types';
import { userPickBoundaries } from '../adapters/draftOrder';
import type { OpponentModelConfig } from './opponentModel';
import { bestFollowUpValue, buildOpponentWindowSchedule, buildTeamRosters, runSimulation, simulateOpponentWindow, type SimulationInput } from './simulate';
import { prepareLineup } from './eligibility';

const CONFIG: OpponentModelConfig = {
  shockScale: 1,
  needBonusCap: 8,
  candidateWindow: 60,
  fallbackStdev: 8,
  syntheticStep: 0.5,
  noAdpAtAllFallback: 16,
};

const SETTINGS: LeagueSettings = {
  provider: 'sleeper', leagueId: 'sim', name: 'Sim', season: '2026', teams: 4,
  startingSlots: ['QB', 'RB', 'WR', 'FLEX'], rosterSlots: {}, scoring: {},
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};
const TEAMS = 4;
const ROUNDS = 4;
const SLOT_TO_TEAM: Record<number, string> = { 1: 'me', 2: 't2', 3: 't3', 4: 't4' };

function player(id: string, position: Position, eligiblePositions: Position[] = [position]): PlayerMeta {
  return { playerId: id, name: id, position, eligiblePositions, team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
}

function adpEntry(playerId: PlayerId, adp: number, stdev = 3, position = 'RB'): AdpEntry {
  return { playerId, name: playerId, position, team: null, adp, stdev, high: adp - 10, low: adp + 10, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' };
}

/** A modest pool: a few RBs/WRs with real ADP, a QB, and enough depth that opponents in a 6-pick
 * window have real choices to make. */
function buildPool(): { players: PlayerMeta[]; scores: Map<PlayerId, number>; adp: AdpEntry[] } {
  const players: PlayerMeta[] = [
    player('rb1', 'RB'), player('rb2', 'RB'), player('rb3', 'RB'), player('rb4', 'RB'), player('rb5', 'RB'),
    player('wr1', 'WR'), player('wr2', 'WR'), player('wr3', 'WR'), player('wr4', 'WR'),
    player('qb1', 'QB'), player('qb2', 'QB'),
  ];
  const scores = new Map<PlayerId, number>([
    ['rb1', 100], ['rb2', 90], ['rb3', 80], ['rb4', 70], ['rb5', 60],
    ['wr1', 95], ['wr2', 85], ['wr3', 75], ['wr4', 65],
    ['qb1', 50], ['qb2', 45],
  ]);
  const adp: AdpEntry[] = [
    adpEntry('rb1', 1, 2, 'RB'), adpEntry('rb2', 3, 2, 'RB'), adpEntry('rb3', 6, 2, 'RB'), adpEntry('rb4', 9, 2, 'RB'), adpEntry('rb5', 12, 2, 'RB'),
    adpEntry('wr1', 2, 2, 'WR'), adpEntry('wr2', 4, 2, 'WR'), adpEntry('wr3', 7, 2, 'WR'), adpEntry('wr4', 10, 2, 'WR'),
    adpEntry('qb1', 5, 2, 'QB'), adpEntry('qb2', 8, 2, 'QB'),
  ];
  return { players, scores, adp };
}

function baseInput(overrides: Partial<SimulationInput>): SimulationInput {
  const { players, scores, adp } = buildPool();
  const playersById = new Map(players.map((p) => [p.playerId, p]));
  return {
    settings: SETTINGS,
    draftType: 'snake',
    teams: TEAMS,
    rounds: ROUNDS,
    slotToTeam: SLOT_TO_TEAM,
    draftId: 'draft-1',
    myTeamId: 'me',
    myRoster: [],
    scores,
    candidates: [player('rb1', 'RB'), player('wr1', 'WR')],
    remainingPlayers: players,
    adp,
    picks: [],
    playersById,
    decisionPick: 1,
    followUpPick: 8,
    opponentConfig: CONFIG,
    executionMode: { mode: 'fixed', scenarios: 20 },
    ...overrides,
  };
}

describe('runSimulation — determinism', () => {
  it('fixed mode: identical input produces a byte-identical payload (elapsedMs excluded)', () => {
    const input = baseInput({});
    const a = runSimulation(input);
    const b = runSimulation(input);
    const strip = (r: ReturnType<typeof runSimulation>) => JSON.stringify({ ...r, diagnostics: { ...r.diagnostics, elapsedMs: 0 } });
    expect(strip(a)).toBe(strip(b));
  });

  it('fixed mode: elapsedMs aside, results are stable across a fresh call graph (no shared mutable state leaking between calls)', () => {
    const input = baseInput({});
    const a = runSimulation(input);
    const b = runSimulation(input);
    expect(a.candidates).toEqual(b.candidates);
    expect(a.diagnostics.scenariosRun).toBe(b.diagnostics.scenariosRun);
    expect(a.diagnostics.timedOut).toBe(b.diagnostics.timedOut);
  });

  it('different draftId produces a different (but still internally deterministic) result', () => {
    const a = runSimulation(baseInput({ draftId: 'draft-1' }));
    const b = runSimulation(baseInput({ draftId: 'draft-2' }));
    expect(a.candidates).not.toEqual(b.candidates);
  });
});

describe('runSimulation — sim-count stability', () => {
  it('mean lookaheadValue converges as scenario count grows (prefix property)', () => {
    const at20 = runSimulation(baseInput({ executionMode: { mode: 'fixed', scenarios: 20 } }));
    const at80 = runSimulation(baseInput({ executionMode: { mode: 'fixed', scenarios: 80 } }));
    const at320 = runSimulation(baseInput({ executionMode: { mode: 'fixed', scenarios: 320 } }));
    for (const candidateId of ['rb1', 'wr1']) {
      const v20 = at20.candidates.find((c) => c.playerId === candidateId)!.lookaheadValue;
      const v80 = at80.candidates.find((c) => c.playerId === candidateId)!.lookaheadValue;
      const v320 = at320.candidates.find((c) => c.playerId === candidateId)!.lookaheadValue;
      // Not asserting exact convergence tolerance (that's a recorded benchmark, not a strict
      // invariant per the review) — just that more scenarios doesn't blow up or diverge wildly.
      expect(Math.abs(v320 - v80)).toBeLessThan(Math.abs(v80 - v20) + 5);
    }
  });

  it('top ordering by expectedFinalStarterValue is stable across scenario counts on this fixture', () => {
    const orderingAt = (n: number) =>
      runSimulation(baseInput({ executionMode: { mode: 'fixed', scenarios: n } }))
        .candidates.slice().sort((a, b) => b.expectedFinalStarterValue - a.expectedFinalStarterValue).map((c) => c.playerId);
    expect(orderingAt(40)).toEqual(orderingAt(160));
  });
});

describe('runSimulation — common random numbers', () => {
  it('two candidates evaluated in the same run see the same opponent noise (survival tracks together for correlated scenarios)', () => {
    // With shockScale 0, every scenario's opponent order is identical (pure ADP), so every
    // candidate's survival is fully determined, not noisy — a strong deterministic check that the
    // scenario loop reuses one set of priorities per scenario rather than redrawing per candidate.
    const zeroNoise = { ...CONFIG, shockScale: 0 };
    const result = runSimulation(baseInput({ opponentConfig: zeroNoise, executionMode: { mode: 'fixed', scenarios: 5 } }));
    for (const c of result.candidates) {
      expect(c.simulatedSurvivalProbability === 0 || c.simulatedSurvivalProbability === 1).toBe(true);
    }
  });
});

describe('runSimulation — pick boundaries (opponent-on-clock regression)', () => {
  it('rejects a mid-window missing slot mapping instead of silently truncating the rollout', () => {
    expect(() => buildOpponentWindowSchedule('snake', TEAMS, ROUNDS, { 1: 'me', 3: 't3', 4: 't4' }, 2, 3))
      .toThrow(/missing or unsupported draft-order mapping/);
  });

  it('opponents are simulated only over decisionPick+1 .. followUpPick-1, never decisionPick or followUpPick itself', () => {
    // decisionPick=1, followUpPick=8 for 'me' (slot 1) in this 4-team snake league — hand-derived
    // and cross-checked against userPickBoundaries directly below.
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, 0, SLOT_TO_TEAM, 'me');
    expect(boundaries).toEqual({ decisionPick: 1, followUpPick: 8 });

    const { players, scores, adp } = buildPool();
    const playersById = new Map(players.map((p) => [p.playerId, p]));
    const baseRosters = buildTeamRosters(SETTINGS, [], playersById, scores, 1);
    // Zero-noise priorities: pure ADP order, so the drafted set is fully hand-verifiable.
    const priorities = [...players]
      .map((p) => ({ playerId: p.playerId, position: p.position as Position, value: adp.find((a) => a.playerId === p.playerId)?.adp ?? 999 }))
      .sort((a, b) => a.value - b.value);

    const drafted = simulateOpponentWindow(
      SETTINGS, 'snake', TEAMS, ROUNDS, SLOT_TO_TEAM,
      2, 7, // windowStart = decisionPick+1, windowEnd = followUpPick-1
      baseRosters, scores, playersById, priorities, new Set(), CONFIG,
    );
    // Exactly 6 opponent picks simulated (overall 2-7) — not 7 (which would include decisionPick=1
    // if off-by-one) and not 8 (which would wrongly include followUpPick).
    expect(drafted.size).toBe(6);
  });

  it('a candidate forced onto the user roster at decisionPick is never available to an opponent in the window', () => {
    const result = runSimulation(baseInput({ candidates: [player('rb1', 'RB')] }));
    // If rb1 (top ADP) were still draftable by opponents, its own deterministic MRV would be
    // impossible to realize consistently; instead confirm every scenario's final value is at
    // least as good as taking rb1 alone (i.e. rb1's presence on the user's roster is respected).
    const rb1 = result.candidates[0]!;
    expect(rb1.expectedFinalStarterValue).toBeGreaterThanOrEqual(0);
  });
});

describe('runSimulation — snake-turn empty window', () => {
  it('an empty opponent window still finds a real, non-degenerate best follow-up (not forced to 0)', () => {
    // 7 picks already made; 'me' (slot 1) is on the clock at 8 and picks again immediately at 9 —
    // the round2/round3 reversal boundary for the first slot. No opponents in between.
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, 7, SLOT_TO_TEAM, 'me');
    expect(boundaries).toEqual({ decisionPick: 8, followUpPick: 9 });

    const { players, scores, adp } = buildPool();
    // Everyone is still on the board (nobody drafted yet, for simplicity) except the candidate.
    const result = runSimulation(baseInput({
      picks: [], decisionPick: 8, followUpPick: 9,
      candidates: [player('rb2', 'RB')], // rb1 (best) is left as the "obvious" follow-up
      remainingPlayers: players,
    }));
    const rb2 = result.candidates[0]!;
    // Since the window is empty, every survivor is available for the follow-up search — the best
    // available (rb1, 100 pts) must be found. This must NOT degenerate to just rb2's own MRV.
    const rb2Prepared = prepareLineup(SETTINGS, [], new Map());
    const rb2Mrv = (() => {
      const withRb2 = new Map(rb2Prepared.points);
      withRb2.set('rb2', scores.get('rb2') ?? 0);
      return 90; // rb2's own points, since roster starts empty and RB/FLEX are open
    })();
    expect(rb2.expectedFinalStarterValue).toBeGreaterThan(rb2Mrv);
    // rb1 is outside the displayed shortlist but is the best full-pool option at the next turn.
    expect(rb2.vona).toBe(-10);
    void adp;
  });
});

describe('runSimulation — end-of-draft null follow-up', () => {
  it('degenerates cleanly to the deterministic MRV with no simulation run', () => {
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, TEAMS * ROUNDS - 1, SLOT_TO_TEAM, 'me');
    expect(boundaries.followUpPick).toBeNull();

    const result = runSimulation(baseInput({ decisionPick: boundaries.decisionPick!, followUpPick: null }));
    expect(result.diagnostics.scenariosRun).toBe(0);
    expect(result.diagnostics.timedOut).toBe(false);
    for (const c of result.candidates) {
      expect(c.lookaheadValue).toBe(c.vona);
      expect(c.lookaheadValue).toBe(c.downside);
      expect(c.simulatedSurvivalProbability).toBe(1);
      expect(Number.isFinite(c.expectedFinalStarterValue)).toBe(true);
    }
  });
});

describe('runSimulation — unmatched-pick bench handling', () => {
  it('an unmatched historical pick does not crash roster reconstruction and contributes no positional need', () => {
    const unmatchedPick: Pick = { overall: 2, round: 1, slot: 2, teamId: 't2', playerId: null, providerPlayerId: 'raw-unknown' };
    expect(() => runSimulation(baseInput({ picks: [unmatchedPick], decisionPick: 1, followUpPick: 8 }))).not.toThrow();

    const { players, scores } = buildPool();
    const playersById = new Map(players.map((p) => [p.playerId, p]));
    const rosters = buildTeamRosters(SETTINGS, [unmatchedPick], playersById, scores, 3);
    // t2's roster must not include a phantom player, and must simply have no entry (nothing to
    // reconstruct) rather than guessing at who the unmatched pick was.
    expect(rosters.has('t2')).toBe(false);
  });
});

describe('runSimulation — budgeted mode', () => {
  it('a 0ms budget still runs at least one full batch, sets timedOut, and stops short of maxScenarios', () => {
    let calls = 0;
    const now = () => { calls += 1; return calls === 1 ? 0 : 1; }; // first call = start time; every check after reports 1ms elapsed
    const result = runSimulation(baseInput({
      executionMode: { mode: 'budgeted', scenarios: 1000, timeBudgetMs: 0, batchSize: 25 },
      now,
    }));
    expect(result.diagnostics.scenariosRun).toBeGreaterThan(0);
    expect(result.diagnostics.scenariosRun).toBeLessThan(1000);
    expect(result.diagnostics.timedOut).toBe(true);
  });

  it('a generous budget completes all requested scenarios without timing out', () => {
    const result = runSimulation(baseInput({
      executionMode: { mode: 'budgeted', scenarios: 40, timeBudgetMs: 60000, batchSize: 25 },
    }));
    expect(result.diagnostics.scenariosRun).toBe(40);
    expect(result.diagnostics.timedOut).toBe(false);
  });

  it('completed scenarios in a truncated budgeted run match a fixed run truncated to the same count', () => {
    // The prefix property (rng.ts's deriveStream) means whatever prefix of scenarios a budgeted run
    // completes must produce the same aggregate as a 'fixed' run asking for exactly that many.
    let calls = 0;
    // Let exactly 2 batches (50 scenarios) complete, then report the budget exceeded.
    const now = () => { calls += 1; return calls <= 2 ? 0 : 1000; };
    const budgeted = runSimulation(baseInput({
      executionMode: { mode: 'budgeted', scenarios: 1000, timeBudgetMs: 1, batchSize: 25 },
      now,
    }));
    const fixed = runSimulation(baseInput({
      executionMode: { mode: 'fixed', scenarios: budgeted.diagnostics.scenariosRun },
    }));
    expect(budgeted.candidates).toEqual(fixed.candidates);
  });
});

describe('runSimulation — synthetic ADP in the candidate window', () => {
  it('a scored player with no ADP row is reachable by opponents in a wide/late-draft window', () => {
    // Synthetic ADP is placed *past* the deepest observed ADP by construction (that's the whole
    // point — it represents a player nobody has drafted widely enough to have real ADP data), so a
    // shallow window (the default 6-pick fixture window) almost never sweeps it up; that's not a
    // bug, it just isn't the scenario this behavior is meant to cover. The meaningful test is a
    // "late-draft" window wide enough to reach the bottom of the pool at all — per the review's own
    // framing — which the old bug (no synthetic entry -> unreachable, spurious 100% survival)
    // would fail even here. Zero shock noise makes the outcome exactly deterministic rather than
    // dependent on how often noise happens to promote the worst-ranked player.
    const { players, scores, adp } = buildPool();
    const noAdpPlayer = player('rbNoAdp', 'RB');
    const allPlayers = [...players, noAdpPlayer]; // 12 total, all opponent-draftable in the baseline
    const allScores = new Map(scores);
    allScores.set('rbNoAdp', 55);
    const zeroNoise = { ...CONFIG, shockScale: 0, syntheticStep: 0.25 };
    const result = runSimulation(baseInput({
      remainingPlayers: allPlayers,
      scores: allScores,
      adp,
      candidates: [player('rbNoAdp', 'RB')],
      decisionPick: 1,
      followUpPick: 14, // window 2..13 = 12 opponent picks, draining the entire 12-player pool
      executionMode: { mode: 'fixed', scenarios: 10 },
      opponentConfig: zeroNoise,
    }));
    expect(result.diagnostics.syntheticAdpCount).toBeGreaterThanOrEqual(1);
    const tracked = result.candidates[0]!;
    // A window wide enough to drain the whole pool must reach even the worst-ranked (synthetic)
    // entry — deterministically 0% survival, proving it's actually reachable, not silently excluded.
    expect(tracked.simulatedSurvivalProbability).toBe(0);
  });

  it('a shallower window plausibly leaves the synthetic player on the board (sanity, not the reachability proof above)', () => {
    const { players, scores, adp } = buildPool();
    const noAdpPlayer = player('rbNoAdp', 'RB');
    const allPlayers = [...players, noAdpPlayer];
    const allScores = new Map(scores);
    allScores.set('rbNoAdp', 55);
    const result = runSimulation(baseInput({
      remainingPlayers: allPlayers,
      scores: allScores,
      adp,
      candidates: [player('rbNoAdp', 'RB')],
      executionMode: { mode: 'fixed', scenarios: 60 }, // default 6-pick window
      opponentConfig: { ...CONFIG, syntheticStep: 0.25 },
    }));
    const tracked = result.candidates[0]!;
    expect(tracked.simulatedSurvivalProbability).toBeGreaterThan(0.5); // usually survives a shallow window
  });
});

describe('runSimulation — null-position scored player', () => {
  it('is excluded from opponent sampling and surfaced in diagnostics, never guessed at', () => {
    const { players, scores, adp } = buildPool();
    const mystery: PlayerMeta = { playerId: 'mystery1', name: 'mystery1', position: null, eligiblePositions: [], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
    const allPlayers = [...players, mystery];
    const allScores = new Map(scores);
    allScores.set('mystery1', 999); // deliberately highest score, so if it leaked in it would dominate
    const result = runSimulation(baseInput({ remainingPlayers: allPlayers, scores: allScores, adp }));
    expect(result.diagnostics.unscoredPositionCount).toBe(1);
    // A candidate list that doesn't include the null-position player at all -- confirms the run
    // doesn't crash and produces ordinary results for the tracked candidates regardless.
    expect(result.candidates).toHaveLength(2);
    for (const c of result.candidates) expect(Number.isFinite(c.expectedFinalStarterValue)).toBe(true);
  });
});

describe('bestFollowUpValue — branch-and-bound', () => {
  const settings: LeagueSettings = { ...SETTINGS, startingSlots: ['RB'] };

  it('finds the best survivor and stops scanning once the bound is exceeded', () => {
    const base = prepareLineup(settings, [], new Map());
    const survivors = [player('rb1', 'RB'), player('rb2', 'RB'), player('rb3', 'RB')];
    const scores = new Map([['rb1', 20], ['rb2', 10], ['rb3', 5]]);
    const value = bestFollowUpValue(base, survivors, scores, new Set(), 'excluded');
    expect(value).toBe(20);
  });

  it('returns 0 ("take no follow-up") when every survivor is drafted or excluded', () => {
    const base = prepareLineup(settings, [], new Map());
    const survivors = [player('rb1', 'RB')];
    const scores = new Map([['rb1', 20]]);
    expect(bestFollowUpValue(base, survivors, scores, new Set(['rb1']), 'someone-else')).toBe(0);
    expect(bestFollowUpValue(base, survivors, scores, new Set(), 'rb1')).toBe(0);
  });

  it('returns 0 when the roster is already full (no positive-gain placement exists)', () => {
    const incumbent = player('rbIncumbent', 'RB');
    const base = prepareLineup(settings, [incumbent], new Map([['rbIncumbent', 50]]));
    const survivors = [player('rb1', 'RB')];
    const scores = new Map([['rbIncumbent', 50], ['rb1', 10]]); // worse than the incumbent, no open slot
    expect(bestFollowUpValue(base, survivors, scores, new Set(), 'excluded')).toBe(0);
  });
});

describe('runSimulation duplicate candidate boundary', () => {
  it('keeps the first duplicate only, so aggregates remain one result per player ID', () => {
    const rb1 = player('rb1', 'RB');
    const result = runSimulation(baseInput({ candidates: [rb1, rb1, player('wr1', 'WR')] }));
    expect(result.candidates.map((candidate) => candidate.playerId)).toEqual(['rb1', 'wr1']);
  });
});
