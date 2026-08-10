// Fails the build if the production frontend artifact is missing files the
// deployed app needs, or if it contains data it must never ship. Run after
// `npm run build`, before deploying.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'frontend', 'dist');

const required = [
  'staticwebapp.config.json',
  join('data', 'manifest.json'),
  join('data', 'players.json'),
  join('data', 'projections-season.json'),
  join('data', 'player-usage.json'),
  join('data', 'adp-ppr.json'),
];

// data/history/ is the append-only ADP snapshot log (pipeline/history.py) —
// capture only, never read by the frontend and never meant to ship. It's
// excluded automatically by stage-data.mjs's non-recursive `.json` filter
// (which only ever copies top-level data/*.json files into
// frontend/public/data/, so a subdirectory of .jsonl files never gets
// staged), but this asserts that exclusion explicitly rather than trusting
// it silently keeps working.
const mustNotExist = [join('data', 'history')];

const missing = required.filter((rel) => !existsSync(join(distDir, rel)));
const forbidden = mustNotExist.filter((rel) => existsSync(join(distDir, rel)));

if (missing.length > 0 || forbidden.length > 0) {
  console.error(`Artifact verification failed for ${distDir}:`);
  for (const rel of missing) console.error(`  - missing required: ${rel}`);
  for (const rel of forbidden) console.error(`  - present but must not ship: ${rel}`);
  process.exit(1);
}

console.log(`Artifact verification passed: all ${required.length} required files present in ${distDir}, and data/history/ correctly excluded`);
