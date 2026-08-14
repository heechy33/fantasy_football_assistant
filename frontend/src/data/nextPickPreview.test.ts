import { describe, expect, it } from 'vitest';
import type { AdpEntry, Pick, PlayerMeta } from '../../../shared/types';
import { buildNextPickPreview } from './nextPickPreview';

function player(id: string): PlayerMeta {
  return {
    playerId: id,
    name: `Player ${id}`,
    position: 'RB',
    eligiblePositions: ['RB'],
    team: null,
    byeWeek: null,
    age: null,
    yearsExp: null,
    injuryStatus: null,
    ids: {},
  };
}

function entry(id: string, adp: number): AdpEntry {
  return {
    playerId: id,
    name: `Player ${id}`,
    position: 'RB',
    team: null,
    adp,
    stdev: 8,
    high: Math.max(1, adp - 12),
    low: adp + 12,
    timesDrafted: 100,
    byeWeek: null,
    adpSource: 'ffc',
    stdevSource: 'observed',
  };
}

describe('buildNextPickPreview', () => {
  it('returns at most ten undrafted players nearest the next-pick ADP', () => {
    const players = Array.from({ length: 14 }, (_, index) => player(String(index + 1)));
    const playersById = new Map(players.map((row) => [row.playerId, row]));
    const adp = players.map((row, index) => entry(row.playerId, 20 + index));
    const picks: Pick[] = [{
      overall: 1,
      round: 1,
      slot: 1,
      teamId: 'other',
      playerId: '6',
      providerPlayerId: '6',
    }];

    const result = buildNextPickPreview(playersById, adp, picks, 10, 27, 10);

    expect(result).toHaveLength(10);
    expect(result.map((row) => row.playerId)).not.toContain('6');
    expect(result[0]?.adp).toBe(27);
    expect(result.every((row) => row.survivalProbability >= 0 && row.survivalProbability <= 1)).toBe(true);
  });

  it('returns no preview when the target is not in the future', () => {
    const only = player('1');
    expect(buildNextPickPreview(new Map([[only.playerId, only]]), [entry('1', 10)], [], 10, 10)).toEqual([]);
  });
});
