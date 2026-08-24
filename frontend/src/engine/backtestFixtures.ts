/**
 * Shared frozen-2025-fixture loading for the backtest family (`backtest.bench.ts`,
 * `simSortProbe.bench.ts`). Extracted so the leakage/integrity assertions live in exactly one place
 * — duplicating a fail-closed check across two benches invites the two copies to silently drift.
 *
 * Node-only (uses `node:fs`/`node:crypto`); never imported by `backtest.ts` or `simSortProbe.ts`
 * themselves, which stay pure per their own module docs. Throws on any leakage/integrity violation —
 * callers should let that propagate as a hard bench failure, not catch it.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlayerMeta, PlayerWeeklyStatsArtifact, SeasonProjection } from '../../../shared/types';
import { validateWeeklyStats } from '../data/dataInvariants';
import { ffcRowsToAdpEntries, verifyBacktestIntegrity, type BacktestInputs, type BacktestIntegrity, type FfcAdpRow } from './backtest';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const backtestDir = join(repoRoot, 'fixtures', 'backtest', '2025');
export const dataDir = join(repoRoot, 'data');
export const reportsDir = join(repoRoot, 'benchmarks', 'reports');

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export interface LoadedBacktestFixtures {
  inputs: BacktestInputs;
  integrity: BacktestIntegrity;
  provenance: Record<string, unknown>;
}

export interface FixtureOverrides {
  projections?: SeasonProjection[];
  weekly?: PlayerWeeklyStatsArtifact;
}

/** Loads `fixtures/backtest/2025/` + `data/players.json` + `data/weekly-stats.json`, verifies the
 * snapshot's leakage assertions (season < 2026, SHA-256 pins match the live `data/` bytes) and the
 * FFC->sleeper identity gate, and throws if any of it fails. Mirrors what
 * `backtest.bench.ts` did inline before this file existed — behavior is unchanged, only the location
 * moved.
 *
 * `overrides` (blend-ladder pilot only) replaces the projection/outcome INPUTS while keeping every
 * identity/integrity check that does not depend on the replaced file: the overridden projections
 * skip nothing (the FFC identity gate is about ADP rows), and an overridden weekly artifact still
 * runs `validateWeeklyStats`. SHA-256 pins apply to the committed files they name; a blend-context
 * run pins its own inputs via `blendContext.ts` instead. With no overrides this function behaves
 * exactly as before — byte-for-byte. */
export function loadBacktestFixtures(overrides: FixtureOverrides = {}): LoadedBacktestFixtures {
  const adpRows = loadJson<{ players: FfcAdpRow[] }>(join(backtestDir, 'adp-ppr.json')).players;
  const projections = overrides.projections ?? (() => {
    const projectionsArtifact = loadJson<unknown>(join(backtestDir, 'projections.json'));
    return (Array.isArray(projectionsArtifact)
      ? projectionsArtifact
      : (projectionsArtifact as { projections: SeasonProjection[] }).projections) as SeasonProjection[];
  })();
  const players = loadJson<PlayerMeta[]>(join(dataDir, 'players.json'));
  const weekly = overrides.weekly ?? loadJson<PlayerWeeklyStatsArtifact>(join(dataDir, 'weekly-stats.json'));
  const provenance = loadJson<Record<string, unknown>>(join(backtestDir, 'provenance.json'));

  const weeklyIssues = validateWeeklyStats(weekly, 2026);
  if (weeklyIssues.length) {
    throw new Error(`weekly-stats artifact failed leakage validation: ${JSON.stringify(weeklyIssues)}`);
  }
  if (!overrides.weekly && !overrides.projections) {
    // Pins are meaningful only when the committed artifacts themselves are in use; a blend-context
    // run verifies its own inputs against fixtures/backtest/2025-blend/provenance-blend.json.
    const inputsRecord = provenance.inputs as Record<string, Record<string, string>>;
    const weeklyPin = inputsRecord.weeklyStats?.sha256;
    const playersPin = inputsRecord.playersJson?.sha256;
    if (!weeklyPin || !playersPin) {
      throw new Error('provenance.json is missing weeklyStats/playersJson sha256 pins');
    }
    const weeklyActual = sha256Of(join(dataDir, 'weekly-stats.json'));
    if (weeklyActual !== weeklyPin) {
      throw new Error(`data/weekly-stats.json sha256 mismatch: expected ${weeklyPin}, got ${weeklyActual} `
        + '(regenerate fixtures/backtest/2025/ via pipeline/backtest_snapshot.py before re-running)');
    }
    const playersActual = sha256Of(join(dataDir, 'players.json'));
    if (playersActual !== playersPin) {
      throw new Error(`data/players.json sha256 mismatch: expected ${playersPin}, got ${playersActual} `
        + '(regenerate fixtures/backtest/2025/ via pipeline/backtest_snapshot.py before re-running)');
    }
  }

  const inputs: BacktestInputs = {
    players,
    projections,
    adp: ffcRowsToAdpEntries(adpRows),
    weekly,
  };
  const integrity = verifyBacktestIntegrity(adpRows, inputs);
  if (integrity.missingFromPlayersJson.length) {
    throw new Error(`FFC-resolved ids missing from players.json: ${integrity.missingFromPlayersJson.join(', ')}`);
  }
  if (integrity.unresolvedRows.length) {
    throw new Error(`FFC rows unresolvable after the hand-map: ${integrity.unresolvedRows.join(', ')}`);
  }

  return { inputs, integrity, provenance };
}

export function gitCommitOrUnknown(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
  } catch {
    return 'unknown (git rev-parse failed)';
  }
}
