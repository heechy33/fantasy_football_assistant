import { describe, expect, it } from 'vitest';
import type { AdpEntry } from '../../../shared/types';
import { buildProviderColumn, unavailableProviderColumn } from './guideProviderColumns';

function entry(playerId: string | null, adp: number, name = playerId ?? 'Unknown'): AdpEntry {
  return {
    playerId,
    name,
    position: 'RB',
    team: null,
    adp,
    stdev: 1,
    high: null,
    low: null,
    timesDrafted: null,
    byeWeek: null,
    adpSource: 'ffc',
    stdevSource: 'observed',
  };
}

describe('guideProviderColumns', () => {
  it('dense-ranks a lane 1-based in ascending ADP order', () => {
    const column = buildProviderColumn('ffc', 'FFC', [entry('a', 3.2), entry('b', 1.1), entry('c', 7.7)]);
    expect(column.status).toBe('ready');
    expect(column.rowCount).toBe(3);
    expect(column.rankByPlayer.get('b')).toBe(1);
    expect(column.rankByPlayer.get('a')).toBe(2);
    expect(column.rankByPlayer.get('c')).toBe(3);
    expect(column.adpByPlayer.get('b')).toBe(1.1);
  });

  it('never assigns rank 0 and never drops joinable players', () => {
    const column = buildProviderColumn('sleeper', 'Sleeper', [entry('x', 100)]);
    expect(column.rankByPlayer.get('x')).toBe(1);
  });

  it('skips entries that cannot join to the pool (null playerId)', () => {
    const column = buildProviderColumn('sleeper', 'Sleeper', [entry(null, 1.5), entry('y', 2.5)]);
    expect(column.rowCount).toBe(1);
    expect(column.rankByPlayer.has('null')).toBe(false);
    expect(column.rankByPlayer.get('y')).toBe(1);
  });

  it('keeps the first occurrence of a duplicate playerId deterministic', () => {
    const column = buildProviderColumn('sleeper', 'Sleeper', [entry('dup', 5), entry('dup', 9)]);
    expect(column.adpByPlayer.get('dup')).toBe(5);
  });

  it('represents an unavailable lane honestly without fabricating ranks', () => {
    const column = unavailableProviderColumn('espn', 'ESPN');
    expect(column.status).toBe('unavailable');
    expect(column.rowCount).toBe(0);
    expect(column.rankByPlayer.size).toBe(0);
  });
});
