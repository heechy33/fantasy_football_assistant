import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, Pick, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard, clearSimulationCache, DEFAULT_SCENARIOS } from './recommend';

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
    // pin down a specific fast number that could vary by CI hardware. Full-suite parallel load has
    // pushed the median to ~1.1s, so 1400ms keeps a ceiling below the historical regression floor
    // while tolerating that noise (the solo run is ~100ms).
    expect(med).toBeLessThan(1400);
  }, 30000);
});

/**
 * Stage C's worst-case rollout window: a 12-team, 16-round snake draft, user in slot 1. Slot 1's
 * on-the-clock overall is `round * teams` on even rounds and `(round - 1) * teams + 1` on odd
 * rounds (see draftOrder.ts's `nextPickForTeam`), which for round 15 gives decisionPick 169 and
 * round 16 gives followUpPick 192 — a 22-pick opponent window, the longest a 12-team snake ever
 * produces. 14 completed rounds (picks 1-168) leave the user with exactly 14 incumbents and a real
 * follow-up remaining, so this never degenerates to the final-pick MRV collapse.
 *
 * This exercises the *extended* rollout pool from `buildRolloutPool`'s per-position `displayLimit`
 * term: at 14 picks made (2 remaining of 16), D/ST goes "due" (see recommend.ts's late-draft
 * schedule), which puts K/DEF at the head of the deterministic order and lets them consume part of
 * the global top-`rolloutLimit` term — exactly the interaction the per-position backfill exists for.
 */
function buildWorstCaseStageCFixture() {
  const players = loadRealData<PlayerMeta[]>('players.json');
  const projections = loadRealData<SeasonProjection[]>('projections-season.json');
  const adp = loadRealData<AdpEntry[]>('adp-ppr.json');

  const settings: LeagueSettings = {
    provider: 'sleeper', leagueId: 'stage-c-worst-case', name: 'Stage C worst case', season: '2026', teams: 12,
    startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
    rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
    scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  };
  const teams = 12;
  const rounds = 16;
  const slotForOverall = (overall: number) => {
    const round = Math.ceil(overall / teams);
    const posInRound = overall - (round - 1) * teams;
    return round % 2 === 0 ? teams - posInRound + 1 : posInRound;
  };
  const slotToTeam: Record<number, string> = {};
  for (let slot = 1; slot <= teams; slot += 1) slotToTeam[slot] = slot === 1 ? 'me' : `opp-${slot}`;

  const topByAdp = adp
    .filter((entry): entry is AdpEntry & { playerId: string } => entry.playerId != null)
    .sort((a, b) => a.adp - b.adp)
    .slice(0, 14 * teams);
  const picks: Pick[] = topByAdp.map((entry, index) => {
    const overall = index + 1;
    const slot = slotForOverall(overall);
    return { overall, round: Math.ceil(overall / teams), slot, teamId: slotToTeam[slot] as string, playerId: entry.playerId, providerPlayerId: entry.playerId };
  });

  const decisionPick = 169;
  const followUpPick = 192;

  const run = () => buildRecommendationBoard({
    settings, players, projections, adp, picks, myTeamId: 'me',
    nextPick: followUpPick, currentPick: decisionPick, limit: 5, displayPosition: null,
    draftRounds: rounds, rosterSpotsPerTeam: rounds,
    simulation: {
      draftId: 'stage-c-worst-case', draftType: 'snake', teams, rounds, slotToTeam,
      decisionPick, followUpPick,
      executionMode: { mode: 'fixed', scenarios: DEFAULT_SCENARIOS_FOR_TEST },
    },
  });

  return { run, picks, teams, rounds, decisionPick, followUpPick };
}

// Placeholder overridden per-call below; the fixture's `run()` closes over whatever this constant
// was when `buildWorstCaseStageCFixture` executed, so each test builds its own fixture per count.
let DEFAULT_SCENARIOS_FOR_TEST = 50;

function runStageCAt(scenarios: number) {
  DEFAULT_SCENARIOS_FOR_TEST = scenarios;
  const fixture = buildWorstCaseStageCFixture();
  return fixture;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[index] as number;
}

/**
 * Exploratory sweep across scenario counts, cold-cache (every sample clears both Stage C caches).
 * Not part of the default `npm test` run — too slow for routine CI. Run explicitly with
 * `STAGE_C_BENCH=1 npx vitest run src/engine/recommendPerformance.test.ts`.
 *
 * Useful for understanding the *cold* cost curve (first Stage C-eligible turn of a session), but
 * `DEFAULT_SCENARIOS` (recommend.ts) was NOT selected from this sweep's numbers — cold cost is
 * dominated by fixed one-time overhead that has nothing to do with scenario count, and the cold
 * case is rare in practice. The real selection used the *warm* measurement below instead — see
 * `DEFAULT_SCENARIOS`'s doc in recommend.ts for the actual numbers and reasoning. If this file's
 * fixtures or the engine change enough to warrant recalibration, re-run both this sweep (for the
 * cold-case shape) and the warm test below (for the actual selection) — set
 * `STAGE_C_BENCH_COUNTS=5,8,10,25` and `STAGE_C_BENCH_SAMPLES=20` to control this sweep.
 */
describe.skipIf(!process.env.STAGE_C_BENCH)('Stage C scenario-count sweep (opt-in, PLAN.md S3 selection gate)', () => {
  it('measures p95 latency at each candidate scenario count on the worst-case rollout window', () => {
    const counts = process.env.STAGE_C_BENCH_COUNTS
      ? process.env.STAGE_C_BENCH_COUNTS.split(',').map(Number)
      : [10, 25, 50, 100, 200];
    const sampleCount = process.env.STAGE_C_BENCH_SAMPLES ? Number(process.env.STAGE_C_BENCH_SAMPLES) : 20;
    const table: { scenarios: number; p95: number; median: number }[] = [];
    for (const scenarios of counts) {
      const { run } = runStageCAt(scenarios);
      const warmupStart = performance.now();
      run(); // warm-up (JIT + static fingerprint caches), not counted
      // eslint-disable-next-line no-console
      console.log(`  [scenarios=${scenarios}] warm-up took ${(performance.now() - warmupStart).toFixed(1)}ms`);
      const durations: number[] = [];
      for (let i = 0; i < sampleCount; i += 1) {
        clearSimulationCache(); // force a cache miss every sample — this measures the cold-run cost
        const start = performance.now();
        run();
        durations.push(performance.now() - start);
      }
      table.push({ scenarios, p95: p95(durations), median: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] as number });
    }
    // eslint-disable-next-line no-console
    console.log('Stage C scenario-count sweep (worst-case 22-pick window, 12 teams x 16 rounds):');
    for (const row of table) {
      // eslint-disable-next-line no-console
      console.log(`  scenarios=${row.scenarios}\tp95=${row.p95.toFixed(1)}ms\tmedian=${row.median.toFixed(1)}ms`);
    }
    const eligible = table.filter((row) => row.p95 <= 250);
    // eslint-disable-next-line no-console
    console.log(`Highest scenario count with p95 <= 250ms: ${eligible.length ? Math.max(...eligible.map((row) => row.scenarios)) : 'NONE — escalate to Web Worker'}`);
    expect(table.length).toBe(counts.length);
  }, 600_000);
});

/**
 * Permanent regression guards for the shipped Stage C default (`DEFAULT_SCENARIOS`). Two separate
 * cases, because they measure genuinely different costs — see `DEFAULT_SCENARIOS`'s doc in
 * recommend.ts for why the *warm* case (second test below), not this cold one, is what the default
 * was actually selected against: cold is dominated by fixed one-time overhead (a from-scratch
 * `buildTeamRosters`, the widened deterministic prefilter) that only the very first Stage
 * C-eligible turn of a session ever pays, while every subsequent turn is the warm case. Both
 * ceilings below are generous on purpose — they exist to catch a real regression (e.g. an
 * accidental O(n^2) reintroduced upstream), not to pin a tight number.
 */
describe('buildRecommendationBoard Stage C performance (worst-case rollout window)', () => {
  it('stays well under a generous ceiling for the shipped default scenario count', () => {
    const { run } = runStageCAt(DEFAULT_SCENARIOS);

    const sample = run();
    expect(sample.diagnostics.simulation).not.toBeNull();
    expect(sample.diagnostics.simulation?.scenariosRun).toBe(DEFAULT_SCENARIOS);

    run(); // warm-up
    const SAMPLES = 7;
    const durations: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      clearSimulationCache();
      const start = performance.now();
      run();
      durations.push(performance.now() - start);
    }
    const med = median(durations);
    // eslint-disable-next-line no-console
    console.log(`Stage C worst-case median over ${SAMPLES} cold-cache runs at ${DEFAULT_SCENARIOS} scenarios: ${med.toFixed(2)}ms (min ${Math.min(...durations).toFixed(2)}ms, max ${Math.max(...durations).toFixed(2)}ms)`);
    // Measured ~900-1150ms at DEFAULT_SCENARIOS=8 (2026-08-10) — genuinely slower than the warm
    // case by design (see this describe block's doc), so this ceiling is deliberately looser than
    // the warm test's. 3s is PLAN.md's clock-test budget; the cold case is a rare one-time cost and
    // the worst median observed under full-suite parallel load (~2.1s) still clears it.
    expect(med).toBeLessThan(3000);
  }, 30_000);

  /**
   * The cold-cache guard above intentionally clears both Stage C caches every sample — it measures
   * a genuine upper bound, but it is *not* what a live draft actually does. Stage C only ever runs
   * while `decisionPick === currentPick` (`recommend.ts`'s `stageC` guard): during the ~20-pick
   * window opponents take between the user's two turns, every poll tick falls back to the cheap S2
   * board, never touching Stage C at all. Stage C's caches only need to be fast for two cases: the
   * *first* poll tick of a user's turn (this file's cold guard covers that), and every *subsequent*
   * poll tick during the same turn while the user is still deciding — which is a pure
   * `simulationCache` hit (near-instant, not measured here) unless a pick landed in between.
   *
   * This test covers the case in between: the *next* time Stage C actually runs after some — here,
   * 24 — picks have landed since the last run, none of them a manual correction. `teamRosterCache`
   * should extend its previous prefix incrementally rather than re-solving all 12 opponent lineups
   * from scratch, and `playerFingerprint`/`adpFingerprintById` should hit outright (same array
   * references). Deliberately does *not* call `clearSimulationCache()` between the two calls. This
   * is the measurement `DEFAULT_SCENARIOS` (recommend.ts) was actually chosen against.
   */
  it('a subsequent Stage C call after new picks land is fast even without clearing caches', () => {
    const players = loadRealData<PlayerMeta[]>('players.json');
    const projections = loadRealData<SeasonProjection[]>('projections-season.json');
    const adp = loadRealData<AdpEntry[]>('adp-ppr.json');
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'stage-c-followup', name: 'Stage C follow-up', season: '2026', teams: 12,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
      scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const teams = 12;
    const rounds = 16;
    const slotForOverall = (overall: number) => {
      const round = Math.ceil(overall / teams);
      const posInRound = overall - (round - 1) * teams;
      return round % 2 === 0 ? teams - posInRound + 1 : posInRound;
    };
    const slotToTeam: Record<number, string> = {};
    for (let slot = 1; slot <= teams; slot += 1) slotToTeam[slot] = slot === 1 ? 'me' : `opp-${slot}`;
    const topByAdp = adp
      .filter((entry): entry is AdpEntry & { playerId: string } => entry.playerId != null)
      .sort((a, b) => a.adp - b.adp)
      .slice(0, teams * rounds);
    const picksThrough = (count: number): Pick[] => topByAdp.slice(0, count).map((entry, index) => {
      const overall = index + 1;
      const slot = slotForOverall(overall);
      return { overall, round: Math.ceil(overall / teams), slot, teamId: slotToTeam[slot] as string, playerId: entry.playerId, providerPlayerId: entry.playerId };
    });

    // Slot 1 in a 12-team snake alternates window length every turn: an even-round pick is adjacent
    // to the next (odd-round) one — zero-pick window, `simulateOpponentWindow` does nothing — while
    // an odd-round pick faces the full 22-pick window before the next (even-round) one. Both turns
    // below are deliberately the odd-round case, so *each* one actually exercises the scenario loop
    // (a null- or zero-window followUp would never touch it at all, defeating this test's purpose).
    const firstTurn = () => buildRecommendationBoard({
      settings, players, projections, adp, picks: picksThrough(12 * teams), myTeamId: 'me',
      nextPick: 168, currentPick: 145, limit: 5, displayPosition: null, draftRounds: rounds, rosterSpotsPerTeam: rounds,
      simulation: { draftId: 'stage-c-followup', draftType: 'snake', teams, rounds, slotToTeam, decisionPick: 145, followUpPick: 168, executionMode: { mode: 'fixed', scenarios: DEFAULT_SCENARIOS } },
    });
    // 24 more picks landed since the user's last turn (rounds 13-14 completing, their own round-15
    // pick included) — this is the exact worst-case fixture above, reached as a *second* Stage C
    // call instead of a cold first one. `draftId` varies per sample so `simulationCache` (keyed on
    // it) misses every time — a fresh miss is the realistic case (a new pick genuinely changes the
    // pick signature) — while `teamRosterCache` (keyed only on picks+settings, not draftId) stays
    // warm across every sample after the first, since all 7 share the identical 168-pick prefix,
    // itself a genuine extension of firstTurn's cached 144-pick prefix.
    const secondTurn = (sample: number) => buildRecommendationBoard({
      settings, players, projections, adp, picks: picksThrough(14 * teams), myTeamId: 'me',
      nextPick: 192, currentPick: 169, limit: 5, displayPosition: null, draftRounds: rounds, rosterSpotsPerTeam: rounds,
      simulation: { draftId: `stage-c-followup-${sample}`, draftType: 'snake', teams, rounds, slotToTeam, decisionPick: 169, followUpPick: 192, executionMode: { mode: 'fixed', scenarios: DEFAULT_SCENARIOS } },
    });

    clearSimulationCache();
    firstTurn(); // cold — populates both caches as of the 168-pick prefix
    firstTurn(); // JIT warm-up of the identical call, not counted
    secondTurn(-1); // JIT warm-up of the transition itself (still populates teamRosterCache for real)

    const durations: number[] = [];
    let lastResult: ReturnType<typeof secondTurn> | undefined;
    for (let i = 0; i < 7; i += 1) {
      const start = performance.now();
      lastResult = secondTurn(i);
      durations.push(performance.now() - start);
    }
    // Sanity: confirms this scenario genuinely exercises the scenario loop (a null/zero-window
    // follow-up would silently report scenariosRun: 0 and make this whole test meaningless).
    expect(lastResult?.diagnostics.simulation?.scenariosRun).toBe(DEFAULT_SCENARIOS);
    const med = median(durations);
    // eslint-disable-next-line no-console
    console.log(`Stage C follow-up-turn median over 7 warm-cache runs: ${med.toFixed(2)}ms (min ${Math.min(...durations).toFixed(2)}ms, max ${Math.max(...durations).toFixed(2)}ms)`);
    // Raised from 500ms: the fixed analytic expansion pool (EXPANSION_DEPTH, recommend.ts) adds a
    // bounded, real cost to every call so up to 20 display rows are available without inflating
    // Stage C's own rollout size — isolated runs measure ~300-350ms here; this ceiling keeps margin
    // for parallel-worker contention in a full-suite run, consistent with this file's "generous
    // ceiling, not a tight bound" philosophy (see the module doc above).
    expect(med).toBeLessThan(900);
  }, 30_000);
});
