/**
 * Blend-ladder steps C+D (opt-in bench): offline rank-utility screen + board-disagreement probe,
 * per `fixtures/backtest/2025/gates-blend-addendum.md` sections 3-5. Exploratory-only output —
 * informs, never gates, never citable alone (vintage asymmetry).
 *
 * Scoring goes through the REAL `scoreStats` + `BACKTEST_SCORING` (never a re-implementation):
 * the derived artifacts carry raw stat values restricted to the scoring key set, so this module
 * is the single place where frozen 2025 bytes become points. No network; run via
 * `npm run screen:blend`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKTEST_SCORING } from './backtest';
import { gitCommitOrUnknown, repoRoot, reportsDir } from './backtestFixtures';
import { clearSimulationCache } from './recommend';
import { scoreStats } from './scoring';
import type { Position } from '../../../shared/types';

const BLEND_DIR = join(repoRoot, 'fixtures', 'backtest', '2025-blend');
const SCREEN_SEED = 20250823;
const BOOTSTRAP_ITERS = 1000;

interface ProjectionRow { playerId: string; source: string; stats: Record<string, number> }
interface ProjectionArtifact {
  schemaVersion: number; season: string; projections: ProjectionRow[];
}
type PointsByWeek = Record<string, number>;

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** Deterministic PRNG (mulberry32) — bootstrap resampling must be reproducible byte-for-byte. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rankArray(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    const base = indexed[i]!;
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.value === base.value) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.index] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (x[i] ?? 0) - mx, dy = (y[i] ?? 0) - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

export function spearman(pred: readonly number[], actual: readonly number[]): number {
  return pearson(rankArray(pred), rankArray(actual));
}

function topNOverlap(predScores: Map<string, number>, actualTotals: Map<string, number>,
  pool: readonly string[], n: number): number {
  const predTop = [...pool].sort((a, b) => (predScores.get(b) ?? 0) - (predScores.get(a) ?? 0)).slice(0, n);
  const actualTop = [...pool].sort((a, b) => (actualTotals.get(b) ?? 0) - (actualTotals.get(a) ?? 0)).slice(0, n);
  const actualSet = new Set(actualTop);
  return predTop.filter((pid) => actualSet.has(pid)).length / n;
}

interface ScreenEntry {
  spearman: number;
  ciLower: number;
  ciUpper: number;
  top24Overall: number;
  top48Overall: number;
  byPosition: Record<string, { n: number; spearman: number; top24?: number }>;
}

function screenSource(scores: Map<string, number>, actualTotals: Map<string, number>,
  pool: readonly string[], positions: Map<string, Position | null>): ScreenEntry {
  const preds = pool.map((pid) => scores.get(pid) ?? 0);
  const actuals = pool.map((pid) => actualTotals.get(pid) ?? 0);
  const pointEstimate = spearman(preds, actuals);

  // Bootstrap CIs over players (1000 resamples, seed 20250823 — addendum section 4).
  const rng = mulberry32(SCREEN_SEED);
  const bootstrapped: number[] = [];
  for (let iter = 0; iter < BOOTSTRAP_ITERS; iter += 1) {
    const bp: number[] = [], ba: number[] = [];
    for (let i = 0; i < pool.length; i += 1) {
      const idx = Math.floor(rng() * pool.length);
      bp.push(preds[idx] ?? 0); ba.push(actuals[idx] ?? 0);
    }
    const r = spearman(bp, ba);
    if (!Number.isNaN(r)) bootstrapped.push(r);
  }
  bootstrapped.sort((a, b) => a - b);
  const pct = (p: number): number => bootstrapped[Math.floor(p * (bootstrapped.length - 1))] ?? 0;

  const byPosition: ScreenEntry['byPosition'] = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const posPool = pool.filter((pid) => positions.get(pid) === pos);
    if (posPool.length < 20) continue;
    const posPreds = posPool.map((pid) => scores.get(pid) ?? 0);
    const posActuals = posPool.map((pid) => actualTotals.get(pid) ?? 0);
    byPosition[pos] = {
      n: posPool.length,
      spearman: spearman(posPreds, posActuals),
      ...(posPool.length >= 48 ? { top24: topNOverlap(scores, actualTotals, posPool, 24) } : {}),
    };
  }
  return {
    spearman: pointEstimate,
    ciLower: pct(0.025), ciUpper: pct(0.975),
    top24Overall: topNOverlap(scores, actualTotals, pool, 24),
    top48Overall: topNOverlap(scores, actualTotals, pool, 48),
    byPosition,
  };
}

// ---------------------------------------------------------------------------
// Step D — board-disagreement probe
// ---------------------------------------------------------------------------

const ROUND_BANDS = [
  { label: '1-3', minRound: 1, maxRound: 3 },
  { label: '4-8', minRound: 4, maxRound: 8 },
  { label: '9-12', minRound: 9, maxRound: 12 },
  { label: '13-16', minRound: 13, maxRound: 16 },
] as const;

interface WalkResult {
  name: string;
  picks: number;
  disagreements: number;
  rate: number;
  bands: { label: string; picks: number; disagreements: number; rate: number }[];
}

/** Deterministic availability walk: players are removed in `removalOrder` (the world's board);
 * at each of the first 192 picks both candidate boards take their argmax over the same remaining
 * set. Two walks bound the answer from both sides: the market's order (FFC ADP) and the blend's
 * own order (pavg score descending) — neither walk is privileged as "the" baseline. */
export function runDisagreementWalk(name: string, removalOrder: string[],
  scoresA: Map<string, number>, scoresB: Map<string, number>): WalkResult {
  const remaining = new Set(removalOrder.slice(0));
  let disagreements = 0;
  const bandCounts = ROUND_BANDS.map((band) => ({ ...band, picks: 0, disagreements: 0 }));
  for (let pick = 1; pick <= Math.min(192, removalOrder.length); pick += 1) {
    const round = Math.ceil(pick / 12);
    const removedThisPick = removalOrder[pick - 1];
    if (removedThisPick == null) break;
    let bestA: string | null = null, bestB: string | null = null;
    let bestAv = -Infinity, bestBv = -Infinity;
    for (const pid of remaining) {
      const av = scoresA.get(pid) ?? 0, bv = scoresB.get(pid) ?? 0;
      if (av > bestAv) { bestAv = av; bestA = pid; }
      if (bv > bestBv) { bestBv = bv; bestB = pid; }
    }
    const agree = bestA === bestB;
    if (!agree) disagreements += 1;
    const band = bandCounts.find((b) => round >= b.minRound && round <= b.maxRound)!;
    band.picks += 1;
    if (!agree) band.disagreements += 1;
    remaining.delete(removedThisPick);
  }
  return {
    name,
    picks: Math.min(192, removalOrder.length),
    disagreements,
    rate: disagreements / Math.min(192, removalOrder.length),
    bands: bandCounts.map(({ label, picks, disagreements }) => (
      { label, picks, disagreements, rate: picks ? disagreements / picks : 0 })),
  };
}

describe.skipIf(!process.env.BENCHMARK)('blend ladder steps C+D (opt-in, exploratory-only)', () => {
  afterEach(() => {
    clearSimulationCache();
  });

  it('screens {fftoday, sleeper, espn, pavg} against 2025 actuals and probes board disagreement', () => {
    const players = loadJson<{ playerId: string; position: string | null; name: string }[]>(
      join(repoRoot, 'data', 'players.json'));
    const positions = new Map(players.map((p) => [p.playerId, p.position as Position | null]));

    const loadProjections = (file: string): ProjectionRow[] =>
      loadJson<ProjectionArtifact>(join(BLEND_DIR, file)).projections;
    // FFToday stays in its snapshot fixture form ({projections:[...]}) — same row shape.
    const fftoday = loadJson<ProjectionArtifact>(
      join(repoRoot, 'fixtures', 'backtest', '2025', 'projections.json')).projections;
    const sleeper = loadProjections('projections-sleeper.json');
    const espn = loadProjections('projections-espn.json');
    const pavg = loadProjections('projections-pavg.json');

    const outcomesArtifact = loadJson<{ points: Record<string, PointsByWeek> }>(
      join(BLEND_DIR, 'outcomes-weekly-full.json'));
    const actualTotals = new Map<string, number>();
    for (const [pid, byWeek] of Object.entries(outcomesArtifact.points)) {
      let total = 0;
      for (let week = 1; week <= 17; week += 1) total += byWeek[String(week)] ?? 0;
      actualTotals.set(pid, total);
    }

    const scoreAll = (rows: ProjectionRow[]): Map<string, number> =>
      new Map(rows.map((row) => [row.playerId,
        scoreStats(row.stats, BACKTEST_SCORING, positions.get(row.playerId) ?? null).points]));
    const scores: Record<
      'fftoday' | 'sleeper' | 'espn' | 'pavgKeyLevel' | 'pavgPointLevel',
      Map<string, number>
    > = {
      fftoday: scoreAll(fftoday),
      sleeper: scoreAll(sleeper),
      espn: scoreAll(espn),
      pavgKeyLevel: scoreAll(pavg),
      pavgPointLevel: new Map(),
    };
    // Point-level variant (original section-3 wording): mean of per-source scored points over
    // covering sources — computed to measure how far it sits from the key-level blend.
    const sourceMaps = [scores.fftoday, scores.sleeper, scores.espn];
    scores.pavgPointLevel = new Map(pavg.map((row) => {
      let sum = 0, count = 0;
      for (const map of sourceMaps) {
        const value = map.get(row.playerId);
        if (value != null) { sum += value; count += 1; }
      }
      return [row.playerId, count ? sum / count : 0] as const;
    }));

    // Common evaluation pool — the audit's lesson: different pools make correlations
    // incomparable. Primary numbers use one fixed pool covered by ALL candidates.
    const allSets = [fftoday, sleeper, espn, pavg].map((rows) => new Set(rows.map((r) => r.playerId)));
    const commonPool = [...allSets.reduce((acc, set) => new Set([...acc].filter((pid) => set.has(pid))))]
      .filter((pid) => actualTotals.has(pid)).sort();

    const screen: Record<string, ScreenEntry> = {};
    for (const [name, map] of Object.entries(scores)) {
      screen[name] = screenSource(map, actualTotals, commonPool, positions);
    }

    // Step D — two symmetric availability walks (addendum section 5 thresholds).
    const adpRows = loadJson<{ players: { sleeperId: string | null; adp: number }[] }>(
      join(repoRoot, 'fixtures', 'backtest', '2025', 'adp-ppr.json')).players
      .filter((row) => row.sleeperId != null)
      .sort((a, b) => a.adp - b.adp)
      .map((row) => row.sleeperId as string);
    const pavgOrder = [...pavg]
      .sort((a, b) => (scores.pavgKeyLevel.get(b.playerId) ?? 0) - (scores.pavgKeyLevel.get(a.playerId) ?? 0))
      .map((row) => row.playerId);
    const walks = [
      runDisagreementWalk('ffc-adp-order', adpRows, scores.fftoday, scores.pavgKeyLevel),
      runDisagreementWalk('pavg-score-order', pavgOrder, scores.fftoday, scores.pavgKeyLevel),
    ];

    // Pre-declared verdicts.
    const buildThresholdsMet = walks.some((w) => w.rate >= 0.05 || w.bands.some((b) => b.rate >= 0.1));
    const earlyExit = walks.every((w) => w.rate < 0.02 && w.bands.every((b) => b.rate < 0.05));
    const probeVerdict = earlyExit
      ? 'EARLY-EXIT: no material difference detected; keep FFToday, stop the ladder'
      : buildThresholdsMet
        ? 'BUILD: disagreement clears pre-declared thresholds; pilot authorized'
        : 'PROCEED-WITH-NOTE: between thresholds; a null pilot is expected and uninformative';

    const report = {
      report: 'blend-screen-and-disagreement-probe',
      date: new Date().toISOString().slice(0, 10),
      gitCommit: gitCommitOrUnknown(),
      label: 'EXPLORATORY-ONLY: never gating, never citable alone (vintage asymmetry, addendum sections 0/4)',
      commonPoolSize: commonPool.length,
      screen,
      pavgVariantAgreement: {
        note: 'Spearman between key-level and point-level pavg on the common pool',
        spearman: spearman(
          commonPool.map((pid) => scores.pavgKeyLevel.get(pid) ?? 0),
          commonPool.map((pid) => scores.pavgPointLevel.get(pid) ?? 0)),
      },
      probe: {
        walks,
        thresholds: { buildOverall: 0.05, buildBand: 0.1, exitOverall: 0.02, exitBand: 0.05 },
        verdict: probeVerdict,
      },
    };

    expect(commonPool.length).toBeGreaterThan(200);
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(join(reportsDir, '2026-08-23-blend-screen.json'), JSON.stringify(report, null, 1));

    const lines = [
      '# Blend screen + disagreement probe — exploratory-only',
      '',
      `- Generated at: ${new Date().toISOString()}`,
      '- Label: **exploratory-only** — informs, never gates, never citable alone',
      `- Common evaluation pool (all-source coverage ∩ has-outcomes): ${commonPool.length} players`,
      '',
      '| Candidate | Spearman | 95% CI | top-24 | top-48 |',
      '|---|---|---|---|---|',
      ...Object.entries(screen).map(([name, s]) => (
        `| ${name} | ${s.spearman.toFixed(3)} | [${s.ciLower.toFixed(3)}, ${s.ciUpper.toFixed(3)}] `
        + `| ${s.top24Overall.toFixed(3)} | ${s.top48Overall.toFixed(3)} |`)),
      '',
      `pavg key-level vs point-level agreement: Spearman ${report.pavgVariantAgreement.spearman.toFixed(4)}`,
      '',
      '## Disagreement probe (pavg vs fftoday boards)',
      '',
      ...walks.flatMap((w) => [
        `- **${w.name}**: overall rate ${(w.rate * 100).toFixed(1)}% (${w.disagreements}/${w.picks})`,
        ...w.bands.map((b) => `  - rounds ${b.label}: ${(b.rate * 100).toFixed(1)}% (${b.disagreements}/${b.picks})`),
      ]),
      '',
      `**Verdict:** ${probeVerdict}`,
      '',
    ];
    writeFileSync(join(reportsDir, '2026-08-23-blend-screen.md'), lines.join('\n') + '\n');

    console.log(`[screen:blend] pool=${commonPool.length} verdict="${probeVerdict}"`);
    for (const [name, s] of Object.entries(screen)) {
      console.log(`[screen:blend] ${name}: rho=${s.spearman.toFixed(3)} `
        + `[${s.ciLower.toFixed(3)}, ${s.ciUpper.toFixed(3)}]`);
    }
  });
});






