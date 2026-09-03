import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, DataManifest, PlayerMeta, PlayerUsageArtifact, ProviderProjectionsArtifact, SeasonProjection } from '../../../shared/types';
import {
  validateAdpProvenance,
  validateAdpRanges,
  validateFiniteProjections,
  validateManifestCrosswalk,
  validatePlayerUsage,
  validateProviderProjections,
  validateUniquePlayerIds,
  validateWeeklyScoring,
  validateWeeklyStats,
} from './dataInvariants';

// Validates the real, committed pipeline output in data/ — not a fixture.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

describe('committed data/*.json invariants', () => {
  it('players.json has unique playerId', () => {
    const players = loadJson<PlayerMeta[]>('players.json');
    expect(players.length).toBeGreaterThan(0);
    expect(validateUniquePlayerIds(players)).toEqual([]);
  });

  it('projections-season.json stats are all finite', () => {
    const projections = loadJson<SeasonProjection[]>('projections-season.json');
    expect(projections.length).toBeGreaterThan(0);
    expect(validateFiniteProjections(projections)).toEqual([]);
  });

  it.each(['adp-standard.json', 'adp-half-ppr.json', 'adp-ppr.json', 'adp-2qb.json'])(
    '%s has non-negative adp/stdev',
    (fileName) => {
      const entries = loadJson<AdpEntry[]>(fileName);
      expect(entries.length).toBeGreaterThan(0);
      expect(validateAdpRanges(entries)).toEqual([]);
    },
  );

  it.each(['adp-standard.json', 'adp-half-ppr.json', 'adp-ppr.json', 'adp-2qb.json'])(
    '%s has valid adpSource/stdevSource provenance and consistent nullability',
    (fileName) => {
      const entries = loadJson<AdpEntry[]>(fileName);
      expect(entries.length).toBeGreaterThan(0);
      expect(validateAdpProvenance(entries)).toEqual([]);
    },
  );

  it('validateAdpProvenance rejects sleeper/observed and ffc/fitted mismatches', () => {
    const sleeperObserved: AdpEntry = {
      playerId: '1', name: 'Bad', position: 'RB', team: 'BUF', adp: 1, stdev: 1,
      high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'sleeper', stdevSource: 'observed',
    };
    const ffcFitted: AdpEntry = {
      playerId: '2', name: 'Also Bad', position: 'WR', team: 'SF', adp: 2, stdev: 1,
      high: 1, low: 5, timesDrafted: 50, byeWeek: 7, adpSource: 'ffc', stdevSource: 'fitted',
    };
    const sleeperWithPopulation: AdpEntry = {
      playerId: '3', name: 'Populated', position: 'TE', team: 'LV', adp: 3, stdev: 1,
      high: 1, low: 5, timesDrafted: 10, byeWeek: null, adpSource: 'sleeper', stdevSource: 'fitted',
    };
    const issues = validateAdpProvenance([sleeperObserved, ffcFitted, sleeperWithPopulation]);
    expect(issues.map((issue) => issue.check).sort()).toEqual([
      'adp-ffc-stdev-observed',
      'adp-sleeper-population-absent',
      'adp-sleeper-stdev-fitted',
    ]);
  });

  it('validateAdpProvenance accepts espn under the Sleeper contract (fitted stdev, null population)', () => {
    const espnGood: AdpEntry = {
      playerId: '1', name: 'Good', position: 'RB', team: 'BUF', adp: 1, stdev: 1,
      high: null, low: null, timesDrafted: null, byeWeek: 7, adpSource: 'espn', stdevSource: 'fitted',
    };
    const espnObserved: AdpEntry = {
      playerId: '2', name: 'Bad', position: 'WR', team: 'SF', adp: 2, stdev: 1,
      high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'espn', stdevSource: 'observed',
    };
    const espnWithPopulation: AdpEntry = {
      playerId: '3', name: 'Populated', position: 'TE', team: 'LV', adp: 3, stdev: 1,
      high: 1, low: 5, timesDrafted: 10, byeWeek: null, adpSource: 'espn', stdevSource: 'fitted',
    };
    expect(validateAdpProvenance([espnGood])).toEqual([]);
    expect(validateAdpProvenance([espnObserved, espnWithPopulation]).map((issue) => issue.check).sort()).toEqual([
      'adp-espn-population-absent',
      'adp-espn-stdev-fitted',
    ]);
  });

  it('validateAdpProvenance accepts yahoo under the Sleeper contract (fitted stdev, null population)', () => {
    const yahooGood: AdpEntry = {
      playerId: '1', name: 'Good', position: 'RB', team: 'BUF', adp: 1, stdev: 1,
      high: null, low: null, timesDrafted: null, byeWeek: 7, adpSource: 'yahoo', stdevSource: 'fitted',
    };
    const yahooObserved: AdpEntry = {
      playerId: '2', name: 'Bad', position: 'WR', team: 'SF', adp: 2, stdev: 1,
      high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'yahoo', stdevSource: 'observed',
    };
    const yahooWithPopulation: AdpEntry = {
      playerId: '3', name: 'Populated', position: 'TE', team: 'LV', adp: 3, stdev: 1,
      high: 1, low: 5, timesDrafted: 10, byeWeek: null, adpSource: 'yahoo', stdevSource: 'fitted',
    };
    expect(validateAdpProvenance([yahooGood])).toEqual([]);
    expect(validateAdpProvenance([yahooObserved, yahooWithPopulation]).map((issue) => issue.check).sort()).toEqual([
      'adp-yahoo-population-absent',
      'adp-yahoo-stdev-fitted',
    ]);
  });

  it('adp-ppr.json is currently the live Sleeper lobby board (canonical path)', () => {
    // Not a hard invariant forever (a real Sleeper outage would legitimately
    // push every format to 'ffc-fallback' for a day), but the committed
    // snapshot in this repo should reflect Sleeper being live and healthy.
    const entries = loadJson<AdpEntry[]>('adp-ppr.json');
    expect(entries.length).toBeGreaterThanOrEqual(250);
    expect(new Set(entries.map((entry) => entry.adpSource))).toEqual(new Set(['sleeper']));
    expect(new Set(entries.map((entry) => entry.stdevSource))).toEqual(new Set(['fitted']));
  });

  it('manifest.json records adp_active_ppr with an explicit activeAdpSource', () => {
    const manifest = loadJson<DataManifest>('manifest.json');
    const active = manifest.sources.adp_active_ppr;
    expect(active?.status).toBe('ok');
    expect(active?.activeAdpSource === 'sleeper' || active?.activeAdpSource === 'ffc-fallback').toBe(true);
  });

  it('manifest.json crosswalk match rate is present and in [0,1]', () => {
    const manifest = loadJson<DataManifest>('manifest.json');
    expect(validateManifestCrosswalk(manifest)).toEqual([]);
  });

  it('player-usage.json has valid prior-season rates and denominators', () => {
    const manifest = loadJson<DataManifest>('manifest.json');
    const usage = loadJson<PlayerUsageArtifact>('player-usage.json');
    expect(validatePlayerUsage(usage, Number(manifest.season))).toEqual([]);
  });

  it('validatePlayerUsage accepts missing production and rejects a mismatched PPG', () => {
    const base: PlayerUsageArtifact = {
      '1': {
        season: 2025, usageSeasonObserved: true, snapPct: 0.5, targetShare: 0.2, carryShare: 0.3,
        gamesWithAnySnap: 10, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
        availabilityRate: 10 / 17,
        seasons: [{ season: 2025, teamGamesWhileRostered: 17, gamesWithAnySnap: 10, availabilityRate: 10 / 17, injuryReportWeeks: 0, outWeeks: 0 }],
        injuryHistory: [], durabilityScore: null, opportunity: null,
      },
    };
    expect(validatePlayerUsage(base, 2026)).toEqual([]);
    expect(validatePlayerUsage({
      '1': {
        ...base['1']!,
        production: {
          games: 10, pointsPpr: 100, pointsPprPerGame: 10,
          receptions: 20, receivingYards: 200, receivingTds: 1, rushingYards: 50, rushingTds: 0,
        },
      },
    }, 2026)).toEqual([]);
    const issues = validatePlayerUsage({
      '1': {
        ...base['1']!,
        production: {
          games: 10, pointsPpr: 100, pointsPprPerGame: 8,
          receptions: -1, receivingYards: 200, receivingTds: 1, rushingYards: 50, rushingTds: 0,
        },
      },
    }, 2026);
    expect(issues.map((issue) => issue.check).sort()).toEqual([
      'context-production-count',
      'context-production-ppg',
    ]);
  });

  it('weekly-ppr.json is valid for the manifest draft season', () => {
    const manifest = loadJson<DataManifest>('manifest.json');
    const weekly = loadJson('weekly-ppr.json');
    expect(validateWeeklyScoring(weekly, Number(manifest.season))).toEqual([]);
  });

  it('validateWeeklyScoring accepts negative points and rejects bad ordering/ranges', () => {
    const valid = {
      schemaVersion: 1,
      season: 2025,
      players: { '1': [{ week: 1, pointsPpr: -2.5 }, { week: 3, pointsPpr: 0 }] },
    };
    expect(validateWeeklyScoring(valid, 2026)).toEqual([]);
    expect(validateWeeklyScoring({ schemaVersion: 1, season: 2025, players: {} }, 2026)).toEqual([]);

    const invalid = {
      ...valid,
      schemaVersion: 0,
      season: 2026,
      players: {
        '1': [
          { week: 3, pointsPpr: 91 },
          { week: 2, pointsPpr: -31 },
          { week: 2, pointsPpr: 1 },
          { week: 23, pointsPpr: Number.NaN },
        ],
      },
    };
    const checks = validateWeeklyScoring(invalid, 2026).map((entry) => entry.check);
    expect(checks).toEqual(expect.arrayContaining([
      'weekly-schema-version',
      'weekly-season',
      'weekly-points-range',
      'weekly-week-order',
      'weekly-duplicate-week',
      'weekly-week-range',
    ]));
  });

  it('weekly-stats.json is valid for the manifest draft season', () => {
    const manifest = loadJson<DataManifest>('manifest.json');
    const weeklyStats = loadJson('weekly-stats.json');
    expect(validateWeeklyStats(weeklyStats, Number(manifest.season))).toEqual([]);
  });

  it('validateWeeklyStats accepts a well-formed artifact', () => {
    const valid = {
      schemaVersion: 1,
      season: 2025,
      weeksFetched: [1, 2, 3],
      columns: { RB: ['pts', 'opp', 'snp', 'fin'] },
      players: {
        '1': { p: 'RB', bye: 9, w: [[1, 12.4, '@KC', 55, 5], [2, 0, 'DAL', 40, 12]] },
      },
      heat: { RB: { pts: [5, 10, 15, 20], opp: null } },
    };
    expect(validateWeeklyStats(valid, 2026)).toEqual([]);
  });

  it('validateWeeklyStats rejects season leakage, bad weeksFetched ordering, and row-width drift', () => {
    const invalid = {
      schemaVersion: 0,
      season: 2026, // not prior to draftSeason=2026 -> leakage
      weeksFetched: [2, 1, 1], // not strictly ascending/unique
      columns: { RB: ['pts', 'opp', 'snp', 'fin'] },
      players: {
        '1': {
          p: 'RB',
          bye: 9,
          // row length 4 != columns[RB].length(4) + 1(week) = 5 -- one short
          w: [[1, 12.4, '@KC', 55]],
        },
        '2': {
          // position not present in `columns` at all
          p: 'QB',
          bye: 7,
          w: [[1, 20, 'DAL', 90, 1]],
        },
      },
      heat: {},
    };
    const checks = validateWeeklyStats(invalid, 2026).map((entry) => entry.check);
    expect(checks).toEqual(expect.arrayContaining([
      'weekly-stats-schema-version',
      'weekly-stats-season',
      'weekly-stats-weeks-fetched-order',
      'weekly-stats-row-width',
      'weekly-stats-series-position',
    ]));
  });

  it('validateWeeklyStats flags a row for a week absent from weeksFetched', () => {
    const invalid = {
      schemaVersion: 1,
      season: 2025,
      weeksFetched: [1], // week 2 never fetched
      columns: { RB: ['pts', 'opp', 'snp', 'fin'] },
      players: { '1': { p: 'RB', bye: 9, w: [[1, 10, 'KC', 50, 1], [2, 8, 'DAL', 60, 2]] } },
      heat: {},
    };
    const checks = validateWeeklyStats(invalid, 2026).map((entry) => entry.check);
    expect(checks).toContain('weekly-stats-row-week-not-fetched');
  });

  it('validateWeeklyStats rejects out-of-range pts and malformed heat breakpoints', () => {
    const invalid = {
      schemaVersion: 1,
      season: 2025,
      weeksFetched: [1],
      columns: { RB: ['pts', 'opp', 'snp', 'fin'] },
      players: { '1': { p: 'RB', bye: 9, w: [[1, 91, 'KC', 50, 1]] } },
      heat: { RB: { pts: [10, 5, 15, 20] } }, // not non-decreasing
    };
    const checks = validateWeeklyStats(invalid, 2026).map((entry) => entry.check);
    expect(checks).toEqual(expect.arrayContaining([
      'weekly-stats-row-pts-range',
      'weekly-stats-heat-breakpoints',
    ]));
  });

  it('projections-providers.json parses as an object, keys exist in players.json, stats finite (legitimate negative stat values are real, e.g. CBS negative rush yards)', () => {
    const artifact = loadJson<ProviderProjectionsArtifact>('projections-providers.json');
    // Object (not an array), displayOnly, and structurally NOT SeasonProjection[].
    expect(validateProviderProjections(artifact)).toEqual([]);
    expect(Array.isArray(artifact)).toBe(false);

    const players = new Set(loadJson<PlayerMeta[]>('players.json').map((p) => p.playerId));
    for (const playerId of Object.keys(artifact.players)) {
      expect(players.has(playerId), `players.json must contain ${playerId}`).toBe(true);
    }
    // The engine's number (projections-season.json) is untouched by this artifact.
    const canonical = loadJson<SeasonProjection[]>('projections-season.json');
    expect(canonical.length).toBeGreaterThan(0);
    const manifest = loadJson<DataManifest>('manifest.json');
    expect(manifest.sources.sleeper_projections?.rows).toBe(artifact.providers.find((provider) => provider.key === 'sleeper')?.rows);
    expect(manifest.sources.espn_projections?.rows).toBe(artifact.providers.find((provider) => provider.key === 'espn')?.rows);
expect(manifest.sources.cbs_projections?.rows).toBe(artifact.providers.find((provider) => provider.key === 'cbs')?.rows);
    expect(manifest.projectionProviders?.providers.sleeper?.status).toBe('ok');
    expect(manifest.projectionProviders?.providers.espn?.status).toBe('ok');
expect(manifest.projectionProviders?.providers.cbs?.status).toBe('ok');
  });
});
