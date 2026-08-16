/* global globalThis */
(() => {
  'use strict';
  const SCHEMA_VERSION = 2;
  const STORAGE_KEY = 'ffa.espn.recon.snapshot.v1';
  const FRAME_SAMPLE_MAX = 50;
  const REJECTED_URL_MAX = 50;
  // Live pick-stream key: a SEPARATE, uncapped, ordered structure from the recon snapshot. Recon
  // keeps its bounded/deduped frames sample; the live stream must retain every SELECTED in order.
  // Live pick-stream key (Step 7c note): mirrored as LIVE_KEY in extension/src/app-content.js (the
  // relay that serves it) and removed by recon.js's Clear; the request/response MESSAGE names live in
  // frontend/src/adapters/espnBridge.ts. Keep the three sites in sync.
  const LIVE_SCHEMA_VERSION = 2;
  const LIVE_STORAGE_KEY = 'ffa.espn.live.snapshot.v1';
  const SECRET = /(?:authorization|cookie|token|password|secret|session|swid|espn_s2|s2|chat|message|conversation)/i;
  const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  const scalar = (value) => typeof value === 'string' ? value.slice(0, 500) : (typeof value === 'number' || typeof value === 'boolean' || value === null ? value : undefined);
  function redact(value, depth = 0) {
    if (depth > 8) return '[truncated-depth]';
    const safe = scalar(value);
    if (safe !== undefined) return safe;
    if (Array.isArray(value)) return value.slice(0, 320).map((item) => redact(item, depth + 1));
    if (!isRecord(value)) return undefined;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const next = SECRET.test(key) ? undefined : redact(item, depth + 1);
      return next === undefined ? [] : [[key, next]];
    }));
  }
  const read = (record, names) => isRecord(record) ? names.map((key) => record[key]).find((value) => value != null) ?? null : null;
  const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  // Reject nullish/empty/boolean inputs before Number(): Number(null) === 0 would otherwise let
  // records without a pick number (e.g. player-pool stat entries that carry only an id) pass asPick.
  const number = (value) => { if (value === null || value === undefined || value === '' || value === false) return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
  function asPick(value) {
    if (!isRecord(value)) return null;
    const player = isRecord(value.player) ? value.player : value;
    // Prefer the pick-level id; fall back to the nested player object (ESPN exposes both).
    const providerPlayerId = text(read(value, ['playerId', 'player_id', 'id'])) || text(read(player, ['playerId', 'player_id', 'id']));
    const name = text(read(player, ['fullName', 'displayName', 'name', 'playerName']));
    const overall = number(read(value, ['overall', 'overallPickNumber', 'pickNumber', 'selection']));
    if ((!providerPlayerId && !name) || overall === null) return null;
    const team = isRecord(value.team) ? value.team : value;
    // defaultPositionId is ESPN's numeric position id; keep it raw for recon and decode it later.
    return { overall, round: number(read(value, ['round', 'roundId', 'roundNumber'])), slot: number(read(value, ['slot', 'slotId', 'draftSlot'])), draftTeamId: text(read(team, ['teamId', 'team_id', 'draftTeamId'])), providerPlayerId, name, position: text(read(player, ['position', 'defaultPosition', 'positionAbbrev', 'defaultPositionId'])), proTeam: text(read(player, ['proTeam', 'proTeamId', 'teamAbbrev', 'team'])) };
  }
  function walk(value, found, seen = new WeakSet(), depth = 0) {
    if (depth > 8 || value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const picks = value.map(asPick).filter(Boolean);
      if (picks.length >= Math.min(2, value.length) && picks.length) found.push(picks);
      value.slice(0, 320).forEach((item) => walk(item, found, seen, depth + 1));
    } else Object.values(value).forEach((item) => walk(item, found, seen, depth + 1));
  }
  function identity(value, seen = new WeakSet(), depth = 0) {
    if (depth > 8 || value === null || typeof value !== 'object' || seen.has(value)) return {};
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => identity(item, seen, depth + 1)).find((item) => item.draftId || item.leagueId) || {};
    const draftId = text(read(value, ['draftId', 'draft_id'])); const leagueId = text(read(value, ['leagueId', 'league_id']));
    if (draftId || leagueId) return { draftId, leagueId, status: text(read(value, ['draftStatus', 'status'])) };
    return Object.values(value).map((item) => identity(item, seen, depth + 1)).find((item) => item.draftId || item.leagueId) || {};
  }
  function normalizeCandidate(candidate, sequence) {
    const payload = redact(candidate?.payload); const arrays = []; walk(payload, arrays);
    const picks = (arrays.sort((a, b) => b.length - a.length)[0] || []).sort((a, b) => a.overall - b.overall);
    const draft = identity(payload); const domRows = Array.isArray(candidate?.domRows) ? candidate.domRows.map((row) => redact(row)).filter(Boolean) : [];
    // leagueId/draftId normally come from the JSON payload; when the socket only carries non-JSON
    // frames, fall back to the draft/league id embedded in the socket URL itself.
    const url = text(candidate?.url) || '';
    const leagueId = draft.leagueId || (url.match(/league-(\d+)/i) || [])[1] || null;
    const draftId = draft.draftId || (url.match(/draft-(\d+)/i) || [])[1] || null;
    // frames is a bounded, deduped sample of distinct non-JSON frame shapes; frameCount counts every
    // non-JSON frame, so recon sees the frame vocabulary instead of only the final frame.
    const frameText = typeof candidate?.frame === 'string' ? redact(candidate.frame) : null;
    const frames = frameText ? [{ text: frameText, frameType: text(candidate?.frameType), byteLength: candidate?.byteLength == null ? null : number(candidate?.byteLength) }] : [];
    const frameCount = frameText ? 1 : 0;
    // rejectedUrls surfaces espn.com fetch/XHR paths the observer filtered out, so the next recon run
    // reveals the real REST endpoints instead of silently dropping them.
    const rejectedUrls = Array.isArray(candidate?.rejectedUrls) ? [...new Set(candidate.rejectedUrls.map((item) => text(item)).filter(Boolean).map((item) => item.slice(0, 160)))].slice(0, REJECTED_URL_MAX) : [];
    // page records the top-frame URL and whether the draft surface is iframe-hosted (manifest scope).
    const page = { url: text(candidate?.pageUrl), frame: text(candidate?.pageFrame) };
    // structure is the bounded, redacted draft payload: it preserves the settings/teams/order/slot
    // shapes recon must establish, while raw (un-redacted) frames are never stored or exported.
    return { schemaVersion: SCHEMA_VERSION, sequence, capturedAt: new Date().toISOString(), source: { transport: text(candidate?.transport) || 'dom', direction: text(candidate?.direction) || 'visible', url: text(candidate?.url), kind: text(candidate?.kind) || 'observation', frameType: text(candidate?.frameType), byteLength: candidate?.byteLength == null ? null : number(candidate?.byteLength) }, draft: { draftId, leagueId, status: draft.status || null }, structure: payload ?? null, frames, frameCount, picks, domRows, rejectedUrls, page, diagnostics: { payloadObserved: payload != null, pickCount: picks.length, domRowCount: domRows.length } };
  }
  // Per-bucket caps summing to FRAME_SAMPLE_MAX: SELECTED frames are the ones a post-mortem
  // actually needs (D/ST ids captured late in the draft), so they get the largest share.
  const FRAME_BUCKET_CAPS = { SELECTED: 20, CLOCK: 10, OTHER: FRAME_SAMPLE_MAX - 30 };
  function frameBucketFor(frameText) {
    const keyword = (typeof frameText === 'string' ? frameText : '').trim().split(' ')[0] || '';
    return keyword === 'SELECTED' || keyword === 'CLOCK' ? keyword : 'OTHER';
  }
  /** Buckets the deduped frame sample by keyword and keeps first-half/last-half per bucket once it
   * overflows its cap. A flat "first 50 distinct lines ever seen" sample (the prior behavior) fills
   * up in the opening seconds of a draft and then never admits anything new — which is exactly why a
   * recon export taken late in a draft carried no late-round SELECTED frames (no D/ST ids) at all.
   * Bucketing keeps the sample bounded while still surfacing what a post-mortem needs from both ends
   * of the draft. */
  function mergeFrames(previous, next) {
    const seen = new Set();
    const merged = [];
    (Array.isArray(previous) ? previous : []).forEach((entry) => {
      if (entry && typeof entry.text === 'string' && !seen.has(entry.text)) { seen.add(entry.text); merged.push(entry); }
    });
    (Array.isArray(next) ? next : []).forEach((entry) => {
      if (entry && typeof entry.text === 'string' && !seen.has(entry.text)) { seen.add(entry.text); merged.push(entry); }
    });
    const buckets = { SELECTED: [], CLOCK: [], OTHER: [] };
    merged.forEach((entry) => { buckets[frameBucketFor(entry.text)].push(entry); });
    const trimmed = [];
    for (const key of ['SELECTED', 'CLOCK', 'OTHER']) {
      const cap = FRAME_BUCKET_CAPS[key];
      const list = buckets[key];
      if (list.length <= cap) { trimmed.push(...list); continue; }
      const firstN = Math.ceil(cap / 2);
      const lastN = cap - firstN;
      trimmed.push(...list.slice(0, firstN), ...list.slice(list.length - lastN));
    }
    return trimmed;
  }
  function mergeSnapshots(previous, next) {
    if (!previous || previous.schemaVersion !== SCHEMA_VERSION) return next;
    const picks = new Map(previous.picks.map((pick) => [pick.overall, pick])); next.picks.forEach((pick) => picks.set(pick.overall, pick));
    const mergedPicks = [...picks.values()].sort((a, b) => a.overall - b.overall);
    const domRows = next.domRows.length ? next.domRows : previous.domRows;
    // Diagnostics reflect the merged snapshot state, never just the last candidate, so a final
    // transport-only candidate cannot zero out counts earlier DOM candidates established.
    return { ...next, sequence: Math.max(Number(previous.sequence) || 0, Number(next.sequence) || 0), draft: { draftId: next.draft.draftId || previous.draft.draftId || null, leagueId: next.draft.leagueId || previous.draft.leagueId || null, status: next.draft.status || previous.draft.status || null }, structure: next.structure ?? previous.structure ?? null, frames: mergeFrames(previous.frames, next.frames), frameCount: (Number(previous.frameCount) || 0) + (Number(next.frameCount) || 0), picks: mergedPicks, domRows, rejectedUrls: [...new Set([...(previous.rejectedUrls || []), ...(next.rejectedUrls || [])])].slice(0, REJECTED_URL_MAX), page: { url: next.page?.url || previous.page?.url || null, frame: next.page?.frame || previous.page?.frame || null }, diagnostics: { payloadObserved: Boolean(previous.diagnostics?.payloadObserved || next.diagnostics?.payloadObserved), pickCount: mergedPicks.length, domRowCount: domRows.length } };
  }
  // ---------------------------------------------------------------------------
  // Live pick stream — parses the confirmed plaintext WS command vocabulary. The
  // socket is never JSON (recon-verified 2026-08-15): INIT is a base64 binary blob
  // that is explicitly NOT decoded (settings come from the Step 1 manual form),
  // and SELECTED/JOINED/TOKEN are the only pick carriers.
  // ---------------------------------------------------------------------------
  function parseFrameLine(line) {
    if (typeof line !== 'string') return null;
    const trimmed = line.trim();
    if (!trimmed) return null;
    const space = trimmed.indexOf(' ');
    const keyword = space === -1 ? trimmed : trimmed.slice(0, space);
    const rest = space === -1 ? '' : trimmed.slice(space + 1).trim();
    if (keyword === 'SELECTED') {
      const parts = rest.split(' ');
      const slot = number(parts[0]);
      const playerId = text(parts[1]);
      if (slot === null || !playerId) return null;
      // The third token <n> (observed 2, 4, 5) is position-shaped but its enum is unverified — it is
      // captured raw as posToken and self-calibrated against ids.espn matches in the adapter, never
      // hard-decoded here. A trailing {GUID} marks the user's own pick; found by shape (startsWith
      // '{'), not position, so it coexists with posToken regardless of whether a GUID is present.
      const posToken = number(parts[2]);
      const trailing = parts.length >= 4 ? text(parts[parts.length - 1]) : null;
      const guid = trailing && trailing.startsWith('{') ? trailing : null;
      return { kind: 'SELECTED', slot, playerId, posToken, guid };
    }
    if (keyword === 'JOINED') {
      const slot = number(rest.split(' ')[0]);
      return slot === null ? null : { kind: 'JOINED', slot };
    }
    if (keyword === 'TOKEN') {
      // Format is `<n>:<leagueId>:<teamId>:<GUID>:<n>` -- recon-verified against TWO independent
      // captures (2026-08-15 mock, league 1488579454: "TOKEN 1:1488579454:1:{GUID}:1343616072" with
      // JOINED 1; and tonight's live draft, league 1592616859: "TOKEN 1:1592616859:7:{SWID}" with
      // JOINED 7). Field 0 is NOT the team id -- it is 1 in both captures and only coincidentally
      // matched JOINED's slot in the first one. Field 2 is the team id in both. Field 1 is the
      // league id in both (unchanged from the original reading).
      const parts = rest.split(':');
      const slot = number(parts[2]);
      const leagueId = text(parts[1]);
      return slot === null || !leagueId ? null : { kind: 'TOKEN', slot, leagueId };
    }
    // SELECTING / CLOCK / STATE / AUTODRAFT / AUTOSUGGEST / PONG / INIT are not pick carriers.
    return null;
  }

  function createLiveSnapshot() {
    return {
      schemaVersion: LIVE_SCHEMA_VERSION, epoch: 0, resetReason: 'new', streamPicks: [], mySlot: null, leagueId: null,
      lastHeartbeatAt: null, domPicks: [],
      // Resume-detection markers (Step 7): domMaxSeen is a running max of every DOM pick-number ever
      // merged; domMaxAtStreamStart snapshots it the instant the FIRST SELECTED lands in this
      // snapshot's life, which is the primary absolute-offset estimate for a stream that attaches
      // mid-draft (see espnOffset.ts). domSampledBeforeStream distinguishes "the board was
      // confirmed empty" from "we haven't looked yet" -- both read as domMaxAtStreamStart === 0.
      domMaxSeen: 0, domMaxAtStreamStart: null, domSampledBeforeStream: false,
      // currentPickNumber/currentPickTeam come from the DOM's own on-the-clock reading
      // ([data-testid="current-pick"], e.g. "On the Clock: Pick 146Team 3") -- present on the very
      // first DOM reconcile, unlike domMaxSeen which only accumulates from the (at most 4-row)
      // pick-number ticker. This is the offset estimate that resolves a late attach fastest.
      currentPickNumber: null, currentPickTeam: null,
    };
  }

  /** Baseline a previous snapshot for either mutator: same-shape snapshots pass through unchanged;
   * a missing prior is a genuinely new session (resetReason 'new', epoch 0); a shape-mismatched
   * prior (LIVE_SCHEMA_VERSION bumped) is a hard reset that MUST still be detectable by the app --
   * previously this silently restarted the stream at overall 1 with no signal at all. Bumping epoch
   * and stamping resetReason here closes that hazard without needing a storage-key bump (Step 7). */
  function baseline(previous) {
    if (previous && previous.schemaVersion === LIVE_SCHEMA_VERSION) return previous;
    if (previous) {
      const fresh = createLiveSnapshot();
      fresh.epoch = (Number(previous.epoch) || 0) + 1;
      fresh.resetReason = 'schema-change';
      return fresh;
    }
    return createLiveSnapshot();
  }

  /** Derive a league id from a socket URL (`league-(\d+)`, already used for recon). Null when the
   * URL carries none — the draft page URL is only `/football/draft`; only the WebSocket URL
   * (`wss://fantasydraft.espn.com/game-1/league-<id>/JOIN`) carries the league id. */
  function leagueIdFromUrl(url) {
    const value = text(url);
    return value ? (value.match(/league-(\d+)/i) || [])[1] || null : null;
  }

  /** Accumulate one socket line into the live snapshot: every arrival refreshes the heartbeat;
   * SELECTED appends (uncapped, ordered by arrival -> overall). JOINED always sets mySlot (the
   * authoritative "you are team N" signal); TOKEN only fills mySlot when JOINED hasn't already set
   * it (TOKEN's team-id field is recon-verified but must never override a real JOINED). A
   * resend is the identical SELECTED line — same team slot AND same player id — and is skipped by
   * the dedupe below. The dedupe deliberately keys on (slot, playerId), NOT playerId alone: ESPN
   * D/ST ids are negative synthetics whose uniqueness across teams is not yet recon-verified, and a
   * playerId-only guard would silently DROP a distinct later pick that shares an id with an earlier
   * one (a pick loss, the one failure class the plan's deferred items must never cause).
   *
   * League identity decides whether the live key still belongs to the same draft: `url` is the
   * socket URL that carried the frame, and the league id is read from a TOKEN frame's own payload
   * or the URL's `league-(\d+)`. A frame from a DIFFERENT league starts a fresh snapshot (empty
   * streamPicks/domPicks, epoch bumped) instead of appending onto the old draft — otherwise the
   * old mock's 58 picks would carry into the new mock. Same-league TOKEN/JOINED keep the snapshot.
   * A SELECTED whose URL names a league the snapshot has not stamped yet also stamps it, so the
   * identity is never left null after the first known frame (a leftover old-league frame would
   * otherwise pass the "leagueId already set" guard and append into the new draft). */
  function applyFrameToLive(previous, line, now, url) {
    const base = baseline(previous);
    const live = { ...base, streamPicks: (base.streamPicks || []).slice(), lastHeartbeatAt: now };
    const frame = parseFrameLine(line);
    if (!frame) return live;
    const incoming = frame.kind === 'TOKEN' ? frame.leagueId : leagueIdFromUrl(url);
    if (incoming && base.leagueId && incoming !== base.leagueId) {
      const fresh = createLiveSnapshot();
      fresh.epoch = (base.epoch || 0) + 1;
      fresh.resetReason = 'league-change';
      fresh.lastHeartbeatAt = now;
      return applyFrameToLive(fresh, line, now, url);
    }
    if (frame.kind === 'JOINED') return { ...live, mySlot: frame.slot, leagueId: incoming || live.leagueId };
    // TOKEN's team-id field must NOT overwrite a seat JOINED already established -- JOINED is the
    // authoritative "you are team N" signal; TOKEN only fills mySlot when nothing has set it yet
    // (e.g. TOKEN arrives before JOINED on a fresh connect). TOKEN still always stamps leagueId.
    if (frame.kind === 'TOKEN') return { ...live, mySlot: live.mySlot == null ? frame.slot : live.mySlot, leagueId: frame.leagueId };
    if (incoming && !live.leagueId) live.leagueId = incoming;
    if (live.streamPicks.some((pick) => pick.slot === frame.slot && pick.playerId === frame.playerId)) return live;
    // The FIRST pick appended into an empty stream stamps domMaxAtStreamStart from whatever the DOM
    // has already told us (domMaxSeen, or the on-the-clock reading's pick number minus one) -- the
    // primary absolute-offset estimate for a mid-draft attach (espnOffset.ts's 'board-empty' /
    // 'corroborated' sources). A from-pick-1 attach has nothing sampled yet, so this reads 0.
    if (live.streamPicks.length === 0) {
      live.domMaxAtStreamStart = Math.max(Number(base.domMaxSeen) || 0, (Number(base.currentPickNumber) || 1) - 1);
    }
    live.streamPicks.push({ overall: live.streamPicks.length + 1, slot: frame.slot, playerId: frame.playerId, posToken: frame.posToken, guid: frame.guid, source: 'frame' });
    return live;
  }

  /** Merge DOM [data-pick-number] rows into the live snapshot by pickNumber, capped at 400 (the most
   * recent rows win — late-draft D/ST picks are the ones that matter). A separate live key and an
   * additive field: the socket stream and heartbeat are untouched. A stale-version prior resets.
   *
   * `leagueId` is the CALLER tab's league id (the draft page URL carries none — espn-content.js
   * remembers its socket league id and passes it here). When the snapshot's league is already set
   * and this tab's league differs, it is a leftover draft page: SKIP the merge entirely so the old
   * tab's rows never refill the new draft's stream or trip the adapter's missed-pick desync. Never
   * reset here — a stale tab must not wipe the live tab's board.
   *
   * `currentPick`, when supplied, is the DOM's own on-the-clock reading:
   * `{ number: <absolute pick number> | null, team: <ESPN team id> | null }`, parsed by the caller
   * from `[data-testid="current-pick"]` (e.g. "On the Clock: Pick 146Team 3"). `number` is present on
   * the very first reconcile regardless of the 4-row pick-number ticker's contents, so it resolves a
   * mid-draft attach's offset faster than domMaxSeen alone — team is a bonus cross-check only,
   * absent whenever the league uses custom (non-"Team N") fantasy team names. */
  function applyDomPicks(previous, domPicks, leagueId, currentPick) {
    const base = baseline(previous);
    const incoming = text(leagueId);
    if (incoming && base.leagueId && incoming !== base.leagueId) return base;
    const merged = new Map();
    (Array.isArray(base.domPicks) ? base.domPicks : []).forEach((pick) => { if (pick && pick.pickNumber != null) merged.set(pick.pickNumber, pick); });
    let maxSeen = Number(base.domMaxSeen) || 0;
    (Array.isArray(domPicks) ? domPicks : []).forEach((pick) => {
      if (!pick || pick.pickNumber == null) return;
      const pickNumber = number(pick.pickNumber);
      if (pickNumber === null) return;
      if (pickNumber > maxSeen) maxSeen = pickNumber;
      const segments = Array.isArray(pick.segments) ? pick.segments.map(text).filter(Boolean).slice(0, 12) : [];
      const textValue = text(pick.text) || segments.join(' ');
      const playerId = text(pick.playerId);
      merged.set(pickNumber, { pickNumber, text: textValue, segments, playerId });
    });
    const sorted = [...merged.values()].sort((a, b) => a.pickNumber - b.pickNumber).slice(-400);
    // Once true, stays true: it records whether the board was ever confirmed sampled while the
    // stream was still empty, not just the current call's state.
    const domSampledBeforeStream = Boolean(base.domSampledBeforeStream) || base.streamPicks.length === 0;
    const currentPickNumber = currentPick && currentPick.number != null ? number(currentPick.number) : (base.currentPickNumber ?? null);
    const currentPickTeam = currentPick && currentPick.team != null ? number(currentPick.team) : (base.currentPickTeam ?? null);
    return { ...base, domPicks: sorted, domMaxSeen: maxSeen, domSampledBeforeStream, currentPickNumber, currentPickTeam };
  }

  globalThis.FfaEspnNormalize = { SCHEMA_VERSION, STORAGE_KEY, LIVE_SCHEMA_VERSION, LIVE_STORAGE_KEY, redact, normalizeCandidate, mergeSnapshots, parseFrameLine, createLiveSnapshot, leagueIdFromUrl, applyFrameToLive, applyDomPicks };
})();
