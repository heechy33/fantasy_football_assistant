import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, Pick, PlayerMeta, Position, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard } from './recommend';

/** Regression coverage for `RecommendationResult.marketRecommendations` — the ADP/market board. */

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'market', name: 'Market', season: '2026', teams: 1,
  startingSlots: ['RB', 'WR'],
  rosterSlots: { RB: 1, WR: 1, BN: 4 },
  scoring: { bonus: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function player(playerId: string, position: Position): PlayerMeta {
  return {
    playerId, name: playerId, position, eligiblePositions: [position], team: 'SEA',
    byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {},
  };
}

function adpEntry(playerId: string, position: string, adpValue: number): AdpEntry {
  return {
    playerId, name: playerId, position, team: 'SEA', adp: adpValue, stdev: 3,
    high: adpValue - 5, low: adpValue + 5, timesDrafted: 100, byeWeek: null,
    adpSource: 'ffc', stdevSource: 'observed',
  };
}

describe('marketRecommendations', () => {
  it('orders past-ADP players by largest fall first, then upcoming players by closest ADP', () => {
    const players = [player('fallen-big', 'RB'), player('fallen-small', 'RB'), player('near', 'RB'), player('far', 'RB')];
    const projections: SeasonProjection[] = players.map((p) => ({ playerId: p.playerId, source: 'fftoday', stats: { bonus: 100 } }));
    // currentPick = 20. fallen-big: adp 5 (delta -15, biggest fall). fallen-small: adp 15 (delta -5).
    // near: adp 22 (delta +2). far: adp 40 (delta +20).
    const adp = [adpEntry('fallen-big', 'RB', 5), adpEntry('fallen-small', 'RB', 15), adpEntry('near', 'RB', 22), adpEntry('far', 'RB', 40)];
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me', currentPick: 20, nextPick: 21, limit: 4,
    });
    expect(result.marketRecommendations.map((r) => r.playerId)).toEqual(['fallen-big', 'fallen-small', 'near', 'far']);
    expect(result.marketRecommendations.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(result.marketRecommendations.map((r) => r.pickDelta)).toEqual([-15, -5, 2, 20]);
  });

  it('excludes drafted players and players without ADP', () => {
    const players = [player('drafted', 'RB'), player('no-adp', 'RB'), player('kept', 'RB')];
    const projections: SeasonProjection[] = players.map((p) => ({ playerId: p.playerId, source: 'fftoday', stats: { bonus: 100 } }));
    const adp = [adpEntry('drafted', 'RB', 5), adpEntry('kept', 'RB', 10)];
    const picks: Pick[] = [{ overall: 1, round: 1, slot: 1, teamId: 'other', playerId: 'drafted', providerPlayerId: 'drafted' }];
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks, myTeamId: 'me', currentPick: 2, nextPick: 3, limit: 4,
    });
    expect(result.marketRecommendations.map((r) => r.playerId)).toEqual(['kept']);
  });

  it('joins projection-backed players to their evaluated engine recommendation', () => {
    const players = [player('projected', 'RB')];
    const projections: SeasonProjection[] = [{ playerId: 'projected', source: 'fftoday', stats: { bonus: 100 } }];
    const adp = [adpEntry('projected', 'RB', 5)];
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me', currentPick: 1, nextPick: 2, limit: 4,
    });
    const row = result.marketRecommendations.find((r) => r.playerId === 'projected');
    expect(row?.recommendation).not.toBeNull();
    expect(row?.recommendation?.playerId).toBe('projected');
  });

  it('joins projected ADP players beyond the 20-row display expansion', () => {
    const players = Array.from({ length: 25 }, (_, index) => player(`deep-${index + 1}`, 'RB'));
    const projections: SeasonProjection[] = players.map((entry) => ({
      playerId: entry.playerId, source: 'fftoday', stats: { bonus: 100 },
    }));
    const adp = players.map((entry, index) => adpEntry(entry.playerId, 'RB', index + 1));

    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me', currentPick: 1, nextPick: 2, limit: 4,
    });
    const row = result.marketRecommendations.find((entry) => entry.playerId === 'deep-25');
    expect(row).toBeDefined();
    expect(row?.recommendation?.playerId).toBe('deep-25');
  });

  it('preserves ADP-listed players without a projection, with recommendation: null', () => {
    const players = [player('unprojected', 'WR')];
    const projections: SeasonProjection[] = []; // no projection at all for this player
    const adp = [adpEntry('unprojected', 'WR', 12)];
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me', currentPick: 1, nextPick: 2, limit: 4,
    });
    expect(result.marketRecommendations).toHaveLength(1);
    expect(result.marketRecommendations[0]?.playerId).toBe('unprojected');
    expect(result.marketRecommendations[0]?.recommendation).toBeNull();
    expect(result.marketRecommendations[0]?.adp).toBe(12);
  });

  it('is never filtered by displayPosition — position filtering is left to callers, after the same league-wide order', () => {
    const players = [player('rb-1', 'RB'), player('wr-1', 'WR')];
    const projections: SeasonProjection[] = players.map((p) => ({ playerId: p.playerId, source: 'fftoday', stats: { bonus: 100 } }));
    const adp = [adpEntry('rb-1', 'RB', 5), adpEntry('wr-1', 'WR', 10)];
    const result = buildRecommendationBoard({
      settings, players, projections, adp, picks: [], myTeamId: 'me', currentPick: 1, nextPick: 2, limit: 4, displayPosition: 'RB',
    });
    // `recommendations` respects the position filter, but `marketRecommendations` stays league-wide.
    expect(result.recommendations.map((r) => r.playerId)).toEqual(['rb-1']);
    expect(result.marketRecommendations.map((r) => r.playerId)).toEqual(['rb-1', 'wr-1']);
  });
});
