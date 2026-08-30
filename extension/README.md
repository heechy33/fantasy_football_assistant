# FFA ESPN Draft Recon (Phase 2)

This plain-JavaScript Manifest V3 extension is read-only reconnaissance, not an ESPN provider
integration. It has no background worker, requests only `storage`, and never requests cookie access.
Its match patterns are limited to ESPN's football-draft route, `http://localhost/*`, and the exact
production app origin (`https://happy-grass-0bcd9d60f.7.azurestaticapps.net/*`).

## Load and rehearse

1. Open `chrome://extensions`, enable **Developer mode**, then choose **Load unpacked**.
2. Select this `extension/` directory and open an authenticated ESPN practice live-draft page.
3. Open the extension's **Inspect views: recon.html** page (or `chrome-extension://<id>/recon.html`).
4. Make a few practice picks, refresh the recon page, and download its sanitized export.

The MAIN-world observer runs at `document_start` for WebSocket, fetch, and XHR responses. It strips
query strings, never examines outgoing requests/headers, and only sends redacted material to the
isolated relay over `window.postMessage` (the documented cross-world channel; `CustomEvent.detail` is
not reliably shared into an isolated world). WebSocket capture accepts any `espn.com` socket opened
by the draft page, while fetch/XHR stay filtered to the verified draft-API tree (the ESPN football
route plus `lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/<season>` and its
`/segments/<seg>/leagues` children — confirmed by the 2026-08-15 recon) to keep unrelated bodies out.

WebSocket frames are decoded for recon: text frames are inspected directly, and binary frames
(`Blob`/`ArrayBuffer`/typed-array views) up to 200,000 bytes are UTF-8 decoded and tagged with
`frameType` (`text`/`blob`/`arraybuffer`/`view`/`other`) and `byteLength` so the transport format can
be characterized before Phase 3. WebSocket strings up to 250,000 chars are parsed as JSON without the
draft-keyword gate (a live-draft socket's field names may not contain `draft`/`pick`/`league`), and
any non-JSON frame is reduced to a bounded preview (≤ 500 chars after redaction) that shows the frame
shape without persisting raw traffic. The snapshot keeps `frames` as a bounded (≤ 50), deduped sample
of distinct frame shapes plus `frameCount` (the true total), so recon sees the frame vocabulary and
slot-to-pick progression instead of only the final frame. JSON frames still land in
`structure`/`picks`; frame previews are dev-recon only. The `rejectedUrls` list records espn.com
fetch/XHR paths the observer filtered out, and `page.url`/`page.frame` record the draft page route and
whether it is top-frame or iframe-hosted, so a match-pattern extension is never guessed.

The isolated script immediately reduces each candidate to the current normalized
`chrome.storage.local` snapshot; raw frames are never stored or exported. Each snapshot keeps a
bounded, redacted draft structure (the settings/teams/order/slot shapes as seen on the wire) plus
normalized picks and a sample of the visible draft log, so the practice export can establish ESPN's
actual schema before Phase 3. DOM rows are tagged with the selector that produced them (`match`), and
`[data-pick-number]`/`[data-pick]` matches also capture their closest row container so the real
player-identity attributes become discoverable instead of stopping at the undo button. Non-JSON
transport frames keep only the bounded, deduped `frames` sample plus `frameCount`; the full frame is
never persisted.

The app relay responds only to this same-origin request and returns the normalized snapshot, never
raw traffic:

```js
window.postMessage({ type: 'ffa.espn.snapshot.request', requestId: 'optional-id' }, location.origin);
```

It replies with `ffa.espn.snapshot.response`. The React app does not consume this until Phase 3.

Before Phase 3, use the practice export to establish the authoritative pick source and ESPN player
IDs; DOM ID availability; full settings shape; D/ST team identity; draft/league status, teams, and
slot mapping; order changes; and whether the actual league uses the same transport. Do not infer an
event schema or D/ST ID formula. If ESPN uses another practice-draft route, add only that verified,
exact route—never a wildcard ESPN host permission.

## App sessions vs extension storage

Clearing the React app's localStorage (e.g. "Clear site data" / `localStorage.clear()` on the app
origin) only drops `ffa.draftSession.v2` — it never touches the ESPN live pick stream, which lives
separately in the extension's `chrome.storage.local` under `ffa.espn.live.snapshot.v1` (a key that
is per browser profile and shared across every ESPN draft tab). That key is reset automatically when
a different league id starts writing from a **foregrounded** draft tab (`applyFrameToLive`) — a
backgrounded or abandoned tab (an unfinished mock ESPN keeps autopicking server-side) is refused the
write instead of being allowed to reset the key, so it can't hijack the draft you're actually
watching (2026-08-28; two tabs both foregrounded at once, e.g. side-by-side windows, can still
race). Refusal is ownership, and ownership expires (2026-08-29): the refusal only holds while the
snapshot's heartbeat is younger than 60s — an autopicking tab heartbeats about every second, so it
keeps protection, while a finished/closed draft's stale snapshot (which the key never clears)
loses the key to the next league that starts writing, even from a hidden tab.  Also: ESPN practice drafts run INSIDE the same league, so a new practice draft reuses the previous
draft's league id and no league-change reset ever fires. A same-league JOINED or TOKEN (the
"entered a draft room" signals) therefore resets the stream when the held draft is complete
(teams x rounds picks) or its heartbeat has been silent for 30s (2026-08-29, resetReason
'draft-restart') — without this, the new draft's picks appended onto the old stream and the
(slot, playerId) dedupe dropped every reused player. A mid-draft tab refresh (fresh heartbeat,
incomplete stream) still resumes instead of resetting. Recon's **Clear** button removes the recon snapshot, the live stream key, and the league
snapshot key.

Two more self-corrections, both 2026-08-29: (1) the app can now ask the extension to drop just the
live stream key directly — `window.postMessage({ type: 'ffa.espn.reset.request', requestId }, ...)`,
replied to with `ffa.espn.reset.response` — which the Draft Room's **End draft** action fires so
abandoning a draft never leaves its picks behind for the next one to inherit; (2) a same-league DOM
reconcile that reports the on-the-clock reading back at pick 1 with zero pick rows on the page is
also treated as a restart (`resetReason: 'draft-restart'`), covering the case where a different tab
(re)joins the room and this tab only ever sees the board, never a JOINED/TOKEN of its own.

## Draft-page league settings (real scoring, not a guess)

A third snapshot, separate from both the live pick stream and the league-page capture above: the
draft page's own 30s `mDraftDetail`+`mSettings`+`mTeam` reconcile (the same fetch that backfills
missed picks — see the next section) also stores its full response under
`chrome.storage.local['ffa.espn.draftleague.snapshot.v1']`, keyed by league id, redacted the same
way as every other capture. It is a SEPARATE key from the league-page capture's
`ffa.espn.league.snapshot.v1` on purpose: a different league's draft-page capture (an ESPN mock has
its own league id) REPLACES this key wholesale, and reusing the league-page key would let tracking
a mock silently wipe a real saved league's connect-time settings.

The app relay answers it with the same shape as the league-page pair:

```js
window.postMessage({ type: 'ffa.espn.draftleague.request', requestId: 'optional-id' }, location.origin);
```

replied to with `ffa.espn.draftleague.response`. This is what lets the Draft Room show a
live-detected draft's REAL scoring and roster settings instead of a guessed PPR preset — before
this existed, the draft page's reconcile fetched the exact same payload but discarded everything
except four facts (rounds/teams/season/name), throwing away `settings.scoringSettings` and
`settings.rosterSettings` on every tick.

## Missed-pick self-correction runs regardless of tab visibility

The 30s `mDraftDetail` reconcile above used to skip entirely whenever the ESPN draft tab was
backgrounded (`document.visibilityState === 'hidden'`) — which is the NORMAL state of that tab any
time the user is looking at the assistant app. A real mock draft lost ~19 picks and never
self-corrected because of exactly this. The visibility gate is removed: the two hazards it was
guarding against are already handled inside `normalize.js` itself (the merge functions never touch
`lastHeartbeatAt`, and both refuse a league-id mismatch outright), and this specific reconcile
always re-fetches ESPN's live truth over the network rather than replaying a cached value, so a
backgrounded tab's fetch is exactly as trustworthy as a foregrounded one's.
