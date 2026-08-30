import { describe, expect, it } from 'vitest';
import type { DraftInit, Pick as DraftPick } from '../../../shared/types';
import { isDraftComplete, isSessionComplete } from './completion';

function draftInitFixture(over: Partial<DraftInit> = {}): DraftInit {
  return {
    provider: 'sleeper',
    draftId: 'draft-1',
    leagueId: 'league-1',
    draftType: 'snake',
    teams: 2,
    rounds: 2,
    slotToTeam: {},
    myTeamId: 'team-me',
    mySlot: 1,
    settings: { name: 'Test League' } as DraftInit['settings'],
    ...over,
  } as unknown as DraftInit;
}

function pick(overall: number): DraftPick {
  return { overall, round: 1, slot: 1, teamId: 'team-1', playerId: 'p', providerPlayerId: 'p' } as unknown as DraftPick;
}

describe('isDraftComplete', () => {
  it('is complete once picksMade reaches teams * rounds', () => {
    const init = draftInitFixture({ teams: 2, rounds: 2 });
    expect(isDraftComplete(init, [pick(1), pick(2), pick(3)])).toBe(false);
    expect(isDraftComplete(init, [pick(1), pick(2), pick(3), pick(4)])).toBe(true);
  });

  it('never reports complete for an auction draft, regardless of pick count', () => {
    const init = draftInitFixture({ draftType: 'auction', teams: 2, rounds: 2 });
    expect(isDraftComplete(init, [pick(1), pick(2), pick(3), pick(4), pick(5)])).toBe(false);
  });
});

describe('isSessionComplete', () => {
  it('is complete when the count rule holds, with no pollStatus at all', () => {
    const init = draftInitFixture({ teams: 2, rounds: 2 });
    expect(isSessionComplete({ init, effectivePicks: [pick(1), pick(2), pick(3), pick(4)] })).toBe(true);
  });

  it('is not complete on a partial board with no corroborating pollStatus', () => {
    const init = draftInitFixture({ teams: 2, rounds: 2 });
    expect(isSessionComplete({ init, effectivePicks: [pick(1)] })).toBe(false);
  });

  it('is complete on a short board when the adapter corroborates with status "complete"', () => {
    const init = draftInitFixture({ teams: 2, rounds: 2 });
    expect(isSessionComplete({ init, effectivePicks: [pick(1)], pollStatus: 'complete' })).toBe(true);
  });

  it('is NOT complete on the same short board with no pollStatus — the bridge/manual case', () => {
    // Bridge and manual sessions have no poll (draftId is null for them), so pollStatus is always
    // undefined for them. This is the case that proves the adapter flag is a corroborator only:
    // an ESPN/manual session sitting at the same short board as the case above must stay
    // in-progress, since the count rule is its only possible completion signal.
    const init = draftInitFixture({ teams: 2, rounds: 2 });
    expect(isSessionComplete({ init, effectivePicks: [pick(1)] })).toBe(false);
  });

  it('a non-complete pollStatus does not override a completed count', () => {
    const init = draftInitFixture({ teams: 2, rounds: 2 });
    expect(isSessionComplete({
      init,
      effectivePicks: [pick(1), pick(2), pick(3), pick(4)],
      pollStatus: 'drafting',
    })).toBe(true);
  });
});
