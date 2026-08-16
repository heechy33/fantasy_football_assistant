/* global chrome */
(() => {
  'use strict';
  // Protocol-channel constants (Step 7c note): the REQUEST/RESPONSE message names are mirrored in
  // frontend/src/adapters/espnBridge.ts and the storage keys in extension/src/normalize.js
  // (LIVE_STORAGE_KEY). Keep the three sites in sync.
  const REQUEST = 'ffa.espn.snapshot.request'; const RESPONSE = 'ffa.espn.snapshot.response'; const LIVE_KEY = 'ffa.espn.live.snapshot.v1';
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== REQUEST) return;
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
  });
})();
