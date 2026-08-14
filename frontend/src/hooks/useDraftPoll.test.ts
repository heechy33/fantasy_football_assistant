import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cred, DraftInit, DraftPicks, ProviderAdapter } from '../../../shared/types';
import {
  computeStaleness,
  createDraftPollController,
  IDLE_HEALTH,
  shouldCommitPollSnapshot,
  useDraftPoll,
  type DraftPollSnapshot,
} from './useDraftPoll';

const CRED: Cred = { provider: 'sleeper', userId: 'u-1' };

const DRAFT_INIT: DraftInit = {
  provider: 'sleeper',
  draftId: 'd-1',
  leagueId: 'l-1',
  draftType: 'snake',
  teams: 2,
  rounds: 1,
  slotToTeam: { 1: 't1', 2: 't2' },
  myTeamId: 't1',
  mySlot: 1,
  settings: {
    provider: 'sleeper',
    leagueId: 'l-1',
    name: 'L',
    season: '2026',
    teams: 2,
    startingSlots: ['QB'],
    rosterSlots: { QB: 1 },
    scoring: {},
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  },
};

function draftPicks(fetchedAt: number): DraftPicks {
  return { status: 'drafting', picks: [], onTheClock: null, fetchedAt };
}

function makeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: 'sleeper',
    listLeagues: vi.fn(),
    init: vi.fn().mockResolvedValue(DRAFT_INIT),
    picks: vi.fn().mockResolvedValue(draftPicks(Date.now())),
    rosters: vi.fn(),
    freeAgents: vi.fn(),
    settings: vi.fn(),
    ...overrides,
  };
}

// Probe that renders the hook so a test can observe whether an unchanged-content poll keeps the
// same draftPicks reference (no new snapshot committed) while health still advances in the ref.
let probeDraftPicks: DraftPicks | null = null;
let probeLastSuccessfulPollAt: number | null = null;

function PollProbe({ adapter, intervalMs }: { adapter: ProviderAdapter; intervalMs?: number }) {
  const poll = useDraftPoll({ adapter, cred: CRED, draftId: 'd-1', intervalMs });
  probeDraftPicks = poll.draftPicks;
  probeLastSuccessfulPollAt = poll.lastSuccessfulPollAt;
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  probeDraftPicks = null;
  probeLastSuccessfulPollAt = null;
});

describe('createDraftPollController', () => {
  it('calls init() once then picks() once immediately on start', async () => {
    const adapter = makeAdapter();
    const onChange = vi.fn();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange,
    });

    await controller.start();

    expect(adapter.init).toHaveBeenCalledTimes(1);
    expect(adapter.picks).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ready' }));

    controller.stop();
  });

  it('polls again after intervalMs and not before', async () => {
    const adapter = makeAdapter();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange: () => {},
    });
    await controller.start();
    expect(adapter.picks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(adapter.picks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.picks).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('polls at the 1s default cadence when no interval is provided', async () => {
    const adapter = makeAdapter();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', onChange: () => {},
    });
    await controller.start();
    expect(adapter.picks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(adapter.picks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.picks).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('uses a start-to-start cadence while keeping requests non-overlapping', async () => {
    const adapter = makeAdapter({
      picks: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return draftPicks(Date.now());
      }),
    });
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 2000, onChange: () => {},
    });
    const started = controller.start();
    await vi.advanceTimersByTimeAsync(300);
    await started;

    await vi.advanceTimersByTimeAsync(1699);
    expect(adapter.picks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.picks).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('refreshes health without replacing unchanged draft-pick content', async () => {
    const snapshots: DraftPollSnapshot[] = [];
    const adapter = makeAdapter({
      picks: vi.fn().mockImplementation(() => Promise.resolve(draftPicks(Date.now()))),
    });
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange: (value) => snapshots.push(value),
    });
    await controller.start();
    const firstPicks = snapshots.at(-1)?.draftPicks;
    const firstSuccess = snapshots.at(-1)?.lastSuccessfulPollAt;
    await vi.advanceTimersByTimeAsync(1000);

    expect(snapshots.at(-1)?.draftPicks).toBe(firstPicks);
    expect(snapshots.at(-1)?.lastSuccessfulPollAt).toBeGreaterThan(firstSuccess ?? -1);
    controller.stop();
  });

  it('honors Retry-After for HTTP 429 responses', async () => {
    const error = Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 3000 });
    const adapter = makeAdapter({ picks: vi.fn().mockRejectedValue(error) });
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange: () => {},
    });
    await controller.start();
    await vi.advanceTimersByTimeAsync(2999);
    expect(adapter.picks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.picks).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('backs off exponentially on repeated failures, capped at maxBackoffMs', async () => {
    const adapter = makeAdapter({ picks: vi.fn().mockRejectedValue(new Error('boom')) });
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, maxBackoffMs: 5000, onChange: () => {},
    });

    await controller.start(); // failure 1 -> backoff 2000 (+jitter up to 200)
    expect(adapter.picks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2200);
    expect(adapter.picks).toHaveBeenCalledTimes(2); // failure 2 -> backoff 4000 (+jitter up to 400)

    await vi.advanceTimersByTimeAsync(4400);
    expect(adapter.picks).toHaveBeenCalledTimes(3); // failure 3 -> backoff capped at 5000 (+jitter up to 500)

    await vi.advanceTimersByTimeAsync(5500);
    expect(adapter.picks).toHaveBeenCalledTimes(4); // stays capped, doesn't keep growing past maxBackoffMs

    controller.stop();
  });

  it('resets backoff and consecutiveFailures after a success', async () => {
    let shouldFail = true;
    const adapter = makeAdapter({
      picks: vi.fn().mockImplementation(() =>
        shouldFail ? Promise.reject(new Error('boom')) : Promise.resolve(draftPicks(Date.now())),
      ),
    });
    const onChange = vi.fn();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, maxBackoffMs: 30000, onChange,
    });

    await controller.start();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ consecutiveFailures: 1 }));

    shouldFail = false;
    await vi.advanceTimersByTimeAsync(2200); // succeeds
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ consecutiveFailures: 0 }));

    shouldFail = true;
    await vi.advanceTimersByTimeAsync(1100); // next poll at the base interval (backoff was reset)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ consecutiveFailures: 1 }));

    controller.stop();
  });

  it('pauses while hidden and resumes immediately on notifyVisible()', async () => {
    let hidden = false;
    const adapter = makeAdapter();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange: () => {}, isHidden: () => hidden,
    });
    await controller.start();
    expect(adapter.picks).toHaveBeenCalledTimes(1);

    hidden = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.picks).toHaveBeenCalledTimes(1); // still paused, no wasted polls

    hidden = false;
    await controller.notifyVisible();
    expect(adapter.picks).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('aborts an in-flight request on backgrounding and starts a fresh poll on foreground return', async () => {
    let firstSignal: AbortSignal | undefined;
    const adapter = makeAdapter({
      picks: vi.fn()
        .mockImplementationOnce((_cred: Cred, _draftId: string, signal?: AbortSignal) => new Promise<DraftPicks>((_resolve, reject) => {
          firstSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted by foreground refresh')), { once: true });
        }))
        .mockResolvedValueOnce(draftPicks(Date.now())),
    });
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange: () => {},
    });

    const started = controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.picks).toHaveBeenCalledTimes(1);

    controller.notifyHidden();
    expect(firstSignal?.aborted).toBe(true);
    await controller.notifyVisible();
    expect(adapter.picks).toHaveBeenCalledTimes(2);
    await started;

    controller.stop();
  });

  it('turns a timed-out request into a visible retryable failure', async () => {
    let signal: AbortSignal | undefined;
    const adapter = makeAdapter({
      picks: vi.fn().mockImplementation((_cred: Cred, _draftId: string, nextSignal?: AbortSignal) => new Promise<DraftPicks>((_resolve, reject) => {
        signal = nextSignal;
        nextSignal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
      })),
    });
    const onChange = vi.fn();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, requestTimeoutMs: 5000, onChange,
    });

    const started = controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    await started;

    expect(signal?.aborted).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      consecutiveFailures: 1,
      lastError: expect.objectContaining({ message: 'Draft picks request timed out after 5000ms.' }),
    }));
    controller.stop();
  });

  it('stop() prevents any further polling', async () => {
    const adapter = makeAdapter();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange: () => {},
    });
    await controller.start();
    controller.stop();

    await vi.advanceTimersByTimeAsync(10000);
    expect(adapter.picks).toHaveBeenCalledTimes(1);
  });

  it('goes to init-error phase if init() fails, without ever polling picks', async () => {
    const adapter = makeAdapter({ init: vi.fn().mockRejectedValue(new Error('nope')) });
    const onChange = vi.fn();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 1000, onChange,
    });

    await controller.start();

    expect(adapter.picks).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'init-error' }));
  });

  it('records poll-start and poll-response marks that bound the network wait', async () => {
    // Fake timers swap `performance` for one without mark/measure — use the real clock here.
    vi.useRealTimers();
    const adapter = makeAdapter();
    const controller = createDraftPollController({
      adapter, cred: CRED, draftId: 'd-1', intervalMs: 60_000, onChange: () => {},
    });
    await controller.start();

    const starts = performance.getEntriesByName('ffa:poll-1-start');
    const responses = performance.getEntriesByName('ffa:poll-1-response');
    expect(starts).toHaveLength(1);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.startTime).toBeGreaterThanOrEqual(starts[0]!.startTime);

    controller.stop();
  });
});

function snapshotAt(overrides: Partial<DraftPollSnapshot> = {}): DraftPollSnapshot {
  return {
    phase: 'ready',
    draftInit: DRAFT_INIT,
    draftPicks: draftPicks(1000),
    lastChangedPollId: null,
    ...IDLE_HEALTH,
    ...overrides,
  };
}

describe('shouldCommitPollSnapshot', () => {
  it('does not commit when only poll health changed on unchanged pick content', () => {
    const picks = draftPicks(1000);
    const current = snapshotAt({ draftPicks: picks, lastSuccessfulPollAt: 1000, lastChangedAt: 1000 });
    // The controller reuses the same draftPicks reference for unchanged content; only
    // health fields (fetchedAt-based timestamps, duration) moved.
    const next = snapshotAt({ draftPicks: picks, lastSuccessfulPollAt: 2000, lastChangedAt: 1000, requestDurationMs: 42 });
    expect(shouldCommitPollSnapshot(current, next)).toBe(false);
  });

  it('commits when the phase changes', () => {
    expect(shouldCommitPollSnapshot(snapshotAt({ phase: 'initializing' }), snapshotAt({ phase: 'ready' }))).toBe(true);
  });

  it('commits when pick content changes', () => {
    const changed: DraftPicks = {
      status: 'drafting',
      picks: [{ overall: 1, round: 1, slot: 1, teamId: 't1', playerId: 'p1', providerPlayerId: 'p1', providerPlayerName: 'P1' }],
      onTheClock: null,
      fetchedAt: 2000,
    };
    expect(shouldCommitPollSnapshot(snapshotAt(), snapshotAt({ draftPicks: changed, lastChangedAt: 2000 }))).toBe(true);
  });

  it('commits when an error changes the failure state', () => {
    expect(shouldCommitPollSnapshot(
      snapshotAt({ consecutiveFailures: 0, lastError: null }),
      snapshotAt({ consecutiveFailures: 1, lastError: new Error('boom') }),
    )).toBe(true);
  });
});

describe('useDraftPoll hook', () => {
  it('keeps the same draftPicks reference while unchanged content is polled again', async () => {
    const picksMock = vi.fn().mockImplementation(() => Promise.resolve(draftPicks(Date.now())));
    const adapter = makeAdapter({ picks: picksMock });
    render(createElement(PollProbe, { adapter, intervalMs: 1000 }));
    await act(async () => {});
    expect(picksMock).toHaveBeenCalledTimes(1);
    expect(probeDraftPicks).not.toBeNull();
    const firstPicks = probeDraftPicks;
    const firstSuccess = probeLastSuccessfulPollAt;

    // Two more intervals: the forceTick keeps re-rendering, but the unchanged pick content
    // must never produce a new draftPicks snapshot — only the ref-backed health advances.
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(picksMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(probeDraftPicks).toBe(firstPicks);
    expect(probeLastSuccessfulPollAt).toBeGreaterThan(firstSuccess ?? -1);
  });
});

describe('computeStaleness', () => {
  it('is not stale with no draftPicks yet', () => {
    expect(computeStaleness(null, 5000, Date.now())).toEqual({ isStale: false, dataAgeMs: null });
  });

  it('is not stale within staleAfterMs', () => {
    const now = 1_000_000;
    const result = computeStaleness(now - 1000, 5000, now);
    expect(result).toEqual({ isStale: false, dataAgeMs: 1000 });
  });

  it('is stale once older than staleAfterMs', () => {
    const now = 1_000_000;
    const result = computeStaleness(now - 6000, 5000, now);
    expect(result).toEqual({ isStale: true, dataAgeMs: 6000 });
  });
});
