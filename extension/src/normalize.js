/* global globalThis */
(() => {
  'use strict';
  const SCHEMA_VERSION = 2;
  const STORAGE_KEY = 'ffa.espn.recon.snapshot.v1';
  const FRAME_SAMPLE_MAX = 50;
  const REJECTED_URL_MAX = 50;
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
  function mergeFrames(previous, next) {
    const seen = new Map();
    (Array.isArray(previous) ? previous : []).forEach((entry) => { if (entry && typeof entry.text === 'string') seen.set(entry.text, entry); });
    (Array.isArray(next) ? next : []).forEach((entry) => { if (entry && typeof entry.text === 'string' && !seen.has(entry.text)) seen.set(entry.text, entry); });
    return [...seen.values()].slice(0, FRAME_SAMPLE_MAX);
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
  globalThis.FfaEspnNormalize = { SCHEMA_VERSION, STORAGE_KEY, redact, normalizeCandidate, mergeSnapshots };
})();
