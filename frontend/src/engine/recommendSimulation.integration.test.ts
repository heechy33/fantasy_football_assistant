import { afterEach, describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerMeta, Position, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard, clearSimulationCache } from './recommend';

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'stage-c-real', name: 'Stage C real', season: '2026', teams: 4,
  startingSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 2 },
  scoring: { points: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function player(playerId: string, position: Position): PlayerMeta {
  return { playerId, name: playerId, position, eligiblePositions: [position], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
}

const basePoints: Record<Position, number> = { QB: 75, RB: 100, WR: 90, TE: 70, K: 30, DEF: 20 };
const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const players = positions.flatMap((position) => [player(position.toLowerCase() + '-1', position), player(position.toLowerCase() + '-2', position)]);
const projections: SeasonProjection[] = players.map((entry) => ({
  playerId: entry.playerId, source: 'test', stats: { points: basePoints[entry.position!] - (entry.playerId.endsWith('-2') ? 5 : 0) },
}));
const adp: AdpEntry[] = players.map((entry, index) => ({
  playerId: entry.playerId, name: entry.name, position: entry.position ?? '', team: null, adp: index + 1,
  stdev: 2, high: index, low: index + 4, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
}));

const simulation = {
  draftId: 'real-stage-c',
  draftType: 'snake' as const,
  teams: 4,
  rounds: 4,
  slotToTeam: { 1: 'me', 2: 't2', 3: 't3', 4: 't4' },
  decisionPick: 1,
  followUpPick: 8,
  executionMode: { mode: 'fixed' as const, scenarios: 3 },
};

afterEach(clearSimulationCache);

describe('Stage C real fixed-mode integration', () => {
  it('runs diagnostic rollouts while analytic plan value ranks skill players, and leaves K/DEF unsimulated', () => {
    const skill = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me',
      currentPick: 1, nextPick: 8, limit: 1, displayPosition: 'RB', simulation,
    });
    expect(skill.diagnostics.simulation).toMatchObject({ scenariosRun: 3, timedOut: false });
    expect(skill.recommendations).toHaveLength(1);
    expect(skill.recommendations[0]).toMatchObject({
      lookaheadValue: expect.any(Number),
      vona: expect.any(Number),
      downside: expect.any(Number),
      simulatedSurvivalProbability: expect.any(Number),
    });
    expect(skill.recommendations[0]).toMatchObject({
      rankingBasis: 'planValue',
      planningHorizon: 1,
      vonaSource: 'analytic',
    });
    expect(skill.recommendations[0]?.reasons.some((reason) => reason.includes('Wait cost: analytic VONA'))).toBe(true);
    expect(skill.recommendations[0]?.reasons.some((reason) => reason.startsWith('Simulation check:'))).toBe(true);

    const kicker = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me',
      currentPick: 1, nextPick: 8, limit: 1, displayPosition: 'K', simulation,
    });
    expect(kicker.recommendations[0]).toMatchObject({
      lookaheadValue: null,
      vona: null,
      downside: null,
      simulatedSurvivalProbability: null,
    });
  });

  it('is deterministic through the recommendation board when fixed mode reruns without cache', () => {
    const input = {
      settings, players, projections, adp, picks: [], myTeamId: 'me',
      currentPick: 1, nextPick: 8, limit: 2, displayPosition: 'RB' as const, simulation,
    };
    const first = buildRecommendationBoard(input);
    clearSimulationCache();
    const second = buildRecommendationBoard(input);

    expect(second.recommendations).toEqual(first.recommendations);
    expect(second.diagnostics.simulation).toMatchObject({ scenariosRun: 3, timedOut: false });
  });

  it('surfaces a real budget cutoff as a partial rollout warning', () => {
    let clockCalls = 0;
    const now = () => (clockCalls++ === 0 ? 0 : 1);
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me',
      currentPick: 1, nextPick: 8, limit: 2, displayPosition: 'RB',
      simulation: {
        ...simulation,
        executionMode: { mode: 'budgeted', scenarios: 12, timeBudgetMs: 0, batchSize: 1 },
        now,
      },
    });

    const diagnostics = result.diagnostics.simulation!;
    expect(diagnostics).toMatchObject({ timedOut: true });
    expect(diagnostics.scenariosRun).toBeGreaterThan(0);
    expect(diagnostics.scenariosRun).toBeLessThan(12);
    expect(result.recommendations[0]?.warnings.some((warning) => warning.includes(`Rollout truncated after ${diagnostics.scenariosRun}/12 scenarios`))).toBe(true);
  });

  it('treats a null follow-up as the valid final-pick deterministic collapse', () => {
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me',
      currentPick: 16, nextPick: null, limit: 1, displayPosition: 'RB',
      simulation: { ...simulation, decisionPick: 16, followUpPick: null },
    });
    expect(result.diagnostics.simulation).toMatchObject({ scenariosRun: 0, timedOut: false });
    expect(result.recommendations[0]).toMatchObject({
      lookaheadValue: expect.any(Number),
      vona: null,
      vonaSource: 'unavailable',
      planningHorizon: 0,
      downside: expect.any(Number),
      simulatedSurvivalProbability: 1,
      availableNextPickProbability: null,
      availabilityAdp: null,
    });
  });
});
