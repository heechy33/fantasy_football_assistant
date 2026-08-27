import { describe, expect, it } from 'vitest';
import { DEFAULT_MOCK_SCORING } from '../adapters/sleeper';
import {
  buildGuideSettings,
  guideAdpFormat,
  parseGuideFormat,
  serializeGuideFormat,
  GUIDE_DEFAULT_FORMAT,
} from './guideLeagueSettings';

describe('guideLeagueSettings', () => {
  it('builds a complete valid LeagueSettings from a 1QB format', () => {
    const settings = buildGuideSettings({ reception: 'ppr', qb: 'one-qb', teams: 12, rounds: 15 });
    expect(settings.provider).toBe('manual');
    expect(settings.leagueId).toBe('draft-guide');
    expect(settings.teams).toBe(12);
    expect(settings.scoring.rec).toBe(1); // ppr
    expect(settings.format).toEqual({ reception: 'ppr', qb: 'one-qb', draft: 'snake' });
    // The 1QB base slots come straight from ManualDraftSetup's ESPN target.
    expect(settings.startingSlots.filter((slot) => slot === 'SUPER_FLEX')).toHaveLength(0);
    expect(Object.keys(settings.rosterSlots)).not.toContain('SUPER_FLEX');
  });

  it('adds exactly one SUPER_FLEX slot for superflex without changing scoring', () => {
    const settings = buildGuideSettings({ reception: 'half-ppr', qb: 'superflex', teams: 10, rounds: 14 });
    expect(settings.startingSlots.filter((slot) => slot === 'SUPER_FLEX')).toHaveLength(1);
    expect(settings.startingSlots.filter((slot) => slot === 'FLEX')).toHaveLength(1);
    // Superflex is a roster-shape dimension — the scoring map is the plain reception preset
    // (DEFAULT_MOCK_SCORING has no 2qb key by design).
    expect(settings.scoring).toBe(DEFAULT_MOCK_SCORING['half-ppr']);
    expect(settings.format.qb).toBe('superflex');
    expect(Object.keys(settings.rosterSlots)).toContain('SUPER_FLEX');
  });

  it('maps the QB dimension onto the ADP lane, not the reception dimension', () => {
    expect(guideAdpFormat({ reception: 'ppr', qb: 'one-qb', teams: 12, rounds: 15 })).toBe('ppr');
    expect(guideAdpFormat({ reception: 'standard', qb: 'one-qb', teams: 12, rounds: 15 })).toBe('standard');
    // A superflex draft drafts against the 2QB board regardless of reception scoring.
    expect(guideAdpFormat({ reception: 'ppr', qb: 'superflex', teams: 12, rounds: 15 })).toBe('2qb');
  });

  it('parses selector state from URL params with safe fallbacks', () => {
    const full = parseGuideFormat(new URLSearchParams('scoring=standard&qb=superflex&teams=14&rounds=16'));
    expect(full).toEqual({ reception: 'standard', qb: 'superflex', teams: 14, rounds: 16 });

    expect(parseGuideFormat(new URLSearchParams())).toEqual(GUIDE_DEFAULT_FORMAT);

    // Invalid values never crash the page — they fall back.
    const garbage = parseGuideFormat(new URLSearchParams('scoring=2qb&qb=te&teams=99&rounds=1'));
    expect(garbage.reception).toBe(GUIDE_DEFAULT_FORMAT.reception);
    expect(garbage.qb).toBe('one-qb');
    expect(garbage.teams).toBe(GUIDE_DEFAULT_FORMAT.teams);
    expect(garbage.rounds).toBe(GUIDE_DEFAULT_FORMAT.rounds);
  });

  it('round-trips through serialize → parse', () => {
    const format = { reception: 'half-ppr' as const, qb: 'superflex' as const, teams: 8, rounds: 13 };
    expect(parseGuideFormat(serializeGuideFormat(format))).toEqual(format);
  });
});
