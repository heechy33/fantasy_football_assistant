import { describe, expect, it } from 'vitest';
import { computeOnTheClock, deriveDraftStatus } from './draftOrder';

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
