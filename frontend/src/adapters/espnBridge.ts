import type { EspnLeagueSnapshot, EspnLiveSnapshot } from '../../../shared/types';
import { parseEspnLeagueJson } from './espnLeague';

// Protocol-channel constants (Step 7c note): mirrored as plain-JS literals in
// extension/src/app-content.js (same REQUEST / RESPONSE strings). The storage keys live in
// extension/src/normalize.js (LIVE_STORAGE_KEY / LEAGUE_STORAGE_KEY). Keep the FOUR sites in sync
// (espnBridge.ts, app-content.js, normalize.js, espn-content.js).
const REQUEST = 'ffa.espn.snapshot.request';
const RESPONSE = 'ffa.espn.snapshot.response';
// The league-snapshot pair is deliberately a SEPARATE message type — the live-snapshot response's
// `version: 3` shape is pinned by three files and must not be overloaded (2026-08-27 connect split).
const LEAGUE_REQUEST = 'ffa.espn.league.request';
const LEAGUE_RESPONSE = 'ffa.espn.league.response';
// The draft-page league-settings pair (2026-08-29) is a THIRD, separate snapshot — the real
// scoring/roster settings the draft page's own 30s mDraftDetail+mSettings+mTeam reconcile
// captures, so a live-detected draft never has to fall back to a guessed PPR preset. Distinct from
// LEAGUE_REQUEST/RESPONSE above: that pair serves the league-PAGE capture (connect-time save);
// this one serves the draft-PAGE capture (Draft Room launcher), a different extraction path with
// its own storage key (see normalize.js's DRAFT_LEAGUE_STORAGE_KEY doc for why they must not share
// one — a mock's different leagueId would otherwise wipe a saved real league's settings).
const DRAFT_LEAGUE_REQUEST = 'ffa.espn.draftleague.request';
const DRAFT_LEAGUE_RESPONSE = 'ffa.espn.draftleague.response';
// Reset pair (2026-08-29): lets "End draft" drop the extension's captured LIVE stream so a genuinely
// new draft never inherits an abandoned one's picks. Mirrored only in app-content.js — there is no
// storage-key or normalize.js counterpart, since it just removes LIVE_KEY wholesale.
const RESET_REQUEST = 'ffa.espn.reset.request';
const RESET_RESPONSE = 'ffa.espn.reset.response';
// A content-script chrome.storage.local.get round trip can occasionally run long on a busy draft
// page; 400ms was tight enough that two ordinary slow polls in a row (~2s total, given the 1s poll
// cadence in useEspnBridge) could flip "extension present" off mid-draft. 900ms stays comfortably
// under the 1000ms poll interval so a stuck request never overlaps the next tick (useEspnBridge's
// runningRef also guards against overlap), while giving a slow round trip real room to land.
const DEFAULT_TIMEOUT_MS = 900;

export interface EspnBridgeResponse {
  /**
   * False only on timeout — no relay answered on this page within `timeoutMs`. That is the
   * "extension not installed/enabled here" signal: a real app-content.js relay always answers
   * (even with `live: null` when no ESPN snapshot exists yet), so silence is the only case a
   * missing extension produces.
   */
  responded: boolean;
  /** Null both on timeout and when the extension answered but has no live snapshot yet
   * (no ESPN draft tab open, or the socket hasn't sent a frame). Callers must not conflate the
   * two — `responded` disambiguates them. */
  live: EspnLiveSnapshot | null;
}

function isLiveSnapshot(value: unknown): value is EspnLiveSnapshot {
  const record = value as { schemaVersion?: unknown; streamPicks?: unknown } | null | undefined;
  return typeof record?.schemaVersion === 'number' && Array.isArray(record?.streamPicks);
}

/**
 * One round-trip to the extension's app-content.js relay (window.postMessage, same-origin only).
 * Resolves on the matching RESPONSE (by requestId — postMessage promises can otherwise arrive
 * out of order if a slow chrome.storage.local.get overlaps a fast one) or on timeout.
 */
export function requestEspnSnapshot(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EspnBridgeResponse> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;

    function finish(result: EspnBridgeResponse) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type !== RESPONSE || event.data?.requestId !== requestId) return;
      const payload = event.data?.live;
      finish({ responded: true, live: payload == null ? null : (isLiveSnapshot(payload) ? payload : null) });
    }

    const timer = setTimeout(() => finish({ responded: false, live: null }), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: REQUEST, requestId }, location.origin);
  });
}

export interface EspnLeagueBridgeResponse {
  /**
   * False only on timeout — no relay answered on this page within `timeoutMs`. Same
   * "extension not installed/enabled here" rule as {@link EspnBridgeResponse.responded}.
   */
  responded: boolean;
  /** Null both on timeout and when the extension answered but has no league snapshot yet (no
   * ESPN league page has been opened since the extension loaded). Callers must not conflate the
   * two — `responded` disambiguates them. */
  league: EspnLeagueSnapshot | null;
}

/** The RAW capture the extension relays — normalize.js's `applyLeagueJson` shape, keyed by
 * leagueId, carrying the untranslated ESPN league-API JSON under `payload`. This is NOT an
 * {@link EspnLeagueSnapshot}: the translation into that shape (name/teams/rounds/diagnostics/…)
 * happens here, via `parseEspnLeagueJson`, never upstream in the extension. */
function isRawLeagueCapture(value: unknown): value is { schemaVersion: number; leagueId: string; payload: unknown; views?: string[]; draftDetailFetchStatus?: string } {
  const record = value as { schemaVersion?: unknown; leagueId?: unknown; payload?: unknown } | null | undefined;
  return typeof record?.schemaVersion === 'number' && typeof record?.leagueId === 'string' && record?.payload != null;
}

/**
 * One round-trip for the ESPN LEAGUE snapshot (not the live draft stream) — same
 * postMessage relay, same requestId correlation, same "timeout ⇒ not present" rule as
 * {@link requestEspnSnapshot}. The extension only has a league snapshot once the user has opened
 * their real ESPN league page (the manifest now matches /football/league*), so the connect panel
 * points the user there when this times out. The relay hands back the RAW capture (see
 * `isRawLeagueCapture`); `parseEspnLeagueJson` is the one place it becomes an `EspnLeagueSnapshot` —
 * skipping that step here previously handed the UI the raw `{schemaVersion, leagueId, payload}`
 * capture instead, which crashed EspnSetupTabs on `snapshot.diagnostics` being undefined.
 */
export function requestEspnLeague(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EspnLeagueBridgeResponse> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;

    function finish(result: EspnLeagueBridgeResponse) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type !== LEAGUE_RESPONSE || event.data?.requestId !== requestId) return;
      const capture = event.data?.league;
      // `capture.views` (the ?view= params the extension saw) travels with the payload into the
      // parser so the connect UI can point at the missing ESPN tab instead of a dead end.
      const league = capture == null ? null : (isRawLeagueCapture(capture) ? parseEspnLeagueJson(capture.payload, capture.views, capture.draftDetailFetchStatus) : null);
      finish({ responded: true, league });
    }

    const timer = setTimeout(() => finish({ responded: false, league: null }), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: LEAGUE_REQUEST, requestId }, location.origin);
  });
}

/**
 * One round-trip for the DRAFT-PAGE league-settings snapshot (2026-08-29) — same postMessage
 * relay/requestId/timeout-means-absent contract as {@link requestEspnLeague}, but reading the
 * OTHER capture: the draft page's own periodic mDraftDetail+mSettings+mTeam reconcile, keyed by
 * whatever league the draft room's socket is currently attached to. This is what lets the Draft
 * Room show a live-detected draft's real scoring/roster settings instead of a guessed PPR preset —
 * before this existed, that reconcile fetched the identical payload but kept only four facts
 * (rounds/teams/season/name) and discarded scoring/roster entirely. The relay hands back the same
 * RAW-capture shape `requestEspnLeague` does (see `isRawLeagueCapture`); `parseEspnLeagueJson` is
 * reused as-is — translation lives in exactly one place regardless of which capture fed it.
 */
export function requestEspnDraftLeague(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EspnLeagueBridgeResponse> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;

    function finish(result: EspnLeagueBridgeResponse) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type !== DRAFT_LEAGUE_RESPONSE || event.data?.requestId !== requestId) return;
      const capture = event.data?.league;
      const league = capture == null ? null : (isRawLeagueCapture(capture) ? parseEspnLeagueJson(capture.payload, capture.views, capture.draftDetailFetchStatus) : null);
      finish({ responded: true, league });
    }

    const timer = setTimeout(() => finish({ responded: false, league: null }), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: DRAFT_LEAGUE_REQUEST, requestId }, location.origin);
  });
}

/**
 * One round-trip asking the extension to drop its captured LIVE draft stream (never the league
 * snapshot) — the "End draft" action's counterpart to the reset extension normalize.js's
 * `applyFrameToLive`/`applyDomPicks` would otherwise apply lazily on the next frame. Resolves
 * `true` once the extension confirms the key is gone; `false` on timeout (no relay answered) or an
 * explicit failure — either way the caller's own session state has already moved on by the time
 * this resolves, so a failure here is logged, never blocking.
 */
export function requestEspnResetSnapshot(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;

    function finish(ok: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type !== RESET_RESPONSE || event.data?.requestId !== requestId) return;
      finish(event.data?.ok === true);
    }

    const timer = setTimeout(() => finish(false), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: RESET_REQUEST, requestId }, location.origin);
  });
}
