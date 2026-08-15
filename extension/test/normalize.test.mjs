// Plain-Node regression test for the Phase 2 recon normalizer (extension/src/normalize.js).
// No framework or build step: run with `node extension/test/normalize.test.mjs`.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const source = readFileSync(new URL('../src/normalize.js', import.meta.url), 'utf8');
eval(source);
const N = globalThis.FfaEspnNormalize;
assert.ok(N, 'normalize.js must expose FfaEspnNormalize');

const draftPayload = {
  draftId: '123456',
  draftStatus: 'IN_PROGRESS',
  leagueId: '999',
  rounds: 14,
  settings: { draftSettings: { rounds: 14, type: 'SNAKE' }, scoringItems: [{ statId: 3, points: 0.1 }] },
  teams: [{ teamId: 1, abbrev: 'AAA' }, { teamId: 2, abbrev: 'BBB' }],
  draftOrder: [2, 1, 3],
  picks: [
    { overallPickNumber: 1, teamId: 2, playerId: '3139477', player: { fullName: 'Christian McCaffrey', defaultPositionId: 2, proTeamId: 22 } },
    { overallPickNumber: 2, teamId: 1, playerId: '15847', player: { fullName: 'Bijan Robinson', defaultPositionId: 2, proTeamId: 1 } },
  ],
  espn_s2: 'SECRET-COOKIE',
  token: 'SECRET-TOKEN',
};

// 1. Sanitization: secret-looking keys and their values never survive redaction at any depth.
const redacted = N.redact(draftPayload);
const serialized = JSON.stringify(redacted);
for (const secret of ['espn_s2', 'token', 'cookie', 'authorization', 'swid', 'SECRET-COOKIE', 'SECRET-TOKEN']) {
  assert.ok(!serialized.includes(secret), `redact must strip ${secret}`);
}

// 2. normalizeCandidate extracts picks + identity and retains the sanitized structure.
const snap = N.normalizeCandidate(
  { kind: 'draft-json', transport: 'fetch', direction: 'response', url: 'https://fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/999', payload: draftPayload },
  1,
);
assert.equal(snap.schemaVersion, N.SCHEMA_VERSION);
assert.equal(snap.draft.draftId, '123456');
assert.equal(snap.draft.leagueId, '999');
assert.equal(snap.draft.status, 'IN_PROGRESS');
assert.equal(snap.picks.length, 2);
assert.equal(snap.picks[0].overall, 1);
assert.equal(snap.picks[0].providerPlayerId, '3139477', 'pick-level playerId must be captured');
assert.equal(snap.picks[0].name, 'Christian McCaffrey');
assert.ok(snap.structure, 'sanitized draft structure must be retained for schema discovery');
assert.ok(snap.structure.settings && snap.structure.teams && snap.structure.draftOrder, 'structure must retain settings/teams/order');
assert.ok(!JSON.stringify(snap).includes('espn_s2') && !JSON.stringify(snap).includes('SECRET-COOKIE'), 'snapshot must not contain secrets');

// 3. mergeSnapshots: monotonic sequence, monotonic picks, structure carried forward, DOM merged.
const dom = N.normalizeCandidate(
  { kind: 'dom', transport: 'dom', direction: 'visible', url: 'https://fantasy.espn.com/football/draft', domRows: [{ attributes: { 'data-player-id': '3139477' }, text: 'CMAC' }] },
  2,
);
assert.equal(dom.structure, null, 'DOM-only candidates carry no transport structure');
const merged = N.mergeSnapshots(snap, dom);
assert.equal(merged.sequence, 2);
assert.equal(merged.picks.length, 2);
assert.ok(merged.structure && merged.structure.teams, 'structure survives a DOM-only merge');
assert.equal(merged.domRows.length, 1);

// 4. Picks keyed by overall: a later transport pick replaces, never duplicates.
const later = N.normalizeCandidate(
  { kind: 'draft-json', transport: 'fetch', direction: 'response', url: 'https://fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/999', payload: { draftId: '123456', leagueId: '999', draftStatus: 'IN_PROGRESS', picks: [{ overallPickNumber: 1, teamId: 2, playerId: '3139477', player: { fullName: 'Christian McCaffrey', defaultPositionId: 2, proTeamId: 22 } }] } },
  3,
);
const merged2 = N.mergeSnapshots(merged, later);
assert.equal(merged2.sequence, 3);
assert.equal(merged2.picks.length, 2, 'overall key must not duplicate picks');

// 5. DOM rows beyond redact depth must not be truncated by map's index being mistaken for depth.
const many = N.normalizeCandidate(
  { kind: 'dom', transport: 'dom', direction: 'visible', url: 'https://fantasy.espn.com/football/draft', domRows: Array.from({ length: 12 }, (_, i) => ({ attributes: { 'data-pick-number': String(i + 1) }, text: `undo-${i + 1}` })) },
  10,
);
assert.equal(many.domRows.length, 12);
assert.equal(many.domRows[11].text, 'undo-12', 'late DOM rows must survive redaction');
assert.ok(!JSON.stringify(many).includes('truncated-depth'), 'no DOM row may be depth-truncated');

// 6. Non-JSON websocket frames carry a bounded frame preview plus frame type/byte length metadata.
const frameSnap = N.normalizeCandidate(
  { kind: 'frame', transport: 'websocket', direction: 'incoming', url: 'wss://fantasydraft.espn.com/game-1/league-5568571/JOIN', frame: '{"p":"not-json-yet…"}', frameType: 'arraybuffer', byteLength: 4096 },
  11,
);
assert.equal(frameSnap.source.frameType, 'arraybuffer');
assert.equal(frameSnap.source.byteLength, 4096);
assert.equal(frameSnap.frames.length, 1);
assert.equal(frameSnap.frames[0].text, '{"p":"not-json-yet…"}');
assert.equal(frameSnap.frames[0].frameType, 'arraybuffer');
assert.equal(frameSnap.frameCount, 1);
assert.equal(frameSnap.picks.length, 0, 'frame previews must not fabricate picks');
assert.equal(frameSnap.structure, null);

// 7. Diagnostics reflect the merged state, not the last candidate, and the frame preview survives.
const mergedFrame = N.mergeSnapshots(many, frameSnap);
assert.equal(mergedFrame.diagnostics.domRowCount, 12, 'domRowCount must survive a DOM-less merge');
assert.equal(mergedFrame.diagnostics.pickCount, 0);
assert.equal(mergedFrame.frames.length, 1, 'frame sample carries forward');
assert.equal(mergedFrame.frames[0].text, '{"p":"not-json-yet…"}');
assert.equal(mergedFrame.frameCount, 1);
assert.equal(mergedFrame.source.frameType, 'arraybuffer', 'latest frame metadata wins');

// 8. v2 regressions: payloadObserved false on frame-only, leagueId from socket URL, frame sample dedup + count, rejected-URL capture.
const frameOnly = N.normalizeCandidate(
  { kind: 'frame', transport: 'websocket', direction: 'incoming', url: 'wss://fantasydraft.espn.com/game-1/league-996408758/JOIN', payload: null, frame: 'SELECTING 8 30000', frameType: 'text', byteLength: 17 },
  20,
);
assert.equal(frameOnly.diagnostics.payloadObserved, false, 'frame-only candidates must not report payloadObserved');
assert.equal(frameOnly.draft.leagueId, '996408758', 'leagueId must fall back to the socket URL');

const frameA = N.normalizeCandidate(
  { kind: 'frame', transport: 'websocket', direction: 'incoming', url: 'wss://fantasydraft.espn.com/game-1/league-996408758/JOIN', frame: 'SELECTING 8 30000', frameType: 'text', byteLength: 17 },
  21,
);
const frameB = N.normalizeCandidate(
  { kind: 'frame', transport: 'websocket', direction: 'incoming', url: 'wss://fantasydraft.espn.com/game-1/league-996408758/JOIN', frame: 'SELECTING 9 30000', frameType: 'text', byteLength: 17 },
  22,
);
const frameC = N.normalizeCandidate(
  { kind: 'frame', transport: 'websocket', direction: 'incoming', url: 'wss://fantasydraft.espn.com/game-1/league-996408758/JOIN', frame: 'SELECTING 8 30000', frameType: 'text', byteLength: 17 },
  23,
);
const sampled = N.mergeSnapshots(N.mergeSnapshots(frameA, frameB), frameC);
assert.equal(sampled.frameCount, 3, 'frameCount must count every frame, duplicates included');
assert.equal(sampled.frames.length, 2, 'identical frames must dedupe; distinct frames must both survive');
assert.deepEqual(sampled.frames.map((f) => f.text).sort(), ['SELECTING 8 30000', 'SELECTING 9 30000']);

const rejected = N.normalizeCandidate(
  { kind: 'transport', transport: 'xhr', direction: 'response', url: 'https://fantasy.espn.com/apis/v2/league-996408758/state', rejectedUrls: ['https://fantasy.espn.com/apis/v2/league-996408758/state'] },
  24,
);
assert.equal(rejected.rejectedUrls.length, 1, 'rejected URLs must be retained for the next recon run');
assert.equal(rejected.rejectedUrls[0], 'https://fantasy.espn.com/apis/v2/league-996408758/state');

const domWithPage = N.normalizeCandidate(
  { kind: 'dom', transport: 'dom', direction: 'visible', url: 'https://fantasy.espn.com/football/draft', pageUrl: 'https://fantasy.espn.com/football/draft', pageFrame: 'top', domRows: [] },
  25,
);
assert.equal(domWithPage.page.url, 'https://fantasy.espn.com/football/draft', 'page URL must be recorded from the DOM candidate');
assert.equal(domWithPage.page.frame, 'top');
const pageMerged = N.mergeSnapshots(frameOnly, domWithPage);
assert.equal(pageMerged.page.url, 'https://fantasy.espn.com/football/draft', 'page URL must survive a frame-only merge');
assert.equal(pageMerged.page.frame, 'top');

// 9. A real player-pool JSON payload must not fabricate picks from stat records that carry an id but
// no pick number (regression: Number(null) === 0 let { id: "002026" } pass asPick with overall 0).
const poolSnap = N.normalizeCandidate(
  { kind: 'draft-json', transport: 'fetch', direction: 'response', url: 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1247342665/draft/playerpool', payload: { players: [{ id: 4242335, status: 'FREEAGENT', player: { fullName: 'Jonathan Taylor', defaultPositionId: 2, proTeamId: 11 }, stats: [{ id: '002025', proTeamId: 0 }, { id: '002026', proTeamId: 0 }] }] } },
  30,
);
assert.equal(poolSnap.diagnostics.payloadObserved, true, 'a real JSON payload must still be observed');
assert.equal(poolSnap.picks.length, 0, 'player-pool stat records must not fabricate picks');

// 10. parseFrameLine: SELECTED with and without the trailing GUID, JOINED slot extraction, TOKEN.
assert.deepEqual(N.parseFrameLine('SELECTED 3 3139477 2'), { kind: 'SELECTED', slot: 3, playerId: '3139477', guid: null }, 'SELECTED without GUID');
assert.deepEqual(N.parseFrameLine('SELECTED 7 15847 4 {ABC-123}'), { kind: 'SELECTED', slot: 7, playerId: '15847', guid: '{ABC-123}' }, 'SELECTED with the user-own-pick GUID');
assert.deepEqual(N.parseFrameLine('JOINED 2 {XYZ-9}'), { kind: 'JOINED', slot: 2 }, 'JOINED exposes the user draft slot');
assert.deepEqual(N.parseFrameLine('TOKEN 2:996408758:1:{XYZ-9}:3'), { kind: 'TOKEN', slot: 2, leagueId: '996408758' }, 'TOKEN also carries the user draft slot and league id');

// 11. Non-pick carriers parse to null — including INIT, which is explicitly never decoded.
for (const line of ['SELECTING 8 30000', 'CLOCK 8 15000 5', 'STATE 12', 'AUTODRAFT 3 false', 'AUTOSUGGEST 3139477', 'PONG PING 12345', 'INIT AAAA...', '']) {
  assert.equal(N.parseFrameLine(line), null, `non-pick frame must be ignored: ${line}`);
}

// 12. applyFrameToLive: uncapped ordered accumulation, mySlot/leagueId from JOINED/TOKEN, heartbeat on
// every frame, and duplicate protection (identical resend AND same player selected again are skipped).
let live = N.createLiveSnapshot();
live = N.applyFrameToLive(live, 'JOINED 2 {G}', 1000);
assert.equal(live.mySlot, 2, 'JOINED sets mySlot');
assert.equal(live.lastHeartbeatAt, 1000);
live = N.applyFrameToLive(live, 'TOKEN 2:996408758:1:{XYZ-9}:3', 1100);
assert.equal(live.leagueId, '996408758', 'TOKEN carries the league id');
live = N.applyFrameToLive(live, 'SELECTED 1 11111 2', 2000);
live = N.applyFrameToLive(live, 'SELECTED 2 22222 4 {G}', 3000);
live = N.applyFrameToLive(live, 'SELECTED 2 22222 4 {G}', 4000); // identical resend of the last pick
live = N.applyFrameToLive(live, 'SELECTED 1 11111 2', 5000); // same player re-selected (replay/dup)
assert.equal(live.streamPicks.length, 2, 'resends and duplicate players must not duplicate the stream');
assert.equal(live.streamPicks[0].overall, 1);
assert.equal(live.streamPicks[0].playerId, '11111');
assert.equal(live.streamPicks[1].overall, 2);
assert.equal(live.streamPicks[1].slot, 2);
assert.equal(live.streamPicks[1].guid, '{G}');
assert.equal(live.streamPicks[1].source, 'frame');
assert.equal(live.lastHeartbeatAt, 5000, 'every frame refreshes the heartbeat');
live = N.applyFrameToLive(live, 'CLOCK 2 15000 4', 6000);
assert.equal(live.streamPicks.length, 2, 'ignored frames must not add picks');
assert.equal(live.lastHeartbeatAt, 6000, 'ignored frames still refresh the heartbeat');
// A fresh snapshot rejects a stale/incompatible previous shape.
const fresh = N.applyFrameToLive({ schemaVersion: 99, streamPicks: [{ overall: 1, playerId: 'bogus' }] }, 'SELECTED 1 11111 2', 7000);
assert.equal(fresh.schemaVersion, N.LIVE_SCHEMA_VERSION, 'a wrong-version prior must reset the live snapshot');
assert.equal(fresh.streamPicks.length, 1);

console.log('normalize.test.mjs: all assertions passed');
