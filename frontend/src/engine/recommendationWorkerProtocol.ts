import type { PlayerId } from '../../../shared/types';
import type { AdpBoardKey } from '../data/adpBoard';
import type { AdpFormat } from '../data/loadPlayerPool';
import type { Recommendation, RecommendationInput, RecommendationResult } from './recommend';
import type { SimulationDiagnostics } from './simulate';

/** The on-clock, pick-dependent slice. `availabilityByPlayer` is omitted because a Map is not
 * directly structured-clonable across the worker boundary; it is shipped as entry pairs and
 * rebuilt inside the worker on every compute. Function-valued build options never cross this
 * boundary (they exist only inside the worker). */
export type RecommendationWorkerDynamicInput = Omit<
  RecommendationInput,
  | 'players'
  | 'projections'
  | 'adp'
  | 'availabilityByPlayer'
  | 'precomputedScores'
  | 'precomputedValueAnchor'
> & {
  availabilityEntries: Array<[PlayerId, number]>;
};

export type RecommendationWorkerRequest =
  | {
      type: 'init';
      staticVersion: number;
      /** The worker fetches its own immutable pool; never clone player/projection arrays on UI. */
      adpBoardKey: AdpBoardKey;
      /** Fallback board selector for `fetchAdpBoard` — the plain `/data/adp-${adpFormat}.json` file
       * used when the `adpBoardKey` file is missing (fail-open, same rule as the FFC fallback). */
      adpFormat: AdpFormat;
    }
  | {
      type: 'compute';
      requestId: number;
      requestKey: string;
      staticVersion: number;
      queuedAt: number;
      input: RecommendationWorkerDynamicInput;
    }
  | {
      /** Cooperative cancellation of a specific request — no reply expected. The worker folds a
       * monotonically increasing `cancelledRequestId` into the same `shouldAbort` check it already
       * uses for newer requests, so off-clock work stops at the next S2/Stage C yield instead of
       * occupying the worker until it finishes. */
      type: 'cancel';
      requestId: number;
      staticVersion: number;
    };

export interface RecommendationWorkerTimings {
  queueMs: number;
  computeMs: number;
  totalMs: number;
}

/** Paint-sized Stage C payload: the displayed Engine rows plus simulation diagnostics. Never
 * includes `marketRecommendations` or per-position `recommendationViews` — those are the objects
 * whose structured clone froze the UI thread. */
export interface RecommendationStageCPatch {
  recommendations: Recommendation[];
  hasMoreRecommendations: boolean;
  simulation: SimulationDiagnostics | null;
}

export function toStageCPatch(result: RecommendationResult): RecommendationStageCPatch {
  return {
    recommendations: result.recommendations,
    hasMoreRecommendations: result.hasMoreRecommendations,
    simulation: result.diagnostics.simulation,
  };
}

export function applyStageCPatch(
  board: RecommendationResult,
  patch: RecommendationStageCPatch,
): RecommendationResult {
  return {
    ...board,
    recommendations: patch.recommendations,
    hasMoreRecommendations: patch.hasMoreRecommendations,
    marketRecommendations: board.marketRecommendations,
    diagnostics: {
      ...board.diagnostics,
      simulation: patch.simulation,
    },
  };
}

export type RecommendationWorkerResponse =
  | {
      type: 'ready';
      staticVersion: number;
    }
  | {
      type: 'result';
      phase: 's2';
      requestId: number;
      requestKey: string;
      staticVersion: number;
      result: RecommendationResult;
      timings: RecommendationWorkerTimings;
    }
  | {
      type: 'result';
      phase: 'stageC';
      requestId: number;
      requestKey: string;
      staticVersion: number;
      patch: RecommendationStageCPatch;
      timings: RecommendationWorkerTimings;
    }
  | {
      type: 'error';
      requestId?: number;
      requestKey?: string;
      staticVersion: number;
      message: string;
    };
