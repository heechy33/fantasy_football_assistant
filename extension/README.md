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
