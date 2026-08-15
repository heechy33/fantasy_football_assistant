/* global chrome */
(() => {
  'use strict';
  const REQUEST = 'ffa.espn.snapshot.request'; const RESPONSE = 'ffa.espn.snapshot.response'; const STORAGE_KEY = 'ffa.espn.recon.snapshot.v1';
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== REQUEST) return;
    const requestId = typeof event.data.requestId === 'string' ? event.data.requestId.slice(0, 80) : null;
    const snapshot = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || null;
    window.postMessage({ type: RESPONSE, version: 1, requestId, snapshot }, location.origin);
  });
})();
