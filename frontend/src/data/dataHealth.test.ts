import { describe, expect, it } from 'vitest';
import type { DataManifest } from '../../../shared/types';
import { resolveDataMode } from './dataHealth';

const NOW = Date.parse('2026-08-07T00:00:00.000Z');
const FRESH = '2026-08-06T12:00:00.000Z'; // 12h old
const STALE = '2026-08-01T00:00:00.000Z'; // 6 days old

function manifestWith(sources: DataManifest['sources']): DataManifest {
  return {
    builtAt: FRESH,
    season: '2026',
    week: null,
    sources,
    crosswalk: { totalPlayers: 100, top300MatchRate: 1, unmatchedTop300: [] },
  };
}

const okSource = (fetchedAt: string) => ({
  url: 'https://example.test',
  rows: 10,
  fetchedAt,
  schemaVersion: 1,
  status: 'ok' as const,
});

describe('resolveDataMode', () => {
  it('is "full" when both projection and ADP are present and fresh', () => {
    const manifest = manifestWith({
      sleeper_season_projections: okSource(FRESH),
      ffc_adp_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('full');
  });

  it('is "projection-only" when ADP is missing entirely', () => {
    const manifest = manifestWith({ sleeper_season_projections: okSource(FRESH) });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('projection-only');
  });

  it('is "adp-only" when projection is missing entirely', () => {
    const manifest = manifestWith({ ffc_adp_ppr: okSource(FRESH) });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('adp-only');
  });

  it('is "unavailable" when neither source is present', () => {
    const manifest = manifestWith({});
    expect(resolveDataMode(manifest, { now: NOW })).toBe('unavailable');
  });

  it('treats a stale source the same as a missing one', () => {
    const manifest = manifestWith({
      sleeper_season_projections: okSource(STALE),
      ffc_adp_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('adp-only');
  });

  it('treats a non-"ok" status the same as a missing source', () => {
    const manifest = manifestWith({
      sleeper_season_projections: { ...okSource(FRESH), status: 'error' },
      ffc_adp_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('adp-only');
  });

  it('never silently substitutes one signal for the other across every pairing', () => {
    const both = manifestWith({
      sleeper_season_projections: okSource(FRESH),
      ffc_adp_ppr: okSource(FRESH),
    });
    const neither = manifestWith({});
    expect(resolveDataMode(both, { now: NOW })).not.toBe(resolveDataMode(neither, { now: NOW }));
  });
});
