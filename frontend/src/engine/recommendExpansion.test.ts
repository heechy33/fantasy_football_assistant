import { afterEach, describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerMeta, Position, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard, clearSimulationCache } from './recommend';

/**
 * Regression coverage for the fixed analytic expansion pool (EXPANSION_DEPTH) and the localized
 * near-tie band rework — validated decisions in the Engine/ADP board revision.
 */

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'expansion', name: 'Expansion', season: '2026', teams: 4,
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

// A wide pool (many players per position) so the fixed EXPANSION_DEPTH=20 backfill and the
// rolloutDisplayLimit/limit split are actually exercised, not trivially satisfied by a tiny board.
const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];
const PLAYERS_PER_POSITION = 30;
const players: PlayerMeta[] = POSITIONS.flatMap((position) => (
  Array.from({ length: PLAYERS_PER_POSITION }, (_, index) => player(`${position.toLowerCase()}-${index + 1}`, position))
));
const points = new Map(players.map((entry) => {
  const [, indexText] = entry.playerId.split('-');
  const index = Number(indexText);
  return [entry.playerId, 150 - index * 2] as const;
}));
const projections: SeasonProjection[] = players.map((entry) => ({
  playerId: entry.playerId, source: 'fftoday', stats: { bonus: points.get(entry.playerId) ?? 0 },
}));
const adp: AdpEntry[] = players.map((entry, index) => ({
  playerId: entry.playerId, name: entry.name, position: entry.position ?? '', team: entry.team,
  adp: index + 1.5, stdev: 4, high: index + 1, low: index + 40,
  timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
}));
const teams = 4;
const slotToTeam = { 1: 'me', 2: 't2', 3: 't3', 4: 't4' };

afterEach(() => {
  clearSimulationCache();
});

function board(overrides: Partial<Parameters<typeof buildRecommendationBoard>[0]> = {}) {
  return buildRecommendationBoard({
    settings, players, projections, adp, picks: [], myTeamId: 'me',
    currentPick: 1, nextPick: 8, draftRounds: 4, rosterSpotsPerTeam: 4,
    rolloutDisplayLimit: 5,
    simulation: {
      draftId: 'expansion-fixture', draftType: 'snake', teams, rounds: 4, slotToTeam,
      decisionPick: 1, followUpPick: 8,
      executionMode: { mode: 'fixed', scenarios: 6 },
    },
    ...overrides,
  });
}

describe('fixed analytic expansion pool', () => {
  it('keeps Engine top-five IDs, values, reasons, rollout pool, and simulation diagnostics identical between output limits 5 and 20', () => {
    const five = board({ limit: 5, includeAnalysisRows: true });
    const twenty = board({ limit: 20, includeAnalysisRows: true });

    expect(five.recommendations).toHaveLength(5);
    expect(twenty.recommendations.length).toBeGreaterThan(5);
    expect(twenty.recommendations.slice(0, 5)).toStrictEqual(five.recommendations);
    // rolloutDisplayLimit (5) — not the display `limit` — sizes the rollout pool in both calls.
    expect(twenty.analysis!.rolloutPoolSize).toBe(five.analysis!.rolloutPoolSize);
    expect(twenty.diagnostics.simulation?.scenariosRun).toBe(five.diagnostics.simulation?.scenariosRun);
  });

  it('supports up to EXPANSION_DEPTH rows per position without inflating the rollout/planning pool', () => {
    const result = board({ limit: 20, displayPosition: 'RB', includeAnalysisRows: true });
    expect(result.recommendations.length).toBe(20);
    expect(result.analysis).toBeDefined();
    // The rollout pool stays bounded by rolloutDisplayLimit (5), independent of the 20-row ask.
    expect(result.analysis!.rolloutPoolSize).toBeGreaterThan(0);
    expect(result.analysis!.rolloutPoolSize).toBeLessThan(result.analysis!.deterministicRows.length);
  });

  it('excludes expansion-only rows from simulation diagnostics (only rollout participants are rolled out)', () => {
    const result = board({ limit: 20, displayPosition: 'RB', includeAnalysisRows: true });
    const simulated = result.recommendations.filter((r) => r.simulatedSurvivalProbability != null);
    const unsimulated = result.recommendations.filter((r) => r.simulatedSurvivalProbability == null);
    expect(simulated.length).toBeGreaterThan(0);
    expect(unsimulated.length).toBeGreaterThan(0);
    // Every displayed row, including expansion-only rows outside the rollout pool, still gets its
    // own analytic plan value against the shared follow-up shortlist.
    expect(result.recommendations.every((r) => Number.isFinite(r.planValue))).toBe(true);
  });

  it('recommendations stay a subset of analysis.simulatedRows even though simulatedRows now includes expansion rows', () => {
    const result = board({ limit: 20, includeAnalysisRows: true });
    const simulatedIds = new Set(result.analysis!.simulatedRows.map((r) => r.playerId));
    for (const recommendation of result.recommendations) {
      expect(simulatedIds.has(recommendation.playerId)).toBe(true);
    }
    expect(result.analysis!.simulatedCandidateCount).toBeLessThanOrEqual(result.analysis!.rolloutPoolSize);
  });
});

describe('localized near-tie bands', () => {
  const kSettings: LeagueSettings = {
    ...settings,
    startingSlots: ['K'],
    rosterSlots: { K: 1, BN: 2 },
  };
  const kPlayers = [player('k-a', 'K'), player('k-b', 'K'), player('k-c', 'K')];
  // anchor(k-a)=100, threshold=max(1,1%*100)=1. k-b is within 1 of the anchor (joins). k-c is 1.5
  // from the *anchor* (fails a fixed-anchor comparison) even though it is only 0.9 from k-b — a
  // chained/transitive implementation would incorrectly extend the first band to include it.
  const kPoints = new Map([['k-a', 100], ['k-b', 99.4], ['k-c', 98.5]]);
  const kProjections: SeasonProjection[] = kPlayers.map((entry) => ({
    playerId: entry.playerId, source: 'fftoday', stats: { bonus: kPoints.get(entry.playerId) ?? 0 },
  }));

  it('compares every candidate to a fixed band anchor instead of chaining adjacent gaps', () => {
    const result = buildRecommendationBoard({
      settings: kSettings, players: kPlayers, projections: kProjections, adp: [], picks: [],
      myTeamId: 'me', currentPick: 1, nextPick: 2, limit: 3, displayPosition: 'K',
    });
    expect(result.recommendations.map((r) => r.playerId)).toEqual(['k-a', 'k-b', 'k-c']);
    expect(result.recommendations.map((r) => r.nearTie)).toEqual([true, true, false]);
  });

  it('never merges bands across special-teams disposition classes, even at identical values', () => {
    // DEF's reserved slot comes due one selection earlier than K's under the late-draft schedule
    // (recommend.ts's buildSpecialTeamsDraftDiagnostics), so with 2 rounds left and 0 picks made,
    // DEF is 'due' while K is still 'early' — different disposition classes despite identical points.
    const stDefKSettings: LeagueSettings = {
      ...settings,
      startingSlots: ['DEF', 'K'],
      rosterSlots: { DEF: 1, K: 1, BN: 2 },
    };
    const stPlayers = [player('def-x', 'DEF'), player('k-x', 'K')];
    const stProjections: SeasonProjection[] = stPlayers.map((entry) => ({
      playerId: entry.playerId, source: 'fftoday', stats: { bonus: 150 },
    }));
    const result = buildRecommendationBoard({
      settings: stDefKSettings, players: stPlayers, projections: stProjections, adp: [], picks: [],
      myTeamId: 'me', currentPick: 1, nextPick: 2, limit: 2, displayPosition: null,
      draftRounds: 2, rosterSpotsPerTeam: 2,
    });
    expect(result.diagnostics.specialTeamsDraft.due).toEqual(['DEF']);
    expect(result.recommendations.map((r) => r.playerId)).toEqual(['def-x', 'k-x']);
    // Same points, adjacent in the sorted order, but different disposition classes — must not band.
    expect(result.recommendations.map((r) => r.nearTie)).toEqual([false, false]);
  });

  it('reorders members within a band by lower next-pick survival, then earlier ADP, then higher plan value, then player ID', () => {
    const rbSettings: LeagueSettings = {
      ...settings,
      startingSlots: ['RB'],
      rosterSlots: { RB: 1, BN: 3 },
    };
    const rbPlayers = [player('rb-x', 'RB'), player('rb-y', 'RB')];
    const rbProjections: SeasonProjection[] = rbPlayers.map((entry) => ({
      playerId: entry.playerId, source: 'fftoday', stats: { bonus: entry.playerId === 'rb-x' ? 100 : 99.5 },
    }));
    // rb-x projects slightly higher (would lead a plain value sort), but rb-y has a much lower
    // next-pick survival probability (ADP already past the current pick) — within the near-tie band
    // this reorders rb-y ahead of rb-x.
    const rbAdp: AdpEntry[] = [
      { playerId: 'rb-x', name: 'rb-x', position: 'RB', team: 'SEA', adp: 50, stdev: 2, high: 45, low: 55, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' },
      { playerId: 'rb-y', name: 'rb-y', position: 'RB', team: 'SEA', adp: 1, stdev: 2, high: 1, low: 5, timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed' },
    ];
    const result = buildRecommendationBoard({
      settings: rbSettings, players: rbPlayers, projections: rbProjections, adp: rbAdp, picks: [],
      myTeamId: 'me', currentPick: 30, nextPick: 40, limit: 2, displayPosition: 'RB',
    });
    expect(result.recommendations.map((r) => r.nearTie)).toEqual([true, true]);
    expect(result.recommendations[0]?.availableNextPickProbability)
      .toBeLessThan(result.recommendations[1]?.availableNextPickProbability ?? Infinity);
    expect(result.recommendations.map((r) => r.playerId)).toEqual(['rb-y', 'rb-x']);
  });
});
