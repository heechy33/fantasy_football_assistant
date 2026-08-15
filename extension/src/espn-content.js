/* global chrome, FfaEspnNormalize */
(() => {
  'use strict';
  const EVENT = 'ffa-espn-recon-candidate';
  let queue = Promise.resolve(); let domTimer = null;
  function persist(candidate) {
    queue = queue.then(async () => {
      const prior = (await chrome.storage.local.get(FfaEspnNormalize.STORAGE_KEY))[FfaEspnNormalize.STORAGE_KEY] || null;
      const next = FfaEspnNormalize.normalizeCandidate(candidate, (Number(prior?.sequence) || 0) + 1);
      await chrome.storage.local.set({ [FfaEspnNormalize.STORAGE_KEY]: FfaEspnNormalize.mergeSnapshots(prior, next) });
    }).catch(() => {}); // Never affect ESPN if local extension storage is unavailable.
  }
  const SELECTORS = ['[data-pick]', '[data-pick-number]', '[data-testid*="pick"]', '[data-player-id]'];
  const ROW_CONTAINER = 'tr, [role="row"], li';
  const dataAttributes = (element) => Object.fromEntries([...element.attributes].filter((attribute) => attribute.name.startsWith('data-') && !/(?:token|cookie|session|chat|message)/i.test(attribute.name)).map((attribute) => [attribute.name, attribute.value.slice(0, 160)]));
  const rowText = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  function reconcileDom() {
    const seen = new Set(); const rows = [];
    for (const selector of SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue; seen.add(element);
        if (rows.length >= 320) break;
        const row = { match: selector, attributes: dataAttributes(element), text: rowText(element) };
        // [data-pick-number]/[data-pick] often sit on the undo button; capture the row container so the
        // real player-identity location (data-player-id/data-testid, team/name text) is discoverable.
        if (selector === '[data-pick]' || selector === '[data-pick-number]') {
          const container = element.closest(ROW_CONTAINER) || element;
          row.row = { text: rowText(container), attributes: dataAttributes(container), playerId: container.querySelector('[data-player-id]')?.getAttribute('data-player-id') || null, testId: container.querySelector('[data-testid]')?.getAttribute('data-testid') || null };
        }
        rows.push(row);
      }
      if (rows.length >= 320) break;
    }
    const kept = rows.filter((row) => Object.keys(row.attributes).length || row.text || (row.row && (Object.keys(row.row.attributes).length || row.row.text || row.row.playerId || row.row.testId)));
    persist({ kind: 'dom', transport: 'dom', direction: 'visible', url: `${location.origin}${location.pathname}`, pageUrl: `${location.origin}${location.pathname}`, pageFrame: window.top === window.self ? 'top' : 'iframe', domRows: kept });
  }
  // The MAIN-world observer posts redacted draft-shaped candidates; page-world window.postMessage is
  // the documented cross-world channel (CustomEvent.detail is not reliably shared into this world).
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== EVENT) return;
    persist(event.data);
  });
  // At document_start the <html> root is not constructed yet; observe the document itself, which
  // still covers the whole subtree once the parser builds it.
  new MutationObserver(() => { clearTimeout(domTimer); domTimer = setTimeout(reconcileDom, 400); }).observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
  window.addEventListener('load', reconcileDom, { once: true }); setTimeout(reconcileDom, 1500);
})();
