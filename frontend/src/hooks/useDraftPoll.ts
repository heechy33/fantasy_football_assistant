import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Cred, DraftInit, DraftPicks, ProviderAdapter } from '../../../shared/types';

export type DraftPollPhase = 'idle' | 'initializing' | 'ready' | 'init-error';

export interface DraftPollSnapshot {
  phase: DraftPollPhase;
  draftInit: DraftInit | null;
  draftPicks: DraftPicks | null;
  /** Timestamp of the most recent successful hot-path request, even when its pick content was unchanged. */
  lastSuccessfulPollAt: number | null;
  /** Timestamp when the provider's pick content last changed. */
  lastChangedAt: number | null;
  lastHttpStatus: number | null;
  retryAt: number | null;
  requestDurationMs: number | null;
  consecutiveFailures: number;
  lastError: unknown;
}

const IDLE_SNAPSHOT: DraftPollSnapshot = {
  phase: 'idle',
  draftInit: null,
  draftPicks: null,
  lastSuccessfulPollAt: null,
  lastChangedAt: null,
  lastHttpStatus: null,
  retryAt: null,
  requestDurationMs: null,
  consecutiveFailures: 0,
  lastError: null,
};

/** Health-only subset of `DraftPollSnapshot` kept in a ref so an unchanged-content poll does not
 * re-render App/DraftWorkspace. The existing 1s stale-banner tick re-renders and re-reads these. */
export interface PollHealth {
  lastSuccessfulPollAt: number | null;
  lastChangedAt: number | null;
  lastHttpStatus: number | null;
  retryAt: number | null;
  requestDurationMs: number | null;
  consecutiveFailures: number;
  lastError: unknown;
}

export const IDLE_HEALTH: PollHealth = {
  lastSuccessfulPollAt: null,
  lastChangedAt: null,
  lastHttpStatus: null,
  retryAt: null,
  requestDurationMs: null,
  consecutiveFailures: 0,
  lastError: null,
};

/** Decides whether a controller emit must land in React state. Pure health fields (poll
 * timestamps, durations, HTTP status) change every poll even when the draft is static; only pick
 * content, phase, and error/backoff state deserve a commit — returning `false` lets React bail
 * out of the render entirely. */
export function shouldCommitPollSnapshot(current: DraftPollSnapshot, next: DraftPollSnapshot): boolean {
  return next.phase !== current.phase
    || next.draftPicks !== current.draftPicks
    || next.lastChangedAt !== current.lastChangedAt
    || next.consecutiveFailures !== current.consecutiveFailures
    || next.lastError !== current.lastError
    || next.lastHttpStatus !== current.lastHttpStatus
    || next.retryAt !== current.retryAt;
}

export interface DraftPollControllerOptions {
  adapter: ProviderAdapter;
  cred: Cred;
  draftId: string;
  intervalMs?: number;
  maxBackoffMs?: number;
  /** Bound a stalled provider request so it cannot hold the serial poll loop forever. */
  requestTimeoutMs?: number;
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
  /** Stops polling and aborts any active hot-path request while the page is backgrounded. */
  notifyHidden(): void;
  /** Resumes immediately and resets backoff — call from a visibilitychange listener. */
  notifyVisible(): Promise<void>;
}

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

interface HttpLikeError {
  status?: number;
  retryAfterMs?: number | null;
}

function httpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error == null || !('status' in error)) return null;
  const value = (error as HttpLikeError).status;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function retryAfterMs(error: unknown): number | null {
  if (typeof error !== 'object' || error == null || !('retryAfterMs' in error)) return null;
  const value = (error as HttpLikeError).retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Ignores fetchedAt so a no-op response can refresh health without invalidating draft state. */
export function sameDraftPicksContent(a: DraftPicks, b: DraftPicks): boolean {
  if (a.status !== b.status || a.picks.length !== b.picks.length) return false;
  if (
    a.onTheClock?.overall !== b.onTheClock?.overall
    || a.onTheClock?.round !== b.onTheClock?.round
    || a.onTheClock?.slot !== b.onTheClock?.slot
    || a.onTheClock?.teamId !== b.onTheClock?.teamId
  ) return false;
  return a.picks.every((pick, index) => {
    const next = b.picks[index];
    return next != null
      && pick.overall === next.overall
      && pick.round === next.round
      && pick.slot === next.slot
      && pick.teamId === next.teamId
      && pick.playerId === next.playerId
      && pick.providerPlayerId === next.providerPlayerId
      && pick.providerPlayerName === next.providerPlayerName;
  });
}

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
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    onChange,
    isHidden = () => (typeof document === 'undefined' ? false : document.hidden),
    scheduleTimeout = (fn, ms) => setTimeout(fn, ms),
    clearScheduledTimeout = (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
  } = options;

  let snapshot: DraftPollSnapshot = { ...IDLE_SNAPSHOT };
  let timer: unknown = null;
  let stopped = true;
  let failures = 0;
  let nextPollId = 0;
  let activeRequest: {
    id: number;
    controller: AbortController;
    timeout: unknown | null;
    timedOut: boolean;
  } | null = null;

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

  /** Invalidates a request before aborting it. An adapter that ignores AbortSignal can still
   * settle later, but its stale response must never update state or schedule another poll. */
  function abandonActiveRequest(): void {
    const active = activeRequest;
    if (active == null) return;
    activeRequest = null;
    if (active.timeout != null) clearScheduledTimeout(active.timeout);
    active.controller.abort();
  }

  async function pollOnce(force = false): Promise<void> {
    if (stopped || (activeRequest != null && !force)) return;
    // Paused while hidden: the loop stays suspended (no wasted timer churn)
    // until notifyVisible() explicitly resumes it.
    if (isHidden()) return;

    if (force) abandonActiveRequest();
    const request = {
      id: nextPollId + 1,
      controller: new AbortController(),
      timeout: null as unknown | null,
      timedOut: false,
    };
    nextPollId = request.id;
    activeRequest = request;
    const startedAt = Date.now();
    request.timeout = scheduleTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
    }, requestTimeoutMs);
    try {
      const draftPicks = await adapter.picks(cred, draftId, request.controller.signal);
      if (stopped || activeRequest !== request) return;
      const finishedAt = Date.now();
      failures = 0;
      const changed = snapshot.draftPicks == null || !sameDraftPicksContent(snapshot.draftPicks, draftPicks);
      emit({
        draftPicks: changed ? draftPicks : snapshot.draftPicks,
        lastSuccessfulPollAt: draftPicks.fetchedAt,
        lastChangedAt: changed ? draftPicks.fetchedAt : snapshot.lastChangedAt,
        lastHttpStatus: 200,
        retryAt: null,
        requestDurationMs: Math.max(0, finishedAt - startedAt),
        consecutiveFailures: 0,
        lastError: null,
      });
      // Start-to-start cadence: request latency consumes part of the interval, but calls never overlap.
      scheduleNext(Math.max(0, intervalMs - (finishedAt - startedAt)));
    } catch (err) {
      if (stopped || activeRequest !== request) return;
      failures += 1;
      const effectiveError = request.timedOut
        ? new Error(`Draft picks request timed out after ${requestTimeoutMs}ms.`)
        : err;
      const providerRetry = httpStatus(effectiveError) === 429 ? retryAfterMs(effectiveError) : null;
      const backoff = providerRetry ?? Math.min(intervalMs * 2 ** failures, maxBackoffMs);
      const jitter = providerRetry == null ? backoff * 0.1 * Math.random() : 0;
      const delay = Math.max(intervalMs, backoff + jitter);
      emit({
        consecutiveFailures: failures,
        lastError: effectiveError,
        lastHttpStatus: httpStatus(effectiveError),
        retryAt: Date.now() + delay,
        requestDurationMs: Math.max(0, Date.now() - startedAt),
      });
      scheduleNext(delay);
    } finally {
      if (request.timeout != null) clearScheduledTimeout(request.timeout);
      if (activeRequest === request) activeRequest = null;
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
    abandonActiveRequest();
  }

  function notifyHidden(): void {
    if (stopped) return;
    clearTimer();
    abandonActiveRequest();
  }

  async function notifyVisible(): Promise<void> {
    if (stopped) return;
    failures = 0;
    clearTimer();
    await pollOnce(true);
  }

  return { start, stop, notifyHidden, notifyVisible };
}

/** Pure, so isStale/dataAgeMs are testable without rendering the hook. */
export function computeStaleness(
  lastSuccessfulPollAt: number | null,
  staleAfterMs: number,
  now: number,
): { isStale: boolean; dataAgeMs: number | null } {
  if (lastSuccessfulPollAt == null) return { isStale: false, dataAgeMs: null };
  const dataAgeMs = now - lastSuccessfulPollAt;
  return { isStale: dataAgeMs > staleAfterMs, dataAgeMs };
}

export interface UseDraftPollOptions {
  adapter: ProviderAdapter;
  cred: Cred;
  /** null = not connected yet; the hook stays idle and polls nothing. */
  draftId: string | null;
  intervalMs?: number;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
  staleAfterMs?: number;
}

export interface UseDraftPollResult extends DraftPollSnapshot {
  isStale: boolean;
  dataAgeMs: number | null;
  /** A stable live-health ref for small status-only subscribers such as the top-bar stale badge.
   * Reading it from their own timer avoids a one-second App/DraftWorkspace reconciliation. */
  healthRef: RefObject<PollHealth>;
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
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    staleAfterMs,
  } = options;
  const effectiveStaleAfterMs = staleAfterMs ?? intervalMs * 2;

  // Poll health stays outside React state: an unchanged-content poll must not re-render
  // App/DraftWorkspace. Status-only consumers can read this stable ref on their own timer.
  const healthRef = useRef<PollHealth>({ ...IDLE_HEALTH });
  const [snapshot, setSnapshot] = useState<DraftPollSnapshot>(IDLE_SNAPSHOT);
  const [reconnectToken, setReconnectToken] = useState(0);

  const reconnect = useCallback(() => setReconnectToken((t) => t + 1), []);

  useEffect(() => {
    if (draftId == null) {
      healthRef.current = { ...IDLE_HEALTH };
      setSnapshot(IDLE_SNAPSHOT);
      return;
    }
    healthRef.current = { ...IDLE_HEALTH };

    const controller = createDraftPollController({
      adapter,
      cred,
      draftId,
      intervalMs,
      maxBackoffMs,
      requestTimeoutMs,
      onChange: (next) => {
        healthRef.current = {
          lastSuccessfulPollAt: next.lastSuccessfulPollAt,
          lastChangedAt: next.lastChangedAt,
          lastHttpStatus: next.lastHttpStatus,
          retryAt: next.retryAt,
          requestDurationMs: next.requestDurationMs,
          consecutiveFailures: next.consecutiveFailures,
          lastError: next.lastError,
        };
        setSnapshot((current) => (shouldCommitPollSnapshot(current, next) ? next : current));
      },
    });
    void controller.start();

    function handleVisibilityChange() {
      if (document.hidden) controller.notifyHidden();
      else void controller.notifyVisible();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // draftId/reconnectToken intentionally drive a full restart; adapter/cred
    // identity changes also restart the poll (they select what's being polled).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, cred, draftId, intervalMs, maxBackoffMs, requestTimeoutMs, reconnectToken]);

  const { isStale, dataAgeMs } = computeStaleness(healthRef.current.lastSuccessfulPollAt, effectiveStaleAfterMs, Date.now());

  return { ...snapshot, ...healthRef.current, isStale, dataAgeMs, healthRef, reconnect };
}
