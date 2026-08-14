import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));

// The two display-only artifacts the engine must never consume. Built from
// parts so this test file's own source does not contain the literal tokens it
// is checking for (it lives inside the engine directory it scans).
const FORBIDDEN_TOKENS = [`fantasypros-${'adp'}`, `projections-${'providers'}`];

function engineSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(ENGINE_DIR);
  return out;
}

// Anti-corruption guard for the display-only rule: the per-site ADP artifact and
// the multi-provider projections artifact are presentation-only and must never be
// adapted into engine inputs (buildRecommendationBoard, availability,
// simulation, ranking comparators). The strongest enforcement is the artifact
// shapes themselves (structurally not SeasonProjection[]/AdpEntry[]), but a
// source-level scan makes an accidental import fail in CI rather than at review.
describe('display-only provider artifacts never reach the engine', () => {
  it.each(engineSourceFiles())('%s does not reference display-only provider artifacts', (file) => {
    const source = readFileSync(file, 'utf-8');
    for (const token of FORBIDDEN_TOKENS) {
      expect(source, `${file} must not reference ${token}`).not.toContain(token);
    }
  });
});

