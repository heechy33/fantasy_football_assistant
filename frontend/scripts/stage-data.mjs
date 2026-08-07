// Copies generated data/*.json (repo root) into frontend/public/data/ so Vite
// picks it up into dist/data/ on build. data/ stays the single committed
// source of truth — frontend/public/data/ is a gitignored staging copy.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(scriptDir, '..', '..', 'data');
const destDir = join(scriptDir, '..', 'public', 'data');

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });

const files = readdirSync(sourceDir).filter((name) => name.endsWith('.json'));

if (files.length === 0) {
  throw new Error(`No JSON files found in ${sourceDir} — run "npm run pipeline" first.`);
}

for (const file of files) {
  cpSync(join(sourceDir, file), join(destDir, file));
}

console.log(`Staged ${files.length} data file(s) from ${sourceDir} into ${destDir}`);
