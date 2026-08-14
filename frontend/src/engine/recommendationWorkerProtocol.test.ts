import { describe, expect, it } from 'vitest';
import type { Recommendation, RecommendationResult } from './recommend';
import { applyStageCPatch, toStageCPatch } from './recommendationWorkerProtocol';

function rec(playerId: string, planValue: number): Recommendation {
  return {
    playerId, rank: 1, projectedPoints: 10, marginalRosterValue: 1, marginalRosterUtility: 1,
    expectedFollowUpValue: 0, planValue, planningHorizon: 0, replacementAdjustedValue: 1,
    replacementLevelPoints: 0, vor: 1, vona: null, vonaSource: 'unavailable', lookaheadValue: null,
    downside: null, simulatedSurvivalProbability: null, benchDepthValue: 0, recommendationMode: 'starter',
    rankingBasis: 'rosterUtility', deprioritized: false, tier: 1, tierGapAfter: 0, tierBoundaryGap: 0,
    tierUrgency: 0, availableNextPickProbability: null, availabilityAdp: null, availabilityAdpHigh: null,
    availabilityAdpLow: null, availabilityStdev: null, availabilitySampleSize: null, nearTie: false,
    scoringDiagnosticSeverity: 'none', missingScoringKeys: [], confidence: 'high', assignedRosterSlot: 'RB',
    replacementPlayerId: null, pickAction: 'take-now', reasons: ['s2'], warnings: [],
  };
}

describe('Stage C worker patch', () => {
  it('replaces displayed rows and simulation diagnostics without copying a market board', () => {
    const s2 = {
      recommendations: [rec('a', 1), rec('b', 2)],
      hasMoreRecommendations: false,
      marketRecommendations: [],
      diagnostics: {
        unmatchedPickCount: 0, unmatchedPickOveralls: [], candidatesEvaluated: 2,
        replacementLevels: [], positionalDemand: { byPosition: new Map(), source: 'default-mix', rosterSpots: 1, usableRows: 0 },
        coreStartingSlotsFilled: false,
        specialTeamsDraft: {
          draftRounds: 1, teamPicksMade: 0, remainingPicks: 1,
          configured: { K: 0, DEF: 0 }, rostered: { K: 0, DEF: 0 }, remaining: { K: 0, DEF: 0 },
          due: [], overdue: [], impossibleToFill: false,
        },
        simulation: null,
      },
    } as RecommendationResult;
    const refined = {
      ...s2,
      recommendations: [{ ...rec('b', 9), planningHorizon: 1 as const, rank: 1, reasons: ['stageC'] }],
      diagnostics: {
        ...s2.diagnostics,
        simulation: { scenariosRun: 8, timedOut: false, elapsedMs: 3, syntheticAdpCount: 0, unscoredPositionCount: 0 },
      },
    };
    const patch = toStageCPatch(refined);
    expect(patch.recommendations).toHaveLength(1);
    expect(patch.simulation?.scenariosRun).toBe(8);
    const applied = applyStageCPatch(s2, patch);
    expect(applied.recommendations[0]?.playerId).toBe('b');
    expect(applied.recommendations[0]?.reasons).toEqual(['stageC']);
    expect(applied.diagnostics.simulation?.scenariosRun).toBe(8);
    expect(applied.marketRecommendations).toEqual([]);
  });
});
