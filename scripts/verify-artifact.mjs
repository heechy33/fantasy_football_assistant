// Fails the build if the production frontend artifact is missing files the
// deployed app needs. Run after `npm run build`, before deploying.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'frontend', 'dist');

const required = [
  'staticwebapp.config.json',
  join('data', 'manifest.json'),
  join('data', 'players.json'),
  join('data', 'projections-season.json'),
  join('data', 'adp-ppr.json'),
];

const missing = required.filter((rel) => !existsSync(join(distDir, rel)));

if (missing.length > 0) {
  console.error(`Artifact verification failed. Missing from ${distDir}:`);
  for (const rel of missing) console.error(`  - ${rel}`);
  process.exit(1);
}

console.log(`Artifact verification passed: all ${required.length} required files present in ${distDir}`);
