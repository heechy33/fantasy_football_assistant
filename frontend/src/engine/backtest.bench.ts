/**
 * Historical 2025 draft-strategy backtest runner (PLAN.md Edge Validation Gate, evaluation layer A).
 *
 * Opt-in only, gated exactly like `benchmarkAvailability.bench.ts` — run with `npm run backtest`
 * (root package.json), never as part of `npm test` (the BENCHMARK env guard is what excludes it
 * from the default `vitest run`, matching vite.config.ts's `*.bench.ts` include glob).
 *
 * The engine-family arms dominate runtime: engine/c1 pay Stage C's ~233 ms warm board cost at every
 * one of their 16 picks, with caches effectively cold across drafts (each draft restarts from empty
 * picks, so `teamRosterCache` rebuilds). Measured post-c1-arm, the pilot
 * (`npm run backtest`, 12 slots x 20 seeds = 240 paired drafts) takes ~50-65 min;
 * scaling linearly; the gating run (`$env:BACKTEST_GATING='1'; $env:BACKTEST_SEEDS='84';
 * npm run backtest`, N >= 1,000 paired drafts) applies the pre-declared gates and takes roughly
 * 3.5-4.5 h (inside this test's explicit 6 h timeout — disable OS sleep for the gating run).
 *
 * Inputs (all committed/pinned — see fixtures/backtest/2025/provenance.json):
 * - `fixtures/backtest/2025/adp-ppr.json` — FFC 2025 PPR ADP (verbatim + resolved sleeperId)
 * - `fixtures/backtest/2025/projections.json` — FFToday 2025 (Updated: 8/31/2025, preseason)
 * - `fixtures/backtest/2025/provenance.json` — gate verdicts + SHA-256 pins of the outcome files
 * - `data/players.json` — the draftable player pool
 * - `data/weekly-stats.json` — real 2025 weekly outcomes (`pts` = Sleeper `pts_ppr`)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKTEST_ARMS,
  BACKTEST_BASE_SEED,
  BACKTEST_BOX_POSITIONS,
  BACKTEST_PLAYOFF_START_WEEK,
  BACKTEST_POSITION_CAPS,
  BACKTEST_ROUNDS,
  BACKTEST_SEASON,
  BACKTEST_STARTING_SLOTS,
  BACKTEST_TEAMS,
  buildBacktestContext,
  mean,
  runBacktest,
  type BacktestArm,
  type BacktestIntegrity,
  type BacktestRunResult,
} from './backtest';
import { gitCommitOrUnknown, loadBacktestFixtures, reportsDir } from './backtestFixtures';
import { loadBlendOverrides } from './blendContext';
import { defaultOpponentModelConfig } from './opponentModel';
import { clearSimulationCache } from './recommend';

const SEED_COUNT = Number(process.env.BACKTEST_SEEDS ?? '20');
const GATING = process.env.BACKTEST_GATING === '1';
// C1-attribution diagnostics rerun (2026-08-24 pre-declaration): BACKTEST_DIAGNOSTICS='1' appends a
// distinct stem so an instrumented rerun can never overwrite a committed report. The run itself is
// unchanged — same arms, seeds, and gates; only additive recorded arrays differ.
const DIAGNOSTICS = process.env.BACKTEST_DIAGNOSTICS === '1';
// Saturation dose-response sweep (2026-08-24 pre-declaration in DECISIONS.md): scales the opponent
// model's `shockScale` (priority noise multiplier; default 1 = observed ADP stdev as-is). Opt-in
// only — unset env keeps the committed run byte-for-byte. Scale 0 = deterministic ADP-order field
// (the saturation limit); higher scales make the field less ADP-like. Distinct report stem so a
// sweep run can never overwrite a committed report.
const SHOCK_SCALE_ENV = process.env.BACKTEST_OPPONENT_SHOCK_SCALE;
const SHOCK_SCALE = SHOCK_SCALE_ENV === undefined ? 1 : Number(SHOCK_SCALE_ENV);
if (!Number.isFinite(SHOCK_SCALE) || SHOCK_SCALE < 0) {
  throw new Error(`BACKTEST_OPPONENT_SHOCK_SCALE must be a finite number >= 0, got '${SHOCK_SCALE_ENV}'`);
}
// Blend-ladder pilot (gates-blend-addendum.md section 6): BLENDED_PROJECTIONS/BLENDED_WEEKLY swap
// the run's input context; the resulting report gets a distinct stem so the two contexts never
// overwrite each other. Unset env -> committed FFToday context, byte-for-byte as before.
const BLEND_OVERRIDES = loadBlendOverrides();
const FILE_STEM = (GATING ? '-historical-backtest-2025' : '-historical-backtest-2025-pilot')
  + (BLEND_OVERRIDES ? '-pavg-context' : '')
  + (DIAGNOSTICS ? '-c1-diagnostics' : '')
  + (SHOCK_SCALE_ENV !== undefined && SHOCK_SCALE !== 1 ? `-shockscale${SHOCK_SCALE}` : '');

const ARM_LABELS: Record<BacktestArm, string> = {
  engine: 'Engine (Stage C on)',
  c1: 'C1 — Stage C lookahead sort (informational, non-gating)',
  b4: 'B4 — MRV + tiers, no simulation',
  b3: 'B3 — static VOR (gate baseline)',
  b2: 'B2 — raw projected points',
  b1: 'B1 — FFC ADP',
};

describe.skipIf(!process.env.BENCHMARK)('2025 historical backtest (opt-in, PLAN.md Edge Validation Gate layer A)', () => {
  afterEach(() => {
    clearSimulationCache();
  });

  it(
    'runs the six arms over the paired (slot, seed) grid and writes the report',
    () => {
      expect(SEED_COUNT).toBeGreaterThan(0);

      // -------------------------------------------------------------------
      // Load the frozen fixtures. `loadBacktestFixtures` throws on any leakage/integrity
      // violation (season/SHA-256 pins, FFC identity gate) — see backtestFixtures.ts.
      // -------------------------------------------------------------------
      const { inputs, integrity, provenance } = loadBacktestFixtures({
        projections: BLEND_OVERRIDES?.projections,
        weekly: BLEND_OVERRIDES?.weekly,
      });
      expect(integrity.handMapped.length).toBe(1); // Hollywood Brown -> Marquise Brown (5848)

      const ctx = buildBacktestContext({
        ...inputs,
        projections: BLEND_OVERRIDES?.projections ?? inputs.projections,
        weekly: BLEND_OVERRIDES?.weekly ?? inputs.weekly,
      }, SHOCK_SCALE_ENV !== undefined
        ? { opponentConfig: { ...defaultOpponentModelConfig(BACKTEST_TEAMS, BACKTEST_ROUNDS), shockScale: SHOCK_SCALE } }
        : {});
      // eslint-disable-next-line no-console
      console.log(`[backtest] start: ${GATING ? 'GATING' : 'pilot'} run — `
        + `${SEED_COUNT} seeds/slot x ${BACKTEST_TEAMS} slots = ${BACKTEST_TEAMS * SEED_COUNT} drafts/arm, `
        + `${BACKTEST_ARMS.length} arms (${BACKTEST_ARMS.join(', ')})`);
      if (SHOCK_SCALE_ENV !== undefined) {
        // eslint-disable-next-line no-console
        console.log(`[backtest] shock-scale sweep: opponent shockScale = ${SHOCK_SCALE} `
          + `(default is 1; 0 = deterministic ADP-order field)`);
      }
      if (BLEND_OVERRIDES) {
        // eslint-disable-next-line no-console
        console.log(`[backtest] blend-context inputs: ${BLEND_OVERRIDES.loadedFrom.projections}, `
          + `${BLEND_OVERRIDES.loadedFrom.weekly}`);
      }
      let lastLoggedDecile = 0;
      const result = runBacktest(ctx, {
        seedCount: SEED_COUNT,
        gating: GATING,
        onSlotComplete: (slot, totalSlots, elapsedMs) => {
          // eslint-disable-next-line no-console
          console.log(`[backtest] slot ${slot}/${totalSlots} complete — `
            + `${(elapsedMs / 60000).toFixed(1)} min elapsed`);
        },
        onDraftComplete: (completed, total, elapsedMs) => {
          const decile = Math.floor((completed / total) * 10);
          if (decile <= lastLoggedDecile) return;
          lastLoggedDecile = decile;
          const elapsedMin = elapsedMs / 60000;
          const etaMin = completed > 0 ? (elapsedMin / completed) * (total - completed) : 0;
          // eslint-disable-next-line no-console
          console.log(`[backtest] progress: ${decile * 10}% (${completed}/${total} drafts) — `
            + `${elapsedMin.toFixed(1)} min elapsed, ~${etaMin.toFixed(1)} min remaining`);
        },
      });
      expect(result.arms.engine.drafts).toBe(BACKTEST_TEAMS * SEED_COUNT);
      expect(result.arms.b3.drafts).toBe(BACKTEST_TEAMS * SEED_COUNT);
      expect(result.arms.engine.perDraftMeanWeekly.length).toBe(result.arms.b3.perDraftMeanWeekly.length);

      writeReport(result, integrity, provenance);
    },
    6 * 60 * 60 * 1000,
  );
});

function writeReport(
  result: BacktestRunResult,
  integrity: BacktestIntegrity,
  provenance: Record<string, unknown>,
): void {
  const reportDate = new Date().toISOString().slice(0, 10);
  const gitCommit = gitCommitOrUnknown();

  const reportJson = {
    metadata: {
      generatedAt: new Date().toISOString(),
      gitCommit,
      gating: GATING,
      seedBase: BACKTEST_BASE_SEED,
      seedCount: SEED_COUNT,
      // 2026-08-24 saturation sweep: the opponent model's priority-noise multiplier for this run
      // (default 1). Recorded so sweep artifacts are self-describing.
      shockScale: SHOCK_SCALE,
      slots: BACKTEST_TEAMS,
      teams: BACKTEST_TEAMS,
      rounds: BACKTEST_ROUNDS,
      season: BACKTEST_SEASON,
      draftsPerArm: result.draftsPerArm,
      arms: BACKTEST_ARMS,
      fixtureProvenance: provenance,
    },
    league: {
      startingSlots: BACKTEST_STARTING_SLOTS,
      positionCaps: BACKTEST_POSITION_CAPS,
      playoffStartWeek: BACKTEST_PLAYOFF_START_WEEK,
    },
    integrity,
    arms: Object.fromEntries(BACKTEST_ARMS.map((arm) => {
      const { perDraftMeanWeekly, ...aggregate } = result.arms[arm];
      return [arm, aggregate];
    })),
    perDraftMeanWeekly: Object.fromEntries(BACKTEST_ARMS.map((arm) => [arm, result.arms[arm].perDraftMeanWeekly])),
    // Diagnostics-only (2026-08-24 c1-attribution pre-declaration): positional decomposition of the
    // subject seat's optimized starters plus first-pick timing. Feeds no gate.
    starterPointsByPosition: Object.fromEntries(
      BACKTEST_ARMS.map((arm) => [arm, result.arms[arm].perDraftStarterPointsByPosition]),
    ),
    firstPickRoundByPosition: Object.fromEntries(
      BACKTEST_ARMS.map((arm) => [arm, result.arms[arm].firstPickRoundByPosition]),
    ),
    pairedEngineVsB3: result.pairedEngineVsB3,
    // Informational only (2026-08-22 sim-sort disagreement probe) — never gates. `meanEngine`/
    // `meanBaseline` inside this PairedStats hold c1's/engine's means respectively (see
    // backtest.ts's `pairedC1VsEngine` doc); renderMd relabels them for the report.
    pairedC1VsEngine: result.pairedC1VsEngine,
    gates: result.gates,
  };

  mkdirSync(reportsDir, { recursive: true });
  const jsonPath = join(reportsDir, `${reportDate}${FILE_STEM}.json`);
  const mdPath = join(reportsDir, `${reportDate}${FILE_STEM}.md`);
  writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2) + '\n');
  writeFileSync(mdPath, renderMd(reportJson, result, integrity));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${jsonPath} and ${mdPath}`);
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function renderMd(
  reportJson: Record<string, unknown>,
  result: BacktestRunResult,
  integrity: BacktestIntegrity,
): string {
  const meta = reportJson.metadata as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`# 2025 Historical Backtest report — ${String(meta.generatedAt).slice(0, 10)}`);
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- Generated at: ${meta.generatedAt}`);
  lines.push(`- Git commit: ${meta.gitCommit}`);
  lines.push(`- ${result.gating ? '**Gating run**' : 'Pilot run (directional, non-gating)'} — `
    + `seeds per slot: ${SEED_COUNT}, drafts per arm: ${result.draftsPerArm}, seed base: \`${BACKTEST_BASE_SEED}\``);
  lines.push('- League: 12-team snake PPR, 16 rounds, plain PPR (no TE bonus), '
    + `startingSlots ${BACKTEST_STARTING_SLOTS.join('/')}, playoffStartWeek ${BACKTEST_PLAYOFF_START_WEEK}`);
  lines.push('');
  lines.push('## Integrity (never silently drop)');
  lines.push('');
  lines.push(`- FFC board rows: ${integrity.ffcRows}; resolved to sleeper ids: ${integrity.resolved}.`);
  for (const mapped of integrity.handMapped) {
    lines.push(`- Hand-mapped: FFC "${mapped.ffcName}" (id ${mapped.ffcPlayerId}) -> Sleeper ${mapped.sleeperName} (${mapped.sleeperId}).`);
  }
  lines.push(`- Drafted-but-zero-outcome players (scored 0 all season, never excluded): `
    + (integrity.zeroOutcomeIds.length ? integrity.zeroOutcomeIds.join(', ') : 'none.'));
  lines.push(`- Resolved ids missing from players.json (must be none): `
    + (integrity.missingFromPlayersJson.length ? integrity.missingFromPlayersJson.join(', ') : 'none.'));
  lines.push(`- FFC rows still unresolvable after the hand-map (must be none): `
    + (integrity.unresolvedRows.length ? integrity.unresolvedRows.join(', ') : 'none.'));
  lines.push('');
  lines.push('## Primary metric — mean optimized weekly starter points (weeks 1-17)');
  lines.push('');
  lines.push('| Arm | Drafts | Mean weekly pts | 10th-pct weekly | Replacement-adj | Coverage | H2H win rate | Playoff rate |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const arm of BACKTEST_ARMS) {
    const a = result.arms[arm];
    lines.push(`| ${ARM_LABELS[arm]} | ${a.drafts} | ${fmt(a.meanWeeklyPoints, 3)} | ${fmt(a.p10WeeklyPoints, 3)} `
      + `| ${fmt(a.meanReplacementAdjustedPoints, 1)} | ${fmt(a.meanCoverage, 3)} | ${fmt(a.meanH2hWinRate, 3)} | ${fmt(a.meanPlayoffRate, 3)} |`);
  }
  lines.push('');
  lines.push('## Paired engine vs baseline-3 (static VOR)');
  lines.push('');
  const p = result.pairedEngineVsB3;
  lines.push(`- n = ${p.n} paired drafts. Engine mean ${fmt(p.meanEngine, 3)} vs baseline-3 mean ${fmt(p.meanBaseline, 3)}.`);
  lines.push(`- Mean paired difference (engine - b3): ${fmt(p.meanDiff, 3)} pts/week, SE ${fmt(p.stdErr, 3)}.`);
  lines.push(`- Paired-difference 95% CI: [${fmt(p.ciLower, 3)}, ${fmt(p.ciUpper, 3)}].`);
  lines.push('');
  lines.push('## Subject starter points by position (diagnostics-only — 2026-08-24 c1-attribution pre-declaration)');
  lines.push('');
  lines.push('Mean weekly optimized-starter points attributed to each starter\'s own position '
    + `(weeks 1-17; FLEX points land in the occupant's position, so the six columns sum to the `
    + `arm's mean weekly total). K/TE/DEF are the cap-1 slots (${JSON.stringify({
      TE: BACKTEST_POSITION_CAPS.TE, K: BACKTEST_POSITION_CAPS.K, DEF: BACKTEST_POSITION_CAPS.DEF,
    })}). Paired per-position CIs and the pre-declared flip test are computed offline by `
    + `\`pipeline/analyze_c1_positions.py\`.`);
  lines.push('');
  lines.push('| Arm | QB | RB | WR | TE | K | DEF | K+TE+DEF |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const arm of BACKTEST_ARMS) {
    const byPos = result.arms[arm].perDraftStarterPointsByPosition;
    const cell = (pos: string) => fmt(mean(byPos[pos as keyof typeof byPos] ?? []), 3);
    const cap1 = BACKTEST_BOX_POSITIONS.filter((pos) => pos === 'TE' || pos === 'K' || pos === 'DEF')
      .reduce((sum, pos) => sum + mean(byPos[pos] ?? []), 0);
    lines.push(`| ${ARM_LABELS[arm]} | ${cell('QB')} | ${cell('RB')} | ${cell('WR')} | ${cell('TE')} `
      + `| ${cell('K')} | ${cell('DEF')} | ${fmt(cap1, 3)} |`);
  }
  lines.push('');
  lines.push('Mean round of the subject\'s first pick at each position (lower = earlier; 0 = never drafted):');
  lines.push('');
  lines.push('| Arm | QB | RB | WR | TE | K | DEF |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const arm of BACKTEST_ARMS) {
    const rounds = result.arms[arm].firstPickRoundByPosition;
    const cell = (pos: string) => fmt(mean(rounds[pos as keyof typeof rounds] ?? []), 2);
    lines.push(`| ${ARM_LABELS[arm]} | ${cell('QB')} | ${cell('RB')} | ${cell('WR')} | ${cell('TE')} `
      + `| ${cell('K')} | ${cell('DEF')} |`);
  }
  lines.push('');
  lines.push('## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)');
  lines.push('');
  const c1 = result.pairedC1VsEngine;
  lines.push('- C1 sorts by Stage C\'s simulated `lookaheadValue` instead of the production `planValue`; '
    + 'same Stage C simulation as `engine`, common-random-numbers-paired rollouts '
    + '(`backtest.ts`\'s `simulateDraft` shares `engine`\'s `draftId` for `c1`). Not a gate — see '
    + '`DECISIONS.md`\'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.');
  lines.push(`- n = ${c1.n} paired drafts. C1 mean ${fmt(c1.meanEngine, 3)} vs engine mean ${fmt(c1.meanBaseline, 3)}.`);
  lines.push(`- Mean paired difference (c1 - engine): ${fmt(c1.meanDiff, 3)} pts/week, SE ${fmt(c1.stdErr, 3)}.`);
  lines.push(`- Paired-difference 95% CI: [${fmt(c1.ciLower, 3)}, ${fmt(c1.ciUpper, 3)}].`);
  lines.push('');
  lines.push('## Gate verdicts');
  lines.push('');
  for (const gate of result.gates) {
    if (gate.label === 'pilot') {
      lines.push(`- **Pilot (non-gating)**: verdicts not applied — ${gate.detail}`);
    } else {
      lines.push(`- **${gate.label}**: ${gate.holds ? 'PASS' : 'FAIL'} — ${gate.detail}`);
    }
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` '
    + '(documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, '
    + 'but it is load-bearing as the field policy.');
  lines.push('- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all '
    + '(draft, week) cells, weeks 1-17.');
  lines.push('- FFC\'s board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage '
    + 'and rely on the opponent model\'s documented synthetic-ADP fallback.');
  lines.push(`- Determinism: rerunning with the same seed set reproduces the same ${result.draftsPerArm}-draft grid; `
    + 'only `metadata.generatedAt`/`gitCommit` differ between runs.');
  return `${lines.join('\n')}\n`;
}

