import { startTransition, useEffect, useRef, useState } from 'react';
import type { RecommendationResult } from '../engine/recommend';
import {
  applyStageCPatch,
  type RecommendationWorkerDynamicInput,
  type RecommendationWorkerRequest,
  type RecommendationWorkerResponse,
  type RecommendationWorkerTimings,
} from '../engine/recommendationWorkerProtocol';
import type { AdpBoardKey } from '../data/adpBoard';
import type { AdpFormat } from '../data/loadPlayerPool';

export type RecommendationRefinementStatus =
  | 'idle'
  | 'base-ready'
  | 'refining'
  | 'refined'
  | 'refinement-error';

export interface RecommendationRefinement {
  status: RecommendationRefinementStatus;
  result: RecommendationResult | null;
  error: string | null;
  timings: RecommendationWorkerTimings | null;
  workerReady: boolean;
}

interface UseRecommendationRefinementInput {
  enabled: boolean;
  requestKey: string;
  /** Which ADP board the worker should load (the key travels, not the provider string). */
  adpBoardKey: AdpBoardKey;
  /** Fallback board selector for the worker's `fetchAdpBoard` (see `RecommendationWorkerRequest.init`). */
  adpFormat: AdpFormat;
  input: RecommendationWorkerDynamicInput | null;
}

interface RefinementSnapshot {
  requestId: number;
  requestKey: string;
  status: 'refining' | 'refined' | 'refinement-error';
  result: RecommendationResult | null;
  error: string | null;
  timings: RecommendationWorkerTimings | null;
}

function sameDraftRequest(a: string, b: string): boolean {
  return a.split('|', 1)[0] === b.split('|', 1)[0];
}

export function useRecommendationRefinement({
  enabled,
  requestKey,
  adpBoardKey,
  adpFormat,
  input,
}: UseRecommendationRefinementInput): RecommendationRefinement {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const staticVersionRef = useRef(0);
  const adpBoardKeyRef = useRef<AdpBoardKey | null>(null);
  const latestRequestIdRef = useRef(0);
  const latestRequestKeyRef = useRef('');
  const [workerReady, setWorkerReady] = useState(false);
  const [snapshot, setSnapshot] = useState<RefinementSnapshot | null>(null);

  /** Tells the worker to stop a request it may still be refining. Idempotent and safe to repeat:
   * the worker only ever advances `cancelledRequestId` upward. */
  function postCancel(worker: Worker, requestId: number): void {
    if (requestId <= 0) return;
    const cancelMessage: RecommendationWorkerRequest = {
      type: 'cancel',
      requestId,
      staticVersion: staticVersionRef.current,
    };
    worker.postMessage(cancelMessage);
  }

  // Long-lived worker: created once, terminated only on unmount. It re-fetches its private pool
  // only for a board-key change (Sleeper ↔ ESPN board, or a format switch), so the main thread
  // never clones a player/projection payload.
  useEffect(() => {
    if (typeof Worker === 'undefined') return;

    const worker = new Worker(new URL('../workers/recommendation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<RecommendationWorkerResponse>) => {
      if (workerRef.current !== worker) return;
      const message = event.data;
      if (message.type === 'ready') {
        if (message.staticVersion === staticVersionRef.current) setWorkerReady(true);
        return;
      }
      if (message.type === 'error' && message.requestId == null) {
        setWorkerReady(false);
        return;
      }
      // Drop responses computed against superseded static data or a stale request. The worker
      // cooperatively cancels the older job's Stage C, so this is normally just the tail of a
      // racing burst — but it must never surface an out-of-date board.
      if (message.staticVersion !== staticVersionRef.current) return;
      if (message.requestId !== latestRequestIdRef.current || message.requestKey !== latestRequestKeyRef.current) return;
      if (message.type === 'result' && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[recommendation-worker] ${message.phase} queueMs=${message.timings.queueMs} computeMs=${message.timings.computeMs.toFixed(1)} totalMs=${message.timings.totalMs.toFixed(1)}`);
      }
      if (message.type === 'error') {
        setSnapshot((current) => current == null
          ? current
          : { ...current, status: 'refinement-error', error: message.message });
        return;
      }
      if (message.phase === 's2') {
        setSnapshot((current) => {
          if (current == null) return current;
          return {
            ...current,
            status: 'refining',
            result: message.result,
            error: null,
            timings: message.timings,
          };
        });
        return;
      }
      startTransition(() => {
        setSnapshot((current) => {
          if (current == null || current.result == null) return current;
          return {
            ...current,
            status: 'refined',
            result: applyStageCPatch(current.result, message.patch),
            error: null,
            timings: message.timings,
          };
        });
      });
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      setSnapshot((current) => current == null
        ? current
        : { ...current, status: 'refinement-error', error: 'Recommendation refinement failed.' });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      adpBoardKeyRef.current = null;
    };
  }, []);

  // Init off-clock. The worker fetches its own immutable pool, so no UI-thread structured clone
  // can delay a live pick render; availability still rides on each small compute message.
  useEffect(() => {
    const worker = workerRef.current;
    if (worker == null) return;
    if (adpBoardKeyRef.current === adpBoardKey) return;
    adpBoardKeyRef.current = adpBoardKey;
    staticVersionRef.current += 1;
    setWorkerReady(false);
    const initMessage: RecommendationWorkerRequest = {
      type: 'init',
      staticVersion: staticVersionRef.current,
      adpBoardKey,
      adpFormat,
    };
    worker.postMessage(initMessage);
  }, [adpBoardKey, adpFormat]);

  // Leaving the clock must stop the in-flight Stage C: there is no newer `compute` to supersede
  // it, so send an explicit cancel and let the worker's next S2/Stage C yield invalidate it.
  useEffect(() => {
    const worker = workerRef.current;
    if (worker == null) return;
    if (!enabled && latestRequestIdRef.current > 0) postCancel(worker, latestRequestIdRef.current);
  }, [enabled]);

  // Compute only when on the clock AND the worker has finished loading its pool.
  useEffect(() => {
    const worker = workerRef.current;
    if (worker == null || !enabled || input == null || !workerReady) return;
    if (adpBoardKeyRef.current !== adpBoardKey) return;

    const previousRequestId = latestRequestIdRef.current;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    // A newer request supersedes the previous one — cancel it explicitly instead of relying on
    // the next `compute` message bumping `latestRequestId` inside the worker on its own.
    if (previousRequestId > 0 && previousRequestId !== requestId) postCancel(worker, previousRequestId);
    latestRequestIdRef.current = requestId;
    latestRequestKeyRef.current = requestKey;
    setSnapshot((current) => ({
      requestId,
      requestKey,
      status: 'refining',
      result: current != null && sameDraftRequest(current.requestKey, requestKey) ? current.result : null,
      error: null,
      timings: null,
    }));
    const computeMessage: RecommendationWorkerRequest = {
      type: 'compute',
      requestId,
      requestKey,
      staticVersion: staticVersionRef.current,
      queuedAt: Date.now(),
      input,
    };
    worker.postMessage(computeMessage);
  }, [adpBoardKey, enabled, input, requestKey, workerReady]);

  if (!enabled) return { status: 'idle', result: null, error: null, timings: null, workerReady };
  if (typeof Worker === 'undefined') return { status: 'base-ready', result: null, error: null, timings: null, workerReady: false };
  if (snapshot == null || snapshot.requestKey !== requestKey) {
    return {
      status: 'base-ready',
      result: snapshot != null && sameDraftRequest(snapshot.requestKey, requestKey) ? snapshot.result : null,
      error: null,
      timings: null,
      workerReady,
    };
  }
  return {
    status: snapshot.status,
    result: snapshot.result,
    error: snapshot.error,
    timings: snapshot.timings,
    workerReady,
  };
}
