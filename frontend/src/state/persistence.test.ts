import { afterEach, describe, expect, it } from 'vitest';
import { clearPersistedSession, loadPersistedSession, savePersistedSession } from './persistence';
import type { PickOverride } from './draftBoardState';

const OVERRIDE: PickOverride = {
  overall: 4,
  playerId: 'player-B',
  source: 'manual-correction',
  correctedAt: 1786060800000,
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
    });

    expect(loadPersistedSession()).toEqual({
      userId: 'u-3',
      draftId: 'raw-draft-ppr',
      mode: 'live',
      overrides: [OVERRIDE],
    });
  });

  it('returns null when nothing has been saved', () => {
    expect(loadPersistedSession()).toBeNull();
  });

  it('returns null for corrupted stored JSON rather than throwing', () => {
    localStorage.setItem('ffa.draftSession.v1', '{not valid json');
    expect(loadPersistedSession()).toBeNull();
  });

  it('clearPersistedSession removes the stored session', () => {
    savePersistedSession({ userId: 'u-3', draftId: 'd-1', mode: 'manual', overrides: [] });
    clearPersistedSession();
    expect(loadPersistedSession()).toBeNull();
  });
});
