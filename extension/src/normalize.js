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
  // League snapshot key (2026-08-27 connect/start split): the RAW (redacted) league-API JSON
  // captured from the ESPN LEAGUE page, keyed by leagueId — a second league's capture REPLACES a
  // first rather than merging. Mirrored as LEAGUE_KEY in app-content.js (the relay that serves it)
  // and consumed by frontend/src/adapters/espnBridge.ts's requestEspnLeague; the PARSING into an
  // EspnLeagueSnapshot happens in frontend/src/adapters/espnLeague.ts, the one translation site.
  // Keep the four sites in sync.
  const LEAGUE_SCHEMA_VERSION = 1;
  const LEAGUE_STORAGE_KEY = 'ffa.espn.league.snapshot.v1';
  // Draft-page league-settings snapshot (2026-08-29): a SEPARATE key from LEAGUE_STORAGE_KEY. The
  // draft page's own reconcileDetailPicks (espn-content.js) fetches mDraftDetail+mSettings+mTeam
  // every 30s from WITHIN the draft page — a distinct capture path from the league-page's passive/
  // proactive capture that fills LEAGUE_STORAGE_KEY. Reusing that key would be wrong: a different
  // leagueId's capture there REPLACES the whole snapshot (applyLeagueJson's different-league
  // branch), and tracking an ESPN mock (a different leagueId than a saved real league) would
  // silently wipe the real league's connect-time capture. A dedicated key removes that interaction
  // outright. Mirrored as DRAFT_LEAGUE_KEY in app-content.js and consumed by
  // frontend/src/adapters/espnBridge.ts's requestEspnDraftLeague; parsed by the SAME
  // frontend/src/adapters/espnLeague.ts (the one translation site) as the league-page capture.
  const DRAFT_LEAGUE_SCHEMA_VERSION = 1;
  const DRAFT_LEAGUE_STORAGE_KEY = 'ffa.espn.draftleague.snapshot.v1';
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
    // ESPN's "no player" sentinel ('-1', occasionally '0') is NOT identity: mock-draft mDraftDetail
    // rows can carry playerId -1 with no name, and a truthiness-only check let the sentinel pass
    // every downstream identity gate - the app then logged a wall of "Unmatched: -1" picks. Null
    // it here so every consumer sees identity-less; real negative D/ST ids (-16003-style) survive.
    const rawPlayerId = text(read(value, ['playerId', 'player_id', 'id'])) || text(read(player, ['playerId', 'player_id', 'id']));
    const providerPlayerId = rawPlayerId && !/^(0|-1)$/.test(rawPlayerId) ? rawPlayerId : null;
    const name = text(read(player, ['fullName', 'displayName', 'name', 'playerName']));
    const overall = number(read(value, ['overall', 'overallPickNumber', 'pickNumber', 'selection']));
    const team = isRecord(value.team) ? value.team : value;
    const draftTeamId = text(read(team, ['teamId', 'team_id', 'draftTeamId']));
    // A teamId alone IS enough structure to keep a row (mock drafts report autopicked players as
    // the '-1' sentinel id with no name): the app joins the DOM pick row for the name and uses
    // the teamId sequence for offset alignment. Only a row with NO id, NO name, and NO team is
    // structurally useless.
    if ((!providerPlayerId && !name && !draftTeamId) || overall === null) return null;
    // defaultPositionId is ESPN's numeric position id; keep it raw for recon and decode it later.
    return { overall, round: number(read(value, ['round', 'roundId', 'roundNumber'])), slot: number(read(value, ['slot', 'slotId', 'draftSlot'])), draftTeamId, providerPlayerId, name, position: text(read(player, ['position', 'defaultPosition', 'positionAbbrev', 'defaultPositionId'])), proTeam: text(read(player, ['proTeam', 'proTeamId', 'teamAbbrev', 'team'])) };
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
      // League facts ESPN itself states (leagueRounds/leagueTeams/leagueSeason/leagueName) start
      // absent; see applyLeagueFacts below for how they get stamped.
      leagueRounds: null, leagueTeams: null, leagueSeason: null, leagueName: null,
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

  /** How long a live snapshot's heartbeat keeps league ownership against a hidden foreign-league
   * tab (see applyFrameToLive). 60s is far above the app's 15s 'disconnected' threshold and far
   * above an actively-autopicking tab's ~1Hz CLOCK cadence, so ONLY a genuinely dead snapshot (a
   * finished or closed draft tab whose key was never cleared) ever loses the key. */
  const LIVE_OWNERSHIP_EXPIRY_MS = 60000;
  /** How silent a snapshot's heartbeat must be before a same-league JOINED/TOKEN treats the
   * previous draft as dead and restarts the stream (see applyFrameToLive). An ACTIVE draft
   * heartbeats ~1Hz, so 30s of silence means nobody is drafting — while the resume path (a tab
   * refresh mid-draft) rejoins well inside this window, and any picks missed during a longer gap
   * are backfilled by the mDraftDetail reconcile regardless. */
  const LIVE_RESTART_QUIET_MS = 30000;

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
   * otherwise pass the "leagueId already set" guard and append into the new draft).
   *
   * `isVisible` (2026-08-28, default true so every existing caller/test is unaffected) gates ONLY
   * this reset, not the write itself: a BACKGROUNDED tab (an abandoned mock ESPN keeps autopicking
   * server-side) must never re-stamp the shared key back to its own league — that ping-pong is
   * exactly what let an abandoned draft's stale picks keep winning over a genuinely new one until
   * the old draft finally went quiet. A hidden tab's foreign-league frame is refused outright
   * (mirrors applyDomPicks' existing "refuse, don't reset" convention) rather than resetting.
   * Establishing a league for the FIRST time (`base.leagueId` still null) is unaffected regardless
   * of visibility, and so is same-league accumulation while hidden — only a DIFFERENT league's
   * reset is gated, so alternating focus between the draft tab and the app tab while tracking one
   * draft is untouched. Two tabs both VISIBLE at once (e.g. two side-by-side windows) can still
   * ping-pong; visibility alone can't distinguish those. */
  function applyFrameToLive(previous, line, now, url, isVisible = true) {
    const base = baseline(previous);
    const live = { ...base, streamPicks: (base.streamPicks || []).slice(), lastHeartbeatAt: now };
    const frame = parseFrameLine(line);
    if (!frame) return live;
    const incoming = frame.kind === 'TOKEN' ? frame.leagueId : leagueIdFromUrl(url);
    if (incoming && base.leagueId && incoming !== base.leagueId) {
      // A hidden/backgrounded tab is refused, not reset -- `base`, not `live`, so it also can't
      // refresh lastHeartbeatAt and launder a dead draft as fresh. But refusal is OWNERSHIP, and
      // ownership must EXPIRE (2026-08-29): the shared key survives a finished/closed draft
      // indefinitely, and a corpse snapshot otherwise refuses the REAL new draft's frames forever
      // while its tab is backgrounded. An actively autopicking abandoned draft heartbeats about
      // every second, so the age window protects exactly the live hijacker and nothing else.
      const heartbeatAge = now - (Number(base.lastHeartbeatAt) || 0);
      if (!isVisible && heartbeatAge < LIVE_OWNERSHIP_EXPIRY_MS) return base;
      const fresh = createLiveSnapshot();
      fresh.epoch = (base.epoch || 0) + 1;
      fresh.resetReason = 'league-change';
      fresh.lastHeartbeatAt = now;
      return applyFrameToLive(fresh, line, now, url, isVisible);
    }
    // Same-league DRAFT RESTART detection (2026-08-29): ESPN practice drafts run INSIDE the same
    // league, so a new practice draft reuses the previous one's league id and none of the
    // league-change machinery above ever fires. The leftover stream then poisons everything: old
    // picks keep their overalls while new picks append at 161+, and the (slot, playerId) resend
    // dedupe silently drops every pick the previous draft also made — a garbage, "cut off" draft
    // log. JOINED and TOKEN are the authoritative "I entered a draft room" signals, so they are
    // the restart checkpoint: when the stream already holds a draft that is either COMPLETE
    // (teams x rounds picks on record) or QUIET (no heartbeat for LIVE_RESTART_QUIET_MS — nobody
    // is drafting it), the stream is stale residue, not a resume, and is reset through the normal
    // epoch-bump path. A mid-draft tab refresh has a fresh heartbeat and an incomplete stream, so
    // the resume path keeps its picks untouched.
    if ((frame.kind === 'JOINED' || frame.kind === 'TOKEN') && incoming && base.leagueId === incoming && (base.streamPicks || []).length > 0) {
      const capacity = (Number(base.leagueTeams) || 0) * (Number(base.leagueRounds) || 0);
      const complete = capacity > 0 && base.streamPicks.length >= capacity;
      const quiet = now - (Number(base.lastHeartbeatAt) || 0) >= LIVE_RESTART_QUIET_MS;
      if (complete || quiet) {
        const fresh = createLiveSnapshot();
        fresh.epoch = (base.epoch || 0) + 1;
        fresh.resetReason = 'draft-restart';
        return applyFrameToLive(fresh, line, now, url, isVisible);
      }
    }
    if (frame.kind === 'JOINED') return { ...live, mySlot: frame.slot, leagueId: incoming || live.leagueId };
    // TOKEN's team-id field must NOT overwrite a seat JOINED already established -- JOINED is the
    // authoritative "you are team N" signal; TOKEN only fills mySlot when nothing has set it yet
    // (e.g. TOKEN arrives before JOINED on a fresh connect). TOKEN still always stamps leagueId.
    if (frame.kind === 'TOKEN') return { ...live, mySlot: live.mySlot == null ? frame.slot : live.mySlot, leagueId: frame.leagueId };
    if (incoming && !live.leagueId) live.leagueId = incoming;
    // Resend dedupe. A real playerId identifies a pick; the mock-autopick -1 sentinel does NOT
    // (every autopicked pick reuses it), so sentinel frames are only deduped against the last few
    // arrivals on the FULL record (slot+id+posToken+guid) - the same team pick two rounds later
    // must not be swallowed as a resend of pick 1.
    const sentinelFrame = frame.playerId === '-1' || frame.playerId === '0';
    if (sentinelFrame) {
      const recent = live.streamPicks.slice(-3);
      if (recent.some((pick) => pick.slot === frame.slot && pick.playerId === frame.playerId && pick.posToken === frame.posToken && pick.guid === frame.guid)) return live;
    } else if (live.streamPicks.some((pick) => pick.slot === frame.slot && pick.playerId === frame.playerId)) return live;
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
   * and this tab's league differs — INCLUDING a tab whose own socket hasn't spoken yet, so its
   * league reads null — SKIP the merge entirely so the old tab's rows, or an unrelated tab's rows
   * (a second mock lobby, a league page), never refill an active draft's stream or trip the
   * adapter's missed-pick desync. (2026-08-28: previously only a NAMED mismatched league was
   * gated — `incoming && ...` — which let any tab that had not yet identified itself write freely
   * into an already-established snapshot; that fail-open was a source of the wrong-pick-number bug,
   * since `domMaxSeen`/`currentPickNumber` feed the absolute-offset estimate directly.) A snapshot
   * with NO league stamped yet (freshly reset) still accepts writes from anyone — the normal
   * from-pick-1 race before any tab's socket has spoken. Never reset here — a stale/foreign tab
   * must not wipe the live tab's board, only be refused a write.
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
    if (base.leagueId && incoming !== base.leagueId) return base;
    // Same-league DRAFT RESTART via board regression (2026-08-29): a NEW practice draft in the SAME
    // league produces no JOINED/TOKEN this tab can see when a DIFFERENT tab is the one that (re)joins
    // -- but the board itself goes back to pick 1 with nothing drafted. A deep existing stream (>1
    // pick) plus a confirmed on-the-clock reading of pick 1 AND zero DOM rows on this reconcile is
    // that regression; both conditions are required together so a single mid-render frame (the
    // ticker not yet populated on an ongoing draft) can't false-trigger it.
    const reportsPickOne = currentPick && number(currentPick.number) === 1;
    const reportsNoRows = !Array.isArray(domPicks) || domPicks.length === 0;
    if ((base.streamPicks || []).length > 1 && reportsPickOne && reportsNoRows) {
      const fresh = createLiveSnapshot();
      fresh.epoch = (base.epoch || 0) + 1;
      fresh.resetReason = 'draft-restart';
      return applyDomPicks(fresh, domPicks, leagueId, currentPick);
    }
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

  function leagueIdFromLeagueUrl(url) {
    const value = text(url);
    return value ? (value.match(/leagues\/(\d+)/i) || [])[1] || null : null;
  }
  function seasonFromLeagueUrl(url) {
    const value = text(url);
    return value ? (value.match(/seasons\/(\d+)/i) || [])[1] || null : null;
  }
  /**
   * Reduce a captured league-API response into the league snapshot (2026-08-27). The payload is
   * stored VERBATIM (it was already redacted by espn-main.js's redact()); parsing/translation is
   * the frontend adapter's job. Keyed by leagueId parsed from the capture URL
   * (`/apis/v3/games/ffl/seasons/<season>/segments/<seg>/leagues/<id>`) — distinct from
   * `leagueIdFromUrl`, which matches the draft socket's `league-<id>` form. A capture with no id
   * is skipped (never a guess); a capture for a DIFFERENT league replaces the whole snapshot.
   *
   * 2026-08-27 multi-view fix: the ESPN league page fires SEVERAL league-API calls
   * (`?view=mSettings`, `mTeam`, `mRoster`, `mDraftDetail`, …) that all match the same
   * `/leagues/<id>` URL. Assigning the payload wholesale meant last-response-wins — a late
   * `mRoster`/`mTeam` response silently destroyed `settings.scoringSettings` and `draftDetail`
   * captured moments earlier. So a SAME-league capture now MERGES: top-level payload keys merge
   * one level deep for records (so a later response without `settings.scoringSettings` cannot
   * erase it), while arrays replace wholesale (a later `teams[]` WITH rosters supersedes an
   * earlier bare `teams[]` — never concatenates). The `?view=` params seen so far are recorded
   * in `views[]` so the connect UI can say "open your league's Rosters tab too" instead of a
   * dead end.
   */
  function viewsFromLeagueUrl(url) {
    const raw = text(url);
    if (!raw) return [];
    try { return new URL(raw).searchParams.getAll('view').map(text).filter(Boolean); }
    catch { return []; }
  }
  function applyLeagueJson(previous, payload, url, capturedAt, fetchStatus) {
    if (!payload || !isRecord(payload)) return previous;
    const leagueId = leagueIdFromLeagueUrl(url) || text(payload.id) || text(payload.leagueId);
    if (!leagueId) return previous; // Not a league payload — keep whatever was there.
    const base = isRecord(previous) && previous.leagueId === leagueId ? previous : null;
    const basePayload = base && isRecord(base.payload) ? base.payload : {};
    const mergedPayload = { ...basePayload };
    for (const [key, incoming] of Object.entries(payload)) {
      const prior = mergedPayload[key];
      // Records merge ONE level deep.
      if (isRecord(incoming) && isRecord(prior)) {
        mergedPayload[key] = { ...prior, ...incoming };
        continue;
      }
      // QUALITY-AWARE REPLACEMENT (2026-08-28): the ESPN page keeps firing league-API calls after
      // the proactive mDraftDetail+mRoster fetch lands, and a later, POORER capture used to
      // destroy earlier, richer data — a bare/short `teams[]` wiped the roster-bearing one (the
      // "team names vanished" bug) and a `draftDetail: null` field erased the merged record (the
      // persistent "rounds derived" bug). Two guards, no direction assumptions:
      // 1. Arrays: the array with MORE entries wins; ties go to the newest. Never let a shorter
      //    array replace a longer one — it can only be a poorer view of the same league.
      // 2. Never let a non-record (null / array / scalar) replace an existing record — a null
      //    field is an absence, never better data than a populated object.
      if (Array.isArray(incoming) && Array.isArray(prior)) {
        mergedPayload[key] = incoming.length >= prior.length ? incoming : prior;
        continue;
      }
      if (!isRecord(incoming) && isRecord(prior)) continue;
      mergedPayload[key] = incoming;
    }
    const views = base && Array.isArray(base.views) ? base.views.slice() : [];
    for (const view of viewsFromLeagueUrl(url)) {
      if (!views.includes(view)) views.push(view);
    }
    return {
      schemaVersion: LEAGUE_SCHEMA_VERSION,
      leagueId,
      season: seasonFromUrl(payload, url) || (base ? base.season : ''),
      payload: mergedPayload,
      views,
      // 'ok' CLEARS a prior 'failed' (the proactive fetch eventually succeeded); 'failed' SETS it;
      // a passive capture with no explicit status KEEPS whatever the proactive fetch reported so a
      // real failure isn't erased by later passive traffic. The app's parser turns this into an
      // honest diagnostic on the connect card (espnLeague.ts).
      draftDetailFetchStatus: fetchStatus === 'failed' ? 'failed' : (fetchStatus === 'ok' ? null : (base && base.draftDetailFetchStatus) || null),
      capturedAt: number(capturedAt) ?? (base && typeof base.capturedAt === 'number' ? base.capturedAt : Date.now()),
    };
    function seasonFromUrl(payloadArg, urlArg) {
      const fromPayload = payloadArg && number(payloadArg.seasonId);
      return String(fromPayload ?? seasonFromLeagueUrl(urlArg) ?? '');
    }
  }

  /**
   * Mark the stored league snapshot's proactive draft-detail fetch as FAILED (espn-content.js
   * calls this after the initial attempt AND its one retry both fail). Keeps the snapshot's other
   * fields untouched; a no-op when no snapshot exists yet.
   */
  function markLeagueFetchFailed(previous) {
    if (!previous || !isRecord(previous) || !previous.leagueId) return previous;
    return { ...previous, draftDetailFetchStatus: 'failed', capturedAt: number(previous.capturedAt) ?? Date.now() };
  }

  /**
   * Missed-frame SELF-CORRECTION (2026-08-28): merge ESPN's authoritative mDraftDetail pick list
   * into the live snapshot. The websocket SELECTED stream is the fast path, but the tab can miss
   * frames (the app flags the gap as "the board shows pick #N but the stream's latest confirmed
   * pick is #M"); draftDetail.picks is the league's OWN pick history — absolute overall numbers
   * plus real player ids — so it repairs the gaps without renumbering anything. Merged by overall
   * (first write wins; ESPN's list is append-mostly), sorted, capped at 600 (16 rounds x 12 teams
   * x headroom). Additive optional field: LIVE_SCHEMA_VERSION stays 2, older readers ignore
   * `detailPicks`. Raw ids/names only — same redaction discipline as the rest of the live key.
   *
   * `leagueId`, when provided, gates the merge exactly like `applyDomPicks` — a tab whose own
   * league differs from (or is not yet known against) an already-established snapshot is refused,
   * not merged (2026-08-28, closes the same fail-open class as the DOM-picks gate).
   *
   * UNDRAFTED-SLATE TRUNCATION (2026-08-28): ESPN's `draftDetail.picks` pre-assigns `teamId` to
   * picks that have NOT happened yet (the full snake slate is generated up front), and a mock
   * autopick's sentinel row (`playerId: -1`/`'0'`, no name) is structurally indistinguishable from
   * that padding — both carry only a teamId. Left unbounded, the padding inflated `detailPicks`
   * past the real pick count, which `bridgePicksToNormalized`'s `detailContiguous` branch then
   * treated as the authoritative, fully-drafted board (the "pick 97 when ESPN was on pick 14" bug).
   * Each stored row is tagged `identified` (a resolvable player id or name); the merged list is
   * truncated to the longest prefix ending at the LAST identified row — real-but-unresolved
   * teamId-only rows sandwiched before that point are kept (mock-autopick alignment needs the
   * teamId sequence), only the un-drafted tail after it is dropped. When NOTHING is identified yet
   * (a pure-autopick mock attached before any resolvable name arrived), truncate to whichever of
   * `currentPickNumber` or the stream's own length is larger — never more picks than an independent
   * live signal agrees have happened.
   */
  function applyDetailPicks(previous, rawPicks, leagueId) {
    const base = previous && isRecord(previous) && previous.schemaVersion === LIVE_SCHEMA_VERSION
      ? previous
      : createLiveSnapshot();
    const incoming = text(leagueId);
    if (base.leagueId && incoming !== base.leagueId) return base;
    if (!Array.isArray(rawPicks)) return base;
    const byOverall = new Map(
      (Array.isArray(base.detailPicks) ? base.detailPicks : [])
        .filter((pick) => isRecord(pick) && number(pick.overall) != null)
        .map((pick) => [pick.overall, pick]),
    );
    for (const raw of rawPicks) {
      const pick = asPick(raw);
      // Overall is always required, and identity normally is too - but ESPN MOCK drafts report
      // autopicked players with the '-1' sentinel id and no name at all. A row that still carries
      // the drafting teamId IS stored (playerId empty): the app joins the DOM pick row at the same
      // absolute pick for the name, and the teamId sequence drives the offset alignment. A row
      // with NEITHER id, name, nor teamId is structurally useless and skipped.
      if (!pick || pick.overall === null || pick.overall <= 0) continue;
      if (!pick.providerPlayerId && !pick.name && !pick.draftTeamId) continue;
      if (byOverall.has(pick.overall)) continue;
      byOverall.set(pick.overall, {
        overall: pick.overall,
        playerId: pick.providerPlayerId ?? '',
        name: pick.name,
        teamId: pick.draftTeamId,
        position: pick.position,
        proTeam: pick.proTeam,
        identified: Boolean(pick.providerPlayerId || pick.name),
      });
    }
    const sorted = [...byOverall.values()].sort((a, b) => a.overall - b.overall).slice(-600);
    let lastIdentified = -1;
    sorted.forEach((pick, index) => { if (pick.identified) lastIdentified = index; });
    const detailPicks = lastIdentified >= 0
      ? sorted.slice(0, lastIdentified + 1)
      : sorted.filter((pick) => pick.overall <= Math.max(Number(base.currentPickNumber) || 0, (base.streamPicks || []).length));
    // lastHeartbeatAt is NOT touched here (2026-08-29): this is a background 30s API reconcile, not
    // a live socket frame. Stamping it would launder a dead/abandoned draft tab as fresh and defeat
    // the same-league quiet-restart detection below, which depends on the heartbeat going stale once
    // nobody is actually drafting. Matches applyDomPicks' existing discipline.
    // leagueId IS stamped here, first-write-only (2026-08-30) — see applyLeagueFacts' matching note;
    // this reconcile is what has to establish identity on a mid-draft attach, before any socket
    // frame arrives. The mismatch guard above already refuses a foreign league once one is set.
    return { ...base, leagueId: base.leagueId || incoming, detailPicks };
  }

  /**
   * League facts (2026-08-28): merge ESPN's OWN answers for the questions the socket cannot
   * answer — draft rounds, league size, season, league name — into the live snapshot. The
   * draft-room socket only ever names teams and players; the app needs the grid (teams/rounds) to
   * be right, and deriving it from pick patterns guesses exactly wrong on mid-draft attaches. The
   * values come from the same periodic mDraftDetail,mSettings read that fills `detailPicks`; the
   * first authoritative read wins (a later DIFFERENT value is almost certainly a different
   * league's response racing the reset — the league-change reset clears the snapshot wholesale).
   * `leagueId`, when provided, gates the merge exactly like `applyDomPicks`/`applyDetailPicks`.
   * Additive optional fields: LIVE_SCHEMA_VERSION stays 2, older readers ignore them.
   */
  function applyLeagueFacts(previous, facts, leagueId) {
    const base = previous && isRecord(previous) && previous.schemaVersion === LIVE_SCHEMA_VERSION
      ? previous
      : createLiveSnapshot();
    const incoming = text(leagueId);
    if (base.leagueId && incoming !== base.leagueId) return base;
    if (!isRecord(facts)) return base;
    const rounds = number(facts.rounds);
    const teams = number(facts.teams);
    const season = typeof facts.season === 'string' || typeof facts.season === 'number' ? String(facts.season) : null;
    const name = typeof facts.name === 'string' && facts.name.trim() ? facts.name.trim() : null;
    return {
      ...base,
      // Stamp leagueId on first write only (2026-08-30, mid-draft-attach fix): a tab attaching to
      // an already-running draft may not see a socket frame for a while, so this periodic API
      // reconcile — which already knows the league from the URL it fetched — is what has to
      // establish identity instead. The mismatch guard above already refuses a foreign league once
      // one is stamped, so first-write-only here cannot weaken it.
      leagueId: base.leagueId || incoming,
      leagueRounds: (base.leagueRounds == null && rounds != null && rounds > 0) ? rounds : (base.leagueRounds ?? null),
      leagueTeams: (base.leagueTeams == null && teams != null && teams > 0) ? teams : (base.leagueTeams ?? null),
      leagueSeason: (base.leagueSeason == null && season) ? season : (base.leagueSeason ?? null),
      leagueName: (base.leagueName == null && name) ? name : (base.leagueName ?? null),
      // lastHeartbeatAt is NOT touched here — see applyDetailPicks' matching note above.
    };
  }

  /** Extract the league facts ESPN's own API states, from a raw league-API payload (the same
   * mDraftDetail+mSettings response `reconcileDetailPicks` already fetches). Mirrors
   * frontend/src/adapters/espnLeague.ts's proven precedence — the draft-room reconcile used to
   * read `payload.draftSettings.{rounds,teams}` directly, a path ESPN never populates (the real
   * path is `payload.settings.draftSettings`, and `teams` is not a `draftSettings` field at all —
   * see espnLeague.ts:129-130/157). This is the ONE place the draft-room path reads shape, so a
   * future ESPN change only needs fixing here. Every field is independently optional; a miss is
   * null, never a guess. */
  function leagueFactsFromPayload(payload) {
    if (!isRecord(payload)) return null;
    const settings = isRecord(payload.settings) ? payload.settings : null;
    const draftSettings = settings && isRecord(settings.draftSettings) ? settings.draftSettings : null;
    const draftDetail = isRecord(payload.draftDetail) ? payload.draftDetail : null;
    const teamsFromArray = Array.isArray(payload.teams) ? payload.teams.length : 0;
    const teams = teamsFromArray || (settings ? number(settings.teams) : null) || null;
    let rounds = (draftSettings ? number(draftSettings.rounds) : null)
      ?? (draftDetail ? number(draftDetail.rounds) : null);
    // REAL 2026 SHAPE (espnLeague.ts:159-166): draftDetail carries no `rounds` field at all — the
    // full slate IS teams x rounds. Only accept when it divides evenly; a remainder means a
    // partial capture, and dividing it would launder a wrong number into a confident read.
    if (rounds == null && draftDetail && Array.isArray(draftDetail.picks)
        && draftDetail.picks.length > 0 && teams > 0 && draftDetail.picks.length % teams === 0) {
      rounds = draftDetail.picks.length / teams;
    }
    return { rounds, teams, season: text(payload.seasonId), name: settings ? text(settings.name) : null };
  }

  /**
   * Reduce a draft-page league-settings capture into its own snapshot (2026-08-29). Unlike
   * `applyLeagueJson`, no incremental one-level merge is needed: every `reconcileDetailPicks` fetch
   * already requests all three views (mDraftDetail, mSettings, mTeam) in ONE response, so each
   * capture is already as complete as this path ever gets — a same-league OR different-league
   * capture both simply replace wholesale (this is what makes tracking a NEW mock, or a NEW real
   * draft, in the same browser session safe: stale settings never survive into a genuinely
   * different draft). A capture with no resolvable leagueId is dropped — never stored keyless.
   */
  function applyDraftLeagueJson(previous, payload, leagueId, capturedAt) {
    if (!payload || !isRecord(payload)) return previous ?? null;
    const incoming = text(leagueId);
    if (!incoming) return previous ?? null;
    return {
      schemaVersion: DRAFT_LEAGUE_SCHEMA_VERSION,
      leagueId: incoming,
      payload,
      capturedAt: number(capturedAt) ?? Date.now(),
    };
  }

  globalThis.FfaEspnNormalize = { SCHEMA_VERSION, STORAGE_KEY, LIVE_SCHEMA_VERSION, LIVE_STORAGE_KEY, LEAGUE_SCHEMA_VERSION, LEAGUE_STORAGE_KEY, DRAFT_LEAGUE_SCHEMA_VERSION, DRAFT_LEAGUE_STORAGE_KEY, redact, normalizeCandidate, mergeSnapshots, parseFrameLine, createLiveSnapshot, leagueIdFromUrl, leagueIdFromLeagueUrl, seasonFromLeagueUrl, applyFrameToLive, applyDomPicks, applyLeagueJson, markLeagueFetchFailed, applyDetailPicks, applyLeagueFacts, leagueFactsFromPayload, applyDraftLeagueJson };
})();
