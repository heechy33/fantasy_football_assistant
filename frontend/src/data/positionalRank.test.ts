import { describe, expect, it } from 'vitest';
import type { AdpEntry } from '../../../shared/types';
import { adpPositionalRank } from './positionalRank';

function entry(playerId: string, position: string, adp: number): AdpEntry {
  return {
    playerId, name: playerId, position, team: 'BUF', adp, stdev: 4,
    high: null, low: null, timesDrafted: null, byeWeek: 7,
    adpSource: 'sleeper', stdevSource: 'fitted',
  };
}

const board: AdpEntry[] = [
  entry('rb-a', 'RB', 12),
  entry('rb-b', 'RB', 24),
  entry('wr-a', 'WR', 8),
  entry('rb-c', 'RB', 24),
  { ...entry('ghost', 'RB', 6), playerId: null },
];

describe('adpPositionalRank', () => {
  it('ranks by same-position ADP, counting rows at or before this player', () => {
    expect(adpPositionalRank('rb-a', 'RB', board)).toBe('ADP RB1');
    expect(adpPositionalRank('rb-b', 'RB', board)).toBe('ADP RB3');
    expect(adpPositionalRank('wr-a', 'WR', board)).toBe('ADP WR1');
  });

  it('returns null without a position, ADP row, or board', () => {
    expect(adpPositionalRank('rb-a', null, board)).toBeNull();
    expect(adpPositionalRank('missing', 'RB', board)).toBeNull();
    expect(adpPositionalRank('rb-a', 'RB', [])).toBeNull();
    expect(adpPositionalRank('rb-a', 'RB', undefined)).toBeNull();
  });
});
