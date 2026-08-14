import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendationResult } from '../engine/recommend';
import type {
  RecommendationWorkerDynamicInput,
  RecommendationWorkerRequest,
  RecommendationWorkerResponse,
  RecommendationWorkerStaticData,
} from '../engine/recommendationWorkerProtocol';
import { useRecommendationRefinement } from './useRecommendationRefinement';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<RecommendationWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: RecommendationWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: RecommendationWorkerRequest) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: RecommendationWorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<RecommendationWorkerResponse>);
  }
}

const staticData: RecommendationWorkerStaticData = {
  players: [],
  projections: [],
  adp: [],
  availabilityEntries: [],
};

const dynamicInput: RecommendationWorkerDynamicInput = {
  settings: {
    provider: 'sleeper', leagueId: 'l1', name: 'Fixture', season: '2026', teams: 2,
    startingSlots: ['RB'], rosterSlots: { RB: 1 }, scoring: { rush_yd: 0.1 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  },
  picks: [],
  myTeamId: 'me',
  nextPick: 4,
};

const result = {
  recommendations: [],
  hasMoreRecommendations: false,
  marketRecommendations: [],
  diagnostics: {
    unmatchedPickCount: 0,
    unmatchedPickOveralls: [],
    candidatesEvaluated: 0,
    replacementLevels: [],
    positionalDemand: { byPosition: new Map(), source: 'default-mix', rosterSpots: 1, usableRows: 0 },
    coreStartingSlotsFilled: false,
    specialTeamsDraft: {
      draftRounds: 1, teamPicksMade: 0, remainingPicks: 1,
      configured: { K: 0, DEF: 0 }, rostered: { K: 0, DEF: 0 }, remaining: { K: 0, DEF: 0 },
      due: [], overdue: [], impossibleToFill: false,
    },
    simulation: null,
  },
} as RecommendationResult;

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRecommendationRefinement', () => {
  it('ignores a stale response and accepts only the current request', () => {
    const { result: hook, rerender } = renderHook(
      ({ requestKey }) => useRecommendationRefinement({
        enabled: true,
        requestKey,
        staticData,
        input: dynamicInput,
      }),
      { initialProps: { requestKey: 'draft|pick-1' } },
    );
    const worker = FakeWorker.instances[0]!;
    const first = worker.messages.find((message) => message.type === 'compute')!;
    expect(first.type).toBe('compute');
    expect(hook.current.status).toBe('refining');

    rerender({ requestKey: 'draft|pick-2' });
    const computes = worker.messages.filter((message) => message.type === 'compute');
    const second = computes[1]!;
    expect(second.type).toBe('compute');

    if (first.type === 'compute') {
      act(() => worker.emit({
        type: 'result', requestId: first.requestId, requestKey: first.requestKey,
        staticVersion: first.staticVersion, result,
        timings: { queueMs: 0, computeMs: 5, totalMs: 5 },
      }));
    }
    expect(hook.current.status).toBe('refining');
    expect(hook.current.result).toBeNull();

    if (second.type === 'compute') {
      act(() => worker.emit({
        type: 'result', requestId: second.requestId, requestKey: second.requestKey,
        staticVersion: second.staticVersion, result,
        timings: { queueMs: 1, computeMs: 8, totalMs: 9 },
      }));
    }
    expect(hook.current.status).toBe('refined');
    expect(hook.current.result).toBe(result);
    expect(hook.current.timings?.computeMs).toBe(8);
  });

  it('terminates its worker on unmount', () => {
    const { unmount } = renderHook(() => useRecommendationRefinement({
      enabled: true,
      requestKey: 'draft|pick-1',
      staticData,
      input: dynamicInput,
    }));
    const worker = FakeWorker.instances[0]!;
    unmount();
    expect(worker.terminated).toBe(true);
  });
});
