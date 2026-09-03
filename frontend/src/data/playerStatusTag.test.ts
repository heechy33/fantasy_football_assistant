import { describe, expect, it } from 'vitest';
import { playerStatusTag, playerStatusTags } from './playerStatusTag';

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

  it('normalizes Sleeper injuryStatus values that previously fell through raw', () => {
    // Sleeper emits these exact tokens live; before these keys existed they rendered as raw
    // 'Sus' / 'NA' / 'DNR' badges instead of a normalized label.
    expect(playerStatusTag({ injuryStatus: 'Sus', yearsExp: 3 })?.label).toBe('SUS');
    expect(playerStatusTag({ injuryStatus: 'NA', yearsExp: 3 })?.label).toBe('NA');
    expect(playerStatusTag({ injuryStatus: 'DNR', yearsExp: 3 })?.label).toBe('DNR');
  });

  it('shows an unavailable tag ahead of injury when availability is zeroed, labeled with status', () => {
    // The Josh Jacobs case: season-long Exempt outranks a weekly Questionable tag.
    expect(playerStatusTag({
      injuryStatus: 'Questionable', yearsExp: 3, status: 'Exempt', availability: 0,
    })).toEqual({ kind: 'unavailable', label: 'Exempt' });
  });

  it('falls back to a generic "Unavailable" label when status is missing', () => {
    expect(playerStatusTag({ injuryStatus: null, yearsExp: 3, status: null, availability: 0 }))
      .toEqual({ kind: 'unavailable', label: 'Unavailable' });
  });

  it('does not tag unavailable when availability is undefined or full', () => {
    expect(playerStatusTag({ injuryStatus: null, yearsExp: 3, availability: undefined })).toBeNull();
    expect(playerStatusTag({ injuryStatus: null, yearsExp: 3, availability: 1 })).toBeNull();
  });
});

describe('playerStatusTags', () => {
  it('returns every applicable tag, injury-first, for a player that is all three at once', () => {
    expect(playerStatusTags(
      { injuryStatus: 'Questionable', yearsExp: 0 },
      { teamChanged: true },
    )).toEqual([
      { kind: 'injury', label: 'Q' },
      { kind: 'rookie', label: 'Rookie' },
      { kind: 'new-team', label: 'New team' },
    ]);
  });

  it('returns just rookie + new-team when healthy', () => {
    expect(playerStatusTags(
      { injuryStatus: null, yearsExp: 0 },
      { teamChanged: true },
    )).toEqual([
      { kind: 'rookie', label: 'Rookie' },
      { kind: 'new-team', label: 'New team' },
    ]);
  });

  it('returns an empty array when there is nothing to tag', () => {
    expect(playerStatusTags({ injuryStatus: null, yearsExp: 4 }, { teamChanged: false })).toEqual([]);
  });

  it('puts unavailable ahead of injury, rookie, and new-team all at once', () => {
    expect(playerStatusTags(
      { injuryStatus: 'Questionable', yearsExp: 0, status: 'Exempt', availability: 0 },
      { teamChanged: true },
    )).toEqual([
      { kind: 'unavailable', label: 'Exempt' },
      { kind: 'injury', label: 'Q' },
      { kind: 'rookie', label: 'Rookie' },
      { kind: 'new-team', label: 'New team' },
    ]);
  });

  it('is what playerStatusTag\'s single-tag result is derived from', () => {
    const player = { injuryStatus: 'Out', yearsExp: 0 };
    const usage = { teamChanged: true };
    expect(playerStatusTag(player, usage)).toEqual(playerStatusTags(player, usage)[0]);
  });
});
