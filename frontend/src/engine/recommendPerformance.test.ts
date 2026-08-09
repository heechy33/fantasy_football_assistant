import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, Pick, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard } from './recommend';

/**
 * S3.1's whole reason for existing: `buildRecommendationBoard` used to call the exponential
 * bitmask DP (`optimizeLineup`) once per candidate. A faithful benchmark port measured that at
 * ~33ms/solve for a full 15-man roster — with ~40-70 candidates evaluated per board, that put the
 * S2 board at an estimated 1.5-2.3s on the main thread, a latent S5 clock-test failure. The
 * `prepareLineup`/`addPlayerToLineup` incremental path (see eligibility.ts) replaces that with one
 * base solve plus an O(slots^2) step per candidate.
 *
 * This is a reported benchmark, not a strict per-run assertion — CI timing is noisy, so this warms
 * up, samples several runs, and checks the median against a generous ceiling rather than asserting
 * a tight bound that would be flaky. See PLAN.md's S3 stage-A performance-gate note.
 */

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
function loadRealData<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'perf', name: 'Perf', season: '2026', teams: 10,
  startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
  scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

describe('buildRecommendationBoard performance (S3.1 regression guard)', () => {
  it('stays well under a generous ceiling with a near-full 15-man roster on real committed data', () => {
    const players = loadRealData<PlayerMeta[]>('players.json');
    const projections = loadRealData<SeasonProjection[]>('projections-season.json');
    const adp = loadRealData<AdpEntry[]>('adp-ppr.json');

    const teams = 10;
    const rounds = 15;
    const topByAdp = adp
      .filter((entry): entry is AdpEntry & { playerId: string } => entry.playerId != null)
      .sort((a, b) => a.adp - b.adp)
      .slice(0, teams * rounds);
    const slotForOverall = (overall: number) => {
      const round = Math.ceil(overall / teams);
      const posInRound = overall - (round - 1) * teams;
      return round % 2 === 0 ? teams - posInRound + 1 : posInRound;
    };
    // 'me' holds slot 3 and so has a full 15-player roster (1/round) by the end of this list —
    // the expensive case per the eligibility.ts benchmark.
    const picks: Pick[] = topByAdp.map((entry, index) => {
      const overall = index + 1;
      const slot = slotForOverall(overall);
      const teamId = slot === 3 ? 'me' : `opp-${slot}`;
      return { overall, round: Math.ceil(overall / teams), slot, teamId, playerId: entry.playerId, providerPlayerId: entry.playerId };
    });

    const run = () => buildRecommendationBoard({
      settings, players, projections, adp, picks, myTeamId: 'me', nextPick: picks.length + teams, currentPick: picks.length + 1, limit: 5,
    });

    // Sanity: this scenario actually exercises a near-full roster, not an accidentally-empty one.
    const sample = run();
    const myRosterSize = picks.filter((p) => p.teamId === 'me').length;
    expect(myRosterSize).toBeGreaterThanOrEqual(14);
    expect(sample.recommendations.length).toBeGreaterThan(0);

    run(); // warm-up (JIT), not counted
    const SAMPLES = 15;
    const durations: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const start = performance.now();
      run();
      durations.push(performance.now() - start);
    }

    const med = median(durations);
    // eslint-disable-next-line no-console
    console.log(`buildRecommendationBoard median over ${SAMPLES} runs at a full 15-man roster: ${med.toFixed(2)}ms (min ${Math.min(...durations).toFixed(2)}ms, max ${Math.max(...durations).toFixed(2)}ms)`);

    // Generous, non-flaky ceiling. The pre-S3.1 full-DP-per-candidate approach was measured at
    // ~1.5-2.3s in this exact scenario; this only needs to confirm we're nowhere near that, not
    // pin down a specific fast number that could vary by CI hardware.
    expect(med).toBeLessThan(250);
  });
});
