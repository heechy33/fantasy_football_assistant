/* global chrome, FfaEspnNormalize */
(() => {
  'use strict';
  const output = document.querySelector('#output'); const status = document.querySelector('#status'); let snapshot = null;
  async function refresh() {
    snapshot = (await chrome.storage.local.get(FfaEspnNormalize.STORAGE_KEY))[FfaEspnNormalize.STORAGE_KEY] || null;
    output.textContent = snapshot ? JSON.stringify(FfaEspnNormalize.redact(snapshot), null, 2) : 'No snapshot yet. Open an ESPN practice or live draft tab, then refresh.';
    status.textContent = snapshot ? `Snapshot ${snapshot.sequence} captured ${snapshot.capturedAt}; ${snapshot.picks.length} normalized picks.` : 'Waiting for ESPN draft activity.';
  }
  document.querySelector('#refresh').addEventListener('click', refresh);
  document.querySelector('#export').addEventListener('click', () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(FfaEspnNormalize.redact(snapshot), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `ffa-espn-recon-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; link.click(); URL.revokeObjectURL(url);
  });
  document.querySelector('#clear').addEventListener('click', async () => { await chrome.storage.local.remove([FfaEspnNormalize.STORAGE_KEY, FfaEspnNormalize.LIVE_STORAGE_KEY]); await refresh(); });
  refresh();
})();
