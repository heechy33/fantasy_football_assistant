import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftInit, DraftPicks, EspnLiveSnapshot } from '../../../shared/types';
import { espnAdapter } from '../adapters/espn';

const REQUEST = 'ffa.espn.snapshot.request';
const RESPONSE = 'ffa.espn.snapshot.response';
const POLL_MS = 2500;
/** No relay response for this long (ms) means the extension is not installed/enabled on this page. */
const EXTENSION_GONE_MS = 12000;

export interface UseEspnBridgeResult {
  /** True while the extension relay answers polls (it answers regardless of ESPN socket state). */
  extensionPresent: boolean;
  /** The latest relayed live snapshot (uncapped, ordered streamPicks). */
  live: EspnLiveSnapshot | null;
  /** The ESPN-stamped DraftInit: form settings + JOINED/TOKEN mySlot (and leagueId) override. */
  init: DraftInit | null;
  /** Canonical picks normalized from the live stream (playerId null + name for unmatched). */
  picks: DraftPicks | null;
  lastHeartbeatAt: number | null;
  lastError: string | null;
}

/**
 * Polls the ESPN extension relay on the app origin (window.postMessage, served by the extension's
 * app-content.js). This is a LOCAL snapshot read, not an upstream GET — the relay hands back the
 * extension's chrome.storage live snapshot. Polling only runs while `base` (the manual-form
 * DraftInit) is provided, i.e. while a bridge session is active.
 */
export function useEspnBridge(base: DraftInit | null): UseEspnBridgeResult {
  const [live, setLive] = useState<EspnLiveSnapshot | null>(null);
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [picks, setPicks] = useState<DraftPicks | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const lastResponseAtRef = useRef(0);

  // Relay responses arrive on the app window itself (app-content.js posts to location.origin).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.type !== RESPONSE) return;
      const payload = event.data?.live;
      if (typeof payload?.schemaVersion === 'number' && Array.isArray(payload?.streamPicks)) {
        lastResponseAtRef.current = Date.now();
        setExtensionPresent(true);
        setLive(payload as EspnLiveSnapshot);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!base) return;
    requestIdRef.current += 1;
    window.postMessage({ type: REQUEST, requestId: String(requestIdRef.current) }, location.origin);
    const poll = setInterval(() => {
      requestIdRef.current += 1;
      window.postMessage({ type: REQUEST, requestId: String(requestIdRef.current) }, location.origin);
    }, POLL_MS);
    // Presence flips only on a real change, so the UI cannot sit on a stale "connected" state.
    const presence = setInterval(() => {
      setExtensionPresent((previous) => {
        const next = Date.now() - lastResponseAtRef.current < EXTENSION_GONE_MS;
        return next === previous ? previous : next;
      });
    }, 1000);
    return () => { clearInterval(poll); clearInterval(presence); };
  }, [base]);

  const init = useMemo(() => (base ? espnAdapter.init(base, live) : null), [base, live]);

  useEffect(() => {
    if (!base || !init) return;
    let active = true;
    espnAdapter.picks(init, live)
      .then((result) => { if (active) setPicks(result); })
      .catch((err: unknown) => {
        if (active) setLastError(err instanceof Error ? err.message : 'Bridge pick resolution failed.');
      });
    return () => { active = false; };
  }, [base, init, live]);

  return {
    extensionPresent,
    live,
    init,
    picks,
    lastHeartbeatAt: live?.lastHeartbeatAt ?? null,
    lastError,
  };
}
