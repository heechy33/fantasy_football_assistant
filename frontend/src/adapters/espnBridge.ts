import type { EspnLiveSnapshot } from '../../../shared/types';

// Protocol-channel constants (Step 7c note): mirrored as plain-JS literals in
// extension/src/app-content.js (same REQUEST / RESPONSE strings). The storage keys live in
// extension/src/normalize.js (LIVE_STORAGE_KEY). Keep the three sites in sync.
const REQUEST = 'ffa.espn.snapshot.request';
const RESPONSE = 'ffa.espn.snapshot.response';
// A content-script chrome.storage.local.get round trip can occasionally run long on a busy draft
// page; 400ms was tight enough that two ordinary slow polls in a row (~2s total, given the 1s poll
// cadence in useEspnBridge) could flip "extension present" off mid-draft. 900ms stays comfortably
// under the 1000ms poll interval so a stuck request never overlaps the next tick (useEspnBridge's
// runningRef also guards against overlap), while giving a slow round trip real room to land.
const DEFAULT_TIMEOUT_MS = 900;

export interface EspnBridgeResponse {
  /**
   * False only on timeout — no relay answered on this page within `timeoutMs`. That is the
   * "extension not installed/enabled here" signal: a real app-content.js relay always answers
   * (even with `live: null` when no ESPN snapshot exists yet), so silence is the only case a
   * missing extension produces.
   */
  responded: boolean;
  /** Null both on timeout and when the extension answered but has no live snapshot yet
   * (no ESPN draft tab open, or the socket hasn't sent a frame). Callers must not conflate the
   * two — `responded` disambiguates them. */
  live: EspnLiveSnapshot | null;
}

function isLiveSnapshot(value: unknown): value is EspnLiveSnapshot {
  const record = value as { schemaVersion?: unknown; streamPicks?: unknown } | null | undefined;
  return typeof record?.schemaVersion === 'number' && Array.isArray(record?.streamPicks);
}

/**
 * One round-trip to the extension's app-content.js relay (window.postMessage, same-origin only).
 * Resolves on the matching RESPONSE (by requestId — postMessage promises can otherwise arrive
 * out of order if a slow chrome.storage.local.get overlaps a fast one) or on timeout.
 */
export function requestEspnSnapshot(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EspnBridgeResponse> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;

    function finish(result: EspnBridgeResponse) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type !== RESPONSE || event.data?.requestId !== requestId) return;
      const payload = event.data?.live;
      finish({ responded: true, live: payload == null ? null : (isLiveSnapshot(payload) ? payload : null) });
    }

    const timer = setTimeout(() => finish({ responded: false, live: null }), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: REQUEST, requestId }, location.origin);
  });
}
