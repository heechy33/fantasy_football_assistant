import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftInit, Pick as DraftPick, PickOverride, SavedDraft } from '../../../shared/types';
import type { SavedLeaguesRepository } from '../data/savedLeaguesRepository';

/** Controlled stand-ins for the two context hooks `useDraftSync` consumes — mutated directly by
 * tests and read through the module mocks below, so no real providers need mounting. */
const harness = vi.hoisted(() => ({
  authStatus: 'signed-in' as 'signed-in' | 'signed-out' | 'loading',
  sessionValue: null as Record<string, unknown> | null,
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    status: harness.authStatus,
    getToken: async () => 'test-token',
  }),
}));

vi.mock('../session/DraftSessionProvider', () => ({
  useDraftSession: () => harness.sessionValue,
}));

const {
  isMockLeagueId,
  mapProvider,
  shouldSyncDraft,
  isDraftComplete,
  sessionKindToMode,
  mergeOverrides,
  useDraftSync,
} = await import('./draftSync');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pickOverride(over: Partial<PickOverride> = {}): PickOverride {
  return {
    round: 1,
    slot: 1,
    teamId: 'team-1',
    ...over,
    overall: over.overall ?? 1,
    playerId: over.playerId ?? 'player-1',
    source: over.source ?? 'manual-correction',
    correctedAt: over.correctedAt ?? 1000,
  };
}

function draftInitFixture(over: Partial<DraftInit> = {}): DraftInit {
  return {
    provider: 'sleeper',
    draftId: 'draft-1',
    leagueId: 'league-1',
    draftType: 'snake',
    teams: 12,
    rounds: 15,
    slotToTeam: {},
    myTeamId: 'team-me',
    mySlot: 4,
    settings: { name: 'Test League' } as DraftInit['settings'],
    ...over,
  } as unknown as DraftInit;
}

function pick(overall: number): DraftPick {
  return { overall, round: 1, slot: 1, teamId: 'team-1', playerId: 'p', providerPlayerId: 'p' } as unknown as DraftPick;
}

function savedDraftFixture(over: Partial<SavedDraft>): SavedDraft {
  return {
    id: 'remote-draft-1',
    userId: 'user-1',
    leagueId: 'remote-league-1',
    provider: 'sleeper',
    providerDraftId: 'draft-1',
    mode: 'live',
    frozenInit: null,
    overrides: [],
    status: 'active',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function boardStub(opts: { overrides?: PickOverride[]; effectivePicks?: DraftPick[] } = {}) {
  return {
    state: { mode: 'live' as const, overrides: new Map((opts.overrides ?? []).map((o) => [o.overall, o])) },
    effectivePicks: opts.effectivePicks ?? [],
    applyOverride: vi.fn(),
  };
}

function sessionValueStub(opts: {
  kind?: 'connected' | 'manual' | 'bridge';
  init?: DraftInit | null;
  board?: ReturnType<typeof boardStub>;
  picksSignature?: string;
} = {}) {
  const kind = opts.kind ?? 'connected';
  const init = opts.init ?? draftInitFixture();
  const session = kind === 'connected'
    ? { kind, cred: { provider: 'sleeper', userId: 'u1' }, draftId: init.draftId }
    : kind === 'manual'
      ? { kind, frozenInit: init, reconnectCred: null, reconnectDraftId: null }
      : { kind, frozenInit: init };
  return {
    session,
    effectiveInit: init,
    board: opts.board ?? boardStub(),
    picksSignature: opts.picksSignature ?? 'sig-1',
  };
}

function repoStub() {
  return {
    listLeagues: vi.fn(async () => []),
    // Mimics the server contract: a client-supplied/absent id never comes back — the response
    // always carries the stored document's id.
    upsertLeague: vi.fn(async (league: Record<string, unknown>) =>
      ({ season: '', createdAt: '', updatedAt: '', userId: 'user-1', ...league, id: league.id ?? 'saved-league-1' })),
    deleteLeague: vi.fn(async () => undefined),
    listDrafts: vi.fn(async (): Promise<SavedDraft[]> => []),
    upsertDraft: vi.fn(async (draft: Record<string, unknown>) =>
      ({ createdAt: '', updatedAt: '', userId: 'user-1', ...draft, id: draft.id ?? 'saved-draft-1' })),
    deleteDraft: vi.fn(async () => undefined),
  };
}

/** First argument of a stub's first call — throws instead of propagating `undefined`, so the
 * typechecker sees a defined value and a missing call fails loudly rather than silently. */
function firstCallArg<A>(fn: { mock: { calls: A[][] } }): A {
  const arg = fn.mock.calls[0]?.[0];
  if (arg === undefined) throw new Error('expected the stub to have been called');
  return arg as A;
}

const SYNC_DEBOUNCE_MS = 5000;

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Latest mounted hook's rerender, so later describes can trigger content changes without
 * threading the renderHook result through every test. */
let rerenderLast: () => void = () => {};

function renderSync(repository: unknown) {
  const result = renderHook(() => useDraftSync(repository as unknown as SavedLeaguesRepository));
  rerenderLast = () => result.rerender();
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.authStatus = 'signed-in';
  harness.sessionValue = sessionValueStub() as unknown as Record<string, unknown>;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

describe('isMockLeagueId', () => {
  it('recognizes Sleeper standalone-mock league ids and nothing else', () => {
    expect(isMockLeagueId('mock:12345')).toBe(true);
    expect(isMockLeagueId('9876543210')).toBe(false);
    expect(isMockLeagueId('mockery-of-a-league-id')).toBe(false);
  });
});

describe('mapProvider', () => {
  it('passes through wired providers and degrades roadmap/stray ones to manual', () => {
    expect(mapProvider('sleeper')).toBe('sleeper');
    expect(mapProvider('espn')).toBe('espn');
    expect(mapProvider('yahoo')).toBe('manual');
    expect(mapProvider('manual')).toBe('manual');
  });
});

describe('shouldSyncDraft', () => {
  it('never syncs a Sleeper mock, active or complete', () => {
    expect(shouldSyncDraft('sleeper', 'mock:12345')).toBe(false);
  });

  it('syncs every other combination — real Sleeper leagues, ESPN, manual, stray providers', () => {
    expect(shouldSyncDraft('sleeper', '9876543210')).toBe(true);
    expect(shouldSyncDraft('espn', 'anything')).toBe(true);
    expect(shouldSyncDraft('yahoo', 'mock:12345')).toBe(true);
    expect(shouldSyncDraft('manual', '')).toBe(true);
  });
});

describe('isDraftComplete', () => {
  it('completes exactly when picks made reach teams × rounds', () => {
    const init = draftInitFixture({ teams: 12, rounds: 15 });
    expect(isDraftComplete(init, [pick(179)])).toBe(false);
    expect(isDraftComplete(init, [pick(180)])).toBe(true);
  });

  it('never reports an auction draft complete — count math is meaningless there', () => {
    const auction = draftInitFixture({ teams: 12, rounds: 15, draftType: 'auction' });
    expect(isDraftComplete(auction, [pick(200)])).toBe(false);
  });
});

describe('sessionKindToMode', () => {
  it('maps each session kind to its wire mode', () => {
    expect(sessionKindToMode('connected')).toBe('live');
    expect(sessionKindToMode('bridge')).toBe('espn');
    expect(sessionKindToMode('manual')).toBe('manual');
  });
});

describe('mergeOverrides', () => {
  it('keeps a correction that only exists remotely and one that only exists locally', () => {
    const localOnly = pickOverride({ overall: 3, playerId: 'local-only' });
    const remoteOnly = pickOverride({ overall: 7, playerId: 'remote-only' });
    const merged = mergeOverrides([localOnly], [remoteOnly]);
    expect(merged).toHaveLength(2);
    expect(merged.map((o) => o.playerId)).toContain('local-only');
    expect(merged.map((o) => o.playerId)).toContain('remote-only');
  });

  it('keeps whichever side was corrected later per pick', () => {
    const localNewer = pickOverride({ overall: 1, playerId: 'local-newer', correctedAt: 2000 });
    const remoteOlder = pickOverride({ overall: 1, playerId: 'remote-older', correctedAt: 1000 });
    expect(mergeOverrides([localNewer], [remoteOlder]).map((o) => o.playerId)).toEqual(['local-newer']);
    expect(mergeOverrides([remoteOlder], [localNewer]).map((o) => o.playerId)).toEqual(['local-newer']);
  });

  it('resolves an exact correctedAt tie to the local side', () => {
    const localTie = pickOverride({ overall: 1, playerId: 'local-tie', correctedAt: 2000 });
    const remoteTie = pickOverride({ overall: 1, playerId: 'remote-tie', correctedAt: 2000 });
    expect(mergeOverrides([localTie], [remoteTie]).map((o) => o.playerId)).toEqual(['local-tie']);
  });
});

describe('useDraftSync', () => {
  it('syncs league + draft once, after the debounce, when signed in', async () => {
    const repo = repoStub();
    renderSync(repo);

    await advance(SYNC_DEBOUNCE_MS - 1);
    expect(repo.upsertLeague).not.toHaveBeenCalled();

    await advance(1);
    expect(repo.upsertLeague).toHaveBeenCalledTimes(1);
    expect(repo.upsertDraft).toHaveBeenCalledTimes(1);

    const leagueArg = firstCallArg(repo.upsertLeague);
    expect(leagueArg.provider).toBe('sleeper');
    expect(leagueArg.providerLeagueId).toBe('league-1');

    const draftArg = firstCallArg(repo.upsertDraft);
    expect(draftArg.mode).toBe('live');
    expect(draftArg.providerDraftId).toBe('draft-1');
    expect(draftArg.status).toBe('active');
  });

  it('does not let an unrelated re-render reset the pending debounce', async () => {
    const repo = repoStub();
    const { rerender } = renderSync(repo);

    await advance(SYNC_DEBOUNCE_MS - 1);
    rerender(); // fresh provider render — same draftIdentity/picksSignature
    await advance(4000);

    expect(repo.upsertLeague).toHaveBeenCalledTimes(1);
  });

  it('re-arms the debounce when the transcript content changes mid-window', async () => {
    const repo = repoStub();
    harness.sessionValue = sessionValueStub({ picksSignature: 'sig-a' }) as unknown as Record<string, unknown>;
    const { rerender } = renderSync(repo);

    await advance(3000);
    harness.sessionValue = sessionValueStub({ picksSignature: 'sig-b' }) as unknown as Record<string, unknown>;
    rerender();

    await advance(3000); // t=6000 — old window abandoned at t=3000; the new one ends at t=8000
    expect(repo.upsertLeague).not.toHaveBeenCalled();

    await advance(2000); // t=8000
    expect(repo.upsertLeague).toHaveBeenCalledTimes(1);
  });

  it('never syncs while signed out', async () => {
    harness.authStatus = 'signed-out';
    const repo = repoStub();
    renderSync(repo);

    await advance(SYNC_DEBOUNCE_MS * 2);
    expect(repo.upsertLeague).not.toHaveBeenCalled();
    expect(repo.listDrafts).not.toHaveBeenCalled();
  });

  it('never syncs a Sleeper mock draft, even when signed in', async () => {
    harness.sessionValue = sessionValueStub({
      init: draftInitFixture({ leagueId: 'mock:12345', draftId: 'mock-draft-1' }),
    }) as unknown as Record<string, unknown>;
    const repo = repoStub();
    renderSync(repo);

    await advance(SYNC_DEBOUNCE_MS * 2);
    expect(repo.upsertLeague).not.toHaveBeenCalled();
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });
});

describe('useDraftSync — reconcile and retention', () => {
  it('aborts the sync cycle when reconciliation fails, then retries on the next change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = repoStub();
    repo.listDrafts.mockRejectedValueOnce(new Error('network blip'));

    renderSync(repo);
    await advance(SYNC_DEBOUNCE_MS);

    // The failed cycle attempted the reconcile but wrote nothing — and did not poison the key.
    expect(repo.listDrafts).toHaveBeenCalledTimes(1);
    expect(repo.upsertLeague).not.toHaveBeenCalled();

    // A content change re-arms the effect → a fresh debounced cycle retries the reconcile.
    harness.sessionValue = sessionValueStub({ picksSignature: 'sig-b' }) as unknown as Record<string, unknown>;
    rerenderLast();
    await advance(SYNC_DEBOUNCE_MS);

    expect(repo.listDrafts).toHaveBeenCalledTimes(2);
    expect(repo.upsertLeague).toHaveBeenCalledTimes(1);
  });

  it('deletes a completed real-Sleeper transcript and never re-upserts it', async () => {
    const completedPicks = Array.from({ length: 180 }, (_, i) => pick(i + 1));
    const repo = repoStub();
    repo.listDrafts.mockResolvedValue([
      savedDraftFixture({ id: 'remote-draft-1', leagueId: 'remote-league-1', providerDraftId: 'draft-1' }),
    ]);
    harness.sessionValue = sessionValueStub({
      init: draftInitFixture({ leagueId: 'league-real', draftId: 'draft-1' }),
      board: boardStub({ effectivePicks: completedPicks }),
      picksSignature: 'complete',
    }) as unknown as Record<string, unknown>;

    renderSync(repo);
    await advance(SYNC_DEBOUNCE_MS);

    expect(repo.deleteDraft).toHaveBeenCalledWith('remote-draft-1');
    expect(repo.upsertDraft).not.toHaveBeenCalled();
    // The league pointer survives the transcript.
    expect(repo.upsertLeague).toHaveBeenCalledTimes(1);
  });

  it('keeps a completed manual/ESPN transcript durably instead of deleting it', async () => {
    const init = draftInitFixture({ provider: 'manual', leagueId: 'manual-league', draftId: 'manual-draft' });
    const completedPicks = Array.from({ length: 180 }, (_, i) => pick(i + 1));
    const repo = repoStub();
    harness.sessionValue = sessionValueStub({
      kind: 'manual',
      init,
      board: boardStub({ effectivePicks: completedPicks }),
      picksSignature: 'complete',
    }) as unknown as Record<string, unknown>;

    renderSync(repo);
    await advance(SYNC_DEBOUNCE_MS);

    expect(repo.deleteDraft).not.toHaveBeenCalled();
    expect(repo.upsertDraft).toHaveBeenCalledTimes(1);
    const draftArg = firstCallArg(repo.upsertDraft);
    expect(draftArg.mode).toBe('manual');
    expect(draftArg.status).toBe('complete');
    expect(draftArg.frozenInit).toBe(init);
  });

  it('adopts a remote draft matched by providerDraftId, merges its overrides onto the local board, and upserts under the adopted ids', async () => {
    const remoteOnly = pickOverride({ overall: 7, playerId: 'remote-only-pick', correctedAt: 9999 });
    const repo = repoStub();
    repo.listDrafts.mockResolvedValue([
      savedDraftFixture({
        id: 'remote-draft-1',
        leagueId: 'remote-league-1',
        providerDraftId: 'draft-1',
        overrides: [remoteOnly],
      }),
    ]);
    const board = boardStub({ overrides: [pickOverride({ overall: 3, playerId: 'local-pick', correctedAt: 1000 })] });
    harness.sessionValue = sessionValueStub({ board }) as unknown as Record<string, unknown>;

    renderSync(repo);
    await advance(SYNC_DEBOUNCE_MS);

    expect(board.applyOverride).toHaveBeenCalledWith(remoteOnly);
    const draftArg = firstCallArg(repo.upsertDraft);
    expect(draftArg.id).toBe('remote-draft-1');
    expect(draftArg.leagueId).toBe('remote-league-1');

    const leagueArg = firstCallArg(repo.upsertLeague);
    expect(leagueArg.id).toBe('remote-league-1');
  });

  it('mints new server-side ids for a draft with no existing remote counterpart', async () => {
    const repo = repoStub();
    renderSync(repo);
    await advance(SYNC_DEBOUNCE_MS);

    expect(repo.listDrafts).toHaveBeenCalledTimes(1);
    const draftArg = firstCallArg(repo.upsertDraft);
    expect(draftArg.id).toBeUndefined();
    expect(draftArg.leagueId).toBe('saved-league-1'); // adopted from the upserted league's response
  });

  // Regression (2026-08-26): once a league can be saved from /leagues/connect before any draft
  // exists, tracking its draft later must UPDATE that SavedLeague in place — reconcileOnce used
  // to adopt savedLeagueId only from a matching remote draft, so with no draft on file the next
  // sync created a second league doc and /leagues showed it twice.
  it('adopts a pre-existing saved LEAGUE when no remote draft matches, so the upsert is not a duplicate', async () => {
    const repo = repoStub();
    repo.listDrafts.mockResolvedValue([]); // no draft yet — the /leagues-connect-first case
    repo.listLeagues.mockResolvedValue([
      {
        id: 'saved-league-existing',
        userId: 'user-1',
        provider: 'sleeper',
        providerLeagueId: 'league-1', // matches effectiveInit.leagueId via mapProvider('sleeper')
        name: 'Work League',
        season: '2026',
        teams: 12,
        rounds: 0,
        mySlot: null,
        settings: { provider: 'sleeper', leagueId: 'league-1' },
        createdAt: '',
        updatedAt: '',
      } as never,
    ]);

    renderSync(repo);
    await advance(SYNC_DEBOUNCE_MS);

    expect(repo.listLeagues).toHaveBeenCalledTimes(1);
    const leagueArg = firstCallArg(repo.upsertLeague);
    expect(leagueArg.id).toBe('saved-league-existing');
  });

  it('mints a fresh league id when neither a draft nor a matching league exists server-side', async () => {
    const repo = repoStub();
    renderSync(repo);
    await advance(SYNC_DEBOUNCE_MS);

    expect(repo.listLeagues).toHaveBeenCalledTimes(1); // the fallback check still ran, once
    expect(firstCallArg(repo.upsertLeague).id).toBeUndefined();
  });
});



