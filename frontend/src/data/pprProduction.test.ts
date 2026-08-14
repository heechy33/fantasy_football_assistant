import { describe, expect, it } from 'vitest';
import { pointsPerGame, pprFromReceptions, pprFromRushes, resolvePointsPerGame } from './pprProduction';

describe('pprProduction', () => {
  it('scores standard PPR from catches and rushes', () => {
    expect(pprFromReceptions(40, 380, 2)).toBeCloseTo(40 + 38 + 12);
    expect(pprFromRushes(180, 9)).toBeCloseTo(18 + 54);
  });

  it('averages observed weekly points and does not invent a zero for missing weeks', () => {
    expect(pointsPerGame([])).toBeNull();
    expect(pointsPerGame([{ week: 1, pointsPpr: 10 }, { week: 3, pointsPpr: 20 }])).toBe(15);
  });

  it('falls back to usage production PPG when the weekly series is empty', () => {
    expect(resolvePointsPerGame([], {
      games: 10, pointsPpr: 142, pointsPprPerGame: 14.2,
      receptions: 0, receivingYards: 0, receivingTds: 0, rushingYards: 0, rushingTds: 0,
    })).toBe(14.2);
    expect(resolvePointsPerGame([{ week: 1, pointsPpr: 8 }], {
      games: 10, pointsPpr: 142, pointsPprPerGame: 14.2,
      receptions: 0, receivingYards: 0, receivingTds: 0, rushingYards: 0, rushingTds: 0,
    })).toBe(8);
  });
});
