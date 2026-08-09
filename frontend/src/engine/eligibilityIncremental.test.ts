import { describe, expect, it } from 'vitest';
import type { LeagueSettings, PlayerId, PlayerMeta, Position, RosterSlot } from '../../../shared/types';
import { addPlayerToLineup, optimizeLineup, prepareLineup, slotEligibility } from './eligibility';

/**
 * Property suite for `addPlayerToLineup`. Its correctness argument (telescoping cancels chain
 * interiors — see the doc comment on the function) is verified here empirically against
 * `prepareLineup`, not asserted by hand: every trial below re-solves the same roster from scratch
 * with the exact bitmask DP and compares indexed occupancy. That comparison is only possible
 * because `prepareLineup`'s `occupantBySlot` is indexed (distinguishes duplicate slots); plain
 * `LineupResult.assignments` cannot express that, which is exactly the gap `PreparedLineup` closes.
 */

// Deterministic, seedable — a failing trial should be reproducible from the printed seed alone.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const DEDICATED_SLOTS: RosterSlot[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const FLEX_SLOTS: RosterSlot[] = ['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'];

// Small, mostly-duplicated point pool so ties (the hard case) are common rather than incidental —
// includes zero and negative values per the review's explicit requirement.
const POINT_POOL = [-8, -3, 0, 0, 4, 4, 7, 9, 9, 12, 15, 18, 18, 22, 27, 31];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  const value = arr[Math.floor(rng() * arr.length)];
  if (value === undefined) throw new Error('pick() called on empty array');
  return value;
}

function makePlayer(id: string, position: Position, eligiblePositions: Position[] = [position]): PlayerMeta {
  return { playerId: id, name: id, position, eligiblePositions, team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} };
}

/** Random slot list: 3-8 dedicated/duplicated slots plus 0-2 flex-family slots, shuffled. */
function randomSlots(rng: () => number): RosterSlot[] {
  const count = 3 + Math.floor(rng() * 6);
  const slots: RosterSlot[] = [];
  for (let i = 0; i < count; i += 1) slots.push(pick(rng, DEDICATED_SLOTS));
  const flexCount = Math.floor(rng() * 3);
  for (let i = 0; i < flexCount; i += 1) slots.push(pick(rng, FLEX_SLOTS));
  // Fisher-Yates shuffle so flex slots aren't always last (slot order affects the tie-break).
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = slots[i] as RosterSlot;
    const b = slots[j] as RosterSlot;
    slots[i] = b; slots[j] = a;
  }
  return slots;
}

function randomSettings(rng: () => number): LeagueSettings {
  return {
    provider: 'sleeper', leagueId: 'prop', name: 'Property', season: '2026', teams: 12,
    startingSlots: randomSlots(rng), rosterSlots: {},
    scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  };
}

/** Random roster: up to 9 players (keeps the O(2^n) DP oracle fast), each with a random position
 * and a 30% chance of extra flex-relevant eligibility (RB/WR/TE cross-eligible), from the
 * discrete/duplicate/zero/negative point pool. */
function randomRoster(rng: () => number, count: number): { players: PlayerMeta[]; points: Map<PlayerId, number> } {
  const players: PlayerMeta[] = [];
  const points = new Map<PlayerId, number>();
  for (let i = 0; i < count; i += 1) {
    const position = pick(rng, POSITIONS);
    let eligible: Position[] = [position];
    if (['RB', 'WR', 'TE'].includes(position) && rng() < 0.3) {
      const extra = pick(rng, ['RB', 'WR', 'TE'] as Position[]);
      eligible = [...new Set([position, extra])];
    }
    const id = `p${i}`;
    players.push(makePlayer(id, position, eligible));
    points.set(id, pick(rng, POINT_POOL));
  }
  return { players, points };
}

const TRIALS = 400;

describe('addPlayerToLineup — property suite against the prepareLineup/DP oracle', () => {
  it('matches the full DP on value and indexed occupancy across randomized rosters', () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 1);
      const settings = randomSettings(rng);
      const rosterSize = Math.floor(rng() * 8); // 0-7, including the empty-roster edge case
      const { players, points } = randomRoster(rng, rosterSize);
      const base = prepareLineup(settings, players, points);

      const candidatePosition = pick(rng, POSITIONS);
      let candidateEligible: Position[] = [candidatePosition];
      if (['RB', 'WR', 'TE'].includes(candidatePosition) && rng() < 0.3) {
        candidateEligible = [...new Set([candidatePosition, pick(rng, ['RB', 'WR', 'TE'] as Position[])])];
      }
      const candidate = makePlayer('candidate', candidatePosition, candidateEligible);
      const candidatePoints = pick(rng, POINT_POOL);

      const { state, addedPlayerSlot } = addPlayerToLineup(base, candidate, candidatePoints);

      const allPoints = new Map(points);
      allPoints.set(candidate.playerId, candidatePoints);
      const oracle = prepareLineup(settings, [...players, candidate], allPoints);

      expect(state.value, `trial ${trial}: value mismatch`).toBeCloseTo(oracle.value, 9);
      expect(state.occupantBySlot, `trial ${trial}: occupancy mismatch`).toEqual(oracle.occupantBySlot);

      const oracleSlotIndex = oracle.occupantBySlot.indexOf(candidate.playerId);
      const expectedSlot = oracleSlotIndex === -1 ? null : (oracle.slots[oracleSlotIndex] ?? null);
      expect(addedPlayerSlot, `trial ${trial}: addedPlayerSlot mismatch`).toBe(expectedSlot);
    }
  });

  /** Every occupied slot actually accepts its occupant, every occupant appears at most once, and
   * total value is the sum of each occupant's own points — catches real bugs (wrong value, a
   * phantom player, an ineligible placement) independent of which specific value-neutral tie-break
   * a given state happens to reflect. */
  function isInternallyConsistent(state: ReturnType<typeof prepareLineup>): boolean {
    const seen = new Set<PlayerId>();
    let sum = 0;
    for (let i = 0; i < state.slots.length; i += 1) {
      const occupant = state.occupantBySlot[i];
      if (occupant == null) continue;
      if (seen.has(occupant)) return false;
      seen.add(occupant);
      const meta = state.playerMetaById.get(occupant);
      const slot = state.slots[i];
      if (!meta || !slot) return false;
      if (!slotEligibility(slot, meta)) return false;
      sum += state.points.get(occupant) ?? 0;
    }
    return Math.abs(sum - state.value) < 1e-6;
  }

  it('chained double addition matches a from-scratch solve on value; occupancy is internally consistent', () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 1000);
      const settings = randomSettings(rng);
      const rosterSize = Math.floor(rng() * 7);
      const { players, points } = randomRoster(rng, rosterSize);
      const base = prepareLineup(settings, players, points);

      const posA = pick(rng, POSITIONS);
      const a = makePlayer('candidateA', posA);
      const ptsA = pick(rng, POINT_POOL);
      const step1 = addPlayerToLineup(base, a, ptsA);

      const posB = pick(rng, POSITIONS);
      const b = makePlayer('candidateB', posB);
      const ptsB = pick(rng, POINT_POOL);
      const step2 = addPlayerToLineup(step1.state, b, ptsB);

      const allPoints = new Map(points);
      allPoints.set(a.playerId, ptsA);
      allPoints.set(b.playerId, ptsB);
      const oracle = prepareLineup(settings, [...players, a, b], allPoints);

      // Value is always exact (telescoping — see eligibility.ts's doc comment). Occupancy identity
      // is asserted exactly whenever it matches, but a documented, value-neutral "leave the
      // candidate out vs. bench a different equal-value player instead" tie (see addPlayerToLineup's
      // ambiguity-check comment) can legitimately diverge from this particular oracle run — in that
      // case we only require the result to still be a valid, correctly-summed lineup.
      expect(step2.state.value, `trial ${trial}`).toBeCloseTo(oracle.value, 9);
      const exact = JSON.stringify(step2.state.occupantBySlot) === JSON.stringify(oracle.occupantBySlot);
      if (!exact) expect(isInternallyConsistent(step2.state), `trial ${trial}: diverged from oracle AND internally inconsistent`).toBe(true);
    }
  });

  it('keeps matching the DP oracle through realistic 12-pick chains', () => {
    for (let trial = 0; trial < 100; trial += 1) {
      const rng = mulberry32(trial + 5000);
      const settings = randomSettings(rng);
      const { players, points } = randomRoster(rng, Math.floor(rng() * 5));
      let state = prepareLineup(settings, players, points);
      const allPlayers = [...players];
      const allPoints = new Map(points);

      for (let step = 0; step < 12; step += 1) {
        const entrant = makePlayer(`chain-${step}`, pick(rng, POSITIONS));
        const entrantPoints = pick(rng, POINT_POOL);
        state = addPlayerToLineup(state, entrant, entrantPoints).state;
        allPlayers.push(entrant);
        allPoints.set(entrant.playerId, entrantPoints);
        const oracle = prepareLineup(settings, allPlayers, allPoints);
        expect(state.value, `trial ${trial}, step ${step}`).toBeCloseTo(oracle.value, 9);
        expect(isInternallyConsistent(state), `trial ${trial}, step ${step}`).toBe(true);
      }
    }
  });

  it('takes the DP-equivalent fast path when a dedicated slot and FLEX are both empty', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['RB', 'FLEX'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const base = prepareLineup(settings, [], new Map());
    const entrant = makePlayer('rb1', 'RB');
    const result = addPlayerToLineup(base, entrant, 10);
    const oracle = prepareLineup(settings, [entrant], new Map([['rb1', 10]]));
    expect(result.state.occupantBySlot).toEqual(oracle.occupantBySlot);
    expect(result.state.occupantBySlot).toEqual([null, 'rb1']);
  });

  it('a zero-point player claims a genuinely open slot instead of staying benched', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['RB', 'FLEX'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const players = [makePlayer('rb1', 'RB')];
    const points = new Map([['rb1', 10]]);
    const base = prepareLineup(settings, players, points);
    const { state, addedPlayerSlot } = addPlayerToLineup(base, makePlayer('wr0', 'WR'), 0);
    expect(addedPlayerSlot).toBe('FLEX');
    expect(state.value).toBe(10); // unchanged — the zero-point player adds nothing but still fills the slot
  });

  it('a negative-point player stays benched rather than displacing anyone', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['RB'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const players = [makePlayer('rb1', 'RB')];
    const points = new Map([['rb1', 10]]);
    const base = prepareLineup(settings, players, points);
    const { state, addedPlayerSlot, result } = addPlayerToLineup(base, makePlayer('rb2', 'RB'), -5);
    expect(addedPlayerSlot).toBeNull();
    expect(state.value).toBe(10);
    expect(result.benched).toContain('rb2');
  });

  it('duplicate slots are addressed by index, not name', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['RB', 'RB'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const players = [makePlayer('rb1', 'RB')];
    const points = new Map([['rb1', 10]]);
    const base = prepareLineup(settings, players, points);
    // The reference DP's "skip this slot, decide later" recursion tries slot 0 first and only
    // overrides on strict improvement, so a single player among duplicate slots lands in the LAST
    // one, not the first — this is the actual (if unintuitive) base-case behavior, not a bug.
    expect(base.occupantBySlot).toEqual([null, 'rb1']);
    // rb2 is eligible for both slots (one empty, one occupied by rb1, who could also move into the
    // empty one) — a genuine multi-route tie the fast path can't resolve locally (see
    // `hasUniqueAugmentingPath`), so this exercises the exact-fallback path against the real oracle
    // rather than asserting a guessed outcome.
    const { state, addedPlayerSlot } = addPlayerToLineup(base, makePlayer('rb2', 'RB'), 5);
    const oracle = prepareLineup(settings, [makePlayer('rb1', 'RB'), makePlayer('rb2', 'RB')], new Map([['rb1', 10], ['rb2', 5]]));
    expect(state.occupantBySlot).toEqual(oracle.occupantBySlot);
    expect(addedPlayerSlot).toBe('RB');
    expect(state.value).toBe(15);
  });

  it('a low-value player with every reachable slot full stays benched (bench-only addition)', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['RB'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const players = [makePlayer('rb1', 'RB')];
    const points = new Map([['rb1', 20]]);
    const base = prepareLineup(settings, players, points);
    const { state, addedPlayerSlot, result } = addPlayerToLineup(base, makePlayer('rb2', 'RB'), 5);
    expect(addedPlayerSlot).toBeNull();
    expect(state.value).toBe(20);
    expect(result.benched).toContain('rb2');
  });

  it('an equal-value swap leaves the existing assignment untouched (skip-preferred tie-break)', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['RB'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const players = [makePlayer('rb1', 'RB')];
    const points = new Map([['rb1', 10]]);
    const base = prepareLineup(settings, players, points);
    const { state, addedPlayerSlot } = addPlayerToLineup(base, makePlayer('rb2', 'RB'), 10);
    expect(addedPlayerSlot).toBeNull();
    expect(state.occupantBySlot).toEqual(['rb1']);
  });

  it('FLEX cascades correctly: a strong RB bumps the incumbent FLEX WR to bench', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['RB', 'WR', 'FLEX'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const players = [makePlayer('rb1', 'RB'), makePlayer('wr1', 'WR'), makePlayer('wr2', 'WR')];
    const points = new Map([['rb1', 10], ['wr1', 8], ['wr2', 6]]);
    const base = optimizeLineup(settings, players, points);
    // Base: RB->rb1, WR->wr1, FLEX->wr2 (best available FLEX-eligible leftover).
    expect(base.assignments.find((a) => a.slot === 'FLEX')?.playerId).toBe('wr2');

    const prepared = prepareLineup(settings, players, points);
    const { state, addedPlayerSlot } = addPlayerToLineup(prepared, makePlayer('rb2', 'RB'), 20);
    expect(addedPlayerSlot).toBe('FLEX'); // rb1 stays at RB (dedicated), rb2 outranks wr2 for FLEX
    expect(state.value).toBe(10 + 8 + 20);
  });

  it('a player eligible for no slot at all stays benched with value unchanged', () => {
    const settings: LeagueSettings = {
      provider: 'sleeper', leagueId: 'x', name: 'x', season: '2026', teams: 12,
      startingSlots: ['QB'], rosterSlots: {}, scoring: {}, format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    };
    const players = [makePlayer('qb1', 'QB')];
    const points = new Map([['qb1', 20]]);
    const base = prepareLineup(settings, players, points);
    const { state, addedPlayerSlot } = addPlayerToLineup(base, makePlayer('rb1', 'RB'), 50);
    expect(addedPlayerSlot).toBeNull();
    expect(state.value).toBe(20);
  });
});
