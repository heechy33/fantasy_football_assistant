import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, Pick, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard, clearSimulationCache, DEFAULT_SCENARIOS, type RecommendationDiagnostics, type RecommendationInput } from './recommend';

/** `diagnostics.simulation.elapsedMs` is a genuinely measured wall-clock duration, not a function of
 * the flag under test — normalize it out before comparing two calls for byte-identical output. */
function normalizeDiagnostics(diagnostics: RecommendationDiagnostics): RecommendationDiagnostics {
  return diagnostics.simulation
    ? { ...diagnostics, simulation: { ...diagnostics.simulation, elapsedMs: 0 } }
    : diagnostics;
}

/**
 * Regression guard for `RecommendationInput.includeAnalysisRows` (benchmarkAvailability.bench.ts's
 * correction 4 — see PLAN.md's S6 gate B). The flag adds an opt-in `analysis` channel; every
 * existing return field must stay byte-identical whether the flag is absent, explicitly `false`, or
 * (for `recommendations`/`diagnostics` specifically) `true` — only the presence of `analysis` itself
 * may differ.
 */

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
function loadRealData<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8')) as T;
}

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'analysis-rows', name: 'Analysis rows', season: '2026', teams: 12,
  startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
  scoring: { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function buildFixtureInput(): { base: RecommendationInput; players: PlayerMeta[]; projections: SeasonProjection[]; adp: AdpEntry[] } {
  const players = loadRealData<PlayerMeta[]>('players.json');
  const projections = loadRealData<SeasonProjection[]>('projections-season.json');
  const adp = loadRealData<AdpEntry[]>('adp-ppr.json');

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

  const base: RecommendationInput = {
    settings, players, projections, adp, picks, myTeamId: 'me',
    nextPick: followUpPick, currentPick: decisionPick, limit: 5, displayPosition: null,
    draftRounds: rounds, rosterSpotsPerTeam: rounds,
    simulation: {
      draftId: 'analysis-rows-fixture', draftType: 'snake', teams, rounds, slotToTeam,
      decisionPick, followUpPick,
      executionMode: { mode: 'fixed', scenarios: DEFAULT_SCENARIOS },
    },
  };
  return { base, players, projections, adp };
}

describe('buildRecommendationBoard includeAnalysisRows (opt-in analysis channel)', () => {
  // Three full Stage C builds in one test, plus the fixed analytic expansion pool's added cost — the
  // default 5s timeout is comfortable in isolation but can brush against it under heavy parallel
  // worker contention in a full-suite run.
  it('omits `analysis` entirely when the flag is absent or false, matching the true-flag run byte-for-byte otherwise', () => {
    const { base } = buildFixtureInput();

    clearSimulationCache();
    const withoutFlag = buildRecommendationBoard(base);
    clearSimulationCache();
    const explicitFalse = buildRecommendationBoard({ ...base, includeAnalysisRows: false });
    clearSimulationCache();
    const explicitTrue = buildRecommendationBoard({ ...base, includeAnalysisRows: true });

    expect('analysis' in withoutFlag).toBe(false);
    expect('analysis' in explicitFalse).toBe(false);
    expect(explicitTrue.analysis).toBeDefined();

    // The only permitted difference between the three calls is the presence of `analysis` itself
    // (and each call's own independently-measured `simulation.elapsedMs`).
    expect(explicitFalse.recommendations).toStrictEqual(withoutFlag.recommendations);
    expect(normalizeDiagnostics(explicitFalse.diagnostics)).toStrictEqual(normalizeDiagnostics(withoutFlag.diagnostics));
    expect(explicitTrue.recommendations).toStrictEqual(withoutFlag.recommendations);
    expect(normalizeDiagnostics(explicitTrue.diagnostics)).toStrictEqual(normalizeDiagnostics(withoutFlag.diagnostics));
  }, 15_000);

  it('pins the exact deterministic-board shape on real committed data (fails loudly on any accidental drift)', () => {
    const { base } = buildFixtureInput();
    clearSimulationCache();
    const result = buildRecommendationBoard(base);
    // `simulation.elapsedMs` is measured wall-clock time — not reproducible across runs/machines,
    // so it's excluded from the pinned snapshot rather than pinning a value that would flake CI.
    expect({ ...result, diagnostics: normalizeDiagnostics(result.diagnostics) }).toMatchSnapshot();
  });

  it('deterministicRows is the full pre-slice evaluated pool; simulatedRows is the actual production rollout output', () => {
    const { base } = buildFixtureInput();
    clearSimulationCache();
    const result = buildRecommendationBoard({ ...base, includeAnalysisRows: true });

    expect(result.analysis).toBeDefined();
    const analysis = result.analysis!;
    expect(analysis.deterministicCandidateCount).toBe(analysis.deterministicRows.length);
    // `deterministicRows` now includes the fixed analytic expansion pool (EXPANSION_DEPTH), which is
    // strictly additive on top of the original rollout/planning candidate set that
    // `candidatesEvaluated` still reports — so the full deterministic pool is always at least as
    // large, never smaller.
    expect(analysis.deterministicRows.length).toBeGreaterThanOrEqual(result.diagnostics.candidatesEvaluated);
    // Stage C is active for this fixture (real follow-up pick, on-clock decision) — the rollout pool
    // is a subset of the deterministic pool, never larger, and every row displayed must appear in it.
    expect(analysis.rolloutPoolSize).toBeGreaterThan(0);
    expect(analysis.rolloutPoolSize).toBeLessThanOrEqual(analysis.deterministicRows.length);
    expect(analysis.simulatedCandidateCount).toBeGreaterThan(0);
    expect(analysis.simulatedCandidateCount).toBeLessThanOrEqual(analysis.rolloutPoolSize);
    for (const displayedRow of result.recommendations) {
      expect(analysis.simulatedRows.some((row) => row.playerId === displayedRow.playerId)).toBe(true);
    }
    // Every actually rolled-out row must also be present, with identical rollout diagnostics, in
    // the deterministic pool — sortSet is built by patching evaluated, not by replacing it.
    const deterministicByPlayerId = new Map(analysis.deterministicRows.map((row) => [row.playerId, row]));
    for (const row of analysis.simulatedRows) {
      if (row.simulatedSurvivalProbability == null) continue;
      expect(deterministicByPlayerId.get(row.playerId)?.simulatedSurvivalProbability)
        .toBe(row.simulatedSurvivalProbability);
    }
  });

  it('returns deterministic analysis rows when Stage C has no simulation context', () => {
    const { base } = buildFixtureInput();
    const { simulation: _simulation, ...withoutSimulation } = base;
    clearSimulationCache();
    const result = buildRecommendationBoard({ ...withoutSimulation, includeAnalysisRows: true });
    expect(result.analysis).toBeDefined();
    expect(result.analysis!.rolloutPoolSize).toBe(0);
    expect(result.analysis!.simulatedCandidateCount).toBe(0);
    expect(result.analysis!.simulatedRows).toStrictEqual(result.analysis!.deterministicRows);
  });

  it('returns deterministic analysis rows when Stage C is off-clock (context present, decisionPick !== currentPick)', () => {
    const { base } = buildFixtureInput();
    // Same vocabulary as recommendSimulation.test.ts / recommend.ts's stageC guard: simulation
    // context is supplied, but decisionPick is not the pick currently on the clock.
    const offClock = {
      ...base,
      currentPick: (base.currentPick as number) + 1,
      simulation: base.simulation,
    };
    clearSimulationCache();
    const result = buildRecommendationBoard({ ...offClock, includeAnalysisRows: true });
    expect(result.analysis).toBeDefined();
    expect(result.diagnostics.simulation).toBeNull();
    expect(result.analysis!.rolloutPoolSize).toBe(0);
    expect(result.analysis!.simulatedCandidateCount).toBe(0);
    expect(result.analysis!.simulatedRows).toStrictEqual(result.analysis!.deterministicRows);
  });
});
