import { buildRecommendationBoard, clearSimulationCache, settingsFingerprint } from '../engine/recommend';
import { computeValueAnchor } from '../engine/replacement';
import { scoreProjection, type ScoreDiagnostics } from '../engine/scoring';
import {
  toStageCPatch,
  type RecommendationWorkerDynamicInput,
  type RecommendationWorkerRequest,
  type RecommendationWorkerResponse,
} from '../engine/recommendationWorkerProtocol';
import type { AdpEntry, PlayerId, PlayerMeta, SeasonProjection } from '../../../shared/types';

interface WorkerScope {
  onmessage: ((event: MessageEvent<RecommendationWorkerRequest>) => void) | null;
  postMessage(message: RecommendationWorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;
let staticVersion = 0;
interface RecommendationWorkerStaticData {
  players: PlayerMeta[];
  projections: SeasonProjection[];
  adp: AdpEntry[];
}
let staticData: RecommendationWorkerStaticData | null = null;
let staticLoad: { version: number; promise: Promise<RecommendationWorkerStaticData> } | null = null;
/** Latest request id seen. A compute that yields after its S2 pass re-checks this so a newer
 * request cooperatively cancels its Stage C work instead of the main thread terminating us. */
let latestRequestId = 0;
/** Highest request id explicitly cancelled by a `cancel` message. Folded into `shouldAbort` so an
 * off-clock user (or a superseded request with no newer `compute` yet) stops Stage C at the next
 * S2/Stage C yield instead of occupying the worker until it finishes. */
let cancelledRequestId = 0;

/** Pick-invariant work cached inside the worker: `scoreProjection` diagnostics (settings +
 * projections do not change mid-draft) and VALUE_ANCHOR (documented pick-invariant). Reset only
 * by `init` (a genuine players/projections/ADP change); availability arrives per-compute and
 * never touches this cache or `clearSimulationCache`. */
let staticScoreCache: {
  key: string;
  scores: Map<PlayerId, ScoreDiagnostics>;
  valueAnchor: number | null;
} | null = null;

function getStaticScores(
  input: RecommendationWorkerDynamicInput,
  data: RecommendationWorkerStaticData,
): { scores: Map<PlayerId, ScoreDiagnostics>; valueAnchor: number | null } {
  const key = `${settingsFingerprint(input.settings)}|${input.rosterSpotsPerTeam ?? '~'}`;
  if (staticScoreCache?.key === key) return staticScoreCache;
  const playersById = new Map<PlayerId, PlayerMeta>(data.players.map((player) => [player.playerId, player]));
  const scores = new Map<PlayerId, ScoreDiagnostics>();
  for (const projection of data.projections) {
    scores.set(projection.playerId, scoreProjection(projection, input.settings, playersById.get(projection.playerId)?.position));
  }
  const valueAnchor = computeValueAnchor({
    settings: input.settings,
    players: data.players,
    projections: data.projections,
    adp: data.adp,
    rosterSpotsPerTeam: input.rosterSpotsPerTeam,
  });
  staticScoreCache = { key, scores, valueAnchor };
  return staticScoreCache;
}

/** Yields to the event loop so queued `compute` messages can bump `latestRequestId`. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function fetchStaticData(adpFormat: string): Promise<RecommendationWorkerStaticData> {
  const [playersResponse, projectionsResponse, adpResponse] = await Promise.all([
    fetch('/data/players.json'),
    fetch('/data/projections-season.json'),
    fetch(`/data/adp-${adpFormat}.json`),
  ]);
  if (!playersResponse.ok) throw new Error(`/data/players.json fetch failed: ${playersResponse.status}`);
  if (!projectionsResponse.ok) throw new Error(`/data/projections-season.json fetch failed: ${projectionsResponse.status}`);
  if (!adpResponse.ok) throw new Error(`/data/adp-${adpFormat}.json fetch failed: ${adpResponse.status}`);
  return {
    players: await playersResponse.json() as PlayerMeta[],
    projections: await projectionsResponse.json() as SeasonProjection[],
    adp: await adpResponse.json() as AdpEntry[],
  };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    staticVersion = message.staticVersion;
    staticData = null;
    // A genuine static change (new players/projections/ADP format or reconnect), not an
    // availability-only update — those ride on `compute` and never clear these caches.
    clearSimulationCache();
    staticScoreCache = null;
    const version = staticVersion;
    const promise = fetchStaticData(message.adpFormat).then((data) => {
      if (staticVersion === version) {
        staticData = data;
        workerScope.postMessage({ type: 'ready', staticVersion: version });
      }
      return data;
    }, (error: unknown) => {
      workerScope.postMessage({
        type: 'error',
        staticVersion: version,
        message: error instanceof Error ? error.message : 'Recommendation data failed to load.',
      });
      throw error;
    });
    staticLoad = { version, promise };
    return;
  }
  if (message.type === 'compute') void handleCompute(message);
  if (message.type === 'cancel' && message.staticVersion === staticVersion) {
    cancelledRequestId = Math.max(cancelledRequestId, message.requestId);
  }
};

async function handleCompute(message: Extract<RecommendationWorkerRequest, { type: 'compute' }>): Promise<void> {
  if (message.staticVersion !== staticVersion) {
    workerScope.postMessage({
      type: 'error',
      requestId: message.requestId,
      requestKey: message.requestKey,
      staticVersion: message.staticVersion,
      message: 'Recommendation data changed before the refinement started.',
    });
    return;
  }

  const requestId = message.requestId;
  const versionAtStart = staticVersion;
  latestRequestId = requestId;
  const startedAt = performance.now();
  const queueMs = Math.max(0, Date.now() - message.queuedAt);
  try {
    if (staticData == null && staticLoad?.version === message.staticVersion) await staticLoad.promise;
    if (staticData == null || staticVersion !== versionAtStart) {
      throw new Error('Recommendation data changed before the refinement started.');
    }
    const { scores, valueAnchor } = getStaticScores(message.input, staticData);
    const shared = {
      ...message.input,
      players: staticData.players,
      projections: staticData.projections,
      adp: staticData.adp,
      availabilityByPlayer: new Map(message.input.availabilityEntries),
      precomputedScores: scores,
      precomputedValueAnchor: valueAnchor,
      includeRecommendationViews: false,
      includeMarketRecommendations: false,
      includeExpansion: false,
    };

    const shouldAbort = () =>
      latestRequestId !== requestId || staticVersion !== versionAtStart || cancelledRequestId >= requestId;
    let s2Posted = false;
    const s2StartedAt = startedAt;
    const fullResult = await buildRecommendationBoard(shared, {
      onDeterministicSnapshot: async (snapshot) => {
        s2Posted = true;
        workerScope.postMessage({
          type: 'result',
          phase: 's2',
          requestId: message.requestId,
          requestKey: message.requestKey,
          staticVersion: message.staticVersion,
          result: snapshot,
          timings: {
            queueMs,
            computeMs: Math.max(0, performance.now() - s2StartedAt),
            totalMs: queueMs + Math.max(0, performance.now() - s2StartedAt),
          },
        });
        await nextTask();
        return shouldAbort() ? 'abort' : 'continue';
      },
      yieldBetweenBatches: nextTask,
      shouldAbort,
    });
    if (fullResult == null || shouldAbort()) return;
    const stageCEnd = performance.now();
    workerScope.postMessage({
      type: 'result',
      phase: 'stageC',
      requestId: message.requestId,
      requestKey: message.requestKey,
      staticVersion: message.staticVersion,
      patch: toStageCPatch(fullResult),
      timings: {
        queueMs,
        computeMs: Math.max(0, stageCEnd - (s2Posted ? startedAt : startedAt)),
        totalMs: queueMs + Math.max(0, stageCEnd - startedAt),
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
}
