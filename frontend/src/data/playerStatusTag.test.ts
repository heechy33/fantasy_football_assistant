import { describe, expect, it } from 'vitest';
import { playerStatusTag } from './playerStatusTag';

describe('playerStatusTag', () => {
  it('prefers injury over rookie and new team', () => {
    expect(playerStatusTag(
      { injuryStatus: 'Questionable', yearsExp: 0 },
      { teamChanged: true },
    )).toEqual({ kind: 'injury', label: 'Q' });
  });

  it('compacts common Sleeper injury statuses', () => {
    expect(playerStatusTag({ injuryStatus: 'PUP', yearsExp: 3 })?.label).toBe('PUP');
    expect(playerStatusTag({ injuryStatus: 'Out', yearsExp: 3 })?.label).toBe('O');
    expect(playerStatusTag({ injuryStatus: 'IR', yearsExp: 3 })?.label).toBe('IR');
    expect(playerStatusTag({ injuryStatus: 'Doubtful', yearsExp: 3 })?.label).toBe('D');
    expect(playerStatusTag({ injuryStatus: 'Suspended', yearsExp: 3 })?.label).toBe('SUS');
  });

  it('passes through an unrecognized injury status', () => {
    expect(playerStatusTag({ injuryStatus: 'COVID', yearsExp: 2 })).toEqual({
      kind: 'injury', label: 'COVID',
    });
  });

  it('shows Rookie when yearsExp is 0 and there is no injury', () => {
    expect(playerStatusTag(
      { injuryStatus: null, yearsExp: 0 },
      { teamChanged: true },
    )).toEqual({ kind: 'rookie', label: 'Rookie' });
  });

  it('shows New team only when healthy and not a rookie', () => {
    expect(playerStatusTag(
      { injuryStatus: null, yearsExp: 4 },
      { teamChanged: true },
    )).toEqual({ kind: 'new-team', label: 'New team' });
  });

  it('returns null when there is nothing to tag', () => {
    expect(playerStatusTag({ injuryStatus: null, yearsExp: 4 }, { teamChanged: false })).toBeNull();
    expect(playerStatusTag({ injuryStatus: '  ', yearsExp: 4 })).toBeNull();
  });
});
