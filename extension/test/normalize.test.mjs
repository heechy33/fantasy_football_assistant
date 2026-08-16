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

// 8b. Step D: the frame sample is bucketed by keyword (SELECTED gets 20, CLOCK 10, everything else
// 20) and keeps first-half/last-half per bucket once it overflows, so a recon export taken late in
// a draft still carries early- AND late-round SELECTED frames instead of losing everything after
// the first 50 distinct lines ever observed.
let frameSample = null;
for (let i = 1; i <= 25; i += 1) {
  const candidate = N.normalizeCandidate(
    { kind: 'frame', transport: 'websocket', direction: 'incoming', url: 'wss://fantasydraft.espn.com/game-1/league-996408758/JOIN', frame: `SELECTED ${i} ${100000 + i} 2`, frameType: 'text', byteLength: 20 },
    40 + i,
  );
  frameSample = frameSample ? N.mergeSnapshots(frameSample, candidate) : candidate;
}
const selectedTexts = frameSample.frames.map((f) => f.text);
assert.equal(selectedTexts.length, 20, 'SELECTED bucket caps at 20 despite 25 distinct frames observed');
assert.ok(selectedTexts.includes('SELECTED 1 100001 2'), 'the earliest SELECTED frames must survive the cap (first half)');
assert.ok(selectedTexts.includes('SELECTED 25 100025 2'), 'the most recent SELECTED frames must survive the cap (last half) — this is the D/ST-at-the-end fix');
assert.ok(!selectedTexts.includes('SELECTED 13 100013 2'), 'a middle frame is evicted once the bucket overflows');

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
// The third token (posToken) is captured raw alongside the GUID, which is found by shape
// (startsWith '{'), not position, so the two coexist regardless of whether a GUID is present.
assert.deepEqual(N.parseFrameLine('SELECTED 3 3139477 2'), { kind: 'SELECTED', slot: 3, playerId: '3139477', posToken: 2, guid: null }, 'SELECTED without GUID');
assert.deepEqual(N.parseFrameLine('SELECTED 7 15847 4 {ABC-123}'), { kind: 'SELECTED', slot: 7, playerId: '15847', posToken: 4, guid: '{ABC-123}' }, 'SELECTED with the user-own-pick GUID');
assert.deepEqual(N.parseFrameLine('JOINED 2 {XYZ-9}'), { kind: 'JOINED', slot: 2 }, 'JOINED exposes the user draft slot');
// TOKEN's team-id field is index 2, not index 0 -- recon-verified against two independent real
// captures: "TOKEN 1:1488579454:1:{GUID}:1343616072" paired with "JOINED 1" (field 0 and field 2
// coincidentally both read 1), and tonight's live draft "TOKEN 1:1592616859:7:{SWID}" paired with
// "JOINED 7" (field 0 reads 1, but the real seat is 7 -- only field 2 agrees with JOINED).
assert.deepEqual(N.parseFrameLine('TOKEN 999:996408758:2:{XYZ-9}:3'), { kind: 'TOKEN', slot: 2, leagueId: '996408758' }, 'TOKEN team id is field 2; field 0 (999 here) is ignored; field 1 is the league id');

// 11. Non-pick carriers parse to null — including INIT, which is explicitly never decoded.
for (const line of ['SELECTING 8 30000', 'CLOCK 8 15000 5', 'STATE 12', 'AUTODRAFT 3 false', 'AUTOSUGGEST 3139477', 'PONG PING 12345', 'INIT AAAA...', '']) {
  assert.equal(N.parseFrameLine(line), null, `non-pick frame must be ignored: ${line}`);
}

// 12. applyFrameToLive: uncapped ordered accumulation, mySlot/leagueId from JOINED/TOKEN, heartbeat on
// every frame, and duplicate protection keyed on (slot, playerId) — an identical resend is skipped,
// while a distinct pick sharing only a playerId at a different slot still appends (see below).
let live = N.createLiveSnapshot();
assert.equal(live.resetReason, 'new', 'a brand-new snapshot has no reset to report');
assert.equal(live.epoch, 0);
live = N.applyFrameToLive(live, 'JOINED 2 {G}', 1000);
assert.equal(live.mySlot, 2, 'JOINED sets mySlot');
assert.equal(live.lastHeartbeatAt, 1000);
// TOKEN's team-id field (index 2, here "9") must NOT override the seat JOINED already established --
// JOINED (2) stays authoritative even though TOKEN names a different team.
live = N.applyFrameToLive(live, 'TOKEN 999:996408758:9:{XYZ-9}:3', 1100);
assert.equal(live.leagueId, '996408758', 'TOKEN carries the league id');
assert.equal(live.mySlot, 2, 'TOKEN must not overwrite a mySlot JOINED already set');
// A TOKEN arriving with no prior JOINED DOES fill mySlot from its own team-id field.
let tokenFirst = N.createLiveSnapshot();
tokenFirst = N.applyFrameToLive(tokenFirst, 'TOKEN 999:111222333:4:{Z}:3', 1000);
assert.equal(tokenFirst.mySlot, 4, 'TOKEN fills mySlot when JOINED has not run yet');
assert.equal(tokenFirst.leagueId, '111222333');
live = N.applyFrameToLive(live, 'SELECTED 1 11111 2', 2000);
assert.equal(live.domMaxAtStreamStart, 0, 'the first stream pick on an empty, unsampled board stamps domMaxAtStreamStart from whatever DOM signal exists (none here, so 0)');
live = N.applyFrameToLive(live, 'SELECTED 2 22222 4 {G}', 3000);
live = N.applyFrameToLive(live, 'SELECTED 2 22222 4 {G}', 4000); // identical resend of the last pick
live = N.applyFrameToLive(live, 'SELECTED 1 11111 2', 5000); // same player re-selected (replay/dup)
assert.equal(live.streamPicks.length, 2, 'resends and duplicate players must not duplicate the stream');
assert.equal(live.streamPicks[0].overall, 1);
assert.equal(live.streamPicks[0].playerId, '11111');
assert.equal(live.streamPicks[1].overall, 2);
assert.equal(live.streamPicks[1].slot, 2);
assert.equal(live.streamPicks[1].posToken, 4, 'posToken is carried onto the stream pick');
assert.equal(live.streamPicks[1].guid, '{G}');
assert.equal(live.streamPicks[1].source, 'frame');
assert.equal(live.lastHeartbeatAt, 5000, 'every frame refreshes the heartbeat');
live = N.applyFrameToLive(live, 'CLOCK 2 15000 4', 6000);
assert.equal(live.streamPicks.length, 2, 'ignored frames must not add picks');
assert.equal(live.lastHeartbeatAt, 6000, 'ignored frames still refresh the heartbeat');
// The dedupe keys on (slot, playerId), not playerId alone: a resend is the identical line, but a
// DISTINCT pick that happens to share a playerId with an earlier one at a different team slot (the
// unproven D/ST-negative-id case) must still append — a playerId-only guard would lose that pick.
live = N.applyFrameToLive(live, 'SELECTED 9 11111 2', 6500);
assert.equal(live.streamPicks.length, 3, 'same playerId at a different team slot is a distinct pick, not a resend');
assert.equal(live.streamPicks[2].overall, 3);
assert.equal(live.streamPicks[2].slot, 9);
assert.equal(live.lastHeartbeatAt, 6500);
// A fresh snapshot rejects a stale/incompatible previous shape -- and, per Step 7, that reset must
// itself be detectable: epoch bumps and resetReason names it, closing the "LIVE_SCHEMA_VERSION 1->2
// on an unchanged key silently renumbers to overall 1" hazard the extension used to have.
const fresh = N.applyFrameToLive({ schemaVersion: 99, streamPicks: [{ overall: 1, playerId: 'bogus' }] }, 'SELECTED 1 11111 2', 7000);
assert.equal(fresh.schemaVersion, N.LIVE_SCHEMA_VERSION, 'a wrong-version prior must reset the live snapshot');
assert.equal(fresh.streamPicks.length, 1);
assert.equal(fresh.epoch, 1, 'a schema-version reset must still bump epoch so the app can detect a silent restart');
assert.equal(fresh.resetReason, 'schema-change');
// A schema-version reset chained onto an ALREADY-bumped epoch increments again, not resets to 1.
const freshAgain = N.applyFrameToLive({ schemaVersion: 99, epoch: 4, streamPicks: [] }, 'SELECTED 1 11111 2', 7500);
assert.equal(freshAgain.epoch, 5, 'epoch keeps incrementing across repeated schema-version resets');

// 13. applyDomPicks: merges into the live snapshot by pickNumber without touching the stream,
// replaces same-number rows, caps at 400 (highest numbers win), and resets a stale-version prior.
let liveDom = N.createLiveSnapshot();
liveDom = N.applyFrameToLive(liveDom, 'SELECTED 10 11111 2', 1000);
liveDom = N.applyDomPicks(liveDom, [{ pickNumber: 1, text: '1Christian McCaffreySFRBKoston\'s Top-Notch Team2', segments: ['1', 'Christian McCaffrey', 'SF', 'RB', 'Koston\'s Top-Notch Team'] }]);
assert.equal(liveDom.streamPicks.length, 1, 'domPicks must not touch the stream picks');
assert.equal(liveDom.lastHeartbeatAt, 1000, 'DOM-only writes must not refresh the heartbeat');
assert.equal(liveDom.domPicks.length, 1);
assert.equal(liveDom.domPicks[0].pickNumber, 1);
assert.equal(liveDom.domPicks[0].text, '1Christian McCaffreySFRBKoston\'s Top-Notch Team2');
assert.equal(liveDom.domPicks[0].playerId, null, 'real ESPN pick rows carry no data-player-id — must default to null, not undefined/missing');
assert.equal(liveDom.domMaxSeen, 1, 'domMaxSeen tracks the running max pickNumber merged');
assert.equal(liveDom.domSampledBeforeStream, false, 'the DOM was sampled AFTER the stream already had a pick — the pre-stream-empty window was missed, so this must stay false');
liveDom = N.applyDomPicks(liveDom, [{ pickNumber: 1, text: '1replacement', segments: [] }, { pickNumber: 2, text: '2two', segments: [], playerId: '99887766' }]);
assert.equal(liveDom.domPicks.length, 2, 'same pickNumber replaces; new ones append');
assert.equal(liveDom.domPicks[0].text, '1replacement');
assert.equal(liveDom.domPicks[1].pickNumber, 2);
assert.equal(liveDom.domPicks[1].playerId, '99887766', 'an opportunistic data-player-id, when present, is carried through');
assert.equal(liveDom.domMaxSeen, 2);
const manyRows = [];
for (let n = 1; n <= 405; n += 1) manyRows.push({ pickNumber: n, text: `t${n}`, segments: [] });
liveDom = N.applyDomPicks(N.createLiveSnapshot(), manyRows);
assert.equal(liveDom.domPicks.length, 400, 'domPicks is capped at 400');
assert.equal(liveDom.domPicks[0].pickNumber, 6, 'the cap keeps the highest pick numbers');
assert.equal(liveDom.domMaxSeen, 405, 'domMaxSeen is not capped even though domPicks storage is');
const freshDom = N.applyDomPicks({ schemaVersion: 1, streamPicks: [], mySlot: 1, leagueId: null, lastHeartbeatAt: null }, [{ pickNumber: 1, text: 'x', segments: [] }]);
assert.equal(freshDom.schemaVersion, N.LIVE_SCHEMA_VERSION, 'a wrong-version prior resets the live snapshot');
assert.equal(freshDom.domPicks.length, 1);
assert.equal(freshDom.epoch, 1, 'a schema-version reset via applyDomPicks must also bump epoch (both mutators share baseline())');
assert.equal(freshDom.resetReason, 'schema-change');
// Rows without a valid pickNumber are skipped; the rest merge by pickNumber (empty text is kept as
// the empty string), and a missing text falls back to the joined segments.
const filtered = N.applyDomPicks(N.createLiveSnapshot(), [{ pickNumber: 3 }, { text: 'no-number' }, { pickNumber: 4, segments: ['4', 'Name', 'SF'] }]);
assert.equal(filtered.domPicks.length, 2, 'rows without a valid pickNumber are skipped');
assert.equal(filtered.domPicks[0].pickNumber, 3);
assert.equal(filtered.domPicks[0].text, '', 'a row with neither text nor segments stores empty text');
assert.equal(filtered.domPicks[1].text, '4 Name SF', 'missing text falls back to the joined segments');

// 13b. Step 7 resume-detection markers: the sampled-before-stream race, and both offset estimates
// (domMaxSeen and the on-the-clock reading) landing correctly in domMaxAtStreamStart.
let sampledEarly = N.createLiveSnapshot();
sampledEarly = N.applyDomPicks(sampledEarly, [], null); // a reconcile that finds nothing, before any pick
assert.equal(sampledEarly.domSampledBeforeStream, true, 'sampling an empty board while the stream is still empty confirms it — not "never looked"');
assert.equal(sampledEarly.domMaxSeen, 0);
sampledEarly = N.applyFrameToLive(sampledEarly, 'SELECTED 1 11111 2', 1000);
assert.equal(sampledEarly.domMaxAtStreamStart, 0, 'a confirmed-empty board at stream start yields offset-0 evidence (espnOffset.ts board-empty source)');

// domMaxAtStreamStart takes the current-pick reading over domMaxSeen when it is higher (Finding B:
// the on-the-clock testid is present before the 4-row pick-number ticker has anything in it).
let lateAttach = N.createLiveSnapshot();
lateAttach = N.applyDomPicks(lateAttach, [{ pickNumber: 142, text: '142row', segments: [] }], null, { number: 146, team: 3 });
assert.equal(lateAttach.domMaxSeen, 142);
assert.equal(lateAttach.currentPickNumber, 146);
assert.equal(lateAttach.currentPickTeam, 3);
lateAttach = N.applyFrameToLive(lateAttach, 'SELECTED 6 4361529 16', 2000);
assert.equal(lateAttach.domMaxAtStreamStart, 145, 'domMaxAtStreamStart takes max(domMaxSeen, currentPickNumber - 1) = max(142, 145) = 145');

// currentPickNumber/currentPickTeam persist across a call that supplies no new reading (e.g. the
// current-pick element temporarily not found), rather than reverting to null.
let persistCurrent = N.createLiveSnapshot();
persistCurrent = N.applyDomPicks(persistCurrent, [], null, { number: 5, team: 1 });
persistCurrent = N.applyDomPicks(persistCurrent, [], null, null);
assert.equal(persistCurrent.currentPickNumber, 5, 'a call with no current-pick reading must not clobber the last known value');
assert.equal(persistCurrent.currentPickTeam, 1);

// 14. leagueIdFromUrl: the draft page URL carries no league id; only the socket URL does.
assert.equal(N.leagueIdFromUrl('https://fantasy.espn.com/football/draft'), null, 'the draft page URL carries no league id');
assert.equal(N.leagueIdFromUrl('wss://fantasydraft.espn.com/game-1/league-983371779/JOIN'), '983371779');
assert.equal(N.leagueIdFromUrl(null), null);

// 15. League-change reset: a frame from a DIFFERENT league starts a fresh snapshot — epoch bumps,
// resetReason names it, prior SELECTED/DOM rows drop, and the next SELECTED is overall 1.
// Same-league frames never reset. TOKEN's team id is field 2 throughout (field 0 is unused/ignored).
let switched = N.createLiveSnapshot();
switched = N.applyFrameToLive(switched, 'TOKEN 999:996408758:1:{XYZ-9}:3', 1000);
switched = N.applyFrameToLive(switched, 'SELECTED 1 11111 2', 2000);
switched = N.applyFrameToLive(switched, 'SELECTED 2 22222 4 {G}', 3000);
assert.equal(switched.streamPicks.length, 2);
assert.equal(switched.leagueId, '996408758');
assert.equal(switched.epoch, 0, 'same-league frames must not bump epoch');
assert.equal(switched.resetReason, 'new', 'no reset has happened yet');
switched = N.applyFrameToLive(switched, 'TOKEN 999:555111222:5:{Q}:3', 4000);
assert.equal(switched.streamPicks.length, 0, 'a new-league TOKEN must drop the prior SELECTED rows');
assert.equal(switched.leagueId, '555111222');
assert.equal(switched.mySlot, 5);
assert.equal(switched.epoch, 1, 'epoch increments on a league-change reset');
assert.equal(switched.resetReason, 'league-change');
assert.equal(switched.domMaxAtStreamStart, null, 'a league-change reset clears the offset markers along with everything else — this is a genuinely different draft');
switched = N.applyFrameToLive(switched, 'SELECTED 3 33333 2', 5000);
assert.equal(switched.streamPicks.length, 1);
assert.equal(switched.streamPicks[0].overall, 1, 'the next SELECTED after a reset is overall 1');

// A SELECTED from a different league-* socket URL resets BEFORE any TOKEN arrives.
let urlReset = N.createLiveSnapshot();
urlReset = N.applyFrameToLive(urlReset, 'SELECTED 1 11111 2', 1000, 'wss://fantasydraft.espn.com/game-1/league-111111111/JOIN');
assert.equal(urlReset.streamPicks.length, 1);
assert.equal(urlReset.leagueId, '111111111', 'SELECTED must stamp leagueId from the socket URL');
urlReset = N.applyFrameToLive(urlReset, 'SELECTED 2 22222 4 {G}', 2000, 'wss://fantasydraft.espn.com/game-1/league-999999999/JOIN');
assert.equal(urlReset.streamPicks.length, 1, 'a different-league SELECTED resets instead of appending');
assert.equal(urlReset.leagueId, '999999999');
assert.equal(urlReset.epoch, 1);
assert.equal(urlReset.streamPicks[0].playerId, '22222');
urlReset = N.applyFrameToLive(urlReset, 'SELECTED 3 33333 2', 3000, 'wss://fantasydraft.espn.com/game-1/league-999999999/JOIN');
assert.equal(urlReset.streamPicks.length, 2, 'same-league SELECTED appends normally');

// The null-identity window: after a reset, an OLD-league SELECTED (URL league differs from the
// stamped identity) must still reset instead of appending into the new stream.
let nullWindow = N.createLiveSnapshot();
nullWindow = N.applyFrameToLive(nullWindow, 'SELECTED 1 11111 2', 1000, 'wss://fantasydraft.espn.com/game-1/league-100000001/JOIN');
nullWindow = N.applyFrameToLive(nullWindow, 'SELECTED 2 22222 4', 2000, 'wss://fantasydraft.espn.com/game-1/league-100000002/JOIN');
assert.equal(nullWindow.streamPicks.length, 1, 'an old-league SELECTED after a reset must reset, not append');
assert.equal(nullWindow.leagueId, '100000002');
assert.equal(nullWindow.streamPicks[0].overall, 1);

// 16. applyDomPicks gates a leftover tab: DOM rows whose tab league differs from the snapshot's
// current league are skipped entirely (never merged, never reset); same-league rows merge.
let domGate = N.createLiveSnapshot();
domGate = N.applyFrameToLive(domGate, 'TOKEN 2:996408758:1:{XYZ-9}:3', 1000);
domGate = N.applyDomPicks(domGate, [{ pickNumber: 1, text: '1new-draft-row', segments: [] }], '996408758');
assert.equal(domGate.domPicks.length, 1, 'same-league DOM rows merge');
domGate = N.applyDomPicks(domGate, [{ pickNumber: 58, text: '58old-draft-row', segments: [] }], '123456789');
assert.equal(domGate.domPicks.length, 1, 'a different-league DOM write is skipped, not merged');
assert.equal(domGate.domPicks[0].pickNumber, 1);
domGate = N.applyDomPicks(domGate, [{ pickNumber: 2, text: '2no-league-url', segments: [] }], null);
assert.equal(domGate.domPicks.length, 2, 'a DOM write with no known league cannot be gated');

console.log('normalize.test.mjs: all assertions passed');
