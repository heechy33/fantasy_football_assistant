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

// 14b. League snapshot reducer (2026-08-27 connect/start split): keyed by the league-API URL's id.
const LEAGUE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/983371779?view=mSettings';
const leagueJson = N.applyLeagueJson(null, { id: 983371779, seasonId: 2026, settings: { name: 'L' } }, LEAGUE_URL, 1700000000000);
assert.equal(leagueJson.schemaVersion, 1);
assert.equal(leagueJson.leagueId, '983371779', 'league id parsed from the capture URL');
assert.equal(leagueJson.season, '2026', 'season from seasonId in the payload');
assert.equal(leagueJson.payload.settings.name, 'L', 'payload stored verbatim');
// A second league's capture REPLACES the snapshot rather than merging.
const leagueJson2 = N.applyLeagueJson(leagueJson, { id: 42 }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/42?view=mTeam', 1700000001000);
assert.equal(leagueJson2.leagueId, '42');
assert.equal(leagueJson2.payload.id, 42);
// A payload with no derivable league id is skipped — never a guess.
assert.equal(N.applyLeagueJson(leagueJson, { foo: 1 }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues?view=mTeam', 1700000002000), leagueJson);
assert.equal(N.leagueIdFromLeagueUrl('https://fantasy.espn.com/football/league?leagueId=1'), null, 'only the leagues/<id> API tree carries the id');
assert.equal(N.seasonFromLeagueUrl(LEAGUE_URL), '2026', 'season fallback from the URL');

// 14c. Multi-view MERGE (2026-08-27 fix): the ESPN league page fires several league-API calls for
// the SAME league (?view=mSettings, mTeam, mRoster, mDraftDetail). A same-league capture must
// MERGE — a late response without scoringSettings must never erase what mSettings captured —
// while a DIFFERENT-league capture still replaces wholesale (asserted above at 14b).
const mergedSettings = N.applyLeagueJson(
  null,
  { id: 777, seasonId: 2026, settings: { scoringSettings: { scoringItems: [{ statId: 3, points: 0.05 }] }, name: 'M' } },
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/777?view=mSettings',
  1700000000000,
);
const mergedRoster = N.applyLeagueJson(
  mergedSettings,
  { id: 777, teams: [{ id: 1, roster: { entries: [{ playerPoolEntry: { player: { fullName: 'QB One' } } }] } }] },
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/777?view=mRoster',
  1700000001000,
);
assert.equal(mergedRoster.leagueId, '777');
assert.equal(mergedRoster.leagueId === mergedSettings.leagueId, true, 'same league');
assert.notEqual(mergedRoster, mergedSettings, 'same-league capture produces a NEW merged snapshot');
assert.equal(
  mergedRoster.payload.settings.scoringSettings.scoringItems[0].statId, 3,
  'a late mRoster response must not erase settings.scoringSettings captured earlier',
);
assert.equal(mergedRoster.payload.settings.name, 'M', 'unrelated settings keys survive the merge');
assert.equal(Array.isArray(mergedRoster.payload.teams) && mergedRoster.payload.teams.length, 1, 'mTeam/mRoster teams[] merged in');
// Arrays replace, never concatenate.
const mergedTeamsAgain = N.applyLeagueJson(
  mergedRoster,
  { id: 777, teams: [{ id: 1 }, { id: 2 }] },
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/777?view=mTeam',
  1700000002000,
);
assert.equal(mergedTeamsAgain.payload.teams.length, 2, 'a later teams[] REPLACES the earlier one (never appends)');
// views[] accumulates the ?view= params seen for this league, deduped, in arrival order.
assert.deepEqual(mergedTeamsAgain.views, ['mSettings', 'mRoster', 'mTeam']);
// draftDetail from a later mDraftDetail view merges at the top level (records merge one level).
const mergedDraft = N.applyLeagueJson(
  mergedTeamsAgain,
  { id: 777, draftDetail: { rounds: 14 } },
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/777?view=mDraftDetail',
  1700000003000,
);
assert.equal(mergedDraft.payload.draftDetail.rounds, 14, 'mDraftDetail merged');
assert.equal(mergedDraft.payload.teams.length, 2, 'draftDetail merge did not disturb teams[]');
assert.equal(mergedDraft.season, '2026', 'season persists across views');
assert.deepEqual(mergedDraft.views, ['mSettings', 'mRoster', 'mTeam', 'mDraftDetail']);

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

// 15b. Hidden-tab league-change guard (2026-08-28): a BACKGROUNDED/abandoned draft tab (ESPN
// keeps autopicking a left mock server-side) must never wipe the shared live key back to its own
// league. Only a VISIBLE tab may reset; a hidden tab's foreign frame is refused outright -- the
// applyDomPicks convention -- while its SAME-league frames keep accumulating, so the normal
// "alternate between the draft tab and the app tab while tracking one draft" workflow is
// untouched. This is the mechanism behind a reported bug: leaving a mock mid-draft (pick 14) and
// starting a new one elsewhere left the board stuck on the abandoned draft until IT finished.
const OLD_URL = 'wss://fantasydraft.espn.com/game-1/league-996408758/JOIN';
const NEW_URL = 'wss://fantasydraft.espn.com/game-1/league-555111222/JOIN';

// (a) hidden + a DIFFERENT league -> refused; nothing moves, not even the heartbeat.
let hidden = N.createLiveSnapshot();
hidden = N.applyFrameToLive(hidden, 'TOKEN 999:996408758:1:{X}:3', 1000);
hidden = N.applyFrameToLive(hidden, 'SELECTED 1 11111 2', 2000, OLD_URL);
hidden = N.applyFrameToLive(hidden, 'TOKEN 999:555111222:5:{Q}:3', 3000, NEW_URL, false);
assert.equal(hidden.leagueId, '996408758', 'a hidden tab must not re-stamp the league');
assert.equal(hidden.streamPicks.length, 1, 'a hidden tab must not wipe the stream');
assert.equal(hidden.epoch, 0, 'a refused write must not bump epoch');
assert.equal(hidden.resetReason, 'new');
assert.equal(hidden.mySlot, 1, 'a refused TOKEN must not steal mySlot');
assert.equal(hidden.lastHeartbeatAt, 2000, 'a refused write must not refresh the heartbeat');
hidden = N.applyFrameToLive(hidden, 'SELECTED 2 22222 4', 4000, NEW_URL, false);
assert.equal(hidden.streamPicks.length, 1, 'a hidden foreign SELECTED is refused too (URL-derived league)');
assert.equal(hidden.leagueId, '996408758');

// (b) hidden + the SAME league -> still accumulates (the user alternating tabs on their OWN draft).
hidden = N.applyFrameToLive(hidden, 'SELECTED 2 22222 4', 5000, OLD_URL, false);
assert.equal(hidden.streamPicks.length, 2, 'a hidden tab must keep accumulating its OWN league');
assert.equal(hidden.streamPicks[1].overall, 2);
assert.equal(hidden.lastHeartbeatAt, 5000, 'same-league hidden frames still refresh the heartbeat');
const hiddenJoin = N.applyFrameToLive(hidden, 'JOINED 7 {G}', 6000, OLD_URL, false);
assert.equal(hiddenJoin.mySlot, 7, 'a hidden same-league JOINED still sets the seat');

// Establishing the FIRST league never depends on visibility (base.leagueId is null -> no guard).
const hiddenFirst = N.applyFrameToLive(N.createLiveSnapshot(), 'SELECTED 1 11111 2', 1000, OLD_URL, false);
assert.equal(hiddenFirst.leagueId, '996408758', 'the first league stamp is visibility-independent');
assert.equal(hiddenFirst.streamPicks.length, 1);

// (c) regression: a VISIBLE tab's different-league frame still resets exactly as before.
let visible = N.createLiveSnapshot();
visible = N.applyFrameToLive(visible, 'TOKEN 999:996408758:1:{X}:3', 1000);
visible = N.applyFrameToLive(visible, 'SELECTED 1 11111 2', 2000, OLD_URL);
visible = N.applyFrameToLive(visible, 'TOKEN 999:555111222:5:{Q}:3', 3000, NEW_URL, true);
assert.equal(visible.leagueId, '555111222');
assert.equal(visible.epoch, 1, 'a visible tab still resets on a league change');
assert.equal(visible.resetReason, 'league-change');
assert.equal(visible.streamPicks.length, 0);
assert.equal(visible.mySlot, 5);

// (d) EXPIRED-OWNERSHIP takeover (2026-08-29): the shared key survives a finished/closed draft
// indefinitely, and a corpse snapshot (heartbeat far older than the 60s LIVE_OWNERSHIP_EXPIRY_MS
// window) must NOT be allowed to refuse the real new draft's frames forever. Visibility
// protection exists to stop an actively autopicking abandoned draft — and such a tab heartbeats
// about every second, keeping its age tiny — so an expired heartbeat is proof the owner is dead.
let corpse = N.createLiveSnapshot();
corpse = N.applyFrameToLive(corpse, 'TOKEN 999:996408758:1:{X}:3', 0);
corpse = N.applyFrameToLive(corpse, 'SELECTED 1 11111 2', 1000, OLD_URL);
corpse = N.applyFrameToLive(corpse, 'TOKEN 999:555111222:5:{Q}:3', 62000, NEW_URL, false);
assert.equal(corpse.leagueId, '555111222', 'a dead snapshot cannot keep ownership from a hidden tab');
assert.equal(corpse.epoch, 1, 'the takeover goes through the normal league-change reset');
assert.equal(corpse.resetReason, 'league-change');
assert.equal(corpse.streamPicks.length, 0, "the corpse draft's picks do not survive the takeover");
assert.equal(corpse.mySlot, 5, 'the new league owns the seat after the takeover');

// A FRESH heartbeat keeps full protection: within the window the hidden refusal holds unchanged.
let freshOwned = N.createLiveSnapshot();
freshOwned = N.applyFrameToLive(freshOwned, 'TOKEN 999:996408758:1:{X}:3', 60000);
freshOwned = N.applyFrameToLive(freshOwned, 'SELECTED 1 11111 2', 61000, OLD_URL);
freshOwned = N.applyFrameToLive(freshOwned, 'TOKEN 999:555111222:5:{Q}:3', 62000, NEW_URL, false);
assert.equal(freshOwned.leagueId, '996408758', 'a fresh snapshot is still protected from hidden foreign frames');
assert.equal(freshOwned.streamPicks.length, 1, 'the fresh owner keeps its stream');

// (e) SAME-LEAGUE DRAFT RESTART (2026-08-29): ESPN practice drafts run INSIDE the same league, so
// a new practice draft reuses the previous draft's league id and no league-change reset fires.
// The leftover stream poisoned everything: new picks appended at 161+ and the (slot, playerId)
// dedupe dropped every pick the previous draft also made. A same-league JOINED/TOKEN is the
// restart checkpoint: reset when the held draft is COMPLETE (teams x rounds) or QUIET (heartbeat
// silent >= 30s); a mid-draft tab refresh (fresh heartbeat, incomplete stream) must keep picks.
const PRACTICE_URL = 'wss://fantasydraft.espn.com/game-1/league-996408758/JOIN';

// Complete draft: 10 teams x 2 rounds stamped, 20 picks on record -> a new JOINED resets.
let finished = N.createLiveSnapshot();
finished = N.applyFrameToLive(finished, 'TOKEN 999:996408758:1:{X}:3', 0);
for (let i = 1; i <= 20; i += 1) finished = N.applyFrameToLive(finished, `SELECTED ${(i % 10) + 1} 9000${i} 2`, i * 1000, PRACTICE_URL);
finished = N.applyLeagueFacts(finished, { rounds: 2, teams: 10 }, '996408758');
assert.equal(finished.streamPicks.length, 20, 'the finished draft holds a full 20-pick stream');
let restarted = N.applyFrameToLive(finished, 'JOINED 5 {H}', 25000, PRACTICE_URL, true);
assert.equal(restarted.streamPicks.length, 0, 'a COMPLETE same-league draft is reset on room entry');
assert.equal(restarted.epoch, 1, 'the restart bumps the epoch');
assert.equal(restarted.resetReason, 'draft-restart', 'the reset is reported as a draft restart');
assert.equal(restarted.leagueId, '996408758', 'the same league is re-stamped');
assert.equal(restarted.mySlot, 5, 'the new room JOINED establishes the seat');

// The reset also works via TOKEN (room entry without a JOINED observation).
let restartedByToken = N.applyFrameToLive(finished, 'TOKEN 999:996408758:3:{Y}:3', 25000, PRACTICE_URL, true);
assert.equal(restartedByToken.streamPicks.length, 0, 'a COMPLETE same-league draft is reset on TOKEN too');
assert.equal(restartedByToken.resetReason, 'draft-restart');

// Mid-draft refresh: fresh heartbeat, incomplete stream -> JOINED keeps the picks (resume path).
let running = N.createLiveSnapshot();
running = N.applyFrameToLive(running, 'TOKEN 999:996408758:1:{X}:3', 60000);
running = N.applyFrameToLive(running, 'SELECTED 1 11111 2', 61000, PRACTICE_URL);
running = N.applyFrameToLive(running, 'SELECTED 2 22222 4', 62000, PRACTICE_URL);
running = N.applyLeagueFacts(running, { rounds: 16, teams: 10 }, '996408758');
let resumed = N.applyFrameToLive(running, 'JOINED 1 {R}', 65000, PRACTICE_URL, true);
assert.equal(resumed.streamPicks.length, 2, 'a fresh mid-draft rejoin must NOT reset (resume)');
assert.equal(resumed.epoch, 0, 'the resume does not bump the epoch');
assert.equal(resumed.mySlot, 1, 'the resume still takes the seat');

// Quiet draft: heartbeat silent > 30s, stream incomplete (abandoned mid-draft) -> reset.
let abandoned = N.createLiveSnapshot();
abandoned = N.applyFrameToLive(abandoned, 'TOKEN 999:996408758:1:{X}:3', 0);
abandoned = N.applyFrameToLive(abandoned, 'SELECTED 1 11111 2', 1000, PRACTICE_URL);
abandoned = N.applyFrameToLive(abandoned, 'SELECTED 2 22222 4', 2000, PRACTICE_URL);
abandoned = N.applyLeagueFacts(abandoned, { rounds: 16, teams: 10 }, '996408758');
// applyLeagueFacts stamps a real Date.now() heartbeat (it only ever fires on a live reconcile);
// rewind it onto the test's fake timeline so the quiet check reads the intended 38s of silence.
abandoned = { ...abandoned, lastHeartbeatAt: 2000 };
let taken = N.applyFrameToLive(abandoned, 'JOINED 8 {N}', 40000, PRACTICE_URL, true);
assert.equal(taken.streamPicks.length, 0, 'a QUIET incomplete draft is reset on room entry');
assert.equal(taken.resetReason, 'draft-restart');
assert.equal(taken.mySlot, 8);

// 16. applyDomPicks gates a leftover tab: DOM rows whose tab league differs from the snapshot's
// current league are skipped entirely (never merged, never reset); same-league rows merge.
let domGate = N.createLiveSnapshot();
domGate = N.applyFrameToLive(domGate, 'TOKEN 2:996408758:1:{XYZ-9}:3', 1000);
domGate = N.applyDomPicks(domGate, [{ pickNumber: 1, text: '1new-draft-row', segments: [] }], '996408758');
assert.equal(domGate.domPicks.length, 1, 'same-league DOM rows merge');
domGate = N.applyDomPicks(domGate, [{ pickNumber: 58, text: '58old-draft-row', segments: [] }], '123456789');
assert.equal(domGate.domPicks.length, 1, 'a different-league DOM write is skipped, not merged');
assert.equal(domGate.domPicks[0].pickNumber, 1);
// 2026-08-28 fix: an unknown-league write (no league identified yet by THIS tab) must ALSO be
// refused once the snapshot already belongs to a league — the prior "cannot be gated" behavior let
// any tab that hadn't yet named its own league (a second lobby, a leftover page) free-ride into an
// already-active draft's board-depth signals (domMaxSeen/currentPickNumber), which is what fed the
// wrong absolute-offset estimate behind the "board showed pick 97 when ESPN was on pick 14" bug.
domGate = N.applyDomPicks(domGate, [{ pickNumber: 2, text: '2no-league-url', segments: [] }], null);
assert.equal(domGate.domPicks.length, 1, 'an unknown-league write is now refused once a league is stamped');
// A snapshot with NO league stamped yet still accepts writes from anyone (the normal from-pick-1
// race before any tab's socket has spoken).
let domGateFresh = N.createLiveSnapshot();
domGateFresh = N.applyDomPicks(domGateFresh, [{ pickNumber: 1, text: '1no-league-yet', segments: [] }], null);
assert.equal(domGateFresh.domPicks.length, 1, 'a snapshot with no stamped league accepts an unknown-league write');

// 17. League snapshot draftDetailFetchStatus: 'failed' sets, 'ok' clears, passive captures keep.
const leagueUrl = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/42';
let leagueSnap = N.applyLeagueJson(null, { id: 42, seasonId: 2026 }, leagueUrl, 1000, 'failed');
assert.equal(leagueSnap.draftDetailFetchStatus, 'failed', 'an explicit failed status must be recorded');
leagueSnap = N.applyLeagueJson(leagueSnap, { id: 42 }, leagueUrl, 2000);
assert.equal(leagueSnap.draftDetailFetchStatus, 'failed', 'a passive capture must not erase a real failure');
leagueSnap = N.applyLeagueJson(
  leagueSnap,
  { id: 42, draftDetail: { rounds: 15 } },
  leagueUrl + '?view=mDraftDetail&view=mRoster',
  3000,
  'ok',
);
assert.equal(leagueSnap.draftDetailFetchStatus, null, 'an eventual success must clear the failure');
assert.equal(leagueSnap.payload.draftDetail.rounds, 15);
assert.ok(leagueSnap.views.includes('mDraftDetail'), 'the successful fetch view is recorded');
leagueSnap = N.markLeagueFetchFailed(leagueSnap);
assert.equal(leagueSnap.draftDetailFetchStatus, 'failed', 'markLeagueFetchFailed sets the flag');
assert.ok(leagueSnap.payload.draftDetail.rounds === 15, 'markLeagueFetchFailed keeps the payload');
assert.equal(N.markLeagueFetchFailed(null), null, 'markLeagueFetchFailed is a no-op without a snapshot');

// 17b. QUALITY-AWARE MERGE: a later, poorer capture must not destroy earlier, richer data.
// A bare/short teams[] (e.g. from a late mSettings call) must NOT replace a roster-bearing one.
let mergeGuard = N.applyLeagueJson(null, { id: 43, seasonId: 2026, teams: [{ id: 1, name: 'Himchan', roster: { entries: [] } }, { id: 2, name: 'Rival' }] }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/43', 1000, 'ok');
assert.equal(mergeGuard.payload.teams.length, 2);
mergeGuard = N.applyLeagueJson(mergeGuard, { id: 43, teams: [] }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/43', 2000);
assert.equal(mergeGuard.payload.teams.length, 2, 'an empty teams[] must not replace a populated one');
mergeGuard = N.applyLeagueJson(mergeGuard, { id: 43, teams: [{ id: 1, abbrev: 'A' }] }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/43', 3000);
assert.equal(mergeGuard.payload.teams.length, 2, 'a shorter teams[] must not replace a longer one');
assert.equal(mergeGuard.payload.teams[0].name, 'Himchan', 'the richer team record survives');
// A richer LATER array still wins.
mergeGuard = N.applyLeagueJson(mergeGuard, { id: 43, teams: [{ id: 1, name: 'Himchan', roster: { entries: [{ playerId: 1 }] } }, { id: 2, name: 'Rival' }, { id: 3, name: 'Third' }] }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/43', 4000);
assert.equal(mergeGuard.payload.teams.length, 3, 'a longer later teams[] replaces');
// A null field must never erase a merged record.
mergeGuard = N.applyLeagueJson(mergeGuard, { id: 43, draftDetail: { rounds: 15 } }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/43?view=mDraftDetail', 5000, 'ok');
assert.equal(mergeGuard.payload.draftDetail.rounds, 15);
mergeGuard = N.applyLeagueJson(mergeGuard, { id: 43, draftDetail: null }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/43', 6000);
assert.equal(mergeGuard.payload.draftDetail.rounds, 15, 'a null draftDetail must not erase the merged record');
// Scalars still replace (freshness wins for plain values).
mergeGuard = N.applyLeagueJson(mergeGuard, { id: 43, seasonId: 2027 }, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2027/segments/0/leagues/43', 7000);
assert.equal(mergeGuard.payload.seasonId, 2027, 'scalar replacement is unchanged');

// 18. Missed-frame SELF-CORRECTION (2026-08-28): applyDetailPicks merges ESPN's authoritative
// mDraftDetail pick history into the live snapshot by overall — the repair path for a tab that
// silently missed websocket frames. Identity + overall are required; stream picks are untouched;
// existing entries are never overwritten.
{
  const detailShape = (overall, playerId, name, teamId) => ({
    pickNumber: overall, id: playerId, player: { id: playerId, fullName: name, defaultPositionId: 2 }, team: { teamId },
  });
  const live = N.createLiveSnapshot();
  let merged = N.applyDetailPicks(live, [detailShape(65, '4429795', 'Jahmyr Gibbs', '3'), detailShape(66, '4362628', 'JaMarr Chase', '7')]);
  assert.equal(merged.detailPicks.length, 2, 'detail picks merge into an empty snapshot');
  assert.deepEqual(merged.detailPicks.map((p) => p.overall), [65, 66], 'sorted by overall');
  assert.equal(merged.detailPicks[0].playerId, '4429795', 'real player id kept for direct crosswalk resolution');
  assert.equal(merged.detailPicks[0].name, 'Jahmyr Gibbs');
  // A stream pick the tab DID see at 66 — detail must not overwrite (first write wins).
  merged = N.applyDetailPicks(merged, [detailShape(66, '9999999', 'Someone Else', '2'), detailShape(67, '3139477', 'Justin Jefferson', '5')]);
  assert.equal(merged.detailPicks.length, 3, 'a new overall appends');
  assert.equal(merged.detailPicks[1].playerId, '4362628', 'an existing overall is never overwritten');
  // Structurally empty rows are skipped; a NAME-only row is kept (the name resolves through the
  // app name tiers — more identity than nothing, never a guess).
  merged = N.applyDetailPicks(merged, [{ pickNumber: 68 }, { pickNumber: 69, player: { fullName: 'No Id' } }]);
  assert.equal(merged.detailPicks.length, 4, 'a row with no identity at all is skipped; a name-only row merges');
  // ESPN mock drafts (2026-08-28): autopick rows can carry the -1 sentinel id with NO name.
  // A row that still carries the drafting teamId is KEPT (empty playerId) - the app joins the DOM
  // pick row at that absolute pick for the name and uses the teamId sequence for offset
  // alignment. Real negative D/ST ids (-16003-style) stay. A row with neither id, name, nor
  // teamId is useless and skipped.
  merged = N.applyDetailPicks(merged, [detailShape(70, '-1', '', '3'), detailShape(71, '0', 'Zero Sentinel', '3'), detailShape(72, '-16003', 'Texans D/ST', '16')]);
  assert.equal(merged.detailPicks.length, 7, 'sentinel-id rows WITH a teamId are kept; the D/ST row merges');
  assert.equal(merged.detailPicks[4].playerId, '', 'a sentinel-id row stores an empty playerId for the DOM join');
  merged = N.applyDetailPicks(merged, [{ pickNumber: 73, id: '-1', player: { id: '-1' }, team: {} }]);
  assert.equal(merged.detailPicks.length, 7, 'a sentinel-id row with no name and no teamId is skipped');
  // Non-array input is a no-op; a stale-version snapshot gets reset to a fresh one.
  assert.equal(N.applyDetailPicks(merged, 'nope'), merged, 'non-array input is a no-op');
  const stale = { schemaVersion: 1, detailPicks: [{ overall: 1 }] };
  assert.equal(N.applyDetailPicks(stale, [detailShape(1, '1', 'A', '1')]).detailPicks.length, 1, 'a stale-version prior resets and still merges');
}

// 19. League facts (2026-08-28): ESPN's own mSettings answer for the grid the app needs. The
// socket never states teams/rounds/season; these stamped values are authoritative, first-write
// wins. Additive optional fields on the live key.
{
  const N2 = globalThis.FfaEspnNormalize;
  let live = N2.createLiveSnapshot();
  live = N2.applyLeagueFacts(live, { rounds: 14, teams: 10, season: 2026 });
  assert.equal(live.leagueRounds, 14, 'rounds stamped');
  assert.equal(live.leagueTeams, 10, 'teams stamped');
  assert.equal(live.leagueSeason, '2026', 'season stamped as a string');
  // First write wins: a later DIFFERENT value never overwrites (a race with a league-change reset
  // clears the snapshot wholesale, so this can only be conflicting evidence).
  live = N2.applyLeagueFacts(live, { rounds: 8, teams: 6, season: 2027 });
  assert.equal(live.leagueRounds, 14, 'a later different rounds never overwrites');
  assert.equal(live.leagueTeams, 10, 'a later different teams never overwrites');
  assert.equal(live.leagueSeason, '2026', 'a later different season never overwrites');
  // Missing fields stay null; garbage input is a no-op.
  let fresh = N2.createLiveSnapshot();
  fresh = N2.applyLeagueFacts(fresh, { rounds: 14 });
  assert.equal(fresh.leagueTeams, null, 'unprovided facts stay null');
  assert.equal(N2.applyLeagueFacts(fresh, 'nope'), fresh, 'non-record input is a no-op');
  // A stale-version snapshot resets to a fresh one and still merges.
  const staleFacts = { schemaVersion: 1, leagueRounds: 3 };
  assert.equal(N2.applyLeagueFacts(staleFacts, { rounds: 14 }).leagueRounds, 14, 'a stale-version prior resets and merges');
}

// 20. leagueFactsFromPayload (2026-08-28): the ONE place the draft-room reconcile reads ESPN's
// shape, replacing the inline `payload.draftSettings.*` read that never matched ESPN's real
// response and left leagueRounds/leagueTeams permanently null (the root cause behind the launcher
// never showing real teams/rounds/seat). Exercised against the ACTUAL recorded contract fixture
// (fixtures/espn-contract/league-2026-08-27.json), not a hand-built stand-in, so the caller path is
// covered too.
{
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/espn-contract/league-2026-08-27.json', import.meta.url), 'utf8'));
  const facts = N.leagueFactsFromPayload(fixture);
  assert.equal(facts.teams, 10, 'teams read from teams[].length');
  assert.equal(facts.rounds, 14, 'rounds read from draftDetail.rounds (this fixture has no settings.draftSettings)');
  assert.equal(facts.season, '2026', 'season read from seasonId');
  assert.equal(facts.name, 'Gridiron Gurus League', 'name read from settings.name');

  // rounds from settings.draftSettings.rounds when present (preferred over draftDetail.rounds).
  const withDraftSettings = N.leagueFactsFromPayload({
    seasonId: 2026,
    teams: [{ id: 1 }, { id: 2 }],
    settings: { name: 'A League', teams: 2, draftSettings: { rounds: 16 } },
    draftDetail: { rounds: 14 },
  });
  assert.equal(withDraftSettings.rounds, 16, 'settings.draftSettings.rounds takes precedence');

  // The WRONG path this replaces: a top-level `payload.draftSettings` (not nested in `settings`)
  // must NOT be read — that was the bug (espn-content.js used to read exactly this path and get
  // `undefined` from every real ESPN response).
  const wrongPath = N.leagueFactsFromPayload({
    seasonId: 2026,
    teams: [{ id: 1 }, { id: 2 }],
    draftSettings: { rounds: 16, teams: 2 },
  });
  assert.equal(wrongPath.rounds, null, 'a top-level draftSettings field must not be read');

  // REAL 2026 SHAPE: draftDetail carries no `rounds` field at all -- the full slate IS teams x
  // rounds, accepted only when it divides evenly.
  const fullSlate = N.leagueFactsFromPayload({
    seasonId: 2026,
    teams: [{ id: 1 }, { id: 2 }],
    draftDetail: { picks: new Array(28).fill({ teamId: 1 }) },
  });
  assert.equal(fullSlate.rounds, 14, 'rounds derived from picks.length / teams when it divides evenly');
  const partialSlate = N.leagueFactsFromPayload({
    seasonId: 2026,
    teams: [{ id: 1 }, { id: 2 }],
    draftDetail: { picks: new Array(15).fill({ teamId: 1 }) },
  });
  assert.equal(partialSlate.rounds, null, 'a remainder means a partial capture -- never divide it into a confident read');

  assert.equal(N.leagueFactsFromPayload(null), null, 'non-record input is a no-op');
  assert.equal(N.leagueFactsFromPayload('nope'), null, 'non-record input is a no-op');
}

// 21. applyDetailPicks / applyLeagueFacts league gating (2026-08-28): the same fail-open class as
// applyDomPicks (test 16) applied to the reconcile's other two writers -- a foreign or
// not-yet-identified tab must not merge into an already-established snapshot.
{
  const detailShape = (overall, playerId, name, teamId) => ({
    pickNumber: overall, id: playerId, player: { id: playerId, fullName: name, defaultPositionId: 2 }, team: { teamId },
  });
  let gated = N.createLiveSnapshot();
  gated = N.applyFrameToLive(gated, 'TOKEN 2:700000001:1:{X}:3', 1000);
  gated = N.applyDetailPicks(gated, [detailShape(1, '111', 'Same League', '1')], '700000001');
  assert.equal(gated.detailPicks.length, 1, 'same-league applyDetailPicks merges');
  gated = N.applyDetailPicks(gated, [detailShape(2, '222', 'Foreign League', '2')], '999999999');
  assert.equal(gated.detailPicks.length, 1, 'a foreign-league applyDetailPicks write is refused');
  gated = N.applyDetailPicks(gated, [detailShape(2, '222', 'Unknown League', '2')], null);
  assert.equal(gated.detailPicks.length, 1, 'an unknown-league applyDetailPicks write is refused once a league is stamped');

  let gatedFacts = N.createLiveSnapshot();
  gatedFacts = N.applyFrameToLive(gatedFacts, 'TOKEN 2:700000002:1:{X}:3', 1000);
  gatedFacts = N.applyLeagueFacts(gatedFacts, { rounds: 14, teams: 10 }, '700000002');
  assert.equal(gatedFacts.leagueRounds, 14, 'same-league applyLeagueFacts merges');
  gatedFacts = N.applyLeagueFacts(gatedFacts, { rounds: 8, teams: 6 }, '999999999');
  assert.equal(gatedFacts.leagueRounds, 14, 'a foreign-league applyLeagueFacts write is refused');
}

// 22. UNDRAFTED-SLATE TRUNCATION (2026-08-28): ESPN's draftDetail.picks pre-assigns teamId to
// picks that have NOT happened yet, and a mock autopick's sentinel row is structurally
// indistinguishable from that padding. This is the "board showed pick 97 when ESPN was on pick 14"
// bug's other candidate cause -- detailPicks must never extend past the last row that carries real
// identity (a resolvable player id or name).
{
  const detailShape = (overall, playerId, name, teamId) => ({
    pickNumber: overall, id: playerId, player: { id: playerId, fullName: name, defaultPositionId: 2 }, team: { teamId },
  });
  const sentinelShape = (overall, teamId) => ({ pickNumber: overall, id: '-1', player: { id: '-1' }, team: { teamId } });
  const live = N.createLiveSnapshot();
  const rows = [];
  for (let i = 1; i <= 14; i += 1) rows.push(detailShape(i, String(1000 + i), `Player ${i}`, String((i % 10) + 1)));
  for (let i = 15; i <= 160; i += 1) rows.push(sentinelShape(i, String((i % 10) + 1))); // undrafted slate padding
  const merged = N.applyDetailPicks(live, rows);
  assert.equal(merged.detailPicks.length, 14, 'the padded slate tail is truncated at the last identified pick');
  assert.deepEqual(merged.detailPicks.map((p) => p.overall), Array.from({ length: 14 }, (_, i) => i + 1));

  // A pure-autopick mock with NOTHING identified yet: truncate to the live-signal bound instead of
  // trusting the full padded slate.
  const pureAutopick = [];
  for (let i = 1; i <= 200; i += 1) pureAutopick.push(sentinelShape(i, String((i % 10) + 1)));
  const boundedByCurrentPick = { ...N.createLiveSnapshot(), currentPickNumber: 5 };
  const truncated = N.applyDetailPicks(boundedByCurrentPick, pureAutopick);
  assert.ok(truncated.detailPicks.length <= 5, 'with nothing identified, the slate is bounded by the live signal, not the full 200-row padding');

  // A real-but-unresolved teamId-only row SANDWICHED between identified rows survives truncation
  // (mock-autopick offset alignment needs the teamId sequence) -- only the tail past the LAST
  // identified row is dropped.
  const sandwiched = [detailShape(1, '111', 'A', '1'), sentinelShape(2, '2'), detailShape(3, '333', 'C', '3'), sentinelShape(4, '4')];
  const sandwichedResult = N.applyDetailPicks(N.createLiveSnapshot(), sandwiched);
  assert.equal(sandwichedResult.detailPicks.length, 3, 'only the tail AFTER the last identified row is dropped');
  assert.deepEqual(sandwichedResult.detailPicks.map((p) => p.overall), [1, 2, 3]);
}

// 23. lastHeartbeatAt must NOT move on a background API reconcile (2026-08-29): applyDetailPicks
// and applyLeagueFacts run off a ~30s timer, not a live socket frame -- stamping the heartbeat here
// would launder a dead/abandoned draft tab as fresh and defeat the same-league quiet-restart rule
// (LIVE_RESTART_QUIET_MS) above. Mirrors applyDomPicks' existing discipline (test 15b).
{
  const detailShape = (overall, playerId, name, teamId) => ({
    pickNumber: overall, id: playerId, player: { id: playerId, fullName: name, defaultPositionId: 2 }, team: { teamId },
  });
  const base = { ...N.createLiveSnapshot(), lastHeartbeatAt: 1000 };
  const afterDetail = N.applyDetailPicks(base, [detailShape(1, '111', 'A', '1')]);
  assert.equal(afterDetail.lastHeartbeatAt, 1000, 'applyDetailPicks must not touch the heartbeat');
  const afterFacts = N.applyLeagueFacts(base, { rounds: 14, teams: 10 });
  assert.equal(afterFacts.lastHeartbeatAt, 1000, 'applyLeagueFacts must not touch the heartbeat');
}

// 24. Same-league DRAFT RESTART via board regression (2026-08-29): when no tab observes a fresh
// JOINED/TOKEN (a DIFFERENT tab is the one that (re)joined the room), the DOM itself going back to
// pick 1 with nothing drafted is the restart signal. Both conditions -- a deep existing stream AND
// a pick-1-with-zero-rows reading -- are required together so a single mid-render frame (the ticker
// not yet populated on an ongoing draft) can't false-trigger it.
{
  let deep = N.createLiveSnapshot();
  for (let i = 1; i <= 20; i += 1) deep = N.applyFrameToLive(deep, `SELECTED ${(i % 10) + 1} 9000${i} 2`, i * 1000, 'wss://fantasydraft.espn.com/game-1/league-700000003/JOIN');
  assert.equal(deep.streamPicks.length, 20, 'a deep stream is set up for the regression check');

  // Board regresses to pick 1, zero rows -> reset.
  const restarted = N.applyDomPicks(deep, [], '700000003', { number: 1, team: null });
  assert.equal(restarted.streamPicks.length, 0, 'a same-league board regression to pick 1 resets the stream');
  assert.equal(restarted.epoch, deep.epoch + 1, 'the restart bumps the epoch');
  assert.equal(restarted.resetReason, 'draft-restart');
  // applyDomPicks never stamps leagueId itself (only gates on it) -- the next socket frame from the
  // (still open, still same-league) draft tab re-establishes it via the normal first-time path.
  assert.equal(restarted.leagueId, null, 'a DOM-only reset does not re-stamp leagueId');

  // Pick 1 alone, WITH dom rows present -> not a restart (a genuine pick-1 read, or a stale ticker
  // that has not cleared yet).
  const withRows = N.applyDomPicks(deep, [{ pickNumber: 1, text: 'x', segments: [] }], '700000003', { number: 1, team: null });
  assert.equal(withRows.streamPicks.length, 20, 'pick-1 with rows present is not a restart');

  // Zero rows alone, WITHOUT the pick-1 reading -> not a restart.
  const noRowsOnly = N.applyDomPicks(deep, [], '700000003', { number: 21, team: null });
  assert.equal(noRowsOnly.streamPicks.length, 20, 'zero rows without a pick-1 reading is not a restart');

  // A shallow stream (<=1 pick) never triggers the regression check regardless of the reading.
  const shallow = N.applyFrameToLive(N.createLiveSnapshot(), 'SELECTED 1 11111 2', 1000, 'wss://fantasydraft.espn.com/game-1/league-700000004/JOIN');
  const shallowResult = N.applyDomPicks(shallow, [], '700000004', { number: 1, team: null });
  assert.equal(shallowResult.streamPicks.length, 1, 'a shallow stream (<=1 pick) is never treated as a restart candidate');
  assert.notEqual(shallowResult.resetReason, 'draft-restart');
}

// 25. applyDraftLeagueJson (2026-08-29): the draft page's own league-settings snapshot, a SEPARATE
// key from the league-page capture. No incremental merge (every capture already carries all three
// views in one response) -- a same-league capture replaces wholesale, a different-league capture
// ALSO replaces wholesale (unlike applyLeagueJson, which merges same-league and REPLACES on a
// league change -- this function never merges at all, by design), and a capture with no resolvable
// leagueId is dropped rather than stored keyless.
{
  const payloadA = { settings: { name: 'League A', scoringSettings: { scoringItems: [{ statId: 3, points: 0.04 }] } } };
  const first = N.applyDraftLeagueJson(null, payloadA, '111', 1000);
  assert.equal(first.schemaVersion, N.DRAFT_LEAGUE_SCHEMA_VERSION);
  assert.equal(first.leagueId, '111');
  assert.deepEqual(first.payload, payloadA);
  assert.equal(first.capturedAt, 1000);

  // Same-league: a newer capture replaces wholesale (no merge -- a field dropped in a later
  // response is genuinely gone, since every capture is already the full three-view response).
  const payloadA2 = { settings: { name: 'League A' } }; // scoringSettings absent this time
  const sameLeague = N.applyDraftLeagueJson(first, payloadA2, '111', 2000);
  assert.deepEqual(sameLeague.payload, payloadA2, 'same-league capture replaces wholesale, never merges');
  assert.equal(sameLeague.capturedAt, 2000);

  // Different league (tracking a mock while a real league's capture is stored): also replaces --
  // this is what makes tracking a different draft safe, unlike LEAGUE_STORAGE_KEY's merge-then-
  // replace-on-change semantics.
  const payloadB = { settings: { name: 'Mock League' } };
  const differentLeague = N.applyDraftLeagueJson(sameLeague, payloadB, '222', 3000);
  assert.equal(differentLeague.leagueId, '222');
  assert.deepEqual(differentLeague.payload, payloadB);

  // No resolvable leagueId -> dropped, previous snapshot untouched.
  const noLeagueId = N.applyDraftLeagueJson(differentLeague, payloadB, null, 4000);
  assert.equal(noLeagueId, differentLeague, 'a capture with no leagueId is never stored');

  // Invalid payload -> dropped.
  const invalidPayload = N.applyDraftLeagueJson(differentLeague, null, '222', 5000);
  assert.equal(invalidPayload, differentLeague, 'a non-record payload is never stored');

  // Never mutates LEAGUE_STORAGE_KEY's own reducer/shape -- a completely separate function that
  // shares no state with applyLeagueJson (confirmed by construction: applyDraftLeagueJson never
  // reads or writes anything keyed by LEAGUE_STORAGE_KEY, which is a caller-side storage key, not
  // a parameter here).
  const untouchedLeagueSnapshot = N.applyLeagueJson(null, { id: '999', settings: { name: 'Real League' } }, 'https://x/leagues/999', 6000, 'ok');
  assert.equal(untouchedLeagueSnapshot.leagueId, '999');
  assert.equal(untouchedLeagueSnapshot.payload.settings.name, 'Real League');
}

// 24. Mid-draft-attach league stamping (2026-08-30): applyDetailPicks and applyLeagueFacts are the
// FIRST thing to run on a tab that attaches to an already-running draft (no socket frame yet), so
// they must be able to establish leagueId themselves rather than waiting for one. First-write-only,
// same discipline as every other field on these two reducers.
{
  const detailShape = (overall, playerId, name, teamId) => ({
    pickNumber: overall, id: playerId, player: { id: playerId, fullName: name, defaultPositionId: 2 }, team: { teamId },
  });

  // applyDetailPicks stamps leagueId onto a fresh (leagueId: null) snapshot.
  let stamped = N.applyDetailPicks(N.createLiveSnapshot(), [detailShape(1, '111', 'A', '1')], '700000003');
  assert.equal(stamped.leagueId, '700000003', 'applyDetailPicks stamps leagueId on first write');
  // Once stamped, a foreign league is still refused (the existing gate, unweakened).
  stamped = N.applyDetailPicks(stamped, [detailShape(2, '222', 'B', '2')], '999999999');
  assert.equal(stamped.leagueId, '700000003', 'a later foreign leagueId never overwrites the stamped one');
  assert.equal(stamped.detailPicks.length, 1, 'the foreign-league write itself is still refused');
  // No leagueId passed -> stays null, exactly as before this change.
  const unstamped = N.applyDetailPicks(N.createLiveSnapshot(), [detailShape(1, '111', 'A', '1')]);
  assert.equal(unstamped.leagueId, null, 'no leagueId argument leaves leagueId null');

  // applyLeagueFacts stamps leagueId onto a fresh snapshot the same way.
  let factsStamped = N.applyLeagueFacts(N.createLiveSnapshot(), { rounds: 14, teams: 10 }, '700000004');
  assert.equal(factsStamped.leagueId, '700000004', 'applyLeagueFacts stamps leagueId on first write');
  factsStamped = N.applyLeagueFacts(factsStamped, { rounds: 8, teams: 6 }, '999999999');
  assert.equal(factsStamped.leagueId, '700000004', 'a later foreign leagueId never overwrites the stamped one');
  assert.equal(factsStamped.leagueRounds, 14, 'the foreign-league write itself is still refused');

  // Neither reducer touches lastHeartbeatAt while stamping leagueId (same discipline as test 23).
  const withHeartbeat = { ...N.createLiveSnapshot(), lastHeartbeatAt: 1000 };
  assert.equal(N.applyDetailPicks(withHeartbeat, [detailShape(1, '111', 'A', '1')], '700000005').lastHeartbeatAt, 1000, 'applyDetailPicks stamping leagueId must not touch the heartbeat');
  assert.equal(N.applyLeagueFacts(withHeartbeat, { rounds: 14 }, '700000006').lastHeartbeatAt, 1000, 'applyLeagueFacts stamping leagueId must not touch the heartbeat');
}

console.log('normalize.test.mjs: all assertions passed');
