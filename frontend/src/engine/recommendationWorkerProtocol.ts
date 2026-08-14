import type { AdpEntry, PlayerId, PlayerMeta, SeasonProjection } from '../../../shared/types';
import type { RecommendationInput, RecommendationResult } from './recommend';

export interface RecommendationWorkerStaticData {
  players: PlayerMeta[];
  projections: SeasonProjection[];
  adp: AdpEntry[];
  availabilityEntries: Array<[PlayerId, number]>;
}

export type RecommendationWorkerDynamicInput = Omit<
  RecommendationInput,
  'players' | 'projections' | 'adp' | 'availabilityByPlayer'
>;

export type RecommendationWorkerRequest =
  | {
      type: 'init';
      staticVersion: number;
      data: RecommendationWorkerStaticData;
    }
  | {
      type: 'compute';
      requestId: number;
      requestKey: string;
      staticVersion: number;
      queuedAt: number;
      input: RecommendationWorkerDynamicInput;
    };

export interface RecommendationWorkerTimings {
  queueMs: number;
  computeMs: number;
  totalMs: number;
}

export type RecommendationWorkerResponse =
  | {
      type: 'result';
      requestId: number;
      requestKey: string;
      staticVersion: number;
      result: RecommendationResult;
      timings: RecommendationWorkerTimings;
    }
  | {
      type: 'error';
      requestId: number;
      requestKey: string;
      staticVersion: number;
      message: string;
    };
