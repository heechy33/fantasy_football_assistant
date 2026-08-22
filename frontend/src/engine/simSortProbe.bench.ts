/**
 * Stage C sim-sort disagreement probe runner (see `simSortProbe.ts`'s module doc for what this
 * measures and why). Opt-in, gated exactly like `backtest.bench.ts` — run with `npm run
 * probe:simsort` (root package.json), never as part of `npm test`.
 *
 * Grid: 12 slots x `PROBE_SEEDS` (default 3) = 36 drafts, ~576 subject-turn observations, ~3-5 min
 * — Stage C dominates cost the same way it does in `backtest.bench.ts`, but this probe runs no
 * scoring against 2025 outcomes, so it is far cheaper than a full arm.
 *
 * Reuses the same frozen 2025 fixtures as the backtest (`backtestFixtures.ts`) so the probe's
 * trajectory is under the identical league/opponent-field conditions the backtest measures outcomes
 * under — a probe run under different conditions would not license a decision about the backtest.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKTEST_TEAMS, buildBacktestContext } from './backtest';
import { gitCommitOrUnknown, loadBacktestFixtures, reportsDir } from './backtestFixtures';
import { clearSimulationCache } from './recommend';
import {
  runSimSortProbeDraft,
  shouldBuildSimSortArm,
  SIM_SORT_BUILD_ARM_THRESHOLDS,
  summarizeSimSortProbe,
  type SimSortObservation,
  type SimSortProbeReport,
} from './simSortProbe';

const SEED_COUNT = Number(process.env.PROBE_SEEDS ?? '3');

describe.skipIf(!process.env.BENCHMARK)('Stage C sim-sort disagreement probe (opt-in)', () => {
  afterEach(() => {
    clearSimulationCache();
  });

  it(
    'walks the engine draft trajectory over the (slot, seed) grid and reports lookahead-vs-planValue disagreement',
    () => {
      expect(SEED_COUNT).toBeGreaterThan(0);

      const { inputs, integrity } = loadBacktestFixtures();
      expect(integrity.missingFromPlayersJson).toEqual([]);
      expect(integrity.unresolvedRows).toEqual([]);

      const ctx = buildBacktestContext(inputs);
      const observations: SimSortObservation[] = [];
      for (let slot = 1; slot <= BACKTEST_TEAMS; slot += 1) {
        for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex += 1) {
          observations.push(...runSimSortProbeDraft(ctx, slot, seedIndex));
        }
      }
      expect(observations.length).toBe(BACKTEST_TEAMS * SEED_COUNT * 16);

      const report = summarizeSimSortProbe(observations);
      writeReport(report, observations.length);
    },
    2 * 60 * 60 * 1000,
  );
});

function fmt(value: number, digits = 3): string {
  return value.toFixed(digits);
}

function writeReport(report: SimSortProbeReport, totalObservations: number): void {
  const reportDate = new Date().toISOString().slice(0, 10);
  const gitCommit = gitCommitOrUnknown();
  const buildArm = shouldBuildSimSortArm(report);

  const reportJson = {
    metadata: {
      generatedAt: new Date().toISOString(),
      gitCommit,
      seedCount: SEED_COUNT,
      slots: BACKTEST_TEAMS,
      totalObservations,
      thresholds: SIM_SORT_BUILD_ARM_THRESHOLDS,
    },
    overall: report.overall,
    byRoundBand: report.byRoundBand,
    noAdpCoverage: report.noAdpCoverage,
    basisCounts: report.basisCounts,
    decision: {
      buildSimSortArm: buildArm,
      rule: 'Build the C1 backtest arm if overall top-1 disagreement >= '
        + `${SIM_SORT_BUILD_ARM_THRESHOLDS.overallTop1DisagreementRate}, OR any round band >= `
        + `${SIM_SORT_BUILD_ARM_THRESHOLDS.roundBandDisagreementRate}, OR the no-ADP-coverage subset `
        + `>= ${SIM_SORT_BUILD_ARM_THRESHOLDS.noAdpCoverageDisagreementRate}.`,
    },
  };

  mkdirSync(reportsDir, { recursive: true });
  const jsonPath = join(reportsDir, `${reportDate}-simsort-disagreement-probe.json`);
  const mdPath = join(reportsDir, `${reportDate}-simsort-disagreement-probe.md`);
  writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2) + '\n');
  writeFileSync(mdPath, renderMd(reportJson, report));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${jsonPath} and ${mdPath}`);
  // eslint-disable-next-line no-console
  console.log(buildArm
    ? 'DECISION: material disagreement found -> build the C1 backtest arm.'
    : 'DECISION: no material disagreement -> Stage C sorting is not a distinct policy under these conditions.');
}

function renderMd(reportJson: Record<string, unknown>, report: SimSortProbeReport): string {
  const meta = reportJson.metadata as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`# Stage C sim-sort disagreement probe — ${String(meta.generatedAt).slice(0, 10)}`);
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- Generated at: ${meta.generatedAt}`);
  lines.push(`- Git commit: ${meta.gitCommit}`);
  lines.push(`- Grid: ${BACKTEST_TEAMS} slots x ${SEED_COUNT} seeds, ${meta.totalObservations} subject-turn observations.`);
  lines.push('- Along the real `engine` draft trajectory (subject always advances on the actual '
    + 'production pick); at every subject turn, records whether a pure Stage C lookahead sort '
    + '(`simSortChoice`) would have chosen a different player.');
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push('| Picks | Disagreements | Rate | Mean Δrank | Mean Spearman (planValue vs lookahead) |');
  lines.push('|---|---|---|---|---|');
  const o = report.overall;
  lines.push(`| ${o.picks} | ${o.disagreements} | ${fmt(o.disagreementRate)} | ${fmt(o.meanDeltaRank, 2)} `
    + `| ${o.meanSpearman == null ? 'n/a' : fmt(o.meanSpearman)} |`);
  lines.push('');
  lines.push('## By round band');
  lines.push('');
  lines.push('| Round | Picks | Disagreements | Rate | Mean Δrank |');
  lines.push('|---|---|---|---|---|');
  for (const { band, bucket } of report.byRoundBand) {
    lines.push(`| ${band.label} | ${bucket.picks} | ${bucket.disagreements} | ${fmt(bucket.disagreementRate)} `
      + `| ${fmt(bucket.meanDeltaRank, 2)} |`);
  }
  lines.push('');
  lines.push('## No-ADP-coverage subset (either the engine pick or the sim pick has no ADP row)');
  lines.push('');
  const n = report.noAdpCoverage;
  lines.push(`- Picks: ${n.picks}, disagreements: ${n.disagreements}, rate: ${fmt(n.disagreementRate)}.`);
  lines.push('');
  lines.push('## Basis counts');
  lines.push('');
  lines.push(`- lookahead: ${report.basisCounts.lookahead}`);
  lines.push(`- special-teams-deferred: ${report.basisCounts['special-teams-deferred']}`);
  lines.push(`- no-lookahead: ${report.basisCounts['no-lookahead']}`);
  lines.push('');
  lines.push('## Decision');
  lines.push('');
  const decision = reportJson.decision as { buildSimSortArm: boolean; rule: string };
  lines.push(`- **${decision.buildSimSortArm ? 'BUILD the C1 arm' : 'DO NOT build the C1 arm'}** — ${decision.rule}`);
  return `${lines.join('\n')}\n`;
}
