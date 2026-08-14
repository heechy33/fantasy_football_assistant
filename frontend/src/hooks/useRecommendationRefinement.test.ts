import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendationResult } from '../engine/recommend';
import type {
  RecommendationStageCPatch,
  RecommendationWorkerDynamicInput,
  RecommendationWorkerRequest,
  RecommendationWorkerResponse,
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

type ComputeMessage = Extract<RecommendationWorkerRequest, { type: 'compute' }>;

const dynamicInput: RecommendationWorkerDynamicInput = {
  settings: {
    provider: 'sleeper', leagueId: 'l1', name: 'Fixture', season: '2026', teams: 2,
    startingSlots: ['RB'], rosterSlots: { RB: 1 }, scoring: { rush_yd: 0.1 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  },
  picks: [],
  myTeamId: 'me',
  nextPick: 4,
  availabilityEntries: [],
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

const patch: RecommendationStageCPatch = {
  recommendations: [],
  hasMoreRecommendations: false,
  simulation: {
    scenariosRun: 8, timedOut: false, elapsedMs: 12, syntheticAdpCount: 0, unscoredPositionCount: 0,
  },
};

function latestCompute(worker: FakeWorker): ComputeMessage {
  const computes = worker.messages.filter((message): message is ComputeMessage => message.type === 'compute');
  return computes[computes.length - 1]!;
}

function emitReady(worker: FakeWorker, staticVersion = 1) {
  act(() => worker.emit({ type: 'ready', staticVersion }));
}

function emitS2(worker: FakeWorker, message: ComputeMessage, computeMs: number) {
  act(() => worker.emit({
    type: 'result',
    phase: 's2',
    requestId: message.requestId,
    requestKey: message.requestKey,
    staticVersion: message.staticVersion,
    result,
    timings: { queueMs: 0, computeMs, totalMs: computeMs },
  }));
}

function emitStageC(worker: FakeWorker, message: ComputeMessage, computeMs: number) {
  act(() => worker.emit({
    type: 'result',
    phase: 'stageC',
    requestId: message.requestId,
    requestKey: message.requestKey,
    staticVersion: message.staticVersion,
    patch,
    timings: { queueMs: 0, computeMs, totalMs: computeMs },
  }));
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRecommendationRefinement', () => {
  it('creates and inits the worker by format alone, even off-clock', () => {
    const { result } = renderHook(() => useRecommendationRefinement({
      enabled: false,
      requestKey: 'draft|pick-1',
      adpFormat: 'ppr',
      input: null,
    }));
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0]!;
    expect(worker.messages).toContainEqual({ type: 'init', staticVersion: 1, adpFormat: 'ppr' });
    expect(worker.messages.some((message) => message.type === 'compute')).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.workerReady).toBe(false);
  });

  it('does not post compute until the worker reports ready', () => {
    renderHook(() => useRecommendationRefinement({
      enabled: true,
      requestKey: 'draft|pick-1',
      adpFormat: 'ppr',
      input: dynamicInput,
    }));
    const worker = FakeWorker.instances[0]!;
    expect(worker.messages.filter((message) => message.type === 'compute')).toHaveLength(0);
    emitReady(worker);
    expect(worker.messages.filter((message) => message.type === 'compute')).toHaveLength(1);
  });

  it('ignores a stale response and accepts only the current request without terminating', () => {
    const { result: hook, rerender } = renderHook(
      ({ requestKey }) => useRecommendationRefinement({
        enabled: true,
        requestKey,
        adpFormat: 'ppr',
        input: dynamicInput,
      }),
      { initialProps: { requestKey: 'draft|pick-1' } },
    );
    const worker = FakeWorker.instances[0]!;
    emitReady(worker);
    const first = latestCompute(worker);
    expect(hook.current.status).toBe('refining');

    rerender({ requestKey: 'draft|pick-2' });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.terminated).toBe(false);
    const second = latestCompute(worker);
    expect(second.requestId).toBeGreaterThan(first.requestId);

    emitStageC(worker, first, 5);
    expect(hook.current.status).toBe('refining');
    expect(hook.current.result).toBeNull();

    emitS2(worker, second, 8);
    expect(hook.current.status).toBe('refining');
    expect(hook.current.result).toBe(result);
    expect(hook.current.timings?.computeMs).toBe(8);

    emitStageC(worker, second, 12);
    expect(hook.current.status).toBe('refined');
    expect(hook.current.timings?.computeMs).toBe(12);
    expect(hook.current.result?.diagnostics.simulation?.scenariosRun).toBe(8);
  });

  it('drops a result computed against superseded static data', () => {
    const { result: hook, rerender } = renderHook(
      ({ adpFormat }) => useRecommendationRefinement({
        enabled: true,
        requestKey: 'draft|pick-1',
        adpFormat,
        input: dynamicInput,
      }),
      { initialProps: { adpFormat: 'ppr' as 'ppr' | 'half-ppr' } },
    );
    const worker = FakeWorker.instances[0]!;
    emitReady(worker, 1);
    const first = latestCompute(worker);
    expect(worker.messages.filter((message) => message.type === 'init')).toHaveLength(1);

    rerender({ adpFormat: 'half-ppr' });
    expect(worker.messages.filter((message) => message.type === 'init')).toHaveLength(2);
    emitReady(worker, 2);
    const current = latestCompute(worker);
    expect(current.staticVersion).toBeGreaterThan(first.staticVersion);

    act(() => worker.emit({
      type: 'result', phase: 'stageC',
      requestId: current.requestId, requestKey: current.requestKey,
      staticVersion: first.staticVersion, patch,
      timings: { queueMs: 0, computeMs: 5, totalMs: 5 },
    }));
    expect(hook.current.status).toBe('refining');
    expect(hook.current.result).toBeNull();
  });

  it('keeps the last completed board visible while the same draft recomputes', () => {
    const { result: hook, rerender } = renderHook(
      ({ requestKey }) => useRecommendationRefinement({
        enabled: true, requestKey, adpFormat: 'ppr', input: dynamicInput,
      }),
      { initialProps: { requestKey: 'draft|pick-1' } },
    );
    const worker = FakeWorker.instances[0]!;
    emitReady(worker);
    emitS2(worker, latestCompute(worker), 4);
    emitStageC(worker, latestCompute(worker), 5);
    expect(hook.current.status).toBe('refined');

    rerender({ requestKey: 'draft|pick-2' });
    expect(hook.current.status).toBe('refining');
    expect(hook.current.result?.recommendations).toEqual(result.recommendations);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('does not carry a completed board into a different draft', () => {
    const { result: hook, rerender } = renderHook(
      ({ requestKey }) => useRecommendationRefinement({
        enabled: true, requestKey, adpFormat: 'ppr', input: dynamicInput,
      }),
      { initialProps: { requestKey: 'draft-a|pick-1' } },
    );
    const worker = FakeWorker.instances[0]!;
    emitReady(worker);
    emitS2(worker, latestCompute(worker), 4);
    emitStageC(worker, latestCompute(worker), 5);
    rerender({ requestKey: 'draft-b|pick-1' });
    expect(hook.current.result).toBeNull();
  });

  it('posts an explicit cancel when the user leaves the clock (enabled → false)', () => {
    const { rerender } = renderHook(
      ({ enabled }) => useRecommendationRefinement({
        enabled,
        requestKey: 'draft|pick-1',
        adpFormat: 'ppr',
        input: dynamicInput,
      }),
      { initialProps: { enabled: true } },
    );
    const worker = FakeWorker.instances[0]!;
    emitReady(worker);
    const compute = latestCompute(worker);
    expect(compute.requestId).toBeGreaterThan(0);

    rerender({ enabled: false });
    const cancels = worker.messages.filter((message): message is Extract<RecommendationWorkerRequest, { type: 'cancel' }> => message.type === 'cancel');
    expect(cancels).toHaveLength(1);
    expect(cancels[0]).toEqual({ type: 'cancel', requestId: compute.requestId, staticVersion: 1 });
  });

  it('cancels the superseded request before posting a newer compute', () => {
    const { rerender } = renderHook(
      ({ requestKey }) => useRecommendationRefinement({
        enabled: true,
        requestKey,
        adpFormat: 'ppr',
        input: dynamicInput,
      }),
      { initialProps: { requestKey: 'draft|pick-1' } },
    );
    const worker = FakeWorker.instances[0]!;
    emitReady(worker);
    const first = latestCompute(worker);
    expect(worker.messages.some((message) => message.type === 'cancel')).toBe(false);

    rerender({ requestKey: 'draft|pick-2' });
    const cancels = worker.messages.filter((message): message is Extract<RecommendationWorkerRequest, { type: 'cancel' }> => message.type === 'cancel');
    expect(cancels).toHaveLength(1);
    expect(cancels[0]?.requestId).toBe(first.requestId);
    expect(latestCompute(worker).requestId).toBeGreaterThan(first.requestId);
    // The cancel must precede the newer compute so the worker can stop Stage C immediately.
    expect(worker.messages.indexOf(cancels[0]!)).toBeLessThan(worker.messages.indexOf(latestCompute(worker)));
  });

  it('terminates its worker on unmount', () => {
    const { unmount } = renderHook(() => useRecommendationRefinement({
      enabled: true,
      requestKey: 'draft|pick-1',
      adpFormat: 'ppr',
      input: dynamicInput,
    }));
    const worker = FakeWorker.instances[0]!;
    unmount();
    expect(worker.terminated).toBe(true);
  });
});
