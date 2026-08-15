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

describe('persistence', () => {
  it('round-trips a session through localStorage', () => {
    savePersistedSession({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'live',
      overrides: [OVERRIDE],
      frozenInit: null,
    });

    expect(loadPersistedSession()).toEqual({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'live',
      overrides: [OVERRIDE],
      frozenInit: null,
    });
  });

  it('round-trips a manual-takeover session including the frozen DraftInit', () => {
    savePersistedSession({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'manual',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
    });

    expect(loadPersistedSession()).toEqual({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'manual',
      overrides: [OVERRIDE],
      frozenInit: FROZEN_INIT,
    });
  });

  it('treats a legacy v1 record (no frozenInit field) as frozenInit: null', () => {
    localStorage.setItem('ffa.draftSession.v1', JSON.stringify({
      userId: 'u-3',
      draftId: 'd-1',
      mode: 'manual',
      overrides: [],
    }));
    expect(loadPersistedSession()).toEqual({
      userId: 'u-3',
      draftId: 'd-1',
      mode: 'manual',
      overrides: [],
      frozenInit: null,
    });
  });

  it('coerces a malformed frozenInit to null instead of crashing on mount', () => {
    localStorage.setItem('ffa.draftSession.v1', JSON.stringify({
      userId: null,
      draftId: null,
      mode: 'manual',
      overrides: [],
      frozenInit: { provider: 'sleeper' },
    }));
    expect(loadPersistedSession()?.frozenInit).toBeNull();
  });

  it('returns null when nothing has been saved', () => {
    expect(loadPersistedSession()).toBeNull();
  });

  it('returns null for corrupted stored JSON rather than throwing', () => {
    localStorage.setItem('ffa.draftSession.v1', '{not valid json');
    expect(loadPersistedSession()).toBeNull();
  });

  it('clearPersistedSession removes the stored session', () => {
    savePersistedSession({ userId: 'u-3', draftId: 'd-1', mode: 'manual', overrides: [], frozenInit: null });
    clearPersistedSession();
    expect(loadPersistedSession()).toBeNull();
  });
});
