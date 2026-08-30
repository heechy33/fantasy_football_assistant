/* global chrome */
(() => {
  'use strict';
  // Protocol-channel constants (Step 7c note): the REQUEST/RESPONSE message names are mirrored in
  // frontend/src/adapters/espnBridge.ts and the storage keys in extension/src/normalize.js
  // (LIVE_STORAGE_KEY / LEAGUE_STORAGE_KEY). Keep the four sites in sync. RESET_REQUEST/RESPONSE
  // (2026-08-29) is a fifth pair on the same two files (espnBridge.ts + here) — no storage-key or
  // normalize.js counterpart, since it only ever removes LIVE_KEY. DRAFT_LEAGUE_REQUEST/RESPONSE
  // (2026-08-29, second) is a sixth pair, WITH a normalize.js counterpart (DRAFT_LEAGUE_STORAGE_KEY)
  // — a third, separate snapshot from both LIVE_KEY and LEAGUE_KEY.
  const REQUEST = 'ffa.espn.snapshot.request'; const RESPONSE = 'ffa.espn.snapshot.response'; const LIVE_KEY = 'ffa.espn.live.snapshot.v1';
  // The league snapshot pair (2026-08-27) is a SEPARATE message type — the live response's
  // `version: 3` shape is pinned by three files and must not be overloaded.
  const LEAGUE_REQUEST = 'ffa.espn.league.request'; const LEAGUE_RESPONSE = 'ffa.espn.league.response'; const LEAGUE_KEY = 'ffa.espn.league.snapshot.v1';
  // Draft-page league-settings pair (2026-08-29) — a THIRD, separate snapshot from LEAGUE_KEY (see
  // normalize.js's DRAFT_LEAGUE_STORAGE_KEY doc for why): relays the real scoring/roster settings
  // the draft page's own 30s mDraftDetail+mSettings+mTeam reconcile captures, so a live-detected
  // draft never has to fall back to a guessed PPR preset.
  const DRAFT_LEAGUE_REQUEST = 'ffa.espn.draftleague.request'; const DRAFT_LEAGUE_RESPONSE = 'ffa.espn.draftleague.response'; const DRAFT_LEAGUE_KEY = 'ffa.espn.draftleague.snapshot.v1';
  // Reset pair (2026-08-29): lets the app explicitly drop the LIVE stream when the user ends a
  // draft session — the "stuck on an abandoned draft" fix. Deliberately clears ONLY LIVE_KEY, never
  // LEAGUE_KEY (the connect card's saved-league data) or the recon snapshot.
  const RESET_REQUEST = 'ffa.espn.reset.request'; const RESET_RESPONSE = 'ffa.espn.reset.response';
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === REQUEST) {
      const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 80) : null;
      // If the extension was reloaded (dev iteration) while this tab stayed open, this content
      // script instance's chrome.* APIs throw "Extension context invalidated" on first access —
      // wrapping in a promise chain turns that into a normal rejection instead of an uncaught one.
      // requestEspnSnapshot() on the app side just times out, exactly like "no relay answered";
      // reloading this tab re-injects a fresh script with a live context.
      Promise.resolve()
        .then(() => chrome.storage.local.get([LIVE_KEY]))
        .then((stored) => {
          // Step 7b: the multi-KB recon snapshot is no longer relayed here — recon.js reads it directly
          // from chrome.storage; the app only ever consumes `live`.
          const live = stored[LIVE_KEY] || null;
          window.postMessage({ type: RESPONSE, version: 3, requestId, live }, location.origin);
        })
        .catch(() => {});
      return;
    }
    if (event.data?.type === LEAGUE_REQUEST) {
      const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 80) : null;
      Promise.resolve()
        .then(() => chrome.storage.local.get([LEAGUE_KEY]))
        .then((stored) => {
          window.postMessage({ type: LEAGUE_RESPONSE, version: 1, requestId, league: stored[LEAGUE_KEY] || null }, location.origin);
        })
        .catch(() => {});
      return;
    }
    if (event.data?.type === DRAFT_LEAGUE_REQUEST) {
      const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 80) : null;
      Promise.resolve()
        .then(() => chrome.storage.local.get([DRAFT_LEAGUE_KEY]))
        .then((stored) => {
          window.postMessage({ type: DRAFT_LEAGUE_RESPONSE, version: 1, requestId, league: stored[DRAFT_LEAGUE_KEY] || null }, location.origin);
        })
        .catch(() => {});
      return;
    }
    if (event.data?.type === RESET_REQUEST) {
      const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 80) : null;
      Promise.resolve()
        .then(() => chrome.storage.local.remove([LIVE_KEY]))
        .then(() => {
          window.postMessage({ type: RESET_RESPONSE, requestId, ok: true }, location.origin);
        })
        .catch(() => {
          window.postMessage({ type: RESET_RESPONSE, requestId, ok: false }, location.origin);
        });
    }
  });
})();
