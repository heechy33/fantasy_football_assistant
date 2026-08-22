/**
 * Pure-function coverage for the 2025 historical backtest (frontend/src/engine/backtest.ts) and the
 * value-only lineup solver fast path (eligibility.ts's optimizeLineupValue). These tests use small
 * synthetic rosters with hand-computable answers; the runner (backtest.bench.ts) is opt-in and is
 * deliberately NOT covered here (it is skipped by the BENCHMARK env guard under `npm test`).
 */
import { describe, expect, it } from 'vitest';
import type { PlayerMeta, PlayerWeeklyStatsArtifact, Position } from '../../../shared/types';
import { optimizeLineup, optimizeLineupValue } from './eligibility';
import {
  buildBacktestContext,
  buildBacktestLeagueSettings,
  draftSeedFor,
  evaluateGates,
  ffcRowsToAdpEntries,
  isLegalPick,
  mean,
  pairedEngineVsBaseline,
  percentile,
  pickBestLegal,
  replacementAdjustedPoints,
  resolveFfcRowSleeperId,
  scoreRosterWeekly,
  simulateSchedules,
  verifyBacktestIntegrity,
  type BacktestInputs,
  type FfcAdpRow,
} from './backtest';

const SETTINGS = buildBacktestLeagueSettings();

function player(id: string, position: Position): PlayerMeta {
  return {
    playerId: id,
    name: id,
    position,
    eligiblePositions: [position],
    team: null,
    byeWeek: null,
    age: null,
    yearsExp: null,
    injuryStatus: null,
    depthChartPosition: null,
    depthChartOrder: null,
    injuryBodyPart: null,
    practiceParticipation: null,
    ids: {},
    heightInches: null,
    weightLbs: null,
    college: null,
    jerseyNumber: null,
    draftYear: null,
    draftRound: null,
    draftPick: null,
  };
}

const PTS_COLUMNS: Record<string, string[]> = {
  QB: ['pts'], RB: ['pts'], WR: ['pts'], TE: ['pts'], K: ['pts'], DEF: ['pts'],
};

function makeWeekly(rowsById: Record<string, Position>, weeksByPlayer: Record<string, [number, number][]>): PlayerWeeklyStatsArtifact {
  return {
    schemaVersion: 1,
    season: 2025,
    weeksFetched: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    columns: PTS_COLUMNS,
    players: Object.fromEntries(Object.entries(weeksByPlayer).map(([id, rows]) => [
      id, { p: rowsById[id] as string, bye: 6, w: rows },
    ])),
    heat: {},
  };
}

// ---------------------------------------------------------------------------
// optimizeLineupValue === optimizeLineup (property suite, deterministic fixtures)
// ---------------------------------------------------------------------------

describe('optimizeLineupValue', () => {
  it('matches optimizeLineup().value on fixed diverse rosters', () => {
    const fullPos: Record<string, Position> = {
      qb1: 'QB', qb2: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', rb4: 'RB', rb5: 'RB',
      wr1: 'WR', wr2: 'WR', wr3: 'WR', wr4: 'WR', wr5: 'WR', te1: 'TE', te2: 'TE', k1: 'K', def1: 'DEF',
    };
    const skillPos: Record<string, Position> = {
      qb1: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', rb4: 'RB', rb5: 'RB',
      wr1: 'WR', wr2: 'WR', wr3: 'WR', wr4: 'WR', wr5: 'WR', te1: 'TE',
    };
    const rosters: PlayerMeta[][] = [
      Object.keys(fullPos).map((id) => player(id, fullPos[id]!)),
      Object.keys(skillPos).map((id) => player(id, skillPos[id]!)),
    ];
    const pointSets: Record<string, number>[] = [
      { qb1: 30, rb1: 20, rb2: 15, wr1: 18, wr2: 12, te1: 10, rb3: 14, wr3: 22, k1: 5, def1: 6, rb4: 8, wr4: 9, qb2: 3, wr5: 7, te2: 4, rb5: 1 },
      { qb1: 5, rb1: 2, rb2: 3, wr1: 4, wr2: 6, te1: 1, rb3: 0, wr3: -2, k1: 0, def1: 0, rb4: 8, wr4: 9, qb2: 3, wr5: 7, te2: 4, rb5: 1 },
    ];
    for (const roster of rosters) {
      for (const pts of pointSets) {
        const weekPts = new Map(Object.entries(pts).map(([id, v]) => [id, v] as const));
        expect(optimizeLineupValue(SETTINGS, roster, weekPts)).toBe(optimizeLineup(SETTINGS, roster, weekPts).value);
      }
    }
  });

  it('matches optimizeLineup on a 16-man roster with negative and zero points', () => {
    const positions: Record<string, Position> = {
      qb1: 'QB', qb2: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', rb4: 'RB', rb5: 'RB',
      wr1: 'WR', wr2: 'WR', wr3: 'WR', wr4: 'WR', wr5: 'WR', te1: 'TE', te2: 'TE', k1: 'K', def1: 'DEF',
    };
    const roster = Object.keys(positions).map((id) => player(id, positions[id]!));
    const pts = new Map(Object.keys(positions).map((id, i) => [id, (i % 5) - 2]));
    expect(optimizeLineupValue(SETTINGS, roster, pts)).toBe(optimizeLineup(SETTINGS, roster, pts).value);
  });
});

// ---------------------------------------------------------------------------
// scoreRosterWeekly — hand-computable optimum, zero-outcome players, coverage
// ---------------------------------------------------------------------------

describe('scoreRosterWeekly', () => {
  const positions: Record<string, Position> = {
    qb1: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR', wr2: 'WR', te1: 'TE', wr3: 'WR', k1: 'K', def1: 'DEF', rb3: 'RB',
  };
  // qb1 20, rb1 10, rb2 5, wr1 12, wr2 8, te1 6, wr3 15 (FLEX), k1 4, def1 3, rb3 2 (bench)
  const weeksByPlayer: Record<string, [number, number][]> = {
    qb1: [[1, 20]], rb1: [[1, 10]], rb2: [[1, 5]], wr1: [[1, 12]], wr2: [[1, 8]],
    te1: [[1, 6]], wr3: [[1, 15]], k1: [[1, 4]], def1: [[1, 3]], rb3: [[1, 2]],
  };
  const weekly = makeWeekly(positions, weeksByPlayer);
  const roster = Object.keys(positions).map((id) => player(id, positions[id]!));
  const HAND_VALUE = 20 + 10 + 5 + 12 + 8 + 6 + 15 + 4 + 3; // 83

  it('computes the hand-computable optimal weekly starter value (FLEX = wr3)', () => {
    const scored = scoreRosterWeekly(SETTINGS, roster, weekly, [1]);
    expect(scored.perWeek).toEqual([HAND_VALUE]);
    expect(scored.coverage).toBe(1);
  });

  it('scores a drafted-but-zero-outcome player 0 all season and never excludes them', () => {
    const withZero = [...roster, player('zero', 'WR')]; // no weekly rows at all
    const scored = scoreRosterWeekly(SETTINGS, withZero, weekly, [1]);
    // Same 83: zero contributes 0 and stays benched — an exact 0, not an exclusion.
    expect(scored.perWeek).toEqual([HAND_VALUE]);
    expect(scored.coverage).toBe(1);
  });

  it('reports coverage below 1 when a legal lineup cannot be filled from played players', () => {
    // Neither wr3 nor rb3 played week 1: only 8 played players, so the FLEX slot cannot be filled.
    const shortWeeks: Record<string, [number, number][]> = {
      qb1: [[1, 20]], rb1: [[1, 10]], rb2: [[1, 5]], wr1: [[1, 12]], wr2: [[1, 8]],
      te1: [[1, 6]], k1: [[1, 4]], def1: [[1, 3]],
    };
    const shortWeekly = makeWeekly(positions, shortWeeks);
    const scored = scoreRosterWeekly(SETTINGS, roster, shortWeekly, [1]);
    expect(scored.coverage).toBe(0);
    // The optimizer fills the 8 dedicated slots (FLEX stays empty): 20+10+5+12+8+6+4+3.
    expect(scored.perWeek[0]).toBe(20 + 10 + 5 + 12 + 8 + 6 + 4 + 3);
  });
});

// ---------------------------------------------------------------------------
// simulateSchedules — hand-computable win/playoff rates
// ---------------------------------------------------------------------------

describe('simulateSchedules', () => {
  const weekValues = (pts: number): number[] => Array.from({ length: 17 }, (_, i) => (i < 14 ? pts : 0));
  const weeklyByTeam = new Map([
    ['A', weekValues(100)],
    ['B', weekValues(90)],
    ['C', weekValues(80)],
    ['D', weekValues(70)],
  ]);

  it('a team that outscores everyone wins every game and always makes the top half', () => {
    const result = simulateSchedules(weeklyByTeam, 'A', draftSeedFor(1, 0), 50);
    expect(result.winRate).toBe(1);
    expect(result.playoffRate).toBe(1);
  });

  it('a team that always loses wins nothing and never makes the playoffs', () => {
    const result = simulateSchedules(weeklyByTeam, 'D', draftSeedFor(1, 0), 50);
    expect(result.winRate).toBe(0);
    expect(result.playoffRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Paired CI + gates
// ---------------------------------------------------------------------------

describe('pairedEngineVsBaseline / evaluateGates', () => {
  it('computes the paired mean/SE/CI and passes when the engine ties', () => {
    const paired = pairedEngineVsBaseline([10.5, 11, 10], [10, 10.5, 9.5]);
    expect(paired.n).toBe(3);
    expect(paired.meanEngine).toBe(10.5);
    expect(paired.meanDiff).toBe(0.5);
    expect(paired.stdErr).toBe(0);
    expect(paired.ciLower).toBe(0.5);
    expect(paired.ciUpper).toBe(0.5);
    const gates = evaluateGates(paired, 8, 8, true);
    expect(gates.find((g) => g.label === 'primary-point-floor')!.holds).toBe(true);
    expect(gates.find((g) => g.label === 'primary-ci')!.holds).toBe(true);
    expect(gates.find((g) => g.label === 'downside')!.holds).toBe(true);
  });

  it('fails the point floor and CI when the baseline is materially ahead', () => {
    const paired = pairedEngineVsBaseline([10, 10, 10], [15, 15, 15]);
    const gates = evaluateGates(paired, 5, 10, true);
    expect(gates.find((g) => g.label === 'primary-point-floor')!.holds).toBe(false);
    expect(gates.find((g) => g.label === 'primary-ci')!.holds).toBe(false);
    expect(gates.find((g) => g.label === 'downside')!.holds).toBe(false);
  });

  it('treats the exact -0.25 boundary as floor-OK but CI-FAIL (strict > -0.25)', () => {
    const paired = pairedEngineVsBaseline([10, 10], [10.25, 10.25]); // diffs exactly -0.25
    const gates = evaluateGates(paired, 8, 8, true);
    expect(gates.find((g) => g.label === 'primary-point-floor')!.holds).toBe(true);
    expect(gates.find((g) => g.label === 'primary-ci')!.holds).toBe(false);
  });

  it('reports a pilot run without applying verdicts', () => {
    const paired = pairedEngineVsBaseline([5, 5], [15, 15]);
    const gates = evaluateGates(paired, 2, 12, false);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.label).toBe('pilot');
    expect(gates[0]!.holds).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Roster legality + integrity (never silently drop)
// ---------------------------------------------------------------------------

describe('isLegalPick / pickBestLegal', () => {
  it('respects the pre-declared per-position caps and the 16-round roster size', () => {
    const qb = player('qb', 'QB');
    const rb = player('rb', 'RB');
    const twoQbRoster = [player('qb1', 'QB'), player('qb2', 'QB')];
    expect(isLegalPick(qb, twoQbRoster)).toBe(false); // QB cap 2 already reached
    expect(isLegalPick(rb, twoQbRoster)).toBe(true);
    expect(isLegalPick(qb, [player('qb1', 'QB')])).toBe(true);
    const fullRoster = Array.from({ length: 16 }, (_, i) => player(`p${i}`, i % 2 ? 'RB' : 'WR'));
    expect(isLegalPick(qb, fullRoster)).toBe(false);
  });

  it('pickBestLegal returns the first legal player in ranking order', () => {
    const qb1 = player('qb1', 'QB');
    const qb2 = player('qb2', 'QB');
    const rb1 = player('rb1', 'RB');
    const roster = [player('qbA', 'QB'), player('qbB', 'QB')];
    expect(pickBestLegal([qb1, qb2, rb1], roster)?.playerId).toBe('rb1');
    expect(pickBestLegal([qb1, qb2], [])?.playerId).toBe('qb1');
    expect(pickBestLegal([qb1], Array.from({ length: 16 }, (_, i) => player(`p${i}`, 'RB')))).toBeNull();
  });
});

describe('resolveFfcRowSleeperId / ffcRowsToAdpEntries / verifyBacktestIntegrity', () => {
  const hollywood: FfcAdpRow = {
    player_id: 3249, name: 'Hollywood Brown', position: 'WR', team: 'FA', adp: 140.5,
    sleeperId: null,
  };
  const normal: FfcAdpRow = {
    player_id: 5177, name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 1.5,
    stdev: 0.8, bye: 6, sleeperId: '7564',
  };

  it('hand-maps Hollywood Brown to Marquise Brown (5848) and passes through verbatim rows', () => {
    expect(resolveFfcRowSleeperId(hollywood)).toBe('5848');
    expect(resolveFfcRowSleeperId(normal)).toBe('7564');
    const entries = ffcRowsToAdpEntries([normal, hollywood]);
    expect(entries.map((e) => e.playerId)).toEqual(['7564', '5848']);
    expect(entries[0]).toMatchObject({ adp: 1.5, stdev: 0.8, byeWeek: 6, adpSource: 'ffc', stdevSource: 'observed' });
  });

  it('verifyBacktestIntegrity records hand-maps and zero-outcome ids, flags unresolvable rows', () => {
    const inputs: BacktestInputs = {
      players: [player('7564', 'WR'), player('5848', 'WR')],
      projections: [],
      adp: [],
      weekly: makeWeekly(
        { '7564': 'WR', '5848': 'WR' },
        { '7564': [[1, 10]] }, // 5848 has no rows
      ),
    };
    const integrity = verifyBacktestIntegrity([normal, hollywood, { ...normal, player_id: 9999, name: 'Ghost', sleeperId: null }], inputs);
    expect(integrity.ffcRows).toBe(3);
    expect(integrity.resolved).toBe(2);
    expect(integrity.handMapped).toEqual([
      { ffcPlayerId: '3249', ffcName: 'Hollywood Brown', sleeperId: '5848', sleeperName: '5848' },
    ]);
    expect(integrity.zeroOutcomeIds).toEqual(['5848']);
    expect(integrity.unresolvedRows).toEqual(['Ghost (WR)']);
    expect(integrity.missingFromPlayersJson).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Aggregators + deterministic seeds
// ---------------------------------------------------------------------------

describe('aggregators and seeds', () => {
  it('mean and percentile follow the nearest-rank convention', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.10)).toBe(1);
    expect(percentile(sorted, 0.50)).toBe(5);
    expect(percentile(sorted, 1.0)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('draft seeds are deterministic and distinct across (slot, seedIndex)', () => {
    expect(draftSeedFor(3, 5)).toBe(draftSeedFor(3, 5));
    expect(draftSeedFor(3, 5)).not.toBe(draftSeedFor(4, 5));
    expect(draftSeedFor(3, 5)).not.toBe(draftSeedFor(3, 6));
  });

  it('replacementAdjustedPoints subtracts the full-lineup season baseline once', () => {
    const positions: Record<string, Position> = {
      qb1: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR', wr2: 'WR', te1: 'TE', wr3: 'WR', k1: 'K', def1: 'DEF', rb3: 'RB',
    };
    const inputs: BacktestInputs = {
      players: Object.keys(positions).map((id) => player(id, positions[id]!)),
      projections: [
        { playerId: 'qb1', source: 'fftoday', stats: { pass_yd: 4000, pass_td: 30 } },
        { playerId: 'rb1', source: 'fftoday', stats: { rush_yd: 1000, rec: 40 } },
        { playerId: 'wr3', source: 'fftoday', stats: { rec: 80, rec_yd: 1000 } },
      ],
      adp: [],
      weekly: makeWeekly({}, {}),
    };
    const ctx = buildBacktestContext(inputs);
    // Baseline > 0 (QB projection scores) so the subtraction is exercised. The baseline is a
    // season-projection total for one full lineup — subtracted once, not per week.
    expect(ctx.replacementLineupBaseline).toBeGreaterThan(0);
    expect(replacementAdjustedPoints(ctx, [100, 100])).toBe(200 - ctx.replacementLineupBaseline);
  });
});

