// MAIN-world observer: inspect incoming ESPN transport, never outgoing requests, headers, cookies,
// query strings, or raw frames. Text and bounded binary frames are decoded so recon can learn the
// real draft frame format; only redacted, draft-shaped JSON or a bounded frame preview crosses to
// the isolated relay.
(() => {
  'use strict';
  const EVENT = 'ffa-espn-recon-candidate';
  const SENSITIVE = /(?:authorization|cookie|token|password|secret|session|swid|espn_s2|s2|chat|message|conversation)/i;
  const FRAME_JSON_MAX = 250000; // chars: larger text frames are metadata-only observations
  // League-API responses are bigger than socket frames and legitimately reach several hundred KB;
  // dropping them at 250k would silently kill the whole league-capture feature, so the leagues
  // tree gets its own (much larger) ceiling. Recon should confirm real sizes (Phase 1a).
  const LEAGUE_JSON_MAX = 2000000;
  const isLeagueApiUrl = (url) => typeof url === 'string' && /apis\/v3\/games\/ffl\/seasons\/[^/]+\/segments\/[^/]+\/leagues/i.test(url);
  const FRAME_BINARY_MAX = 200000; // bytes: larger binary frames are metadata-only observations
  const cleanUrl = (value) => { if (typeof value !== 'string' || !value) return null; try { const url = new URL(value, location.href); return `${url.origin}${url.pathname}`; } catch { return null; } };
  // Verified route from recon (2026-08-15): the draft app calls lm-api-reads.fantasy.espn.com at
  // /apis/v3/games/ffl/seasons/<season> and its /segments/<seg>/leagues children. Only this exact ffl
  // seasons tree plus /football is allowed — never a wildcard espn.com path.
  const isDraftUrl = (url) => { try { const parsed = new URL(url); return /(^|\.)espn\.com$/i.test(parsed.hostname) && /\/(?:football|apis\/v3\/games\/ffl\/seasons\/[^/]+(?:\/segments\/[^/]+\/leagues(?:\/[^/]+)?)?)/i.test(parsed.pathname); } catch { return false; } };
  const isEspnHost = (url) => { try { return /(^|\.)espn\.com$/i.test(new URL(url).hostname); } catch { return false; } };
  const rejectedUrls = []; const REJECTED_URL_MAX = 50;
  const recordRejected = (clean) => { if (!clean || !isEspnHost(clean) || rejectedUrls.includes(clean) || rejectedUrls.length >= REJECTED_URL_MAX) return; rejectedUrls.push(clean.slice(0, 160)); };

  // Depth ceiling: roster data on the league-API branch sits at teams[]→team→roster→entries→
  // entry→playerPoolEntry→player (depth 7) and player stats a couple levels deeper — past the
  // frame-branch cut of 8, which silently turned whole rosters into '[truncated-depth]'. The
  // ceiling is raised ONLY for league-API responses (isLeagueApiUrl); socket frames keep the
  // tight cut. The 320-element array cap (scoringItems alone is ~180) and the 500-char string
  // cap are unchanged, and SENSITIVE is not loosened.
  const FRAME_REDACT_MAX_DEPTH = 8;
  const LEAGUE_REDACT_MAX_DEPTH = 12;
  function redact(value, depth = 0, maxDepth = FRAME_REDACT_MAX_DEPTH) {
    if (depth > maxDepth) return '[truncated-depth]';
    if (typeof value === 'string') return value.slice(0, 500);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 320).map((item) => redact(item, depth + 1, maxDepth));
    if (!value || typeof value !== 'object') return undefined;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const safe = SENSITIVE.test(key) ? undefined : redact(item, depth + 1, maxDepth);
      return safe === undefined ? [] : [[key, safe]];
    }));
  }
  function observe(transport, direction, url, raw, frameType, byteLength) {
    const clean = cleanUrl(url);
    if (!clean) return;
    // The WebSocket path is unknown until recon observes it, so accept any espn.com socket opened by
    // this draft page; fetch/XHR stay on the known draft-API path to keep unrelated bodies out.
    const allowed = transport === 'websocket' ? isEspnHost(clean) : isDraftUrl(clean);
    if (!allowed) { if (transport !== 'websocket') recordRejected(clean); return; }
    // Discovery log (2026-08-28): every captured URL, so a page view (e.g. Draft Recap) whose
    // rounds data lives on an endpoint we don't key on is visible in the page console immediately.
    console.info(`[ffa] capture: ${transport} ${clean}${typeof raw === 'string' ? ` (${raw.length}b)` : ''}`);
    let payload = null;
    let frame = null;
    const jsonMax = isLeagueApiUrl(clean) ? LEAGUE_JSON_MAX : FRAME_JSON_MAX;
    if (typeof raw === 'string' && raw.length <= jsonMax) {
      // Recon must learn the real frame shape before any format is assumed, so websocket frames skip
      // the draft-keyword gate: JSON whose field names lack draft/pick/league must not be dropped.
      // fetch/XHR bodies stay keyword-gated because their URLs are already narrowed to draft-API paths.
      const wantsFrame = transport === 'websocket' || /(?:draft|pick|league|roster|scoring)/i.test(raw);
      if (wantsFrame) {
        const maxDepth = isLeagueApiUrl(clean) ? LEAGUE_REDACT_MAX_DEPTH : FRAME_REDACT_MAX_DEPTH;
        try { payload = redact(JSON.parse(raw), 0, maxDepth); }
        catch { frame = redact(raw.slice(0, 1000)) || null; } // bounded, redacted preview of the frame shape only
      }
    }
    const kind = payload ? 'draft-json' : (frame ? 'frame' : 'transport');
    window.postMessage({ type: EVENT, kind, transport, direction, url: clean, payload, frame, frameType, byteLength, rejectedUrls: rejectedUrls.slice() }, location.origin);
  }
  const nativeFetch = window.fetch;
  window.fetch = function ffaReconFetch(input) {
    const response = nativeFetch.apply(this, arguments); const url = typeof input === 'string' ? input : input?.url;
    Promise.resolve(response).then((resolved) => {
      const clean = cleanUrl(url || resolved.url); if (!clean) return; if (!isDraftUrl(clean)) { recordRejected(clean); return; }
      resolved.clone().text().then((body) => observe('fetch', 'response', clean, body, 'text', body.length)).catch(() => observe('fetch', 'response', clean, null, null, null));
    }).catch(() => {});
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open; const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function ffaReconOpen(method, url) { this.__ffaReconUrl = cleanUrl(url); return nativeOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function ffaReconSend() { this.addEventListener('loadend', () => observe('xhr', 'response', this.__ffaReconUrl, this.responseText, 'text', this.responseText.length)); return nativeSend.apply(this, arguments); };
  const NativeWebSocket = window.WebSocket;
  function observeBinaryFrame(url, bytes, frameType) {
    const byteLength = bytes.byteLength;
    if (byteLength === 0) { observe('websocket', 'incoming', url, '', frameType, 0); return; }
    if (byteLength > FRAME_BINARY_MAX) { observe('websocket', 'incoming', url, null, frameType, byteLength); return; }
    try { observe('websocket', 'incoming', url, new TextDecoder('utf-8').decode(bytes), frameType, byteLength); }
    catch { observe('websocket', 'incoming', url, null, frameType, byteLength); }
  }
  function ReconWebSocket(url, protocols) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    socket.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') observe('websocket', 'incoming', url, data, 'text', data.length);
      else if (data instanceof Blob) {
        const byteLength = data.size;
        if (byteLength > FRAME_BINARY_MAX) observe('websocket', 'incoming', url, null, 'blob', byteLength);
        else data.text().then((text) => observe('websocket', 'incoming', url, text, 'blob', byteLength)).catch(() => observe('websocket', 'incoming', url, null, 'blob', byteLength));
      } else if (data instanceof ArrayBuffer) observeBinaryFrame(url, data, 'arraybuffer');
      else if (data && typeof data === 'object' && typeof data.byteLength === 'number' && data.buffer instanceof ArrayBuffer) observeBinaryFrame(url, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), 'view');
      else observe('websocket', 'incoming', url, null, 'other', null);
    });
    return socket;
  }
  ReconWebSocket.prototype = NativeWebSocket.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) ReconWebSocket[key] = NativeWebSocket[key];
  window.WebSocket = ReconWebSocket;
})();
