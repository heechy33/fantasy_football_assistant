import { buildRecommendationBoard, clearSimulationCache } from '../engine/recommend';
import type {
  RecommendationWorkerRequest,
  RecommendationWorkerResponse,
  RecommendationWorkerStaticData,
} from '../engine/recommendationWorkerProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<RecommendationWorkerRequest>) => void) | null;
  postMessage(message: RecommendationWorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;
let staticVersion = 0;
let staticData: RecommendationWorkerStaticData | null = null;

workerScope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    staticVersion = message.staticVersion;
    staticData = message.data;
    clearSimulationCache();
    return;
  }

  if (staticData == null || message.staticVersion !== staticVersion) {
    workerScope.postMessage({
      type: 'error',
      requestId: message.requestId,
      requestKey: message.requestKey,
      staticVersion: message.staticVersion,
      message: 'Recommendation data changed before the refinement started.',
    });
    return;
  }

  const startedAt = performance.now();
  const queueMs = Math.max(0, Date.now() - message.queuedAt);
  try {
    const result = buildRecommendationBoard({
      ...message.input,
      players: staticData.players,
      projections: staticData.projections,
      adp: staticData.adp,
      availabilityByPlayer: new Map(staticData.availabilityEntries),
    });
    const finishedAt = performance.now();
    workerScope.postMessage({
      type: 'result',
      requestId: message.requestId,
      requestKey: message.requestKey,
      staticVersion: message.staticVersion,
      result,
      timings: {
        queueMs,
        computeMs: finishedAt - startedAt,
        totalMs: queueMs + finishedAt - startedAt,
      },
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: message.requestId,
      requestKey: message.requestKey,
      staticVersion: message.staticVersion,
      message: error instanceof Error ? error.message : 'Recommendation refinement failed.',
    });
  }
};
