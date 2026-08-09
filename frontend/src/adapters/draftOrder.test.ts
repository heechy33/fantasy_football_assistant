import { describe, expect, it } from 'vitest';
import type { Pick } from '../../../shared/types';
import { canonicalPicksSignature, computeOnTheClock, deriveDraftStatus, nextPickForTeam, userPickBoundaries } from './draftOrder';

const TEAMS = 12;
const ROUNDS = 15;
const SLOT_TO_TEAM: Record<number, string> = Object.fromEntries(
  Array.from({ length: TEAMS }, (_, i) => [i + 1, `team-${i + 1}`]),
);

describe('computeOnTheClock', () => {
  it('starts round 1 ascending from slot 1', () => {
    expect(computeOnTheClock('snake', TEAMS, ROUNDS, 0, SLOT_TO_TEAM)).toEqual({
      teamId: 'team-1',
      slot: 1,
      round: 1,
      overall: 1,
    });
  });

  it('ends round 1 at the last slot', () => {
    expect(computeOnTheClock('snake', TEAMS, ROUNDS, 11, SLOT_TO_TEAM)).toEqual({
      teamId: 'team-12',
      slot: 12,
      round: 1,
      overall: 12,
    });
  });

  it('reverses at the round 1 -> round 2 boundary (last slot drafts twice in a row)', () => {
    expect(computeOnTheClock('snake', TEAMS, ROUNDS, 12, SLOT_TO_TEAM)).toEqual({
      teamId: 'team-12',
      slot: 12,
      round: 2,
      overall: 13,
    });
  });

  it('ends round 2 back at slot 1', () => {
    expect(computeOnTheClock('snake', TEAMS, ROUNDS, 23, SLOT_TO_TEAM)).toEqual({
      teamId: 'team-1',
      slot: 1,
      round: 2,
      overall: 24,
    });
  });

  it('reverses again into round 3 (ascending, same direction as round 1)', () => {
    expect(computeOnTheClock('snake', TEAMS, ROUNDS, 24, SLOT_TO_TEAM)).toEqual({
      teamId: 'team-1',
      slot: 1,
      round: 3,
      overall: 25,
    });
  });

  it('returns null once every pick has been made', () => {
    expect(computeOnTheClock('snake', TEAMS, ROUNDS, TEAMS * ROUNDS, SLOT_TO_TEAM)).toBeNull();
  });

  it('never reverses for a linear draft', () => {
    expect(computeOnTheClock('linear', TEAMS, ROUNDS, 12, SLOT_TO_TEAM)).toEqual({
      teamId: 'team-1',
      slot: 1,
      round: 2,
      overall: 13,
    });
  });

  it('is a documented no-op for auction drafts', () => {
    expect(computeOnTheClock('auction', TEAMS, ROUNDS, 0, SLOT_TO_TEAM)).toBeNull();
  });

  it('returns null when the computed slot has no team mapping', () => {
    expect(computeOnTheClock('snake', TEAMS, ROUNDS, 0, {})).toBeNull();
  });
});

describe('deriveDraftStatus', () => {
  it('passes through pre_draft as pre', () => {
    expect(deriveDraftStatus('pre_draft', 0, TEAMS, ROUNDS)).toBe('pre');
  });

  it('passes through drafting while picks remain', () => {
    expect(deriveDraftStatus('drafting', 10, TEAMS, ROUNDS)).toBe('drafting');
  });

  it('passes through complete', () => {
    expect(deriveDraftStatus('complete', TEAMS * ROUNDS, TEAMS, ROUNDS)).toBe('complete');
  });

  it('overrides a lagging raw status to complete once every pick is made', () => {
    expect(deriveDraftStatus('drafting', TEAMS * ROUNDS, TEAMS, ROUNDS)).toBe('complete');
  });

  it('overrides a stale pre_draft snapshot to drafting once any pick exists', () => {
    // rawStatus reflects init()-time reality only; picks() never refetches it,
    // so a real pick having landed is itself proof drafting has started.
    expect(deriveDraftStatus('pre_draft', 1, TEAMS, ROUNDS)).toBe('drafting');
  });
});
describe('nextPickForTeam', () => {
  it('finds the following personal turn when the user is currently on the clock', () => {
    expect(nextPickForTeam('snake', TEAMS, ROUNDS, 0, SLOT_TO_TEAM, 'team-1', true)).toBe(24);
  });
  it('finds the upcoming personal turn when someone else is on the clock', () => {
    expect(nextPickForTeam('snake', TEAMS, ROUNDS, 15, SLOT_TO_TEAM, 'team-3')).toBe(22);
  });
});

describe('userPickBoundaries', () => {
  it('opponent-on-clock boundary: decisionPick is the upcoming personal turn, not the pick in progress', () => {
    // 15 picks made; team-3 (a mid-slot team) is not currently on the clock. decisionPick must be
    // team-3's own next selection (22, per the nextPickForTeam test above), never picksCount+1's
    // pick, which belongs to whichever opponent is actually on the clock at that point.
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, 15, SLOT_TO_TEAM, 'team-3');
    expect(boundaries.decisionPick).toBe(22);
    // followUpPick is team-3's *next* pick after that — round 3, ascending again, slot 3.
    expect(boundaries.followUpPick).toBe(27);
    // The opponent simulation window (decisionPick+1 .. followUpPick-1 = 23..26) must never
    // include decisionPick (22) or followUpPick (27) themselves.
    expect(boundaries.decisionPick).not.toBe(23);
    expect(boundaries.followUpPick).not.toBe(26);
  });

  it('snake-turn boundary: the last slot has back-to-back picks, so the opponent window is empty', () => {
    // team-12 picks at the round1/round2 turn boundary (12, then immediately 13) — this is the
    // documented edge case where followUpPick === decisionPick + 1 and no opponent is simulated.
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, 11, SLOT_TO_TEAM, 'team-12');
    expect(boundaries.decisionPick).toBe(12);
    expect(boundaries.followUpPick).toBe(13);
    expect(boundaries.followUpPick).toBe((boundaries.decisionPick ?? 0) + 1);
  });

  it('end-of-draft: followUpPick is null when the decision pick is the team\'s last selection', () => {
    // Round 15 (the final round, ascending since 15 is odd) is team-1's last pick, at overall 169
    // (14 full rounds * 12 teams + 1). No further team-1 pick exists in a 12x15 draft.
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, 168, SLOT_TO_TEAM, 'team-1');
    expect(boundaries.decisionPick).toBe(169);
    expect(boundaries.followUpPick).toBeNull();
  });

  it('draft already complete: both boundaries are null', () => {
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, TEAMS * ROUNDS, SLOT_TO_TEAM, 'team-1');
    expect(boundaries.decisionPick).toBeNull();
    expect(boundaries.followUpPick).toBeNull();
  });

  it('no team id: both boundaries are null', () => {
    const boundaries = userPickBoundaries('snake', TEAMS, ROUNDS, 0, SLOT_TO_TEAM, null);
    expect(boundaries.decisionPick).toBeNull();
    expect(boundaries.followUpPick).toBeNull();
  });

  it('auction drafts are a documented no-op, matching nextPickForTeam', () => {
    const boundaries = userPickBoundaries('auction', TEAMS, ROUNDS, 0, SLOT_TO_TEAM, 'team-1');
    expect(boundaries.decisionPick).toBeNull();
    expect(boundaries.followUpPick).toBeNull();
  });
});

describe('canonicalPicksSignature', () => {
  function pick(overrides: Partial<Pick>): Pick {
    return { overall: 1, round: 1, slot: 1, teamId: 'team-1', playerId: 'p1', providerPlayerId: 'p1', ...overrides };
  }

  it('is independent of input array order', () => {
    const a = [pick({ overall: 1 }), pick({ overall: 2, teamId: 'team-2' })];
    const b = [pick({ overall: 2, teamId: 'team-2' }), pick({ overall: 1 })];
    expect(canonicalPicksSignature(a)).toBe(canonicalPicksSignature(b));
  });

  it('changes when a pick\'s team ownership changes, even though the player is the same', () => {
    // This is the review-round-2 fix: opponent-need modeling depends on team ownership, so a
    // manual correction reassigning a pick's team must change the signature (and therefore the
    // derived RNG seed) even though overall/playerId are unchanged.
    const a = [pick({ overall: 5, teamId: 'team-3', playerId: 'p9' })];
    const b = [pick({ overall: 5, teamId: 'team-7', playerId: 'p9' })];
    expect(canonicalPicksSignature(a)).not.toBe(canonicalPicksSignature(b));
  });

  it('changes when a pick\'s slot changes', () => {
    const a = [pick({ overall: 5, slot: 3 })];
    const b = [pick({ overall: 5, slot: 4 })];
    expect(canonicalPicksSignature(a)).not.toBe(canonicalPicksSignature(b));
  });

  it('renders an unmatched (crosswalk-miss) pick distinctly from a matched one', () => {
    const matched = [pick({ overall: 5, playerId: 'p9' })];
    const unmatched = [pick({ overall: 5, playerId: null })];
    expect(canonicalPicksSignature(matched)).not.toBe(canonicalPicksSignature(unmatched));
  });

  it('length-frames opaque fields, preventing delimiter collisions inside team/player ids', () => {
    const a = [pick({ overall: 1, teamId: 'a', slot: 2, playerId: '3:x' })];
    const b = [pick({ overall: 1, teamId: 'a:2', slot: 3, playerId: 'x' })];
    expect(canonicalPicksSignature(a)).not.toBe(canonicalPicksSignature(b));
  });

  it('is deterministic for identical input', () => {
    const picks = [pick({ overall: 1 }), pick({ overall: 2, teamId: 'team-2' })];
    expect(canonicalPicksSignature(picks)).toBe(canonicalPicksSignature([...picks]));
  });

  it('handles an empty pick list', () => {
    expect(canonicalPicksSignature([])).toBe('');
  });
});
