/* global chrome */
(() => {
  'use strict';
  const REQUEST = 'ffa.espn.snapshot.request'; const RESPONSE = 'ffa.espn.snapshot.response'; const STORAGE_KEY = 'ffa.espn.recon.snapshot.v1'; const LIVE_KEY = 'ffa.espn.live.snapshot.v1';
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== REQUEST) return;
    const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 80) : null;
    const stored = await chrome.storage.local.get([STORAGE_KEY, LIVE_KEY]);
    const snapshot = stored[STORAGE_KEY] || null;
    const live = stored[LIVE_KEY] || null;
    // The relay serves the recon snapshot AND the live pick stream; the app consumes `live`.
    window.postMessage({ type: RESPONSE, version: 2, requestId, snapshot, live }, location.origin);
  });
})();
