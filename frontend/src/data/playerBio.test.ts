import { describe, expect, it } from 'vitest';
import type { PlayerMeta } from '../../../shared/types';
import { formatDraft, formatDraftPick, formatHeight, formatWeight, formatYearsExp, playerBioItems } from './playerBio';

const rb: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

describe('formatHeight', () => {
  it('converts inches to feet-inches', () => {
    expect(formatHeight(77)).toBe('6\'5"');
    expect(formatHeight(72)).toBe('6\'0"');
  });

  it('hides missing values', () => {
    expect(formatHeight(null)).toBeNull();
    expect(formatHeight(0)).toBeNull();
  });
});

describe('formatWeight / years / draft', () => {
  it('formats weight and experience', () => {
    expect(formatWeight(237)).toBe('237 lbs');
    expect(formatYearsExp(0)).toBe('Rookie');
    expect(formatYearsExp(8)).toBe('8 yrs');
  });

  it('formats a full draft line and omits it without a year', () => {
    expect(formatDraft(2018, 1, 7)).toBe('2018 · Rd 1 · Pk 7');
    expect(formatDraft(2018, null, null)).toBe('2018');
    expect(formatDraft(null, 1, 7)).toBeNull();
  });

  it('formats the compact draft-pick chip the hero uses', () => {
    expect(formatDraftPick(2, 1, 2022)).toBe('2.01 (2022)');
    expect(formatDraftPick(1, 7, 2018)).toBe('1.07 (2018)');
    // A bare year still surfaces (same fallback as formatDraft); nothing at all returns null.
    expect(formatDraftPick(null, null, 2018)).toBe('2018');
    expect(formatDraftPick(null, null, null)).toBeNull();
    expect(formatDraftPick(1, 7, null)).toBe('1.07');
  });
});

describe('playerBioItems', () => {
  it('omits empty fields and includes age/exp/bye already on PlayerMeta', () => {
    expect(playerBioItems(rb)).toEqual([
      { label: 'Age', value: '24' },
      { label: 'Experience', value: '3 yrs' },
      { label: 'Bye', value: '7' },
    ]);
  });

  it('adds height, weight, college, jersey, and draft when present', () => {
    const items = playerBioItems({
      ...rb,
      heightInches: 71,
      weightLbs: 215,
      college: 'Alabama',
      jerseyNumber: 22,
      draftYear: 2021,
      draftRound: 1,
      draftPick: 4,
    });
    expect(items).toEqual([
      { label: 'Age', value: '24' },
      { label: 'Height', value: '5\'11"' },
      { label: 'Weight', value: '215 lbs' },
      { label: 'Experience', value: '3 yrs' },
      { label: 'Draft Pick', value: '1.04 (2021)' },
      { label: 'Bye', value: '7' },
      { label: 'No.', value: '#22' },
      { label: 'College', value: 'Alabama' },
    ]);
  });

  it('hides body and draft chips for DEF', () => {
    const items = playerBioItems({
      ...rb,
      playerId: 'BUF',
      name: 'Buffalo',
      position: 'DEF',
      eligiblePositions: ['DEF'],
      heightInches: 72,
      weightLbs: 200,
      college: 'n/a',
      draftYear: 1960,
      yearsExp: null,
      age: null,
    });
    expect(items).toEqual([{ label: 'Bye', value: '7' }]);
  });
});
