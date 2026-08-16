import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftInit, DraftPicks, EspnDomPick, EspnLiveSnapshot } from '../../../shared/types';
import { deriveEspnStreamOffsetSync, espnAdapter, espnSeatMismatch } from '../adapters/espn';
import { deriveEspnDraftOrder } from '../adapters/espnDraftOrder';
import { requestEspnSnapshot } from '../adapters/espnBridge';

const POLL_MS = 1000;
/** Heartbeat-age thresholds (ms), matching the ESPN plan's "stale vs disconnected" split. */
const STALE_MS = 10000;
const DISCONNECTED_MS = 15000;
/** Consecutive missed relay responses before flipping "extension present" off — absorbs several
 * dropped postMessage round-trips instead of flickering the connect UI. A content-script
 * `chrome.storage.local.get` round trip on a busy draft page can occasionally miss the per-request
 * timeout below without the extension actually being gone, so this stays close to the ~5s window
 * the previous polling design tolerated (12s / 2500ms cadence), not a hair-trigger 2 misses. */
const MISS_STREAK_THRESHOLD = 5;

export type EspnBridgeStatus =
  | 'no-extension'
  | 'no-espn-tab'
  /** The relay stopped responding after it had already delivered at least one live snapshot this
   * session — almost always the unpacked extension being reloaded in chrome://extensions while the
   * app tab stayed open (its content-script context is invalidated and app-content.js silently
   * stops answering). Distinct from 'no-extension' so the fix ("reload this page and the ESPN tab")
   * isn't confused with "the extension isn't installed". */
  | 'relay-silent'
  | 'live'
  | 'stale'
  | 'disconnected';

/** FNV-1a (32-bit) over every DOM row's pickNumber + collapsed text. Unlike `streamPicks` (append-only),
 * the extension's `applyDomPicks` REPLACES rows in place by pickNumber, so a row whose text changes —
 * e.g. a row first captured mid-render that later gains its position token, or the D/ST row Step B's
 * DOM resolution depends on — must still invalidate the memo even when length/max pick number are
 * unchanged. Length is prefixed into the signature so it is encoded too. */
function domPicksSignature(rows: readonly EspnDomPick[]): string {
  if (rows.length === 0) return '';
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (const row of rows) {
    hash ^= row.pickNumber;
    hash = Math.imul(hash, 0x01000193);
    const text = row.text ?? '';
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `${rows.length}:${hash >>> 0}`;
}

/**
 * A scalar signature of everything in `live` that can actually change `init`/`picks`/`seatMismatch`
 * — deliberately excluding `lastHeartbeatAt`, which changes on ~every 1Hz CLOCK frame and would
 * otherwise give `live` a new identity every poll regardless of whether anything material changed.
 * `streamPicks` only ever grows by append (`applyFrameToLive` skips a resend already present), so
 * length + the last pick's id is sufficient without hashing the whole array every tick. `domPicks`
 * is NOT append-only, so its rows are content-hashed (pickNumber + text) instead of just counted.
 */
function materialKeyFor(live: EspnLiveSnapshot | null): string {
  if (!live) return '';
  const picks = live.streamPicks;
  const lastPickId = picks.length ? picks[picks.length - 1]!.playerId : '';
  // epoch is included so a league-change reset invalidates init/picks even if the new league's
  // stream happens to be exactly as deep as the old one was (length alone could look unchanged).
  // The Step 7 resume-detection fields are included too: domMaxAtStreamStart/domSampledBeforeStream
  // feed the offset derivation directly (see espnOffset.ts), currentPickNumber changes roughly once
  // per pick (not on every ~1Hz heartbeat, since only a real DOM reconcile updates it), and
  // resetReason distinguishes a schema-version resume from a league change. Anything not listed here
  // is invisible to init/picks/seatMismatch — they're only ever recomputed off this signature.
  return [
    live.epoch ?? 0, live.leagueId, live.mySlot, picks.length, lastPickId,
    domPicksSignature(live.domPicks ?? []),
    live.domMaxAtStreamStart ?? '', live.domMaxSeen ?? 0, live.domSampledBeforeStream ?? false,
    live.currentPickNumber ?? '', live.resetReason ?? '',
  ].join('|');
}

export interface UseEspnBridgeResult {
  /** True while the extension relay answers polls (it answers regardless of ESPN socket state). */
  extensionPresent: boolean;
  /** The latest relayed live snapshot (uncapped, ordered streamPicks). */
  live: EspnLiveSnapshot | null;
  /** The ESPN-stamped DraftInit: form settings stay authoritative — mySlot is the typed draft
   * position, and JOINED/TOKEN only stamps leagueId. */
  init: DraftInit | null;
  /** Canonical picks normalized from the live stream, plus the bridge's own desync diagnostic. */
  picks: DraftPicks | null;
  lastHeartbeatAt: number | null;
  /** ms since the last heartbeat, recomputed every ~1s even between new snapshots. Null pre-beat. */
  dataAgeMs: number | null;
  status: EspnBridgeStatus;
  /** status is 'stale' or 'disconnected' — mirrors useDraftPoll's isStale for DataHealth. */
  isStale: boolean;
  /** Pick-resolution failures from `espnAdapter.picks()` (e.g. a crosswalk load error). Lifecycle is
   * independent of the relay poll: a healthy relay tick must never clear a real adapter error, and a
   * successful pick resolution clears it. */
  pickError: string | null;
  /** Relay-owned diagnostics — currently only the pinned-leagueId-changed warning. Recomputed every
   * healthy poll (so it clears itself once the mismatch resolves), never touched by pick resolution. */
  relayWarning: string | null;
  /** Non-null when the ESPN team id's derived draft position disagrees with the typed slot — the
   * guard that would have caught the 2026-08-15 rehearsal bug live. */
  seatMismatch: string | null;
}

/**
 * Polls the ESPN extension relay on the app origin (window.postMessage, served by the extension's
 * app-content.js). This is a LOCAL snapshot read, not an upstream GET — the relay hands back the
 * extension's chrome.storage live snapshot.
 *
 * Polling runs unconditionally (even with no ESPN session active) so a connect screen can show
 * extension/tab presence before the user commits to the bridge. `init`/`picks` resolution only
 * runs once `base` (the manual-form DraftInit) is supplied, i.e. once a bridge session is active.
 */
export function useEspnBridge(base: DraftInit | null): UseEspnBridgeResult {
  const [live, setLive] = useState<EspnLiveSnapshot | null>(null);
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [picks, setPicks] = useState<DraftPicks | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [relayWarning, setRelayWarning] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const missStreakRef = useRef(0);
  const runningRef = useRef(false);
  /** True once ANY live snapshot has been received this session. Distinguishes 'no-extension'
   * (never connected) from 'relay-silent' (was connected, then the relay stopped answering — e.g.
   * the unpacked extension was reloaded while this tab stayed open). */
  const hadLiveRef = useRef(false);
  /** First observed ESPN leagueId, pinned for the session. A later change is followed silently only
   * when the extension reset for a new league (epoch bumped or the stream collapsed) — a clean
   * "closed old mock, opened new mock" switch. A league change WITHOUT that signal (the extension
   * could not reset) is a real pick-attribution hazard, so it is surfaced as a warning, not
   * silently followed — but the snapshot is still accepted, since rejecting it outright would drop
   * picks on a false positive (the relay key is shared across any ESPN tab on the origin). */
  const pinnedLeagueIdRef = useRef<string | null>(null);
  /** The extension's last-observed draft epoch (its league-change reset counter) and the last
   * streamPicks length. An epoch increase is the unambiguous "extension reset for a new league"
   * signal; a length collapse is the fallback for a manually-cleared key (the epoch restarted at
   * 0), so a legitimate same-tab switch is followed either way instead of warned at. */
  const lastEpochRef = useRef(0);
  const lastStreamLenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const response = await requestEspnSnapshot();
        if (cancelled) return;
        setNow(Date.now());
        if (!response.responded) {
          missStreakRef.current += 1;
          if (missStreakRef.current >= MISS_STREAK_THRESHOLD) setExtensionPresent(false);
          return;
        }
        missStreakRef.current = 0;
        setExtensionPresent(true);
        if (response.live) {
          hadLiveRef.current = true;
          const leagueId = response.live.leagueId;
          const epoch = response.live.epoch ?? 0;
          const streamLen = response.live.streamPicks?.length ?? 0;
          const epochIncreased = epoch > lastEpochRef.current;
          if (epoch !== lastEpochRef.current) lastEpochRef.current = epoch;
          // A clean switch: the extension reset for a new league (epoch bumped), or the stream
          // collapsed after a manually-cleared key (epoch restarted at 0). Either way, follow the
          // new league and clear the warning. Warn only when the league changed with NO reset
          // signal — that is the real second-tab hazard the extension could not clean up.
          const cleanSwitch = epochIncreased || streamLen < lastStreamLenRef.current;
          lastStreamLenRef.current = streamLen;
          if (pinnedLeagueIdRef.current == null) {
            pinnedLeagueIdRef.current = leagueId;
            setRelayWarning(null);
          } else if (leagueId && leagueId !== pinnedLeagueIdRef.current) {
            if (cleanSwitch) {
              pinnedLeagueIdRef.current = leagueId;
              setRelayWarning(null);
            } else {
              setRelayWarning(
                `ESPN league id changed mid-session (${pinnedLeagueIdRef.current} -> ${leagueId}) — is a second draft tab open?`,
              );
            }
          } else {
            setRelayWarning(null);
          }
          setLive(response.live);
        } else {
          // Relay answered but has no ESPN snapshot (no draft tab open, or the socket hasn't sent a
          // frame yet) — clear any held snapshot rather than continuing to show a stale one.
          setLive(null);
        }
      } finally {
        runningRef.current = false;
      }
    }

    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // A new base means a fresh session context (handleEspnSetupSubmit / handleManualSetupEdit): drop
  // the pinned league so the next poll re-pins to whatever league the extension is currently
  // serving, instead of inheriting a stale league from the previous session and warning on a
  // legitimate same-tab switch. Harmless on an edit — the same league simply re-pins, no warning.
  useEffect(() => {
    pinnedLeagueIdRef.current = null;
    lastStreamLenRef.current = 0;
  }, [base]);

  // `live` gets a new object identity on every ~1s poll (lastHeartbeatAt always changes), which
  // would otherwise cancel and restart the Stage C rollout every second for the entire time the
  // user is on the clock (see the ESPN plan's D1). `material` only changes identity when something
  // that actually affects init/picks/seatMismatch changes, keyed on a cheap scalar signature.
  const materialKey = materialKeyFor(live);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => live, [materialKey]);

  const init = useMemo(() => (base ? espnAdapter.init(base, material) : null), [base, material]);

  /** Seat cross-check: does the typed draft position match the position the stream's own order
   * assigns to your ESPN team id? Warns on disagreement — never a silent override. Uses the
   * no-index (board-empty-only) offset derivation, same as `init`'s slotToTeamName enrichment —
   * this hook has no async player-pool index handy, and the common case this guards (before/at
   * pick 1) is exactly the case that offset derivation confirms. */
  const seatMismatch = useMemo(() => {
    if (!base || !material) return null;
    const offset = deriveEspnStreamOffsetSync(material);
    const order = deriveEspnDraftOrder(material.streamPicks, base.teams, base.draftType, offset);
    return espnSeatMismatch(material, order, base.mySlot);
  }, [base, material]);

  useEffect(() => {
    if (!base || !init) return;
    let active = true;
    espnAdapter.picks(init, material)
      .then((result) => { if (active) { setPicks(result); setPickError(null); } })
      .catch((err: unknown) => {
        if (active) setPickError(err instanceof Error ? err.message : 'Bridge pick resolution failed.');
      });
    return () => { active = false; };
  }, [base, init, material]);

  const lastHeartbeatAt = live?.lastHeartbeatAt ?? null;
  const dataAgeMs = lastHeartbeatAt == null ? null : now - lastHeartbeatAt;

  const status: EspnBridgeStatus = !extensionPresent
    ? (hadLiveRef.current ? 'relay-silent' : 'no-extension')
    : !live
      ? 'no-espn-tab'
      : dataAgeMs != null && dataAgeMs > DISCONNECTED_MS
        ? 'disconnected'
        : dataAgeMs != null && dataAgeMs > STALE_MS
          ? 'stale'
          : 'live';

  return {
    extensionPresent,
    live,
    init,
    picks,
    lastHeartbeatAt,
    dataAgeMs,
    status,
    isStale: status === 'stale' || status === 'disconnected',
    pickError,
    relayWarning,
    seatMismatch,
  };
}
