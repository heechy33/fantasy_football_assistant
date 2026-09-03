// Fails the build if the production frontend artifact is missing files the
// deployed app needs, or if it contains data it must never ship. Run after
// `npm run build`, before deploying.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'frontend', 'dist');

const required = [
  'staticwebapp.config.json',
  join('data', 'manifest.json'),
  join('data', 'players.json'),
  join('data', 'projections-season.json'),
  join('data', 'projections-providers.json'),
  join('data', 'player-usage.json'),
  join('data', 'adp-ppr.json'),
  join('data', 'weekly-ppr.json'),
  join('data', 'weekly-stats.json'),
  join('fonts', 'inter.woff2'),
  join('fonts', 'inter-italic.woff2'),
  join('fonts', 'archivo.woff2'),
  join('fonts', 'archivo-italic.woff2'),
  join('models', 'trophy.glb'),
  join('team-logos', 'kc.png'),
];

// data/history/ is the append-only ADP snapshot log (pipeline/history.py) —
// capture only, never read by the frontend and never meant to ship. It's
// excluded automatically by stage-data.mjs's non-recursive `.json` filter
// (which only ever copies top-level data/*.json files into
// frontend/public/data/, so a subdirectory of .jsonl files never gets
// staged), but this asserts that exclusion explicitly rather than trusting
// it silently keeps working.
const mustNotExist = [join('data', 'history')];

// The ESPN default-PPR board (`data/adp-espn-ppr.json`) is additive and
// fail-open: the pipeline commits it only when the ESPN fetch+parse
// succeeded, and records a manifest `espn_adp_ppr` entry with status 'ok'
// exactly in that case (any failure writes an error entry instead and leaves
// `adp-ppr.json` untouched). Requiring the file unconditionally would break
// the build on any ESPN fetch failure, defeating fail-open — so the
// requirement is gated on the committed manifest's status instead.
const espnManifest = readJson(join('data', 'manifest.json'));
const espnAdpOk = espnManifest?.sources?.['espn_adp_ppr']?.status === 'ok';
const espnAdpRequired = espnAdpOk ? [join('data', 'adp-espn-ppr.json')] : [];

// The Underdog best-ball board (`data/adp-underdog-bestball.json`) follows the
// same fail-open pattern, with one difference: on failure the pipeline leaves
// the PRIOR committed board byte-identical (it never deletes it, because the
// Underdog lane is display/decoration + market-spread raw material only and
// is never treated as current-by-default). The staged copy therefore always
// exists once a first successful run has committed one — so it's required
// exactly when the manifest reports `underdog_bestball` ok, mirroring ESPN.
const manifest = espnManifest;
const underdogAdpOk = manifest?.sources?.['underdog_bestball']?.status === 'ok';
const underdogAdpRequired = underdogAdpOk ? [join('data', 'adp-underdog-bestball.json')] : [];

// The Yahoo draft-analysis boards (`data/adp-yahoo-<fmt>.json` for
// standard/half-ppr/ppr; NOT 2qb) follow the same fail-open pattern as ESPN.
// One row per served format in the manifest; each independently required
// when its manifest entry reports ok, deleted by the pipeline on a failed
// refresh (mirroring ESPN's `adp-espn-ppr.json` behavior). Added 2026-09-XX
// (Phase 2).
const yahooAdpRequired = ['standard', 'half-ppr', 'ppr']
  .filter((fmt) => manifest?.sources?.[`yahoo_adp_${fmt}`]?.status === 'ok')
  .map((fmt) => join('data', `adp-yahoo-${fmt}.json`));

const missing = required.filter((rel) => !existsSync(join(distDir, rel)))
  .concat(espnAdpRequired.filter((rel) => !existsSync(join(distDir, rel))))
  .concat(underdogAdpRequired.filter((rel) => !existsSync(join(distDir, rel))))
  .concat(yahooAdpRequired.filter((rel) => !existsSync(join(distDir, rel))));
const forbidden = mustNotExist.filter((rel) => existsSync(join(distDir, rel)));

if (missing.length > 0 || forbidden.length > 0) {
  console.error(`Artifact verification failed for ${distDir}:`);
  for (const rel of missing) console.error(`  - missing required: ${rel}`);
  for (const rel of forbidden) console.error(`  - present but must not ship: ${rel}`);
  process.exit(1);
}

console.log(`Artifact verification passed: all ${required.length} required files present in ${distDir}, and data/history/ correctly excluded`);
if (espnAdpOk) {
  console.log(`Artifact verification: manifest reports espn_adp_ppr ok — data/adp-espn-ppr.json present in ${distDir}`);
} else {
  console.log('Artifact verification: manifest reports espn_adp_ppr error/absent — ESPN ADP board not required (fail-open)');
}
if (underdogAdpOk) {
  console.log(`Artifact verification: manifest reports underdog_bestball ok — data/adp-underdog-bestball.json present in ${distDir}`);
} else {
  console.log('Artifact verification: manifest reports underdog_bestball error/absent — Underdog best-ball board not required (fail-open)');
}
const yahooOk = ['standard', 'half-ppr', 'ppr'].filter((fmt) => manifest?.sources?.[`yahoo_adp_${fmt}`]?.status === 'ok');
if (yahooOk.length > 0) {
  console.log(`Artifact verification: manifest reports yahoo_adp_${yahooOk.join('/yahoo_adp_')} ok — corresponding adp-yahoo-*.json files present in ${distDir}`);
} else {
  console.log('Artifact verification: manifest reports all yahoo_adp_* error/absent — Yahoo ADP boards not required (fail-open)');
}

/** Read and parse a JSON file from dist, or null when missing/unparseable. */
function readJson(rel) {
  const path = join(distDir, rel);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

