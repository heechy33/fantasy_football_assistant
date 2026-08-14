import { afterEach, describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerMeta, Position, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard, buildRolloutPool, clearSimulationCache, type Recommendation } from './recommend';

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'stage-c', name: 'Stage C', season: '2026', teams: 4,
  startingSlots: ['QB', 'RB', 'WR', 'FLEX'],
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 4 },
  scoring: { bonus: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function player(playerId: string, position: Position): PlayerMeta {
  return {
    playerId, name: playerId, position, eligiblePositions: [position], team: 'SEA',
    byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {},
  };
}

const players: PlayerMeta[] = [
  player('qb1', 'QB'), player('qb2', 'QB'),
  player('rb1', 'RB'), player('rb2', 'RB'), player('rb3', 'RB'), player('rb4', 'RB'),
  player('wr1', 'WR'), player('wr2', 'WR'), player('wr3', 'WR'), player('wr4', 'WR'),
  player('te1', 'TE'), player('te2', 'TE'),
  player('k1', 'K'), player('def1', 'DEF'),
];

const points = new Map(players.map((entry, index) => [entry.playerId, 120 - index * 3]));
const projections: SeasonProjection[] = players.map((entry) => ({
  playerId: entry.playerId, source: 'fftoday', stats: { bonus: points.get(entry.playerId) ?? 0 },
}));
const adp: AdpEntry[] = players.map((entry, index) => ({
  playerId: entry.playerId, name: entry.name, position: entry.position ?? '', team: entry.team,
  adp: index + 1.5, stdev: 2, high: index + 1, low: index + 20,
  timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
}));
const slotToTeam = { 1: 'me', 2: 't2', 3: 't3', 4: 't4' };

afterEach(() => {
  clearSimulationCache();
});

describe('buildRolloutPool', () => {
  it('unions global leaders with up to two positive-MRV skill leaders per position', () => {
    const ordered: Recommendation[] = players.map((entry, index) => ({
      playerId: entry.playerId,
      rank: index + 1,
      projectedPoints: points.get(entry.playerId) ?? 0,
      marginalRosterValue: entry.position === 'K' || entry.position === 'DEF' ? 0 : 10 - index * 0.1,
      marginalRosterUtility: entry.position === 'K' || entry.position === 'DEF' ? 0 : 10 - index * 0.1,
      expectedFollowUpValue: 0,
      planValue: entry.position === 'K' || entry.position === 'DEF' ? 0 : 10 - index * 0.1,
      planningHorizon: 0,
      replacementAdjustedValue: 10 - index * 0.1,
      replacementLevelPoints: 0,
      vor: 0,
      vona: null,
      vonaSource: 'unavailable',
      lookaheadValue: null,
      downside: null,
      simulatedSurvivalProbability: null,
      benchDepthValue: 0,
      recommendationMode: 'starter',
      rankingBasis: 'rosterUtility',
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
      assignedRosterSlot: entry.position,
      replacementPlayerId: null,
      pickAction: 'take-now',
      reasons: [],
      warnings: [],
    }));
    const playersById = new Map(players.map((entry) => [entry.playerId, entry]));
    // With a tiny global shortlist, per-position coverage must still pull two positive-MRV skill leaders.
    const pool = buildRolloutPool(ordered, playersById, 1, 2);
    expect(pool[0]?.playerId).toBe('qb1');
    expect(pool.filter((entry) => playersById.get(entry.playerId)?.position === 'RB').map((entry) => entry.playerId))
      .toEqual(['rb1', 'rb2']);
    expect(pool.filter((entry) => playersById.get(entry.playerId)?.position === 'WR').map((entry) => entry.playerId))
      .toEqual(['wr1', 'wr2']);
    // K/DEF are never added by the per-position extension.
    expect(pool.some((entry) => entry.playerId === 'k1' || entry.playerId === 'def1')).toBe(false);
  });

  it('does not add non-positive positional top-N entries outside the global leaders when displayLimit is 0', () => {
    const ordered: Recommendation[] = players.map((entry, index) => ({
      playerId: entry.playerId,
      rank: index + 1,
      projectedPoints: points.get(entry.playerId) ?? 0,
      marginalRosterValue: entry.position === 'QB' ? 0 : 10,
      marginalRosterUtility: entry.position === 'QB' ? 0 : 10,
      expectedFollowUpValue: 0,
      planValue: entry.position === 'QB' ? 0 : 10,
      planningHorizon: 0,
      replacementAdjustedValue: 10,
      replacementLevelPoints: 0,
      vor: 0,
      vona: null,
      vonaSource: 'unavailable',
      lookaheadValue: null,
      downside: null,
      simulatedSurvivalProbability: null,
      benchDepthValue: 0,
      recommendationMode: 'starter',
      rankingBasis: 'rosterUtility',
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
      assignedRosterSlot: entry.position,
      replacementPlayerId: null,
      pickAction: 'take-now',
      reasons: [],
      warnings: [],
    }));
    const playersById = new Map(players.map((entry) => [entry.playerId, entry]));

    const pool = buildRolloutPool(ordered, playersById, 1, 0);

    expect(pool.map((entry) => entry.playerId)).toEqual([
      'qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'te2',
    ]);
    expect(pool.map((entry) => entry.playerId)).not.toContain('qb2');
  });

  it('backfills non-positive-MRV positional rows once displayLimit requires it (D1 tab fill)', () => {
    const ordered: Recommendation[] = players.map((entry, index) => ({
      playerId: entry.playerId,
      rank: index + 1,
      projectedPoints: points.get(entry.playerId) ?? 0,
      marginalRosterValue: entry.position === 'QB' ? 0 : 10,
      marginalRosterUtility: entry.position === 'QB' ? 0 : 10,
      expectedFollowUpValue: 0,
      planValue: entry.position === 'QB' ? 0 : 10,
      planningHorizon: 0,
      replacementAdjustedValue: 10,
      replacementLevelPoints: 0,
      vor: 0,
      vona: null,
      vonaSource: 'unavailable',
      lookaheadValue: null,
      downside: null,
      simulatedSurvivalProbability: null,
      benchDepthValue: 0,
      recommendationMode: 'starter',
      rankingBasis: 'rosterUtility',
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
      assignedRosterSlot: entry.position,
      replacementPlayerId: null,
      pickAction: 'take-now',
      reasons: [],
      warnings: [],
    }));
    const playersById = new Map(players.map((entry) => [entry.playerId, entry]));

    // Same fixture as above (QB has zero MRV), but now with a nonzero displayLimit — the tab-fill
    // term must still pull qb2 in, even though it would never qualify via the positive-MRV term.
    const pool = buildRolloutPool(ordered, playersById, 1, 2);

    expect(pool.map((entry) => entry.playerId)).toContain('qb2');
    expect(pool.filter((entry) => playersById.get(entry.playerId)?.position === 'QB').map((entry) => entry.playerId))
      .toEqual(['qb1', 'qb2']);
  });
});

describe('buildRecommendationBoard Stage C', () => {
  it('fills analytic plan/VONA fields while retaining rollout diagnostics', () => {
    const board = buildRecommendationBoard({
      settings,
      players,
      projections,
      adp,
      picks: [],
      myTeamId: 'me',
      nextPick: 8,
      currentPick: 1,
      limit: 5,
      draftRounds: 4,
      rosterSpotsPerTeam: 4,
      simulation: {
        draftId: 'draft-stage-c',
        draftType: 'snake',
        teams: 4,
        rounds: 4,
        slotToTeam,
        decisionPick: 1,
        followUpPick: 8,
        executionMode: { mode: 'fixed', scenarios: 12 },
      },
    });

    expect(board.diagnostics.simulation).not.toBeNull();
    expect(board.diagnostics.simulation!.scenariosRun).toBe(12);
    const skill = board.recommendations.filter((entry) => {
      const position = players.find((player) => player.playerId === entry.playerId)?.position;
      return position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE';
    });
    expect(skill.length).toBeGreaterThan(0);
    expect(skill.every((entry) => entry.lookaheadValue != null)).toBe(true);
    expect(skill.every((entry) => entry.vona != null)).toBe(true);
    expect(skill.every((entry) => entry.reasons.some((reason) => /Wait cost: analytic VONA/i.test(reason)))).toBe(true);

    const byPlan = [...skill].sort((a, b) => b.planValue - a.planValue
      || a.playerId.localeCompare(b.playerId));
    expect(skill.map((entry) => entry.playerId)).toEqual(byPlan.map((entry) => entry.playerId));
  });

  it('computes VONA against same-group alternatives, even when the selected player lacks ADP', () => {
    const board = buildRecommendationBoard({
      settings,
      players,
      projections,
      // The selected player is available now, so its missing ADP must not suppress a VONA whose
      // uncertainty is entirely about the other WRs surviving to the next turn.
      adp: adp.filter((entry) => entry.playerId !== 'wr1'),
      picks: [],
      myTeamId: 'me',
      currentPick: 1,
      nextPick: 8,
      limit: 12,
      draftRounds: 4,
      rosterSpotsPerTeam: 4,
      includeAnalysisRows: true,
    });
    const byId = new Map(board.analysis!.deterministicRows.map((entry) => [entry.playerId, entry]));
    const target = byId.get('wr1');
    const alternatives = ['wr2', 'wr3', 'wr4']
      .map((id) => byId.get(id))
      .filter((entry): entry is Recommendation => entry != null)
      .sort((a, b) => b.marginalRosterUtility - a.marginalRosterUtility || a.playerId.localeCompare(b.playerId));

    expect(target).toBeDefined();
    expect(alternatives).toHaveLength(3);
    expect(target!.vonaSource).toBe('analytic');
    const expectedBestAlternative = alternatives.reduce(
      ({ value, noneHigher }, alternative) => ({
        value: value + noneHigher * (alternative.availableNextPickProbability ?? 0) * alternative.marginalRosterUtility,
        noneHigher: noneHigher * (1 - (alternative.availableNextPickProbability ?? 0)),
      }),
      { value: 0, noneHigher: 1 },
    ).value;
    expect(target!.vona).toBeCloseTo(Math.max(0, target!.marginalRosterUtility - expectedBestAlternative), 10);
  });

  it('falls back to deterministic S2 when an explicit zero-scenario request has a real follow-up', () => {
    const board = buildRecommendationBoard({
      settings,
      players,
      projections,
      adp,
      picks: [],
      myTeamId: 'me',
      nextPick: 8,
      currentPick: 1,
      limit: 5,
      draftRounds: 4,
      rosterSpotsPerTeam: 4,
      simulation: {
        draftId: 'draft-stage-c',
        draftType: 'snake',
        teams: 4,
        rounds: 4,
        slotToTeam,
        decisionPick: 1,
        followUpPick: 8,
        executionMode: { mode: 'fixed', scenarios: 0 },
      },
    });
    expect(board.diagnostics.simulation).toBeNull();
    expect(board.recommendations.every((entry) => entry.vona != null && entry.lookaheadValue == null)).toBe(true);
    expect(board.recommendations.every((entry) => entry.rankingBasis === 'planValue')).toBe(true);
  });

  it('builds a paint-sized S2 snapshot without planning, views, or the market board', () => {
    const board = buildRecommendationBoard({
      settings,
      players,
      projections,
      adp,
      picks: [],
      myTeamId: 'me',
      currentPick: 1,
      nextPick: null,
      limit: 24,
      rolloutDisplayLimit: 24,
      includeRecommendationViews: false,
      includeMarketRecommendations: false,
      includeExpansion: false,
    });

    expect(board.recommendationViews).toBeUndefined();
    expect(board.marketRecommendations).toEqual([]);
    expect(board.diagnostics.simulation).toBeNull();
    expect(board.recommendations.every((entry) => entry.planningHorizon === 0)).toBe(true);
  });

  it('emits a deterministic snapshot then refines Stage C on the same evaluated set', async () => {
    const snapshots: number[] = [];
    const full = await buildRecommendationBoard({
      settings,
      players,
      projections,
      adp,
      picks: [],
      myTeamId: 'me',
      nextPick: 8,
      currentPick: 1,
      limit: 5,
      draftRounds: 4,
      rosterSpotsPerTeam: 4,
      includeRecommendationViews: false,
      includeMarketRecommendations: false,
      includeExpansion: false,
      simulation: {
        draftId: 'draft-stage-c-phased',
        draftType: 'snake',
        teams: 4,
        rounds: 4,
        slotToTeam,
        decisionPick: 1,
        followUpPick: 8,
        executionMode: { mode: 'fixed', scenarios: 4 },
      },
    }, {
      onDeterministicSnapshot: (snapshot): 'continue' => {
        snapshots.push(snapshot.recommendations.length);
        expect(snapshot.diagnostics.simulation).toBeNull();
        expect(snapshot.recommendations.every((entry) => entry.planningHorizon === 0)).toBe(true);
        expect(snapshot.marketRecommendations).toEqual([]);
        return 'continue';
      },
    });
    expect(snapshots).toEqual([5]);
    expect(full).not.toBeNull();
    expect(full!.diagnostics.simulation?.scenariosRun).toBe(4);
    expect(full!.recommendations.some((entry) => entry.planningHorizon === 1)).toBe(true);
  });
});
