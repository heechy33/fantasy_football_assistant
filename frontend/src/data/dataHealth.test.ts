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
  it('is "full" when both production projection (fftoday) and ADP are present and fresh', () => {
    const manifest = manifestWith({
      fftoday_projections: okSource(FRESH),
      adp_active_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('full');
  });

  it('is "projection-only" when ADP is missing entirely', () => {
    const manifest = manifestWith({ fftoday_projections: okSource(FRESH) });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('projection-only');
  });

  it('is "adp-only" when projection is missing entirely', () => {
    const manifest = manifestWith({ adp_active_ppr: okSource(FRESH) });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('adp-only');
  });

  it('is "unavailable" when neither source is present', () => {
    const manifest = manifestWith({});
    expect(resolveDataMode(manifest, { now: NOW })).toBe('unavailable');
  });

  it('treats a stale production projection the same as a missing one', () => {
    const manifest = manifestWith({
      fftoday_projections: okSource(STALE),
      adp_active_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('adp-only');
  });

  it('treats a non-"ok" production projection the same as a missing source', () => {
    const manifest = manifestWith({
      fftoday_projections: { ...okSource(FRESH), status: 'error' },
      adp_active_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('adp-only');
  });

  it('falls back to sleeper_season_projections only when the fftoday key is absent', () => {
    const manifest = manifestWith({
      sleeper_season_projections: okSource(FRESH),
      adp_active_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('full');
  });

  it('does not fall through to a healthy sleeper feed when an unhealthy fftoday key is present', () => {
    // Presence alone selects fftoday_projections; a stale/error fftoday entry must not silently
    // substitute sleeper_season_projections just because that fallback key is also populated.
    const manifest = manifestWith({
      fftoday_projections: okSource(STALE),
      sleeper_season_projections: okSource(FRESH),
      adp_active_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('adp-only');
  });

  it('is "full" when adp_active_ppr is a fresh, ok FFC fallback (health depends on status/freshness, not which upstream won)', () => {
    const manifest = manifestWith({
      fftoday_projections: okSource(FRESH),
      adp_active_ppr: { ...okSource(FRESH), activeAdpSource: 'ffc-fallback' },
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('full');
  });

  it('honors an explicit adpSourceKey override (as DataHealth does per format)', () => {
    const manifest = manifestWith({
      fftoday_projections: okSource(FRESH),
      adp_active_half_ppr: okSource(FRESH),
    });
    expect(resolveDataMode(manifest, { now: NOW })).toBe('projection-only');
    expect(resolveDataMode(manifest, { now: NOW, adpSourceKey: 'adp_active_half_ppr' })).toBe('full');
  });

  it('keeps the four degraded modes distinct — never silently substitutes one signal for the other', () => {
    const full = resolveDataMode(manifestWith({
      fftoday_projections: okSource(FRESH),
      adp_active_ppr: okSource(FRESH),
    }), { now: NOW });
    const projectionOnly = resolveDataMode(manifestWith({
      fftoday_projections: okSource(FRESH),
    }), { now: NOW });
    const adpOnly = resolveDataMode(manifestWith({
      adp_active_ppr: okSource(FRESH),
    }), { now: NOW });
    const unavailable = resolveDataMode(manifestWith({}), { now: NOW });

    expect(full).toBe('full');
    expect(projectionOnly).toBe('projection-only');
    expect(adpOnly).toBe('adp-only');
    expect(unavailable).toBe('unavailable');
    expect(new Set([full, projectionOnly, adpOnly, unavailable]).size).toBe(4);
  });
});
