import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { buildGuideInput, deriveGuideRows, sortGuideRows } from './guideBoard';
import { buildProviderColumn, unavailableProviderColumn } from './guideProviderColumns';
import { buildGuideSettings } from './guideLeagueSettings';
import { buildRecommendationBoard } from '../engine/recommend';

/**
 * The public Draft Guide's engine contract, verified against the REAL committed `data/` artifacts
 * (same no-mocks convention as the engine tests). These pin the three configuration traps from
 * DECISIONS.md 2026-08-25: full-length board (not the default limit of 3), the no-lost-player
 * union across engine + ADP lanes, and never surfacing seat-dependent numbers to anonymous users.
 */

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
function loadRealData<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

const players = loadRealData<PlayerMeta[]>('players.json');
const projections = loadRealData<SeasonProjection[]>('projections-season.json');
const adpPpr = loadRealData<AdpEntry[]>('adp-ppr.json');
const adpStandard = loadRealData<AdpEntry[]>('adp-standard.json');

const settingsPpr = buildGuideSettings({ reception: 'ppr', qb: 'one-qb', teams: 12, rounds: 15 });
const settingsStandard = buildGuideSettings({ reception: 'standard', qb: 'one-qb', teams: 12, rounds: 15 });

function buildRows(settings = settingsPpr, adp = adpPpr) {
  const input = buildGuideInput(settings, 15, { players, projections, adp });
  return buildRecommendationBoard(input);
}

describe('guideBoard against real data/', () => {
  it('builds a FULL-length board — not the default limit of 3', () => {
    const result = buildRows();
    // The explicit limit is 200 (the engine's scored ceiling is ~414); anything under a few
    // hundred means the explicit `limit` was lost and the input defaulted to 3.
    expect(result.recommendations.length).toBe(200);
  }, 30_000);

  it('unions engine-scored players with the ADP lane — ADP-only rows are present, not dropped', () => {
    const result = buildRows();
    const rows = deriveGuideRows(result, adpPpr, new Map(players.map((p) => [p.playerId, p])));
    // adp-ppr has 1,545 entries but only ~308 overlap projections; the union must keep them all.
    expect(rows.length).toBeGreaterThanOrEqual(adpPpr.length - 5);
    const unscored = rows.filter((row) => row.engineRank == null);
    // The majority of the ppr lane has no engine score — they must still be visible rows
    // (the table renders an em-dash for their engine rank).
    expect(unscored.length).toBeGreaterThan(1_000);
    for (const row of unscored) {
      expect(row.adpEntry).not.toBeNull();
    }
  }, 30_000);

  it('never surfaces seat-dependent numbers without a draft seat', () => {
    const result = buildRows();
    for (const recommendation of result.recommendations) {
      // myTeamId: null / nextPick: null must mean planningActive and stageC stay off.
      expect(recommendation.availableNextPickProbability).toBeNull();
      expect(recommendation.vona ?? null).toBeNull();
    }
  }, 30_000);

  it('reorders when scoring changes (standard vs ppr)', () => {
    const pprTop = buildRows().recommendations.slice(0, 25).map((r) => r.playerId);
    const standardTop = buildRows(settingsStandard, adpStandard).recommendations.slice(0, 25).map((r) => r.playerId);
    expect(pprTop.length).toBe(25);
    expect(standardTop.length).toBe(25);
    // A single elite player can top both formats — assert the ORDERING shifts somewhere in the
    // top 25 rather than requiring a different #1.
    expect(pprTop.some((id, index) => standardTop[index] !== id)).toBe(true);
  }, 60_000);

  it('sorts by a sparse lane with missing players LAST — never rank 0, never dropped', () => {
    const result = buildRows();
    const rows = deriveGuideRows(result, adpPpr, new Map(players.map((p) => [p.playerId, p])));
    const sample = rows.slice(0, 100);
    const engineRankByPlayer = new Map(result.recommendations.map((r, i) => [r.playerId, i + 1]));
    // FFC standard (~221 rows) is genuinely sparse vs the guide's ~1,500-row universe.
    const ffcSparse = buildProviderColumn('ffc', 'FFC', adpStandard);
    const sleeperFull = buildProviderColumn('sleeper', 'Sleeper', adpPpr);
    const sorted = sortGuideRows(sample, 'ffc', {
      sleeper: sleeperFull,
      espn: unavailableProviderColumn('espn', 'ESPN'),
      ffc: ffcSparse,
      underdog: unavailableProviderColumn('underdog', 'Underdog'),
    }, engineRankByPlayer);

    expect(sorted.length).toBe(sample.length); // nothing dropped
    const missingCount = sorted.filter((row) => !ffcSparse.rankByPlayer.has(row.playerId)).length;
    // Rows missing from the lane occupy exactly the tail — em-dash upstream, never rank 0.
    const tail = sorted.slice(sorted.length - missingCount);
    const head = sorted.slice(0, sorted.length - missingCount);
    expect(missingCount).toBeGreaterThan(0);
    expect(head.length).toBeGreaterThan(0);
    for (const row of head) {
      expect(ffcSparse.rankByPlayer.has(row.playerId)).toBe(true);
    }
    for (const row of tail) {
      expect(ffcSparse.rankByPlayer.has(row.playerId)).toBe(false);
    }
  }, 30_000);
});
