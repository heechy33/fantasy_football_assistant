// Runs the opt-in Stage C sim-sort disagreement probe (frontend/src/engine/simSortProbe.bench.ts),
// gated on process.env.BENCHMARK exactly like scripts/run-backtest.mjs does for backtest.bench.ts —
// see that file's comments for why this is a plain Node wrapper (no cross-env dependency) and why
// cwd is set explicitly to frontend/ rather than relying on `npm --prefix`.
//
// Seed count is forwarded as PROBE_SEEDS so `npm run probe:simsort` and a wider run share the exact
// same code path:
//   npm run probe:simsort                       -> 12 slots x 3 seeds = 36 drafts, ~3-5 min
//   $env:PROBE_SEEDS='20'; npm run probe:simsort  -> wider probe, still non-gating
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const frontendDir = join(process.cwd(), 'frontend');

const result = spawnSync(
  'npm',
  ['exec', 'vitest', 'run', 'src/engine/simSortProbe.bench.ts'],
  {
    stdio: 'inherit',
    shell: true,
    cwd: frontendDir,
    env: {
      ...process.env,
      BENCHMARK: '1',
      PROBE_SEEDS: process.env.PROBE_SEEDS ?? '3',
    },
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
