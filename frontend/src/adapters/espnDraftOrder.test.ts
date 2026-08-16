import { describe, expect, it } from 'vitest';
import type { EspnLivePick } from '../../../shared/types';
import { deriveEspnDraftOrder, streamPickPosition } from './espnDraftOrder';
import type { EspnStreamOffset } from './espnOffset';

// Recon 2026-08-15 (10-team snake): round 1 went in team order [10, 7, 9, 8, 3, 2, 6, 4, 5, 1],
// round 2 opened [1, 5, ...]. SELECTED's first token is the league team id, not a draft position.
const ROUND_ONE_TEAMS = [10, 7, 9, 8, 3, 2, 6, 4, 5, 1];

function stream(teamIds: readonly number[]): EspnLivePick[] {
  return teamIds.map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` }));
}

function confirmedOffset(offset: number): EspnStreamOffset {
  return { offset, confirmed: true, source: 'crosswalk-join', joins: 2, distinctCandidates: 1, reason: null };
}

const UNCONFIRMED: EspnStreamOffset = { offset: null, confirmed: false, source: null, joins: 0, distinctCandidates: 0, reason: 'test fixture' };

describe('deriveEspnDraftOrder', () => {
  it('pins every position from a clean round-1 pass with a confirmed offset of 0 (the recon permutation)', () => {
    const order = deriveEspnDraftOrder(stream(ROUND_ONE_TEAMS), 10, 'snake', confirmedOffset(0));
    expect(order.reliable).toBe(true);
    expect(order.complete).toBe(true);
    expect([...order.positionByTeam.entries()]).toEqual([
      [10, 1], [7, 2], [9, 3], [8, 4], [3, 5], [2, 6], [6, 7], [4, 8], [5, 9], [1, 10],
    ]);
  });

  it('resolves round-2 picks through positionByTeam (snake reversal), given a confirmed offset of 0', () => {
    const picks = stream([...ROUND_ONE_TEAMS, 1, 5]);
    const order = deriveEspnDraftOrder(picks, 10, 'snake', confirmedOffset(0));
    expect(order.reliable).toBe(true);
    // Overall 11 = team 1 = position 10 (round-2 snake opener); overall 12 = team 5 = position 9.
    expect(streamPickPosition(order, picks[10]!, 0, 'snake', 10)).toBe(10);
    expect(streamPickPosition(order, picks[11]!, 0, 'snake', 10)).toBe(9);
  });

  it('streamPickPosition on round-1 arrivals matches arrival index when the offset is 0', () => {
    const picks = stream(ROUND_ONE_TEAMS);
    const order = deriveEspnDraftOrder(picks, 10, 'snake', confirmedOffset(0));
    expect(streamPickPosition(order, picks[0]!, 0, 'snake', 10)).toBe(1);
    expect(streamPickPosition(order, picks[9]!, 0, 'snake', 10)).toBe(10);
  });

  // Step 6 (D5): arrival index cannot be laundered into a draft position without a CONFIRMED
  // absolute-pick offset (espnOffset.ts) -- there is no arrival-index fallback of any kind anymore.
  // This supersedes the old repeat-detection heuristic (a team id repeating within the first `teams`
  // arrivals), which flagged a mid-round-1 start but MISSED a round-2 start entirely (see the next
  // test) -- an unconfirmed offset is now the only gate, and it catches both cases uniformly.
  it('is unreliable with NO positions at all whenever the offset is unconfirmed, regardless of the stream shape', () => {
    const midRoundOne = deriveEspnDraftOrder(stream([4, 5, 1, 1, 5, 4, 2, 6, 3, 8]), 10, 'snake', UNCONFIRMED);
    expect(midRoundOne.reliable).toBe(false);
    expect(midRoundOne.positionByTeam.size).toBe(0);

    const cleanRoundOne = deriveEspnDraftOrder(stream(ROUND_ONE_TEAMS), 10, 'snake', UNCONFIRMED);
    expect(cleanRoundOne.reliable).toBe(false);
    expect(cleanRoundOne.positionByTeam.size).toBe(0);
  });

  // THE FLIP (per PLAN Step 6): a stream that opens exactly at the top of round 2 has `teams`
  // distinct arrivals, so the old repeat-detection heuristic marked it `reliable: true` while mapping
  // every team to arrival-index-as-position -- i.e. team 1 (the true round-2 opener, position 10) was
  // reported at position 1. Confidently wrong. Now: unconfirmed -> unreliable (no positions at all,
  // never a wrong guess); confirmed (offset 10, since arrival 1 is absolute pick 11) -> the CORRECT
  // positions, matching the round-1 pass's reversed order exactly.
  it('a round-2-start stream is unreliable without a confirmed offset, and correct WITH one', () => {
    const roundTwoOpen = stream([1, 5, 4, 2, 6, 3, 8, 9, 7, 10]);

    const unconfirmed = deriveEspnDraftOrder(roundTwoOpen, 10, 'snake', UNCONFIRMED);
    expect(unconfirmed.reliable).toBe(false);
    expect(unconfirmed.positionByTeam.size).toBe(0);
    expect(streamPickPosition(unconfirmed, roundTwoOpen[0]!, null, 'snake', 10)).toBeNull();

    const confirmed = deriveEspnDraftOrder(roundTwoOpen, 10, 'snake', confirmedOffset(10));
    expect(confirmed.reliable).toBe(true);
    expect([...confirmed.positionByTeam.entries()]).toEqual([
      [1, 10], [5, 9], [4, 8], [2, 7], [6, 6], [3, 5], [8, 4], [9, 3], [7, 2], [10, 1],
    ]);
    // Arrival 1 (team 1) is absolute pick 11 -> position 10, NOT position 1 (the old wrong answer).
    expect(streamPickPosition(confirmed, roundTwoOpen[0]!, 10, 'snake', 10)).toBe(10);
  });

  it('is incomplete (but reliable) mid-round-1 before every team has picked, given a confirmed offset', () => {
    const order = deriveEspnDraftOrder(stream([10, 7, 9]), 10, 'snake', confirmedOffset(0));
    expect(order.reliable).toBe(true);
    expect(order.complete).toBe(false);
    expect(order.positionByTeam.get(7)).toBe(2);
  });

  it('flags a conflict (the same team id computing to two different positions) as unreliable even with a confirmed offset', () => {
    // A pathological/corrupted case: two picks from the same team id land at different absolute
    // positions under the given offset -- evidence the offset itself is wrong despite passing
    // espnOffset.ts's own checks. A belt-and-suspenders guard, not the primary confirmation path.
    const picks: EspnLivePick[] = [
      { overall: 1, slot: 1, playerId: 'a' },
      { overall: 2, slot: 1, playerId: 'b' }, // same team id, different arrival -> different position
    ];
    const order = deriveEspnDraftOrder(picks, 10, 'snake', confirmedOffset(0));
    expect(order.reliable).toBe(false);
  });
});
