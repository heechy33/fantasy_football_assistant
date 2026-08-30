import { describe, expect, it } from 'vitest';
import { espnBonusLabel, formatEspnBonusTag, hasEspnBonusLabel } from './espnBonusCatalog';

describe('espnBonusCatalog', () => {
  it('labels the verified FG-tier ids and the long-TD family; unknown ids stay generic', () => {
    // Verified in-repo against pipeline/espn_projections.py's _RAW_STAT_WEIGHTS.
    expect(hasEspnBonusLabel(74)).toBe(true);
    expect(espnBonusLabel(80)).toBe('FG 0-39 yd');
    expect(espnBonusLabel(85)).toBe('Missed FG');
    // Long-TD family: 35/36 rush TDs, 45/46 RECEIVING TDs (espn-api PLAYER_STATS_MAP).
    expect(espnBonusLabel(35)).toBe('Rush TD 40+ yd');
    expect(espnBonusLabel(46)).toBe('Rec TD 50+ yd');
    // Yardage-game family: 37/38 rush games, 56/57 RECEIVING games.
    expect(espnBonusLabel(37)).toBe('100-199 yd rushing game');
    expect(espnBonusLabel(57)).toBe('200+ yd receiving game');
    // An id with no confident meaning must NOT get an invented label.
    expect(hasEspnBonusLabel(999)).toBe(false);
    expect(espnBonusLabel(999)).toBe('Bonus category (id 999)');
    expect(hasEspnBonusLabel(58)).toBe(false);
  });

  it('formats a tag with the point value and an explicit sign', () => {
    expect(formatEspnBonusTag({ statId: 35, points: 2 })).toBe('Rush TD 40+ yd +2');
    expect(formatEspnBonusTag({ statId: 85, points: -1 })).toBe('Missed FG −1');
  });
});
