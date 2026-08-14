// Captures a real, completed Sleeper mock/league draft verbatim, for the availability/VONA
// benchmark harness (frontend/src/engine/benchmarkAvailability.bench.ts). Zero-dep Node ESM,
// same pattern as scripts/verify-artifact.mjs: no framework, just fs + fetch.
//
// Writes the two raw upstream payloads unmodified (no normalization — that's the adapter's job,
// exercised at harness time via the real sleeperAdapter against a stubbed fetch) to
// fixtures/sleeper/recorded/<draftId>/{draft,picks}.json.
//
// Usage: node scripts/fetch-sleeper-mock.mjs <draftId> [<draftId> ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const outRoot = join(process.cwd(), 'fixtures', 'sleeper', 'recorded');

const draftIds = process.argv.slice(2);
if (draftIds.length === 0) {
  console.error('Usage: node scripts/fetch-sleeper-mock.mjs <draftId> [<draftId> ...]');
  process.exit(1);
}

async function fetchRawJson(path) {
  const res = await fetch(`${SLEEPER_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Sleeper API ${path} failed: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

let failed = false;
for (const draftId of draftIds) {
  try {
    const [draftBody, picksBody] = await Promise.all([
      fetchRawJson(`/draft/${encodeURIComponent(draftId)}`),
      fetchRawJson(`/draft/${encodeURIComponent(draftId)}/picks`),
    ]);
    // Parse only for capture diagnostics. The buffers written below remain the exact response bodies.
    const draft = JSON.parse(draftBody.toString('utf8'));
    const picks = JSON.parse(picksBody.toString('utf8'));

    if (draft.status !== 'complete') {
      console.warn(`Warning: draft ${draftId} status is "${draft.status}", not "complete" — captured anyway.`);
    }
    const expectedPicks = (draft.settings?.teams ?? 0) * (draft.settings?.rounds ?? 0);
    if (expectedPicks > 0 && picks.length !== expectedPicks) {
      console.warn(`Warning: draft ${draftId} has ${picks.length}/${expectedPicks} picks — captured anyway.`);
    }

    const dir = join(outRoot, draftId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'draft.json'), draftBody);
    writeFileSync(join(dir, 'picks.json'), picksBody);
    console.log(`Captured draft ${draftId}: ${picks.length} picks, status "${draft.status}" -> ${dir}`);
  } catch (err) {
    failed = true;
    console.error(`Failed to capture draft ${draftId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failed) process.exit(1);
