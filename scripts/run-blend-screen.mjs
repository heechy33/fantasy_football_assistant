// Runs the blend-ladder steps C+D (frontend/src/engine/blendScreen.bench.ts): offline
// rank-utility screen + board-disagreement probe over the frozen 2025-retrievable bytes.
// BENCHMARK-gated exactly like run-simsort-probe.mjs / run-backtest.mjs (see those files for why
// this is a plain Node wrapper and why cwd is set explicitly to frontend/).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const frontendDir = join(process.cwd(), 'frontend');

const result = spawnSync(
  'npm',
  ['exec', 'vitest', 'run', 'src/engine/blendScreen.bench.ts'],
  {
    stdio: 'inherit',
    shell: true,
    cwd: frontendDir,
    env: {
      ...process.env,
      BENCHMARK: '1',
    },
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
