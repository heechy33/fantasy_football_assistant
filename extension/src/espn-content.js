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
  // the snapshot when a NEW league's socket starts writing (old mock -> new mock) -- but ONLY when
  // THIS tab is foregrounded (2026-08-28): a backgrounded/abandoned draft tab (ESPN keeps
  // autopicking a left mock server-side) must not be able to reset the shared key back to its own
  // league out from under whichever draft the user is actually watching. Visibility is read HERE,
  // inside the queued callback, not captured at call time -- writes are serialized on `queue`,
  // which can have a backlog, so reading it earlier could apply a stale verdict.
  function applyLiveFrame(frameText, url) {
    queue = queue.then(async () => {
      const isVisible = document.visibilityState !== 'hidden';
      const key = FfaEspnNormalize.LIVE_STORAGE_KEY;
      const prior = (await chrome.storage.local.get(key))[key] || null;
      await chrome.storage.local.set({ [key]: FfaEspnNormalize.applyFrameToLive(prior, frameText, Date.now(), url, isVisible) });
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
    if (urlLeague) { socketLeagueId = urlLeague; startDetailReconcile(); }
    persist(candidate);
    // A text frame candidate is the raw socket line (bounded/redacted by espn-main.js); feed it into
    // the separate live pick stream. INIT previews parse to null and are harmlessly skipped.
    if (typeof candidate?.frame === 'string' && candidate.frame) applyLiveFrame(candidate.frame, candidate.url);
    // League-API JSON (2026-08-27): captured verbatim (redacted) from the ESPN league page's own
    // fetches, stored under its own key keyed by leagueId. The pick-stream handling above is
    // untouched; parsing happens in the app's espnLeague adapter, not here.
    if (candidate?.kind === 'draft-json' && candidate?.payload && FfaEspnNormalize.leagueIdFromLeagueUrl(candidate.url)) {
      applyLeagueJson(candidate.payload, candidate.url);
      ensureDraftDetail(candidate.url);
    }
    // Mid-draft-attach fix (2026-08-30): a tab that attaches to an ALREADY-RUNNING draft may not
    // see a socket frame for a while (nobody else has picked since it attached), so `socketLeagueId`
    // above never gets set and the detail reconcile — which is what fetches ESPN's own pick history
    // and real scoring settings — never starts. The draft room ALSO calls the league API directly
    // (recon-verified, see espn-main.js's isDraftUrl comment), and that traffic already carries the
    // league id in its URL via the same parser used for socket frames. Gated to the draft page only
    // (this content script also runs on /football/league* and /football/team*, whose league-API
    // traffic must never seed the shared live-draft snapshot).
    if (!socketLeagueId && location.pathname.startsWith('/football/draft')) {
      const apiLeague = FfaEspnNormalize.leagueIdFromLeagueUrl(candidate.url);
      if (apiLeague) { socketLeagueId = apiLeague; startDetailReconcile(); }
    }
  });

  // The league snapshot lives in its own storage key, keyed by the capture URL's leagueId — a
  // second league's capture replaces the first rather than merging.
  // 2026-08-28 ACTIVE mDraftDetail FETCH (DECISIONS.md): the passive capture only sees views the
  // ESPN page itself requests, and most league pages never fetch mDraftDetail, so the exact round
  // count never reaches those captures. This content script makes ONE GET per league session to
  // the verified read-API host the page itself already calls (lm-api-reads.fantasy.espn.com),
  // appending ?view=mDraftDetail&view=mRoster to the captured league path (the clean URL keeps origin+path),
  // then feeds the JSON through the SAME applyLeagueJson merge as a passive capture. Read-only;
  // failure retries once, then the passive capture still works. Never a wildcard espn.com fetch.
  let draftDetailFetchedLeagueId = null;
  function ensureDraftDetail(url) {
    const leagueId = FfaEspnNormalize.leagueIdFromLeagueUrl(url);
    if (!leagueId || draftDetailFetchedLeagueId === leagueId) return;
    draftDetailFetchedLeagueId = leagueId;
    fetchDraftDetail(url, true);
  }
  // Failure is not silent-forever: ONE retry after 3s (a fetch fired before the page's ESPN
  // cookies were established can fail once, then succeed), then give up -- the passive capture
  // still works and the adapter's diagnostics keep naming the gap honestly.
  function fetchDraftDetail(url, allowRetry) {
    // Full view set in ONE GET: mTeam carries the team display names (mRoster's teams[] can lack
    // them), mSettings guarantees draftSettings, mDraftDetail the draft record — so the connect
    // card populates completely from league home with zero clicks.
    const draftDetailUrl = url + '?view=mTeam&view=mRoster&view=mDraftDetail&view=mSettings';
    // Visible in the ESPN page's DevTools console so a silent failure is diagnosable in seconds
    // instead of a guessing loop — prefixed `[ffa]` so it filters cleanly.
    console.info(`[ffa] draft-detail fetch: ${draftDetailUrl}`);
    fetch(draftDetailUrl, { credentials: 'include' })
      .then((response) => {
        console.info(`[ffa] draft-detail fetch: HTTP ${response.status}`);
        return response.ok ? response.json() : null;
      })
      .then((payload) => {
        if (payload) {
          // Shape discovery (2026-08-28): rounds=undefined on the real 2026 API, so print the FULL
          // key sets of the two objects that should carry it — the real field name shows up here.
          const keys = (value) => (value && typeof value === 'object' ? Object.keys(value).slice(0, 40).join(', ') : String(value));
          const arrLen = (value) => (Array.isArray(value) ? `Array(${value.length})` : String(value));
          console.info(`[ffa] fetch payload: teams=${Array.isArray(payload.teams) ? payload.teams.length : 0} named=${Array.isArray(payload.teams) ? payload.teams.filter((t) => t && (t.name || (t.location && t.nickname))).length : 0}`);
          console.info(`[ffa] draftDetail keys=[${keys(payload.draftDetail)}]`);
          console.info(`[ffa] settings keys=[${keys(payload.settings)}]`);
          console.info(`[ffa] draftSettings keys=[${keys(payload.settings?.draftSettings)}]`);
          const dd = payload.draftDetail || {};
          console.info(`[ffa] draftDetail arrays: order=${arrLen(dd.order)} draftOrder=${arrLen(dd.draftOrder)} picks=${arrLen(dd.picks)} drafted=${arrLen(dd.drafted)}`);
          console.info(`[ffa] settings.draftSettings raw=${JSON.stringify(payload.settings?.draftSettings)?.slice(0, 600)}`);
          applyLeagueJson(payload, draftDetailUrl, Date.now(), 'ok');
        }
        else if (!allowRetry) markFetchFailed();
        else setTimeout(() => fetchDraftDetail(url, false), 3000);
      })
      .catch((error) => {
        console.warn(`[ffa] draft-detail fetch failed${allowRetry ? ' (retrying in 3s)' : ' (giving up)'}`, error);
        if (allowRetry) setTimeout(() => fetchDraftDetail(url, false), 3000);
        else markFetchFailed();
      });
  }
  // Both attempts failed: record it in the snapshot so the app's connect card can say the automatic
  // fetch failed instead of only suggesting the manual Draft Recap path.
  function markFetchFailed() {
    queue = queue.then(async () => {
      const key = FfaEspnNormalize.LEAGUE_STORAGE_KEY;
      const prior = (await chrome.storage.local.get(key))[key] || null;
      await chrome.storage.local.set({ [key]: FfaEspnNormalize.markLeagueFetchFailed(prior) });
    }).catch(() => {});
  }
  // Missed-frame SELF-CORRECTION (2026-08-28): the websocket SELECTED stream can silently drop
  // frames — the app flags the resulting board-vs-stream gap ("the board shows pick #74 but the
  // stream's latest confirmed pick is #65"). While this tab knows its league id (the draft-room
  // socket speaks it), periodically re-read the league's OWN pick history — the same mDraftDetail
  // read-API GET the league-page path already uses — and merge it into the live snapshot via
  // applyDetailPicks. The stream stays the fast path; this only ever ADDS picks the stream missed,
  // never renumbers or removes. Rate-limited to one GET per interval per tab; failures are logged
  // and simply wait for the next tick.
  //
  // 2026-08-29 FIX: this reconcile used to no-op whenever `document.visibilityState === 'hidden'`
  // — which is the NORMAL state of the ESPN tab any time the user is looking at the assistant app,
  // i.e. the entire product. A live mock lost ~19 picks and never self-corrected because of exactly
  // this: the tab was backgrounded the whole time, so the reconcile that was supposed to backfill
  // the gap never ran. The visibility gate's own comment named two hazards, and both are already
  // handled INSIDE normalize.js, not by this gate: (1) "would launder a dead tab as fresh" —
  // applyDetailPicks/applyLeagueFacts both explicitly never touch lastHeartbeatAt (see their own
  // doc comments); (2) "could feed a stale/foreign league's picks into an active session's board" —
  // both functions already refuse a leagueId mismatch outright (`base.leagueId && incoming !==
  // base.leagueId`). The remaining case — an ABANDONED practice draft reusing the SAME league id as
  // a fresh one (DECISIONS.md, 2026-08-29 (2)) — is also harmless here specifically: this reconcile
  // always re-fetches ESPN's live truth for `socketLeagueId` over the network, never replays a
  // locally cached value, so a backgrounded tab's fetch returns exactly the same current state a
  // foregrounded tab's fetch would. There is nothing left for visibility to protect against, so it
  // is removed outright rather than replaced with a subtler gate.
  const DETAIL_RECONCILE_MS = 30000;
  const isRecord = (value) => value !== null && typeof value === 'object';
  let detailReconcileTimer = null;
  function startDetailReconcile() {
    if (detailReconcileTimer) return;
    // Never affect ESPN if a storage/extension-context call throws (e.g. context invalidated) --
    // same defensive discipline as persist()/applyLiveFrame() above.
    reconcileDetailPicks().catch(() => {});
    detailReconcileTimer = setInterval(() => { reconcileDetailPicks().catch(() => {}); }, DETAIL_RECONCILE_MS);
  }
  // A backgrounded or abandoned draft tab must stop writing into the shared live key — its 30s
  // timer would otherwise keep refreshing lastHeartbeatAt forever (laundering a dead tab as fresh)
  // and, pre-2026-08-28, could feed a stale/foreign league's picks into an active session's board.
  function stopDetailReconcile() {
    if (detailReconcileTimer) { clearInterval(detailReconcileTimer); detailReconcileTimer = null; }
  }
  window.addEventListener('pagehide', stopDetailReconcile);
  // The network fetch runs OUTSIDE `queue` (matching fetchDraftDetail's pattern below) -- only the
  // chrome.storage merges are serialized on it. Chaining the fetch itself onto `queue` would stall
  // every other pending write (socket frames, DOM rows) behind a slow/hung ESPN response.
  async function reconcileDetailPicks() {
    if (!socketLeagueId) return;
    const key = FfaEspnNormalize.LIVE_STORAGE_KEY;
    const priorForSeason = (await chrome.storage.local.get(key))[key] || null;
    // Query the season ESPN itself has already stamped on this snapshot when available -- the
    // calendar year (`new Date().getFullYear()`) is wrong for any draft held outside the season
    // the calendar year names (a January mock, an offseason dynasty startup), and nothing here
    // ever corrected it before. Falls back to the calendar year only until the first reconcile.
    const season = (priorForSeason && priorForSeason.leagueSeason) || new Date().getFullYear();
    // Repeated view params, matching the form the working league-page fetch already uses
    // (fetchDraftDetail above) rather than the comma-joined form ESPN's response shape never
    // confirmed it honors.
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${socketLeagueId}?view=mDraftDetail&view=mSettings&view=mTeam`;
    let payload = null;
    try {
      const response = await fetch(url, { credentials: 'include' });
      payload = response.ok ? await response.json() : null;
    } catch (error) {
      console.warn('[ffa] detail reconcile failed (will retry next tick)', error);
      return;
    }
    if (!payload) return;
    // Extraction lives in normalize.js's leagueFactsFromPayload (shared with espnLeague.ts's
    // proven precedence) -- the inline `payload.draftSettings.*` read this replaced never matched
    // ESPN's real shape (`payload.settings.draftSettings`), so leagueRounds/leagueTeams were
    // permanently null and this reconcile only ever looked like it was working.
    const facts = FfaEspnNormalize.leagueFactsFromPayload(payload);
    // scoringItems diagnostic (2026-08-29): settles the one open question behind relaying this
    // payload for real settings (Step 2 below) -- does the draft page's own mDraftDetail+mSettings
    // fetch actually carry the league's scoringItems, or only the four facts leagueFactsFromPayload
    // already extracts? `hidden=` confirms the visibility-gate removal above is doing something —
    // this line should now appear on schedule even while the ESPN tab is backgrounded.
    const scoringItems = isRecord(payload.settings) && isRecord(payload.settings.scoringSettings) && Array.isArray(payload.settings.scoringSettings.scoringItems)
      ? payload.settings.scoringSettings.scoringItems
      : (isRecord(payload.settings) && Array.isArray(payload.settings.scoringItems) ? payload.settings.scoringItems : null);
    console.info(`[ffa] league facts: rounds=${facts && facts.rounds} teams=${facts && facts.teams} season=${facts && facts.season} name=${facts && facts.name} scoringItems=${scoringItems ? scoringItems.length : 'absent'} hidden=${document.visibilityState === 'hidden'}`);
    if (facts && (facts.rounds != null || facts.teams != null || facts.season != null || facts.name != null)) {
      queue = queue.then(async () => {
        const prior = (await chrome.storage.local.get(key))[key] || null;
        await chrome.storage.local.set({ [key]: FfaEspnNormalize.applyLeagueFacts(prior, facts, socketLeagueId) });
      }).catch(() => {});
    }
    // Draft-page league settings relay (2026-08-29, Step 2): store the FULL captured payload
    // (redacted, matching the league-page capture's discipline) under its own key so the app can
    // read real scoring/roster settings instead of guessing a PPR preset for a live-detected draft
    // — see normalize.js's applyDraftLeagueJson doc for why this is NOT the same key as the
    // league-page capture. Runs every tick regardless of whether `facts`/`picks` below found
    // anything, since the payload itself is what matters here. Uses normalize.js's OWN `redact`
    // (isolated-world, hardcoded depth 8 — distinct from espn-main.js's MAIN-world `redact`, which
    // takes a configurable maxDepth): this fetch requests mDraftDetail+mSettings+mTeam only, never
    // mRoster, so nothing here needs the deeper roster-tree ceiling espn-main.js's league-page path
    // carries. `settings.scoringSettings.scoringItems[i].points` sits at depth 5 — well inside 8.
    const draftLeagueKey = FfaEspnNormalize.DRAFT_LEAGUE_STORAGE_KEY;
    const redactedPayload = FfaEspnNormalize.redact(payload);
    queue = queue.then(async () => {
      const prior = (await chrome.storage.local.get(draftLeagueKey))[draftLeagueKey] || null;
      await chrome.storage.local.set({
        [draftLeagueKey]: FfaEspnNormalize.applyDraftLeagueJson(prior, redactedPayload, socketLeagueId, Date.now()),
      });
    }).catch((error) => {
      console.warn('[ffa] draft-league settings merge FAILED', error);
    });
    const picks = isRecord(payload.draftDetail) && Array.isArray(payload.draftDetail.picks) ? payload.draftDetail.picks : null;
    if (!picks || picks.length === 0) return;
    queue = queue.then(async () => {
      const prior = (await chrome.storage.local.get(key))[key] || null;
      const next = FfaEspnNormalize.applyDetailPicks(prior, picks, socketLeagueId);
      await chrome.storage.local.set({ [key]: next });
      console.info(`[ffa] detail reconcile: ${next.detailPicks ? next.detailPicks.length : 0} authoritative picks on record (of ${picks.length} in the slate)`);
    }).catch(() => {});
  }
  function applyLeagueJson(payload, url, capturedAt, fetchStatus) {
    queue = queue.then(async () => {
      const key = FfaEspnNormalize.LEAGUE_STORAGE_KEY;
      const prior = (await chrome.storage.local.get(key))[key] || null;
      const next = FfaEspnNormalize.applyLeagueJson(prior, payload, url, capturedAt ?? Date.now(), fetchStatus);
      await chrome.storage.local.set({ [key]: next });
      // Visible in the ESPN page's DevTools console: shows the merged state after each capture so
      // an overwrite bug (or a missing view) is diagnosable without guessing.
      const teams = Array.isArray(next?.payload?.teams) ? next.payload.teams.length : 0;
      const named = Array.isArray(next?.payload?.teams)
        ? next.payload.teams.filter((team) => team && (team.name || (team.location && team.nickname))).length
        : 0;
      const bytes = JSON.stringify(next).length;
      console.info(`[ffa] league merge: views=[${(next?.views || []).join(', ')}] teams=${teams} named=${named} draftDetail=${next?.payload?.draftDetail ? `yes (rounds=${JSON.stringify(next.payload.draftDetail.rounds)})` : 'no'} (${Math.round(bytes / 1024)} KB)`);
    }).catch((error) => {
      // A write failure (e.g. chrome.storage quota on a multi-MB mRoster payload) must NOT vanish
      // silently — that used to look exactly like "the merge never happened".
      console.warn('[ffa] league merge FAILED', error);
    });
  }
  // At document_start the <html> root is not constructed yet; observe the document itself, which
  // still covers the whole subtree once the parser builds it. The DOM pick observer is DRAFT-page
  // scope only: since the manifest also matches league/team pages (for the league capture), letting
  // it run there would write draft-shaped recon noise into the live key from pages with no draft.
  if (!/\/football\/draft/i.test(location.pathname)) return;
  new MutationObserver(() => { clearTimeout(domTimer); domTimer = setTimeout(reconcileDom, 400); }).observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
  // An immediate best-effort call, in addition to load/1500ms: on a mid-draft tab attach, SELECTED
  // frames can start arriving over the socket before the 400ms-debounced observer or the 1500ms
  // fallback ever fire, which would let the first pick land with domSampledBeforeStream still false
  // (a false "we haven't looked" reading that blocks the fast board-empty/board-depth offset
  // confirmation). This call usually finds nothing at document_start and is harmless when it does.
  reconcileDom();
  window.addEventListener('load', reconcileDom, { once: true }); setTimeout(reconcileDom, 1500);
})();
