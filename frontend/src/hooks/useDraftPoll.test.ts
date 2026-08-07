import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cred, DraftInit, DraftPicks, ProviderAdapter } from '../../../shared/types';
import { computeStaleness, createDraftPollController } from './useDraftPoll';

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
});

describe('computeStaleness', () => {
  it('is not stale with no draftPicks yet', () => {
    expect(computeStaleness(null, 5000, Date.now())).toEqual({ isStale: false, dataAgeMs: null });
  });

  it('is not stale within staleAfterMs', () => {
    const now = 1_000_000;
    const result = computeStaleness(draftPicks(now - 1000), 5000, now);
    expect(result).toEqual({ isStale: false, dataAgeMs: 1000 });
  });

  it('is stale once older than staleAfterMs', () => {
    const now = 1_000_000;
    const result = computeStaleness(draftPicks(now - 6000), 5000, now);
    expect(result).toEqual({ isStale: true, dataAgeMs: 6000 });
  });
});
