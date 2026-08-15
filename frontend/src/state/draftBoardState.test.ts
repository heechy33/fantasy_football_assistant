import { describe, expect, it } from 'vitest';
import type { Pick } from '../../../shared/types';
import {
  applyOverride,
  computeEffectivePicks,
  createDraftBoardState,
  freezeLivePicksToOverrides,
  setLivePicks,
  setMode,
  undoOverride,
} from './draftBoardState';

function pick(overall: number, playerId: string, teamId = `team-${overall}`): Pick {
  return {
    overall,
    round: 1,
    slot: overall,
    teamId,
    playerId,
    providerPlayerId: playerId,
  };
}

describe('createDraftBoardState', () => {
  it('starts empty in live mode by default', () => {
    const state = createDraftBoardState();
    expect(state.mode).toBe('live');
    expect(state.livePicks).toEqual([]);
    expect(state.overrides.size).toBe(0);
  });
});

describe('setLivePicks', () => {
  it('replaces live picks in live mode', () => {
    const state = setLivePicks(createDraftBoardState(), [pick(1, 'A')]);
    expect(computeEffectivePicks(state)).toEqual([pick(1, 'A')]);
  });

  it('is a no-op in manual mode — manual sessions never have a live layer', () => {
    const state = setLivePicks(createDraftBoardState('manual'), [pick(1, 'A')]);
    expect(state.livePicks).toEqual([]);
  });

  it('keeps the same state identity when pick content is unchanged', () => {
    const first = setLivePicks(createDraftBoardState(), [pick(1, 'A')]);
    const second = setLivePicks(first, [pick(1, 'A')]);
    expect(second).toBe(first);
  });
});

describe('computeEffectivePicks — plain live picks, no overrides', () => {
  it('returns live picks sorted by overall', () => {
    const state = setLivePicks(createDraftBoardState(), [pick(2, 'B'), pick(1, 'A')]);
    expect(computeEffectivePicks(state).map((p) => p.overall)).toEqual([1, 2]);
  });
});

describe('override precedence (exit criterion 3: correction never corrupts availability)', () => {
  it('a correction wins over the live pick at the same overall', () => {
    let state = setLivePicks(createDraftBoardState(), [pick(4, 'player-A')]);
    state = applyOverride(state, {
      overall: 4,
      playerId: 'player-B',
      source: 'manual-correction',
      correctedAt: 1,
    });

    const effective = computeEffectivePicks(state);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.playerId).toBe('player-B');
    // player-A is not drafted anywhere else — no duplicate-drafted state left behind
    expect(effective.some((p) => p.playerId === 'player-A')).toBe(false);
  });

  it('a later poll updating livePicks never overwrites an existing override', () => {
    let state = setLivePicks(createDraftBoardState(), [pick(4, 'player-A')]);
    state = applyOverride(state, {
      overall: 4,
      playerId: 'player-B',
      source: 'manual-correction',
      correctedAt: 1,
    });

    // simulate the next poll re-reporting the (still wrong, from Sleeper's view) live value
    state = setLivePicks(state, [pick(4, 'player-A')]);

    expect(computeEffectivePicks(state)[0]?.playerId).toBe('player-B');
  });

  it('undo restores whatever the live layer currently holds', () => {
    let state = setLivePicks(createDraftBoardState(), [pick(4, 'player-A')]);
    state = applyOverride(state, {
      overall: 4,
      playerId: 'player-B',
      source: 'manual-correction',
      correctedAt: 1,
    });
    state = undoOverride(state, 4);

    expect(computeEffectivePicks(state)[0]?.playerId).toBe('player-A');
  });

  it('undoing a pure manual-entry (no live counterpart) removes it from the board entirely', () => {
    let state = createDraftBoardState();
    state = applyOverride(state, {
      overall: 1,
      round: 1,
      slot: 1,
      teamId: 'team-1',
      playerId: 'player-Z',
      source: 'manual-entry',
      correctedAt: 1,
    });
    expect(computeEffectivePicks(state)).toHaveLength(1);

    state = undoOverride(state, 1);
    expect(computeEffectivePicks(state)).toHaveLength(0);
  });

  it('undoing an overall with no override is a no-op', () => {
    const state = setLivePicks(createDraftBoardState(), [pick(1, 'A')]);
    const unchanged = undoOverride(state, 999);
    expect(unchanged).toBe(state);
  });
});

describe('manual mode', () => {
  it('setMode("manual") clears any live picks', () => {
    let state = setLivePicks(createDraftBoardState(), [pick(1, 'A')]);
    state = setMode(state, 'manual');
    expect(state.livePicks).toEqual([]);
  });

  it('a manual-entry override fully specifies a pick with no live counterpart', () => {
    let state = createDraftBoardState('manual');
    state = applyOverride(state, {
      overall: 1,
      round: 1,
      slot: 1,
      teamId: 'team-1',
      playerId: 'player-Q',
      providerPlayerName: 'Player Q',
      source: 'manual-entry',
      correctedAt: 1,
    });

    expect(computeEffectivePicks(state)).toEqual([
      {
        overall: 1,
        round: 1,
        slot: 1,
        teamId: 'team-1',
        playerId: 'player-Q',
        providerPlayerId: 'player-Q',
        providerPlayerName: 'Player Q',
      },
    ]);
  });
});

describe('freezeLivePicksToOverrides — atomic manual takeover', () => {
  it('converts every effective live pick into a complete manual-entry override retaining both ids', () => {
    const livePicks: Pick[] = [
      { overall: 1, round: 1, slot: 1, teamId: 'team-1', playerId: 'player-A', providerPlayerId: 'espn-1', providerPlayerName: 'Player A' },
      { overall: 2, round: 1, slot: 2, teamId: 'team-2', playerId: 'player-B', providerPlayerId: 'espn-2', providerPlayerName: 'Player B' },
    ];
    const frozen = freezeLivePicksToOverrides(setLivePicks(createDraftBoardState(), livePicks));

    expect(frozen.mode).toBe('manual');
    expect(frozen.livePicks).toEqual([]);
    expect(frozen.overrides.size).toBe(2);
    expect(computeEffectivePicks(frozen)).toEqual(livePicks);
    for (const override of frozen.overrides.values()) {
      expect(override.source).toBe('manual-entry');
      expect(override.round).toBe(1);
      expect(override.teamId).toBeDefined();
      expect(override.providerPlayerId).toBeDefined();
    }
  });

  it('freezes an existing correction as an override too, while keeping the corrected player', () => {
    let state = setLivePicks(createDraftBoardState(), [pick(1, 'A'), pick(2, 'B')]);
    state = applyOverride(state, {
      overall: 2,
      playerId: 'player-C',
      source: 'manual-correction',
      correctedAt: 1,
    });

    const frozen = freezeLivePicksToOverrides(state);
    expect(frozen.mode).toBe('manual');
    expect(frozen.overrides.get(2)?.source).toBe('manual-entry');
    expect(frozen.overrides.get(2)?.playerId).toBe('player-C');
    expect(computeEffectivePicks(frozen).map((p) => p.playerId)).toEqual(['A', 'player-C']);
  });

  it('is idempotent when already in manual mode', () => {
    let state = createDraftBoardState('manual');
    state = applyOverride(state, {
      overall: 1,
      round: 1,
      slot: 1,
      teamId: 'team-1',
      playerId: 'player-A',
      providerPlayerName: 'Player A',
      source: 'manual-entry',
      correctedAt: 1,
    });

    const frozen = freezeLivePicksToOverrides(state);
    expect(frozen.mode).toBe('manual');
    expect(frozen.overrides.size).toBe(1);
    expect(frozen.overrides.get(1)).toMatchObject({
      overall: 1,
      playerId: 'player-A',
      providerPlayerId: 'player-A',
      providerPlayerName: 'Player A',
    });
  });

  it('freezing an empty board yields an empty manual state', () => {
    const frozen = freezeLivePicksToOverrides(createDraftBoardState());
    expect(frozen.mode).toBe('manual');
    expect(frozen.livePicks).toEqual([]);
    expect(frozen.overrides.size).toBe(0);
  });
});
