/**
 * Reported benchmark for the public Draft Guide's synchronous main-thread engine build — the
 * measurement that settles whether the guide needs the worker escape hatch
 * (`useRecommendationRefinement`). Gated opt-in exactly like `simSortProbe.bench.ts`: run with
 * `BENCHMARK=1 npx vitest run src/engine/draftGuidePerformance.bench.ts`, never as part of `npm test`.
 *
 * The guide input is strictly cheaper than `recommendPerformance.test.ts`'s pinned scenario:
 * myRoster is empty so every lineup step is the cheapest incremental one, planningActive is false
 * (no pairwise loop), and stageC is false (no Monte Carlo). Read that file's doc before touching
 * engine hot paths.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { buildGuideInput } from '../data/guideBoard';
import { buildGuideSettings } from '../data/guideLeagueSettings';
import { buildRecommendationBoard } from './recommend';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
function loadRealData<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

describe.skipIf(!process.env.BENCHMARK)('Draft Guide main-thread board (opt-in reported benchmark)', () => {
  it('builds the full guide board and reports the median duration', () => {
    const settings = buildGuideSettings({ reception: 'ppr', qb: 'one-qb', teams: 12, rounds: 15 });
    const data = {
      players: loadRealData<PlayerMeta[]>('players.json'),
      projections: loadRealData<SeasonProjection[]>('projections-season.json'),
      adp: loadRealData<AdpEntry[]>('adp-ppr.json'),
    };
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      // Warm-up on the first pass; the memoized pipeline means production rebuilds only on a
      // selector change, so each sample here is a cold build by design.
      const start = performance.now();
      const result = buildRecommendationBoard(buildGuideInput(settings, 15, data));
      samples.push(performance.now() - start);
      expect(result.recommendations.length).toBe(200);
    }
    const medianMs = median(samples);
    // Reported, not asserted tight (CI timing is noisy — same convention as recommendPerformance).
    // Escape hatch threshold from the plan: if low-end p95 exceeds ~250ms, wire the worker in.
    // eslint-disable-next-line no-console
    console.log(`[draft-guide-bench] median board build: ${medianMs.toFixed(1)}ms over ${samples.length} runs`);
    expect(medianMs).toBeLessThan(2_000);
  });
});
