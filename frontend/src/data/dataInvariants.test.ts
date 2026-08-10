import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, DataManifest, PlayerMeta, PlayerUsageArtifact, SeasonProjection } from '../../../shared/types';
import {
  validateAdpProvenance,
  validateAdpRanges,
  validateFiniteProjections,
  validateManifestCrosswalk,
  validatePlayerUsage,
  validateUniquePlayerIds,
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
});
