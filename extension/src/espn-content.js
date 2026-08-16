/* global chrome, FfaEspnNormalize */
(() => {
  'use strict';
  const EVENT = 'ffa-espn-recon-candidate';
  let queue = Promise.resolve(); let domTimer = null; let socketLeagueId = null;
  // This tab's league id, remembered from the socket URL (league-<id>) of the frames it has seen.
  // The draft PAGE URL carries no league id, so this per-tab value is the only way DOM pick writes
  // can be gated against a different-league snapshot in the shared live key. Null until the socket
  // speaks (DOM writes before that merge freely — the snapshot's own league is null or the same
  // tab's TOKEN will re-establish it within a second).
  function persist(candidate) {
    queue = queue.then(async () => {
      const prior = (await chrome.storage.local.get(FfaEspnNormalize.STORAGE_KEY))[FfaEspnNormalize.STORAGE_KEY] || null;
      const next = FfaEspnNormalize.normalizeCandidate(candidate, (Number(prior?.sequence) || 0) + 1);
      await chrome.storage.local.set({ [FfaEspnNormalize.STORAGE_KEY]: FfaEspnNormalize.mergeSnapshots(prior, next) });
    }).catch(() => {}); // Never affect ESPN if local extension storage is unavailable.
  }
  // The live pick stream lives in its own storage key, separate from the bounded/deduped recon
  // sample. Every text frame refreshes the heartbeat; SELECTED frames accumulate uncapped in order.
  // `url` is the socket URL that carried the frame: applyFrameToLive uses its league-<id> to reset
  // the snapshot when a NEW league's socket starts writing (old mock -> new mock).
  function applyLiveFrame(frameText, url) {
    queue = queue.then(async () => {
      const key = FfaEspnNormalize.LIVE_STORAGE_KEY;
      const prior = (await chrome.storage.local.get(key))[key] || null;
      await chrome.storage.local.set({ [key]: FfaEspnNormalize.applyFrameToLive(prior, frameText, Date.now(), url) });
    }).catch(() => {});
  }
  const SELECTORS = ['[data-pick]', '[data-pick-number]', '[data-testid*="pick"]', '[data-player-id]'];
  const ROW_CONTAINER = 'tr, [role="row"], li';
  const dataAttributes = (element) => Object.fromEntries([...element.attributes].filter((attribute) => attribute.name.startsWith('data-') && !/(?:token|cookie|session|chat|message)/i.test(attribute.name)).map((attribute) => [attribute.name, attribute.value.slice(0, 160)]));
  const rowText = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  /** Step B: collect [data-pick-number] rows for the live pick stream (merged by pickNumber, capped
   * at 400). text is the collapsed row text; segments are the direct-child text of the row container,
   * captured now so a future run can drop the text regex. `playerId` is an opportunistic bonus join
   * key for Step 6's offset derivation — recon (2026-08-15) confirmed real pick rows carry NO
   * `data-player-id` (only the Queue-button suggestions do), so this is expected to stay null on
   * every real row; nothing depends on it resolving. */
  function collectDomPicks() {
    const seen = new Set(); const picks = [];
    for (const element of document.querySelectorAll('[data-pick-number]')) {
      if (seen.has(element)) continue; seen.add(element);
      if (picks.length >= 400) break;
      const container = element.closest(ROW_CONTAINER) || element;
      const text = rowText(container);
      const attrNumber = Number((element.getAttribute('data-pick-number') || '').trim());
      const leadingDigits = /^\d+/.exec(text);
      const pickNumber = Number.isFinite(attrNumber) && attrNumber > 0
        ? attrNumber
        : (leadingDigits ? Number(leadingDigits[0]) : NaN);
      if (!Number.isFinite(pickNumber) || pickNumber <= 0) continue;
      const segments = [...container.childNodes]
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 12);
      const playerId = container.querySelector('[data-player-id]')?.getAttribute('data-player-id') || null;
      picks.push({ pickNumber, text, segments, playerId });
    }
    return picks;
  }
  /** The DOM's own on-the-clock reading, e.g. `[data-testid="current-pick"]` textContent
   * "On the Clock: Pick 146Team 3" (recon-verified 2026-08-15). `number` is present the instant this
   * element exists, well before the 4-row pick-number ticker fills in — the fastest absolute-offset
   * signal available on a mid-draft attach (see normalize.js's domMaxAtStreamStart). `team` is a
   * bonus cross-check, only parseable when the league still uses ESPN's default "Team N" names. */
  function readCurrentPick() {
    const el = document.querySelector('[data-testid="current-pick"]');
    const raw = (el?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    const pickMatch = /Pick\s*(\d+)/.exec(raw);
    const teamMatch = /Team\s*(\d+)/.exec(raw);
    const pickNumber = pickMatch ? Number(pickMatch[1]) : null;
    const team = teamMatch ? Number(teamMatch[1]) : null;
    if (!Number.isFinite(pickNumber) && !Number.isFinite(team)) return null;
    return { number: Number.isFinite(pickNumber) ? pickNumber : null, team: Number.isFinite(team) ? team : null };
  }
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
    // [data-pick-number] rows also feed the live pick stream (merged by pickNumber, capped) so the
    // app can resolve D/ST and the non-ids.espn tail without a static id map. Same queue chain, no
    // second timer. Always run (even with zero rows and no current-pick reading) so
    // domSampledBeforeStream can distinguish "the board was confirmed empty" from "we have not
    // looked yet" -- that distinction is what stops a mid-draft attach from false-confirming offset 0.
    const domPicks = collectDomPicks();
    const currentPick = readCurrentPick();
    queue = queue.then(async () => {
      const key = FfaEspnNormalize.LIVE_STORAGE_KEY;
      const prior = (await chrome.storage.local.get(key))[key] || null;
      await chrome.storage.local.set({ [key]: FfaEspnNormalize.applyDomPicks(prior, domPicks, socketLeagueId, currentPick) });
    }).catch(() => {}); // Never affect ESPN if local extension storage is unavailable.
  }
  // The MAIN-world observer posts redacted draft-shaped candidates; page-world window.postMessage is
  // the documented cross-world channel (CustomEvent.detail is not reliably shared into this world).
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== EVENT) return;
    const candidate = event.data;
    // Remember this tab's league from the socket URL (league-<id>) before feeding the frame, so DOM
    // pick writes from THIS page can later be gated against a different-league shared snapshot.
    const urlLeague = FfaEspnNormalize.leagueIdFromUrl(candidate.url);
    if (urlLeague) socketLeagueId = urlLeague;
    persist(candidate);
    // A text frame candidate is the raw socket line (bounded/redacted by espn-main.js); feed it into
    // the separate live pick stream. INIT previews parse to null and are harmlessly skipped.
    if (typeof candidate?.frame === 'string' && candidate.frame) applyLiveFrame(candidate.frame, candidate.url);
  });
  // At document_start the <html> root is not constructed yet; observe the document itself, which
  // still covers the whole subtree once the parser builds it.
  new MutationObserver(() => { clearTimeout(domTimer); domTimer = setTimeout(reconcileDom, 400); }).observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
  // An immediate best-effort call, in addition to load/1500ms: on a mid-draft tab attach, SELECTED
  // frames can start arriving over the socket before the 400ms-debounced observer or the 1500ms
  // fallback ever fire, which would let the first pick land with domSampledBeforeStream still false
  // (a false "we haven't looked" reading that blocks the fast board-empty/board-depth offset
  // confirmation). This call usually finds nothing at document_start and is harmless when it does.
  reconcileDom();
  window.addEventListener('load', reconcileDom, { once: true }); setTimeout(reconcileDom, 1500);
})();
