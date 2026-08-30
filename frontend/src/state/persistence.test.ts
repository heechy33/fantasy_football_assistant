import { afterEach, describe, expect, it } from 'vitest';
import { clearPersistedSession, loadPersistedSession, savePersistedSession } from './persistence';
import type { PickOverride } from './draftBoardState';
import type { DraftInit } from '../../../shared/types';

const OVERRIDE: PickOverride = {
  overall: 4,
  playerId: 'player-B',
  source: 'manual-correction',
  correctedAt: 1786060800000,
};

const FROZEN_INIT: DraftInit = {
  provider: 'sleeper',
  draftId: 'raw-draft-ppr',
  leagueId: 'raw-league-ppr',
  draftType: 'snake',
  teams: 12,
  rounds: 15,
  slotToTeam: { 1: 'me', 2: 'them' },
  myTeamId: 'me',
  mySlot: 1,
  settings: {
    provider: 'sleeper',
    leagueId: 'raw-league-ppr',
    name: 'PPR',
    season: '2026',
    teams: 12,
    startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
    rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 7 },
    scoring: { rec: 1 },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  },
};

afterEach(() => {
  localStorage.clear();
});

/** Every field a live (non-complete) record leaves at its null default — spread into a round-trip
 * expectation so adding a future complete-only field doesn't require editing every other test. */
const NULL_COMPLETION_FIELDS = { completedAt: null, from: null, provider: null, savedLeagueId: null };

describe('persistence', () => {
  it('round-trips a session through localStorage', () => {
    savePersistedSession({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'live',
      overrides: [OVERRIDE],
      frozenInit: null,
      ...NULL_COMPLETION_FIELDS,
    });

    expect(loadPersistedSession()).toEqual({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'live',
      overrides: [OVERRIDE],
      frozenInit: null,
      ...NULL_COMPLETION_FIELDS,
    });
  });

  it('round-trips a manual-takeover session including the frozen DraftInit', () => {
    savePersistedSession({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'manual',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
      ...NULL_COMPLETION_FIELDS,
    });

    expect(loadPersistedSession()).toEqual({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'manual',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
      ...NULL_COMPLETION_FIELDS,
    });
  });

  it('round-trips an ESPN bridge session (mode espn, board runs live)', () => {
    savePersistedSession({
      userId: null,
      draftId: null,
      mode: 'espn',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
      ...NULL_COMPLETION_FIELDS,
    });

    expect(loadPersistedSession()).toEqual({
      userId: null,
      draftId: null,
      mode: 'espn',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
      ...NULL_COMPLETION_FIELDS,
    });
  });

  it('round-trips a completed session (mode complete, plus completedAt/from/provider/savedLeagueId)', () => {
    savePersistedSession({
      userId: null,
      draftId: null,
      mode: 'complete',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
      completedAt: '2026-08-28T12:00:00.000Z',
      from: 'espn',
      provider: 'espn',
      savedLeagueId: 'league-42',
    });

    expect(loadPersistedSession()).toEqual({
      userId: null,
      draftId: null,
      mode: 'complete',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
      completedAt: '2026-08-28T12:00:00.000Z',
      from: 'espn',
      provider: 'espn',
      savedLeagueId: 'league-42',
    });
  });

  // The persisted shape changed under v2 (mode gained 'espn'; ESPN bridge picks no longer arrive
  // as overrides — see the ESPN sync-restoration plan, 2026-08-15). A v1 record must be ignored
  // wholesale, not half-restored: replaying its `mode: 'manual'` (the only value the old build could
  // write for a bridge session) would silently disarm the bridge on reload while the UI still shows
  // an ESPN session as active.
  it('ignores a legacy v1 record entirely (migration gap fix, not a partial restore)', () => {
    localStorage.setItem('ffa.draftSession.v1', JSON.stringify({
      userId: 'u-3',
      draftId: 'd-1',
      mode: 'manual',
      overrides: [],
    }));
    expect(loadPersistedSession()).toBeNull();
  });

  // v2 -> v3 bump (2026-08-28, mode gained 'complete'): same reasoning as v1 -> v2 above, a v2
  // record must be dropped wholesale rather than half-restored — it has no completedAt/from/
  // provider/savedLeagueId fields at all, so there's nothing sensible to reconstruct.
  it('ignores a legacy v2 record entirely, not just a v1 one', () => {
    localStorage.setItem('ffa.draftSession.v2', JSON.stringify({
      userId: 'u-3',
      draftId: 'd-1',
      mode: 'manual',
      overrides: [],
      frozenInit: null,
    }));
    expect(loadPersistedSession()).toBeNull();
  });

  it('coerces a malformed frozenInit to null instead of crashing on mount', () => {
    localStorage.setItem('ffa.draftSession.v3', JSON.stringify({
      userId: null,
      draftId: null,
      mode: 'manual',
      overrides: [],
      frozenInit: { provider: 'sleeper' },
    }));
    expect(loadPersistedSession()?.frozenInit).toBeNull();
  });

  it('coerces an unrecognized mode to "live" rather than crashing or defaulting to "complete"', () => {
    localStorage.setItem('ffa.draftSession.v3', JSON.stringify({
      userId: null,
      draftId: null,
      mode: 'not-a-real-mode',
      overrides: [],
      frozenInit: null,
    }));
    expect(loadPersistedSession()?.mode).toBe('live');
  });

  it('returns null when nothing has been saved', () => {
    expect(loadPersistedSession()).toBeNull();
  });

  it('returns null for corrupted stored JSON rather than throwing', () => {
    localStorage.setItem('ffa.draftSession.v3', '{not valid json');
    expect(loadPersistedSession()).toBeNull();
  });

  it('clearPersistedSession removes the stored session', () => {
    savePersistedSession({
      userId: 'u-3',
      draftId: 'd-1',
      mode: 'manual',
      overrides: [],
      frozenInit: null,
      ...NULL_COMPLETION_FIELDS,
    });
    clearPersistedSession();
    expect(loadPersistedSession()).toBeNull();
  });
});
