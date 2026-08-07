import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, DataManifest, PlayerMeta, SeasonProjection } from '../../../shared/types';
import {
  validateAdpRanges,
  validateFiniteProjections,
  validateManifestCrosswalk,
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

  it('manifest.json crosswalk match rate is present and in [0,1]', () => {
    const manifest = loadJson<DataManifest>('manifest.json');
    expect(validateManifestCrosswalk(manifest)).toEqual([]);
  });
});
