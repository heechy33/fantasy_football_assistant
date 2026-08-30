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
  // LEAGUE_STORAGE_KEY included (2026-08-28): it used to leak across sessions indefinitely -- no
  // code path ever cleared it (a same-league-different-season capture merges rather than resets,
  // see normalize.js's applyLeagueJson doc), so a months-old league capture could still be served
  // to the connect card as current. DRAFT_LEAGUE_STORAGE_KEY included (2026-08-29): the draft
  // page's own league-settings snapshot, same leak class.
  document.querySelector('#clear').addEventListener('click', async () => { await chrome.storage.local.remove([FfaEspnNormalize.STORAGE_KEY, FfaEspnNormalize.LIVE_STORAGE_KEY, FfaEspnNormalize.LEAGUE_STORAGE_KEY, FfaEspnNormalize.DRAFT_LEAGUE_STORAGE_KEY]); await refresh(); });
  refresh();
})();
