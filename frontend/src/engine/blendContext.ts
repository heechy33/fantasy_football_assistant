/**
 * Blend-ladder pilot context loader (gates-blend-addendum.md section 6).
 *
 * The projection swap CANNOT be an in-run additive arm (it changes `scores`, replacement levels,
 * and opponent-pool membership via `buildBacktestContext`), so the pavg arms run as a SEPARATE
 * CRN-paired invocation: this module reads `BLENDED_PROJECTIONS` / `BLENDED_WEEKLY` env vars
 * (repo-root-relative paths into fixtures/backtest/2025-blend/) and returns input overrides.
 * Unset env -> null -> the committed FFToday context, byte-for-byte.
 *
 * Every override path is verified against `provenance-blend.json`'s SHA-256 pins before use.
 * The extended weekly artifact is assembled from the frozen full feed in the exact
 * `PlayerWeeklyStatsArtifact` shape `scoreRosterWeekly` consumes (columns/heat copied verbatim
 * from the committed artifact; rows carry [week, pts, null]; zero-outcome players stay absent,
 * which `buildGameLogRows` renders as `inactive` -> scored 0, per gates.md's rule).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PlayerMeta,
  PlayerWeeklyStatSeries,
  PlayerWeeklyStatsArtifact,
  SeasonProjection,
} from '../../../shared/types';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BLEND_DIR = join(REPO_ROOT, 'fixtures', 'backtest', '2025-blend');

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export interface BlendContextOverrides {
  projections: SeasonProjection[];
  weekly: PlayerWeeklyStatsArtifact;
  /** Repo-relative paths actually loaded, for the report's provenance line. */
  loadedFrom: { projections: string; weekly: string };
}

export function loadBlendOverrides(): BlendContextOverrides | null {
  const projectionsPath = process.env.BLENDED_PROJECTIONS;
  const weeklyPath = process.env.BLENDED_WEEKLY;
  if (!projectionsPath && !weeklyPath) return null;
  if (!projectionsPath || !weeklyPath) {
    throw new Error('BLENDED_PROJECTIONS and BLENDED_WEEKLY must be set together');
  }

  const provenance = loadJson<{
    outputs: Record<string, { sha256: string }>;
  }>(join(BLEND_DIR, 'provenance-blend.json'));

  const verifyPin = (envPath: string, pinKey: string): void => {
    const expected = provenance.outputs[pinKey]?.sha256;
    if (!expected) throw new Error(`provenance-blend.json has no pin for ${pinKey}`);
    const actual = sha256Of(join(REPO_ROOT, envPath.replace(/^[/\\]/, '')));
    if (actual !== expected) {
      throw new Error(`${envPath} sha256 mismatch: expected ${expected}, got ${actual}`);
    }
  };
  verifyPin(projectionsPath, 'projections-pavg.json');
  verifyPin(weeklyPath, 'outcomes-weekly-full.json');

  const projectionsArtifact = loadJson<{ projections: SeasonProjection[] }>(
    join(REPO_ROOT, projectionsPath.replace(/^[/\\]/, '')));
  const projections = projectionsArtifact.projections;

  // Assemble the extended weekly artifact in the committed shape. columns/heat are per-position
  // definitions (not player data) — copied verbatim from the committed artifact so
  // `buildGameLogRows`' column indexing is guaranteed identical.
  const committed = loadJson<PlayerWeeklyStatsArtifact>(join(REPO_ROOT, 'data', 'weekly-stats.json'));
  const players = loadJson<PlayerMeta[]>(join(REPO_ROOT, 'data', 'players.json'));
  const positionByPlayer = new Map(players.map((p) => [p.playerId, p.position]));
  const outcomes = loadJson<{ points: Record<string, Record<string, number>> }>(
    join(REPO_ROOT, weeklyPath.replace(/^[/\\]/, ''))).points;

  const series: Record<string, PlayerWeeklyStatSeries> = {};
  for (const [pid, byWeek] of Object.entries(outcomes)) {
    const position = positionByPlayer.get(pid);
    if (position == null) continue; // not in the canonical pool — cannot be drafted anyway
    // Row layout mirrors the committed artifact: expectedLength = columns.length + 1 (row[0] is
    // the week; a key at columns[i] lives at row[i+1]). Only 'pts' carries data here.
    const width = (committed.columns[position]?.length ?? 14) + 1;
    const w = Object.entries(byWeek)
      .map(([week, pts]) => {
        const row: (number | string | null)[] = new Array<number | string | null>(width).fill(null);
        row[0] = Number(week);
        row[1] = pts;
        return row as PlayerWeeklyStatSeries['w'][number];
      })
      .sort((a, b) => (a[0] as number) - (b[0] as number));
    series[pid] = { p: position, bye: null, w };
  }
  const weekly: PlayerWeeklyStatsArtifact = {
    schemaVersion: committed.schemaVersion,
    season: committed.season,
    weeksFetched: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    columns: committed.columns,
    players: series,
    heat: committed.heat,
  };

  return {
    projections,
    weekly,
    loadedFrom: { projections: projectionsPath, weekly: weeklyPath },
  };
}
