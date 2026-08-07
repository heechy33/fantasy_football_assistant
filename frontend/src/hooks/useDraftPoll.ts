import { useCallback, useEffect, useState } from 'react';
import type { Cred, DraftInit, DraftPicks, ProviderAdapter } from '../../../shared/types';

export type DraftPollPhase = 'idle' | 'initializing' | 'ready' | 'init-error';

export interface DraftPollSnapshot {
  phase: DraftPollPhase;
  draftInit: DraftInit | null;
  draftPicks: DraftPicks | null;
  consecutiveFailures: number;
  lastError: unknown;
}

const IDLE_SNAPSHOT: DraftPollSnapshot = {
  phase: 'idle',
  draftInit: null,
  draftPicks: null,
  consecutiveFailures: 0,
  lastError: null,
};

export interface DraftPollControllerOptions {
  adapter: ProviderAdapter;
  cred: Cred;
  draftId: string;
  intervalMs?: number;
  maxBackoffMs?: number;
  onChange: (snapshot: DraftPollSnapshot) => void;
  /** Injected for testability; defaults to `document.hidden`. */
  isHidden?: () => boolean;
  /** Injected for testability; defaults to the real `setTimeout`. */
  scheduleTimeout?: (fn: () => void, ms: number) => unknown;
  clearScheduledTimeout?: (handle: unknown) => void;
}

export interface DraftPollController {
  /** Runs init() then the first picks() poll. Returned promise settles once that first cycle is done. */
  start(): Promise<void>;
  stop(): void;
  /** Resumes immediately and resets backoff — call from a visibilitychange listener. */
  notifyVisible(): Promise<void>;
}

const DEFAULT_INTERVAL_MS = 2500;
const DEFAULT_MAX_BACKOFF_MS = 30000;

/**
 * Framework-free self-scheduling poll loop (never overlapping calls —
 * the next poll is only scheduled after the previous one settles).
 * Exported standalone so the polling/backoff/visibility logic is unit
 * testable without React or a component-testing dependency; `useDraftPoll`
 * below is a thin subscriber.
 */
export function createDraftPollController(options: DraftPollControllerOptions): DraftPollController {
  const {
    adapter,
    cred,
    draftId,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    onChange,
    isHidden = () => (typeof document === 'undefined' ? false : document.hidden),
    scheduleTimeout = (fn, ms) => setTimeout(fn, ms),
    clearScheduledTimeout = (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
  } = options;

  let snapshot: DraftPollSnapshot = { ...IDLE_SNAPSHOT };
  let timer: unknown = null;
  let stopped = true;
  let failures = 0;

  function emit(patch: Partial<DraftPollSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    onChange(snapshot);
  }

  function clearTimer() {
    if (timer != null) {
      clearScheduledTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext(delay: number) {
    clearTimer();
    if (stopped) return;
    timer = scheduleTimeout(() => void pollOnce(), delay);
  }

  async function pollOnce(): Promise<void> {
    if (stopped) return;
    // Paused while hidden: the loop stays suspended (no wasted timer churn)
    // until notifyVisible() explicitly resumes it.
    if (isHidden()) return;

    try {
      const draftPicks = await adapter.picks(cred, draftId);
      if (stopped) return;
      failures = 0;
      emit({ draftPicks, consecutiveFailures: 0, lastError: null });
      scheduleNext(intervalMs);
    } catch (err) {
      if (stopped) return;
      failures += 1;
      const backoff = Math.min(intervalMs * 2 ** failures, maxBackoffMs);
      const jitter = backoff * 0.1 * Math.random();
      emit({ consecutiveFailures: failures, lastError: err });
      scheduleNext(backoff + jitter);
    }
  }

  async function start(): Promise<void> {
    stopped = false;
    failures = 0;
    emit({ ...IDLE_SNAPSHOT, phase: 'initializing' });
    try {
      const draftInit = await adapter.init(cred, draftId);
      if (stopped) return;
      emit({ phase: 'ready', draftInit });
      await pollOnce();
    } catch (err) {
      if (stopped) return;
      emit({ phase: 'init-error', lastError: err });
    }
  }

  function stop(): void {
    stopped = true;
    clearTimer();
  }

  async function notifyVisible(): Promise<void> {
    if (stopped) return;
    failures = 0;
    clearTimer();
    await pollOnce();
  }

  return { start, stop, notifyVisible };
}

/** Pure, so isStale/dataAgeMs are testable without rendering the hook. */
export function computeStaleness(
  draftPicks: DraftPicks | null,
  staleAfterMs: number,
  now: number,
): { isStale: boolean; dataAgeMs: number | null } {
  if (!draftPicks) return { isStale: false, dataAgeMs: null };
  const dataAgeMs = now - draftPicks.fetchedAt;
  return { isStale: dataAgeMs > staleAfterMs, dataAgeMs };
}

export interface UseDraftPollOptions {
  adapter: ProviderAdapter;
  cred: Cred;
  /** null = not connected yet; the hook stays idle and polls nothing. */
  draftId: string | null;
  intervalMs?: number;
  maxBackoffMs?: number;
  staleAfterMs?: number;
}

export interface UseDraftPollResult extends DraftPollSnapshot {
  isStale: boolean;
  dataAgeMs: number | null;
  /** Re-runs init() + picks() from scratch. Safe: Sleeper's picks endpoint always returns the full array, never a delta. */
  reconnect: () => void;
}

export function useDraftPoll(options: UseDraftPollOptions): UseDraftPollResult {
  const {
    adapter,
    cred,
    draftId,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    staleAfterMs,
  } = options;
  const effectiveStaleAfterMs = staleAfterMs ?? intervalMs * 2;

  const [snapshot, setSnapshot] = useState<DraftPollSnapshot>(IDLE_SNAPSHOT);
  const [reconnectToken, setReconnectToken] = useState(0);
  const [, forceTick] = useState(0);

  const reconnect = useCallback(() => setReconnectToken((t) => t + 1), []);

  useEffect(() => {
    if (draftId == null) {
      setSnapshot(IDLE_SNAPSHOT);
      return;
    }

    const controller = createDraftPollController({
      adapter,
      cred,
      draftId,
      intervalMs,
      maxBackoffMs,
      onChange: setSnapshot,
    });
    void controller.start();

    function handleVisibilityChange() {
      if (!document.hidden) void controller.notifyVisible();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // draftId/reconnectToken intentionally drive a full restart; adapter/cred
    // identity changes also restart the poll (they select what's being polled).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, cred, draftId, intervalMs, maxBackoffMs, reconnectToken]);

  // No new poll is required for the stale banner to keep advancing with the clock.
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { isStale, dataAgeMs } = computeStaleness(snapshot.draftPicks, effectiveStaleAfterMs, Date.now());

  return { ...snapshot, isStale, dataAgeMs, reconnect };
}
