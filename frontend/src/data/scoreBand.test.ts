import { describe, expect, it } from 'vitest';
import { axisBand, clampScore } from './scoreBand';

describe('scoreBand', () => {
  it('clamps non-finite and out-of-range values into [0, 100]', () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-20)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
  });

  it('inverts Risk so a high score reads as a poor band', () => {
    expect(axisBand(80)).toBe('elite');
    expect(axisBand(80, 'lower-better')).toBe('poor');
    expect(axisBand(20, 'lower-better')).toBe('elite');
  });
});
