import { useEffect, useRef, useState } from 'react';
import type { RecommendationResult } from '../engine/recommend';
import type {
  RecommendationWorkerDynamicInput,
  RecommendationWorkerRequest,
  RecommendationWorkerResponse,
  RecommendationWorkerStaticData,
  RecommendationWorkerTimings,
} from '../engine/recommendationWorkerProtocol';

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
}

interface UseRecommendationRefinementInput {
  enabled: boolean;
  requestKey: string;
  staticData: RecommendationWorkerStaticData;
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

export function useRecommendationRefinement({
  enabled,
  requestKey,
  staticData,
  input,
}: UseRecommendationRefinementInput): RecommendationRefinement {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const staticVersionRef = useRef(0);
  const staticDataRef = useRef<RecommendationWorkerStaticData | null>(null);
  const [snapshot, setSnapshot] = useState<RefinementSnapshot | null>(null);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || input == null || typeof Worker === 'undefined') return;

    let worker = workerRef.current;
    if (worker == null) {
      worker = new Worker(new URL('../workers/recommendation.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<RecommendationWorkerResponse>) => {
        const message = event.data;
        setSnapshot((current) => {
          if (current == null || message.requestId !== current.requestId || message.requestKey !== current.requestKey) {
            return current;
          }
          if (message.type === 'error') {
            return { ...current, status: 'refinement-error', error: message.message };
          }
          return {
            ...current,
            status: 'refined',
            result: message.result,
            error: null,
            timings: message.timings,
          };
        });
      };
      worker.onerror = () => {
        setSnapshot((current) => current == null
          ? current
          : { ...current, status: 'refinement-error', error: 'Recommendation refinement failed.' });
      };
    }

    if (staticDataRef.current !== staticData) {
      staticDataRef.current = staticData;
      staticVersionRef.current += 1;
      const initMessage: RecommendationWorkerRequest = {
        type: 'init',
        staticVersion: staticVersionRef.current,
        data: staticData,
      };
      worker.postMessage(initMessage);
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSnapshot({
      requestId,
      requestKey,
      status: 'refining',
      result: null,
      error: null,
      timings: null,
    });
    const computeMessage: RecommendationWorkerRequest = {
      type: 'compute',
      requestId,
      requestKey,
      staticVersion: staticVersionRef.current,
      queuedAt: Date.now(),
      input,
    };
    worker.postMessage(computeMessage);
  }, [enabled, input, requestKey, staticData]);

  if (!enabled) return { status: 'idle', result: null, error: null, timings: null };
  if (typeof Worker === 'undefined') return { status: 'base-ready', result: null, error: null, timings: null };
  if (snapshot == null || snapshot.requestKey !== requestKey) {
    return { status: 'base-ready', result: null, error: null, timings: null };
  }
  return {
    status: snapshot.status,
    result: snapshot.result,
    error: snapshot.error,
    timings: snapshot.timings,
  };
}
