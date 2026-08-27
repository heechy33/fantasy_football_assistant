// Self-host all 32 NFL team logos at ESPN's high-resolution size (~500px PNG, the same marks
// currently bundled but at much sharper resolution for the hero's orbit atlas). Re-run whenever
// a team rebrands. Run: node scripts/fetch-team-logos.mjs
// NOTE: team marks are trademarked by their clubs; self-hosting them in a free personal project
// is an existing product decision (see DECISIONS.md).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND',
  'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA',
  'SF', 'TB', 'TEN', 'WAS',
];

const outDir = join(process.cwd(), 'frontend', 'public', 'team-logos');
mkdirSync(outDir, { recursive: true });

let failed = [];
for (const abbr of TEAMS) {
  const file = `${abbr.toLowerCase()}.png`;
  const url = `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    failed.push(`${abbr}: HTTP ${res.status}`);
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Cheap sanity check: PNG magic bytes.
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    failed.push(`${abbr}: not a PNG response`);
    continue;
  }
  writeFileSync(join(outDir, file), bytes);
  console.log(`${abbr}: ${bytes.length} bytes -> ${file}`);
}
if (failed.length) {
  console.error(`FAILED (${failed.length}):\n${failed.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('All 32 team logos fetched.');
}