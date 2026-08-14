import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerId, PlayerMeta, Position, SeasonProjection } from '../../../shared/types';
import type { SimulationInput, SimulationResult } from './simulate';

const runSimulationMock = vi.hoisted(() => vi.fn());
vi.mock('./simulate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulate')>();
  return { ...actual, runSimulation: runSimulationMock };
});

import { buildRecommendationBoard, buildRolloutPool, clearSimulationCache, type Recommendation } from './recommend';

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'stage-c', name: 'Stage C', season: '2026', teams: 4,
  startingSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 2 },
  scoring: { points: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
function player(playerId: string, position: Position): PlayerMeta {
  return { playerId, name: playerId, position, eligiblePositions: [position], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
}

const players = positions.flatMap((position) => Array.from({ length: 4 }, (_, index) => player(position.toLowerCase() + '-' + (index + 1), position)));
const points: Record<Position, number> = { QB: 80, RB: 100, WR: 90, TE: 70, K: 30, DEF: 20 };
const projections: SeasonProjection[] = players.map((entry, index) => ({
  playerId: entry.playerId, source: 'test', stats: { points: points[entry.position!] - (index % 4) * 5 },
}));
const adp: AdpEntry[] = players.map((entry, index) => ({
  playerId: entry.playerId, name: entry.name, position: entry.position ?? '', team: null,
  adp: index + 1, stdev: 3, high: index, low: index + 5, timesDrafted: 100,
  byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
}));
const simulation = {
  draftId: 'stage-c-draft',
  draftType: 'snake' as const,
  teams: 4,
  rounds: 4,
  slotToTeam: { 1: 'me', 2: 't2', 3: 't3', 4: 't4' },
  decisionPick: 1,
  followUpPick: 8,
  executionMode: { mode: 'fixed' as const, scenarios: 12 },
};

function mockResult(input: SimulationInput, timedOut = false): SimulationResult {
  return {
    diagnostics: { scenariosRun: input.followUpPick == null ? 0 : input.executionMode.scenarios, timedOut, elapsedMs: 1, syntheticAdpCount: 0, unscoredPositionCount: 0 },
    candidates: input.candidates.map((candidate) => {
      // Deliberately reverse the two top RBs from their deterministic points/S2 order.
      const lookaheadValue = candidate.playerId === 'rb-2' ? 100 : candidate.playerId === 'rb-1' ? 99.5 : 40;
      return {
        playerId: candidate.playerId,
        expectedFinalStarterValue: lookaheadValue,
        lookaheadValue,
        vona: lookaheadValue - 10,
        downside: lookaheadValue - 2,
        simulatedSurvivalProbability: candidate.playerId === 'rb-1' ? 0.25 : 0.75,
      };
    }),
  };
}

function board(overrides: Partial<Parameters<typeof buildRecommendationBoard>[0]> = {}) {
  return buildRecommendationBoard({
    settings, players, projections, adp, picks: [], myTeamId: 'me',
    currentPick: 1, nextPick: 8, limit: 2,
    ...overrides,
  });
}

function recommendation(playerId: PlayerId, marginalRosterValue = 1): Recommendation {
  return {
    playerId, rank: 0, projectedPoints: 1, marginalRosterValue,
    marginalRosterUtility: marginalRosterValue, expectedFollowUpValue: 0,
    planValue: marginalRosterValue, planningHorizon: 0, replacementAdjustedValue: 1,
    replacementLevelPoints: 0, vor: 0, vona: null, vonaSource: 'unavailable',
    lookaheadValue: null, downside: null, simulatedSurvivalProbability: null,
    benchDepthValue: 0, recommendationMode: 'starter', rankingBasis: 'rosterUtility',
    deprioritized: false, tier: 1, tierGapAfter: 0,
    tierBoundaryGap: 0, tierUrgency: 0, availableNextPickProbability: null, availabilityAdp: null,
    availabilityAdpHigh: null, availabilityAdpLow: null, availabilityStdev: null, availabilitySampleSize: null,
    nearTie: false, scoringDiagnosticSeverity: 'none', missingScoringKeys: [], confidence: 'high',
    assignedRosterSlot: null, replacementPlayerId: null,
    pickAction: 'take-now',
    reasons: [], warnings: [],
  };
}

beforeEach(() => {
  clearSimulationCache();
  runSimulationMock.mockReset();
  runSimulationMock.mockImplementation((input: SimulationInput) => mockResult(input));
});
afterEach(clearSimulationCache);

describe('buildRolloutPool', () => {
  it('unions global leaders with positive-MRV skill leaders, excludes K/DEF extensions, and preserves S2 order', () => {
    const ordered = [
      recommendation('k-1'), recommendation('rb-1'), recommendation('def-1'),
      recommendation('qb-2'), recommendation('rb-2'), recommendation('wr-2'),
      recommendation('te-2'), recommendation('qb-1', 0), recommendation('wr-1', 0), recommendation('te-1', 0),
    ];
    const meta = new Map([
      ['k-1', player('k-1', 'K')], ['rb-1', player('rb-1', 'RB')], ['def-1', player('def-1', 'DEF')],
      ['qb-2', player('qb-2', 'QB')], ['rb-2', player('rb-2', 'RB')], ['wr-2', player('wr-2', 'WR')],
      ['te-2', player('te-2', 'TE')], ['qb-1', player('qb-1', 'QB')], ['wr-1', player('wr-1', 'WR')], ['te-1', player('te-1', 'TE')],
    ]);
    // Global shortlist of 2 keeps k-1/rb-1; the position extension adds only positive-MRV
    // skill leaders. K/DEF remain absent from extensions, and (with displayLimit 0 here) zero-MRV
    // rows are not quota-fillers either — see recommendStageC.test.ts for the nonzero-displayLimit
    // backfill behavior.
    const result = buildRolloutPool(ordered, meta, 2, 0);
    expect(result.map((entry) => entry.playerId)).toEqual(['k-1', 'rb-1', 'qb-2', 'rb-2', 'wr-2', 'te-2']);
  });
});

describe('Stage C recommendation wiring', () => {
  it('caps only per-candidate replays while preserving the full opponent pool', () => {
    board({ simulation, simulationCandidateLimit: 3 });

    const input = runSimulationMock.mock.calls[0]?.[0] as SimulationInput;
    expect(input.candidates).toHaveLength(3);
    expect(input.remainingPlayers).toHaveLength(players.length);
    expect(input.remainingPlayers.length).toBeGreaterThan(input.candidates.length);
  });

  it('keeps no-simulation boards display-scoped, while simulation widens once and shares the same pool across tabs', () => {
    const s2Rb = board({ displayPosition: 'RB' });
    const s2Wr = board({ displayPosition: 'WR' });
    expect(s2Rb.recommendations.every((entry) => entry.playerId.startsWith('rb-'))).toBe(true);
    expect(s2Wr.recommendations.every((entry) => entry.playerId.startsWith('wr-'))).toBe(true);
    expect(s2Rb.recommendations.map((entry) => entry.playerId)).toEqual(['rb-1', 'rb-2']);
    expect(s2Rb.diagnostics.simulation).toBeNull();

    const rb = board({ displayPosition: 'RB', simulation });
    const wr = board({ displayPosition: 'WR', simulation });
    expect(rb.diagnostics.candidatesEvaluated).toBe(24);
    expect(wr.diagnostics.candidatesEvaluated).toBe(24);
    expect(runSimulationMock).toHaveBeenCalledTimes(1);
    expect(rb.recommendations.map((entry) => entry.playerId).slice(0, 2)).toEqual(['rb-1', 'rb-2']);
    expect(rb.recommendations.every((entry) => entry.lookaheadValue != null)).toBe(true);
    expect(wr.recommendations.every((entry) => entry.lookaheadValue != null)).toBe(true);
  });

  it('declines an off-clock simulation request rather than skipping intervening opponent picks', () => {
    const s2 = board({ displayPosition: 'RB', currentPick: 2 });
    const offClock = board({
      displayPosition: 'RB',
      currentPick: 2,
      simulation: { ...simulation, decisionPick: 5, followUpPick: 8 },
    });

    expect(runSimulationMock).not.toHaveBeenCalled();
    expect(offClock.diagnostics.simulation).toBeNull();
    expect(offClock.recommendations.map((entry) => entry.playerId)).toEqual(s2.recommendations.map((entry) => entry.playerId));
  });

  it('falls back to the unchanged S2 board for an explicit zero-scenario request with a follow-up', () => {
    const s2 = board({ displayPosition: 'RB' });
    const fallback = board({ displayPosition: 'RB', simulation: { ...simulation, executionMode: { mode: 'fixed', scenarios: 0 } } });
    expect(fallback.recommendations.map((entry) => entry.playerId)).toEqual(s2.recommendations.map((entry) => entry.playerId));
    expect(fallback.recommendations.every((entry) => entry.lookaheadValue == null)).toBe(true);
    expect(fallback.diagnostics.simulation).toBeNull();
    expect(runSimulationMock).not.toHaveBeenCalled();
  });

  it('keeps the null-follow-up final-pick collapse, including null availability and populated lookahead fields', () => {
    const finalPick = board({
      displayPosition: 'RB',
      currentPick: 16,
      nextPick: null,
      simulation: { ...simulation, decisionPick: 16, followUpPick: null },
    });
    expect(finalPick.diagnostics.simulation?.scenariosRun).toBe(0);
    expect(finalPick.recommendations.every((entry) => entry.lookaheadValue != null && entry.vona == null)).toBe(true);
    expect(finalPick.recommendations.every((entry) => entry.planningHorizon === 0)).toBe(true);
    expect(finalPick.recommendations.every((entry) => entry.availableNextPickProbability == null && entry.availabilityAdp == null)).toBe(true);
  });

  it('keeps K/DEF unsimulated and does not use rollout lookahead for skill near ties', () => {
    const simulated = board({ displayPosition: 'RB', simulation });
    expect(simulated.recommendations.map((entry) => entry.nearTie)).toEqual([false, false]);
    const kicker = board({ displayPosition: 'K', simulation });
    expect(kicker.recommendations.every((entry) => entry.lookaheadValue == null && entry.vona == null)).toBe(true);
  });

  it('does not let rollout lookahead perturb plan-value near ties', () => {
    const resultWithValues = (input: SimulationInput, rb1Value: number): SimulationResult => {
      const result = mockResult(input);
      return {
        ...result,
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          lookaheadValue: candidate.playerId === 'rb-2' ? 500 : candidate.playerId === 'rb-1' ? rb1Value : candidate.lookaheadValue,
        })),
      };
    };
    runSimulationMock.mockImplementation((input: SimulationInput) => resultWithValues(input, 495));
    expect(board({ displayPosition: 'RB', simulation }).recommendations.map((entry) => entry.nearTie)).toEqual([false, false]);

    clearSimulationCache();
    runSimulationMock.mockImplementation((input: SimulationInput) => resultWithValues(input, 494.9));
    expect(board({ displayPosition: 'RB', simulation }).recommendations.map((entry) => entry.nearTie)).toEqual([false, false]);
  });

  it('switches skill rows to bench-depth ordering (not lookahead) once core slots are filled, even while a kicker is due', () => {
    // `startingSlots: ['K']` means every non-K/DEF slot is vacuously "filled" (there are none), so
    // `coreStartingSlotsFilled` is true from the first call — bench mode engages immediately. Stage C
    // still runs and still populates `lookaheadValue` on every skill row (for the explanation UI and
    // the future benchmark harness), it just stops being the sort key — see eligibility.ts's
    // `benchDepthValue` doc and recommend.ts's `useLookaheadSort`/`rankingBasis` for why.
    const dueKSettings: LeagueSettings = {
      ...settings,
      startingSlots: ['K'],
      rosterSlots: { K: 1, BN: 1 },
    };
    const result = board({
      settings: dueKSettings,
      currentPick: 1,
      nextPick: null,
      limit: 14,
      displayPosition: null,
      draftRounds: 1,
      rosterSpotsPerTeam: 1,
      simulation: { ...simulation, decisionPick: 1, followUpPick: null },
    });
    const skillRows = result.recommendations.filter((entry) => /^(qb|rb|wr|te)-/.test(entry.playerId));

    expect(result.diagnostics.specialTeamsDraft.due).toContain('K');
    expect(result.diagnostics.coreStartingSlotsFilled).toBe(true);
    // A due K/DEF stays the highest-priority override regardless of bench mode — dispositionSortClass
    // ('due' = 0) is compared before any value term, bench-depth included.
    expect(result.recommendations[0]?.playerId).toBe('k-1');
    // Stage C's simulation still ran and still populated lookaheadValue — it just isn't the sort key.
    expect(skillRows.every((entry) => entry.lookaheadValue != null)).toBe(true);
    expect(skillRows.every((entry) => entry.recommendationMode === 'bench')).toBe(true);
    expect(skillRows.every((entry) => entry.rankingBasis !== 'planValue')).toBe(true);
    expect(result.recommendations.find((entry) => entry.playerId === 'k-1')?.lookaheadValue).toBeNull();
  });

  it('surfaces a truncated rollout while retaining its positive-scenario simulated board', () => {
    runSimulationMock.mockImplementation((input: SimulationInput) => ({
      ...mockResult(input, true),
      diagnostics: { ...mockResult(input, true).diagnostics, scenariosRun: 5 },
    }));
    const result = board({ displayPosition: 'RB', simulation });
    expect(result.diagnostics.simulation).toMatchObject({ scenariosRun: 5, timedOut: true });
    expect(result.recommendations[0]?.warnings.some((warning) => warning.includes('Rollout truncated after 5/12 scenarios'))).toBe(true);
  });

  it('cache keys distinguish picks, scores, settings, ADP, opponent config, modes, and an explicit clear', () => {
    board({ simulation });
    board({ simulation, displayPosition: 'WR' });
    expect(runSimulationMock).toHaveBeenCalledTimes(1);

    board({ simulation, picks: [{ overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb-4', providerPlayerId: 'rb-4' }] });
    board({ simulation, projections: projections.map((projection) => projection.playerId === 'rb-3' ? { ...projection, stats: { points: 999 } } : projection) });
    board({ simulation: { ...simulation, executionMode: { mode: 'budgeted', scenarios: 12, timeBudgetMs: 50, batchSize: 1 } } });
    board({ simulation, settings: { ...settings, scoring: { points: 2 } } });
    board({ simulation, adp: adp.map((entry) => entry.playerId === 'rb-3' ? { ...entry, adp: 99 } : entry) });
    board({ simulation: { ...simulation, opponentConfig: { shockScale: 0.5, needBonusCap: 8, candidateWindow: 60, fallbackStdev: 8, syntheticStep: 0.5, noAdpAtAllFallback: 16 } } });
    expect(runSimulationMock).toHaveBeenCalledTimes(7);

    clearSimulationCache();
    board({ simulation });
    expect(runSimulationMock).toHaveBeenCalledTimes(8);
  });

  it('invalidates a rollout cache entry when ADP changes for a drafted board player', () => {
    const picks = [{ overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb-4', providerPlayerId: 'rb-4' }];
    board({ simulation, picks });
    board({
      simulation,
      picks,
      adp: adp.map((entry) => entry.playerId === 'rb-4' ? { ...entry, stdev: 99 } : entry),
    });

    expect(runSimulationMock).toHaveBeenCalledTimes(2);
  });
});
