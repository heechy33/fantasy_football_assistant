// Runs the opt-in 2025 historical backtest (frontend/src/engine/backtest.bench.ts), gated on
// process.env.BENCHMARK exactly like scripts/run-benchmark.mjs does for benchmarkAvailability.bench.ts.
//
// A plain Node wrapper instead of `cross-env BENCHMARK=1 ...` because cross-env is not an installed
// dependency and inline `VAR=1 command` is not portable to Windows (this repo's dev environment) —
// matches the zero-dep script convention already used by verify-artifact.mjs/fetch-sleeper-mock.mjs.
//
// Seed count / gating are forwarded as BACKTEST_SEEDS / BACKTEST_GATING so a 20-seed directional
// pilot and an N >= 1,000 gating run share the exact same code path:
//   npm run backtest                              -> pilot, 12 slots x 20 seeds, non-gating
//   $env:BACKTEST_SEEDS='84'; $env:BACKTEST_GATING='1'; npm run backtest
// BACKTEST_OPPONENT_SHOCK_SCALE (2026-08-24 saturation sweep) passes through process.env untouched:
//   $env:BACKTEST_OPPONENT_SHOCK_SCALE='2'; npm run backtest   -> -shockscale2 report stem
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// `npm --prefix frontend exec ...` resolves frontend/'s installed binaries but does NOT change the
// spawned process's cwd to frontend/ (verified: `npm --prefix frontend exec -- node -e
// "console.log(process.cwd())"` prints the repo root) — so vitest would run rootless, find no
// frontend/vite.config.ts, and fall back to the default `*.test.ts`/`*.spec.ts` include glob only.
// Running `npm run <script>` *inside* frontend/ (cwd set explicitly below) is what actually mirrors
// how every other `npm --prefix frontend run ...` root script behaves.
const frontendDir = join(process.cwd(), 'frontend');

// `shell: true` is required for `spawnSync('npm', ...)` to resolve to `npm.cmd` on Windows
// (Node's spawnSync does not itself apply PATHEXT resolution to non-shell child processes).
const result = spawnSync(
  'npm',
  ['exec', 'vitest', 'run', 'src/engine/backtest.bench.ts'],
  {
    stdio: 'inherit',
    shell: true,
    cwd: frontendDir,
    env: {
      ...process.env,
      BENCHMARK: '1',
      BACKTEST_SEEDS: process.env.BACKTEST_SEEDS ?? '20',
      BACKTEST_GATING: process.env.BACKTEST_GATING ?? '0',
    },
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
