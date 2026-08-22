/**
 * Unit coverage for `simSortChoice` and the aggregation/threshold functions in `simSortProbe.ts`.
 * The probe driver itself (`runSimSortProbeDraft`) needs real fixtures and is exercised only by the
 * opt-in `simSortProbe.bench.ts`, mirroring `backtest.test.ts`'s split with `backtest.bench.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerId, PlayerMeta, Position } from '../../../shared/types';
import type { Recommendation, RecommendationResult } from './recommend';
import {
  SIM_SORT_BUILD_ARM_THRESHOLDS,
  shouldBuildSimSortArm,
  simSortChoice,
  spearmanPlanValueVsLookahead,
  summarizeSimSortProbe,
  type SimSortObservation,
} from './simSortProbe';

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

function rec(overrides: Partial<Recommendation> & { playerId: PlayerId }): Recommendation {
  return {
    rank: 1,
    projectedPoints: 0,
    marginalRosterValue: 0,
    marginalRosterUtility: 0,
    expectedFollowUpValue: 0,
    planValue: 0,
    planningHorizon: 1,
    replacementAdjustedValue: 0,
    replacementLevelPoints: 0,
    vor: 0,
    vona: null,
    vonaSource: 'analytic',
    lookaheadValue: null,
    downside: null,
    simulatedSurvivalProbability: null,
    benchDepthValue: 0,
    recommendationMode: 'starter',
    rankingBasis: 'planValue',
    deprioritized: false,
    tier: 1,
    tierGapAfter: 0,
    tierBoundaryGap: 0,
    tierUrgency: 0,
    availableNextPickProbability: null,
    availabilityAdp: null,
    availabilityAdpHigh: null,
    availabilityAdpLow: null,
    availabilityStdev: null,
    availabilitySampleSize: null,
    nearTie: false,
    scoringDiagnosticSeverity: 'none',
    missingScoringKeys: [],
    confidence: 'high',
    assignedRosterSlot: null,
    replacementPlayerId: null,
    pickAction: 'take-now',
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

function result(recommendations: Recommendation[], analysisRows?: Recommendation[]): RecommendationResult {
  return {
    recommendations,
    hasMoreRecommendations: false,
    marketRecommendations: [],
    diagnostics: {
      unmatchedPickCount: 0,
      unmatchedPickOveralls: [],
      candidatesEvaluated: recommendations.length,
      replacementLevels: [],
      positionalDemand: { byPosition: new Map(), source: 'adp', rosterSpots: 0, usableRows: 0 },
      coreStartingSlotsFilled: false,
      specialTeamsDraft: {
        draftRounds: null, teamPicksMade: null, remainingPicks: null,
        configured: { K: 1, DEF: 1 }, rostered: { K: 0, DEF: 0 }, remaining: { K: 1, DEF: 1 },
        due: [], overdue: [], impossibleToFill: false,
      },
      simulation: null,
    },
    ...(analysisRows ? {
      analysis: {
        deterministicRows: analysisRows,
        simulatedRows: analysisRows,
        deterministicCandidateCount: analysisRows.length,
        simulatedCandidateCount: analysisRows.filter((r) => r.simulatedSurvivalProbability != null).length,
        rolloutPoolSize: analysisRows.length,
      },
    } : {}),
  };
}

const playersById = new Map<PlayerId, PlayerMeta>([
  ['rb1', player('rb1', 'RB')],
  ['rb2', player('rb2', 'RB')],
  ['wr1', player('wr1', 'WR')],
  ['k1', player('k1', 'K')],
  ['def1', player('def1', 'DEF')],
]);

describe('simSortChoice', () => {
  it('defers to the production top pick when it is K/DEF, regardless of lookahead', () => {
    const rows = [
      rec({ playerId: 'k1', planValue: 100, lookaheadValue: 1 }),
      rec({ playerId: 'rb1', planValue: 50, lookaheadValue: 999 }),
    ];
    const choice = simSortChoice(result(rows, rows), playersById);
    expect(choice).toEqual({ playerId: 'k1', basis: 'special-teams-deferred' });
  });

  it('defers to the production top pick when no row has a lookaheadValue', () => {
    const rows = [
      rec({ playerId: 'rb1', planValue: 100, lookaheadValue: null }),
      rec({ playerId: 'wr1', planValue: 90, lookaheadValue: null }),
    ];
    const choice = simSortChoice(result(rows, rows), playersById);
    expect(choice).toEqual({ playerId: 'rb1', basis: 'no-lookahead' });
  });

  it('picks the max-lookahead non-K/DEF row when lookahead values are present', () => {
    const rows = [
      rec({ playerId: 'rb1', planValue: 100, lookaheadValue: 5 }),
      rec({ playerId: 'wr1', planValue: 90, lookaheadValue: 12 }),
      rec({ playerId: 'k1', planValue: 80, lookaheadValue: 999 }), // excluded: K
    ];
    const choice = simSortChoice(result(rows, rows), playersById);
    expect(choice).toEqual({ playerId: 'wr1', basis: 'lookahead' });
  });

  it('breaks lookahead ties by planValue desc, then playerId asc, deterministically', () => {
    const rows = [
      rec({ playerId: 'wr1', planValue: 40, lookaheadValue: 10 }),
      rec({ playerId: 'rb2', planValue: 60, lookaheadValue: 10 }),
      rec({ playerId: 'rb1', planValue: 60, lookaheadValue: 10 }),
    ];
    const choice = simSortChoice(result(rows, rows), playersById);
    // rb1 and rb2 tie on lookahead(10) and planValue(60); playerId asc picks rb1.
    expect(choice).toEqual({ playerId: 'rb1', basis: 'lookahead' });
  });

  it('throws when includeAnalysisRows was not requested', () => {
    const rows = [rec({ playerId: 'rb1', planValue: 100 })];
    expect(() => simSortChoice(result(rows), playersById)).toThrow(/includeAnalysisRows/);
  });

  it('throws when there is no recommendation to choose from', () => {
    expect(() => simSortChoice(result([], []), playersById)).toThrow(/empty/);
  });
});

describe('spearmanPlanValueVsLookahead', () => {
  it('returns 1 when the two orderings agree exactly', () => {
    const rows = [
      rec({ playerId: 'rb1', planValue: 100, lookaheadValue: 50 }),
      rec({ playerId: 'wr1', planValue: 90, lookaheadValue: 40 }),
      rec({ playerId: 'rb2', planValue: 80, lookaheadValue: 30 }),
    ];
    expect(spearmanPlanValueVsLookahead(rows)).toBeCloseTo(1, 10);
  });

  it('returns -1 when the two orderings are exact reverses', () => {
    const rows = [
      rec({ playerId: 'rb1', planValue: 100, lookaheadValue: 10 }),
      rec({ playerId: 'wr1', planValue: 90, lookaheadValue: 20 }),
      rec({ playerId: 'rb2', planValue: 80, lookaheadValue: 30 }),
    ];
    expect(spearmanPlanValueVsLookahead(rows)).toBeCloseTo(-1, 10);
  });

  it('returns null with fewer than two comparable rows', () => {
    expect(spearmanPlanValueVsLookahead([rec({ playerId: 'rb1', lookaheadValue: 1 })])).toBeNull();
    expect(spearmanPlanValueVsLookahead([
      rec({ playerId: 'rb1', lookaheadValue: null }),
      rec({ playerId: 'wr1', lookaheadValue: null }),
    ])).toBeNull();
  });
});

function observation(overrides: Partial<SimSortObservation>): SimSortObservation {
  return {
    slot: 1,
    seedIndex: 0,
    overall: 1,
    round: 1,
    enginePickId: 'rb1',
    simPickId: 'rb1',
    agree: true,
    basis: 'lookahead',
    enginePickHasAdp: true,
    simPickHasAdp: true,
    deltaRank: 0,
    lookaheadOfEnginePick: 10,
    planValueOfSimPick: 10,
    simulatedCandidateCount: 10,
    spearman: 1,
    ...overrides,
  };
}

describe('summarizeSimSortProbe / shouldBuildSimSortArm', () => {
  it('reports zero disagreement and does not recommend building the arm when every pick agrees', () => {
    const observations = Array.from({ length: 20 }, (_, i) => observation({ round: 1 + (i % 16), overall: i + 1 }));
    const report = summarizeSimSortProbe(observations);
    expect(report.overall.disagreementRate).toBe(0);
    expect(shouldBuildSimSortArm(report)).toBe(false);
  });

  it('recommends building the arm once overall disagreement crosses the pre-declared threshold', () => {
    const total = 100;
    const disagreements = Math.ceil(total * SIM_SORT_BUILD_ARM_THRESHOLDS.overallTop1DisagreementRate);
    const observations = Array.from({ length: total }, (_, i) => observation({
      overall: i + 1,
      round: 1,
      agree: i >= disagreements,
      simPickId: i < disagreements ? 'wr1' : 'rb1',
    }));
    const report = summarizeSimSortProbe(observations);
    expect(report.overall.disagreementRate).toBeGreaterThanOrEqual(SIM_SORT_BUILD_ARM_THRESHOLDS.overallTop1DisagreementRate);
    expect(shouldBuildSimSortArm(report)).toBe(true);
  });

  it('recommends building the arm when only a late-round band crosses its threshold, even if the overall rate does not', () => {
    // 4 early-round picks (rounds 1-3), all agree; 4 late-round picks (round 13), all disagree.
    // Overall disagreement = 4/8 = 50%... to isolate the band-only trigger, pad with agreeing picks
    // across other bands so the overall rate stays below 5% while round 13-16 stays above 10%.
    const agreeingPadding = Array.from({ length: 200 }, (_, i) => observation({ overall: i + 1, round: 1 + (i % 8) }));
    const lateDisagreements = Array.from({ length: 3 }, (_, i) => observation({
      overall: 1000 + i, round: 13, agree: false, simPickId: 'wr1',
    }));
    const observations = [...agreeingPadding, ...lateDisagreements];
    const report = summarizeSimSortProbe(observations);
    expect(report.overall.disagreementRate).toBeLessThan(SIM_SORT_BUILD_ARM_THRESHOLDS.overallTop1DisagreementRate);
    const lateBand = report.byRoundBand.find((b) => b.band.label === '13-16')!;
    expect(lateBand.bucket.disagreementRate).toBeGreaterThanOrEqual(SIM_SORT_BUILD_ARM_THRESHOLDS.roundBandDisagreementRate);
    expect(shouldBuildSimSortArm(report)).toBe(true);
  });

  it('counts basis categories and excludes them from meanDeltaRank/meanSpearman when null', () => {
    const observations = [
      observation({ basis: 'special-teams-deferred', deltaRank: 0, spearman: null }),
      observation({ basis: 'no-lookahead', deltaRank: 0, spearman: null }),
      observation({ basis: 'lookahead', deltaRank: 2, spearman: 0.5 }),
    ];
    const report = summarizeSimSortProbe(observations);
    expect(report.basisCounts).toEqual({ lookahead: 1, 'special-teams-deferred': 1, 'no-lookahead': 1 });
    expect(report.overall.meanSpearman).toBeCloseTo(0.5, 10);
    expect(report.totalObservations).toBe(3);
  });
});
