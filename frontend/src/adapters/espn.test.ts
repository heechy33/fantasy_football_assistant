import { describe, expect, it, vi } from 'vitest';
import type { EspnDomPick, EspnLivePick, EspnLiveSnapshot, PlayerMeta, Position } from '../../../shared/types';
import { buildManualDraftInit } from '../components/ManualDraftSetup';
import { bridgePicksToNormalized, buildEspnPlayerIndex, espnAdapter, espnDesyncReason, espnSeatMismatch, learnPosTokenPositions, mergeBridgeInit, resolveEspnPlayer } from './espn';
import { deriveEspnDraftOrder } from './espnDraftOrder';
import { canonicalTeam, teamFromFranchiseName, teamFromProTeamId } from './espnTeams';
import type { EspnStreamOffset } from './espnOffset';

function player(playerId: string, name: string, position: Position | null, team: string | null, espnId?: string): PlayerMeta {
  return {
    playerId, name, position, eligiblePositions: position ? [position] : [], team,
    byeWeek: null, age: null, yearsExp: null, injuryStatus: null,
    ids: espnId ? { espn: espnId } : {},
  };
}

const PLAYERS = [
  player('1', 'Christian McCaffrey', 'RB', 'SF', '3139477'),
  player('2', 'James Cook', 'RB', 'BUF', '15847'),
  player('3', 'James Cook', 'RB', 'CHI'), // ambiguous with #2 on name+position alone
  player('WAS', 'Washington Commanders', 'DEF', 'WAS'),
  player('SF', 'San Francisco 49ers', 'DEF', 'SF'),
  player('HOU', 'Houston Texans', 'DEF', 'HOU'),
];

describe('espnTeams', () => {
  it('canonicalizes team aliases onto players.json keys (WSH -> WAS, JAC -> JAX)', () => {
    expect(canonicalTeam('WSH')).toBe('WAS');
    expect(canonicalTeam('JAC')).toBe('JAX');
    expect(canonicalTeam('BUF')).toBe('BUF');
    expect(canonicalTeam(null)).toBeNull();
  });

  it('maps every ESPN proTeamId to the canonical team (28 -> WAS, 25 -> SF)', () => {
    expect(teamFromProTeamId(28)).toBe('WAS');
    expect(teamFromProTeamId(25)).toBe('SF');
    expect(teamFromProTeamId(1)).toBe('ATL');
    expect(teamFromProTeamId(0)).toBeNull();
    expect(teamFromProTeamId(999)).toBeNull();
    expect(teamFromProTeamId(null)).toBeNull();
  });

  it('resolves full franchise names and short forms for the DOM cross-check', () => {
    expect(teamFromFranchiseName('Washington Commanders')).toBe('WAS');
    expect(teamFromFranchiseName('Commanders')).toBe('WAS');
    expect(teamFromFranchiseName('San Francisco 49ers')).toBe('SF');
    expect(teamFromFranchiseName('Bills')).toBe('BUF');
    expect(teamFromFranchiseName('Not a Team')).toBeNull();
    expect(teamFromFranchiseName(null)).toBeNull();
  });

  it('never matches a short abbreviation embedded inside an unrelated franchise name (real recon regression, 2026-08-15)', () => {
    // "NE" is a substring of "mi-NE-sota vikings" -- a raw .includes() match returned MIN here
    // before "new england patriots" was ever considered (Minnesota is declared first). Must return
    // null so the caller's next fallback, canonicalTeam, resolves it correctly instead.
    expect(teamFromFranchiseName('NE')).toBeNull();
    expect(canonicalTeam('NE')).toBe('NE');
  });
});

describe('resolveEspnPlayer', () => {
  const index = buildEspnPlayerIndex(PLAYERS);

  it('resolves an ESPN player id via ids.espn', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: '3139477' })).toEqual({ playerId: '1', providerPlayerName: 'Christian McCaffrey' });
  });

  it('resolves a D/ST pick by proTeamId, never by its negative synthetic id', () => {
    const result = resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 16, proTeamId: 28 });
    expect(result.playerId).toBe('WAS');
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 16, proTeamId: 25 }).playerId).toBe('SF');
  });

  it('resolves a D/ST pick straight from the -(16000+proTeamId) id, no DOM/position hint needed', () => {
    // Recon-verified 2026-08-15 (league 1488579454, real SELECTED frames): -16034 -> proTeamId 34 ->
    // HOU, independently cross-checked against the DOM row "142Texans D/STHOU...". This is what
    // makes a D/ST pick joinable for the Step 6 offset derivation even with zero DOM enrichment.
    expect(resolveEspnPlayer(index, { providerPlayerId: '-16034' }).playerId).toBe('HOU');
    expect(resolveEspnPlayer(index, { providerPlayerId: '-16028' }).playerId).toBe('WAS'); // 28 -> WAS
    // Out of the real proTeamId range: must never false-positive against an unrelated small
    // negative id (the existing -5000/-999 synthetic test ids used elsewhere in this file).
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000' }).playerId).toBeNull();
    expect(resolveEspnPlayer(index, { providerPlayerId: '-999' }).playerId).toBeNull();
  });

  it('resolves a D/ST pick from the DOM team text (full name, short form, or alias abbreviation)', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 'DEF', teamText: 'Commanders' }).playerId).toBe('WAS');
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 'D/ST', teamText: 'WSH' }).playerId).toBe('WAS');
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 'DST', teamText: '49ers' }).playerId).toBe('SF');
  });

  it('keeps an unresolved non-DEF pick visible with its DOM name instead of dropping it', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: '-999' })).toEqual({ playerId: null, providerPlayerName: null });
    expect(resolveEspnPlayer(index, { providerPlayerId: '-999', name: 'Hollywood Brown', position: 'WR', teamText: 'PHI' }))
      .toEqual({ playerId: null, providerPlayerName: 'Hollywood Brown' });
  });

  it('resolves a unique name + position + team when the id is unknown', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: 'unknown-id', name: 'James Cook', position: 'RB', teamText: 'BUF' }).playerId).toBe('2');
  });

  it('refuses to guess when name + position is ambiguous', () => {
    // Two "James Cook" RBs on different teams, and no team signal -> null (never guess).
    expect(resolveEspnPlayer(index, { providerPlayerId: 'unknown-id', name: 'James Cook', position: 'RB' }).playerId).toBeNull();
  });
});

describe('learnPosTokenPositions', () => {
  // A small local index with a QB alongside the shared RB fixtures, distinct from the top-level
  // PLAYERS/index so the contradiction case has two genuinely different positions to conflict.
  const index = buildEspnPlayerIndex([...PLAYERS, player('4', 'Patrick Mahomes', 'QB', 'KC', '3139478')]);

  it('learns a token -> position mapping from picks that already resolved via ids.espn', () => {
    const streamPicks: EspnLivePick[] = [
      { overall: 1, slot: 10, playerId: '3139477', posToken: 2 }, // McCaffrey, RB
      { overall: 2, slot: 7, playerId: '15847', posToken: 2 }, // Cook, RB
    ];
    expect(learnPosTokenPositions(streamPicks, index)).toEqual(new Map([[2, 'RB']]));
  });

  it('discards a token that maps to more than one distinct position (contradictory evidence)', () => {
    const streamPicks: EspnLivePick[] = [
      { overall: 1, slot: 10, playerId: '3139477', posToken: 5 }, // McCaffrey, RB
      { overall: 2, slot: 7, playerId: '3139478', posToken: 5 }, // Mahomes, QB — same token, different position
    ];
    expect(learnPosTokenPositions(streamPicks, index).has(5)).toBe(false);
  });

  it('ignores picks with no posToken or that never resolved via ids.espn', () => {
    const streamPicks: EspnLivePick[] = [
      { overall: 1, slot: 10, playerId: '3139477' }, // no posToken
      { overall: 2, slot: 7, playerId: 'not-in-index', posToken: 3 }, // unresolved
    ];
    expect(learnPosTokenPositions(streamPicks, index).size).toBe(0);
  });

  it('discards posToken 16 -- contradictory in real recon data, so it must never be hard-coded as a position', () => {
    // Recon-verified 2026-08-15 (league 1488579454): posToken 16 was observed on an RB
    // (Isiah Pacheco), a QB (Jared Goff), and another RB (Alvin Kamara) in the same stream. Unlike
    // tokens 2 (RB) and 4 (WR), which were consistent across every sampled pick, 16 is genuinely
    // ambiguous -- this pins that as expected behavior so a future change doesn't "fix" it into a
    // wrong hard-coded enum entry.
    const realIndex = buildEspnPlayerIndex([
      player('p4', 'Isiah Pacheco', 'RB', 'DET', '4361529'),
      player('p5', 'Jared Goff', 'QB', 'DET', '3046779'),
      player('p6', 'Alvin Kamara', 'RB', 'NO', '3054850'),
    ]);
    const streamPicks: EspnLivePick[] = [
      { overall: 1, slot: 6, playerId: '4361529', posToken: 16 },
      { overall: 2, slot: 1, playerId: '3046779', posToken: 16 },
      { overall: 3, slot: 5, playerId: '3054850', posToken: 16 },
    ];
    expect(learnPosTokenPositions(streamPicks, realIndex).has(16)).toBe(false);
  });
});

describe('mergeBridgeInit', () => {
  const base = buildManualDraftInit({ leagueName: 'LeAgUe', teams: 10, rounds: 14, mySlot: 2 });

  it('keeps the form\'s typed slot authoritative — JOINED/TOKEN mySlot is an ESPN team id, not a position', () => {
    const live: EspnLiveSnapshot = { schemaVersion: 2, streamPicks: [], mySlot: 5, leagueId: '996408758', lastHeartbeatAt: 123 };
    const merged = mergeBridgeInit(base, live);
    expect(merged.provider).toBe('espn');
    expect(merged.leagueId).toBe('996408758');
    // The user typed draft position 2; JOINED/TOKEN says "you are ESPN team 5" — a team id, never
    // a draft position (recon 2026-08-15). The typed slot stays authoritative.
    expect(merged.mySlot).toBe(2);
    expect(merged.myTeamId).toBe('2');
    expect(merged.teams).toBe(10); // settings come from the manual form, unchanged
    expect(merged.settings.scoring).toBe(base.settings.scoring);
  });

  it('keeps the form slot when the snapshot has not yet observed JOINED/TOKEN', () => {
    const merged = mergeBridgeInit(base, null);
    expect(merged.mySlot).toBe(2);
    expect(merged.myTeamId).toBe('2');
  });

  it('enriches slotToTeamName from DOM pick rows once the order is known', () => {
    const live: EspnLiveSnapshot = {
      schemaVersion: 2,
      streamPicks: [
        { overall: 1, slot: 10, playerId: '11111' },
        { overall: 2, slot: 7, playerId: '22222' },
      ],
      domPicks: [
        { pickNumber: 1, text: '1Christian McCaffreySFRBKoston\'s Top-Notch Team2', segments: [] },
        { pickNumber: 2, text: '2James CookBUFRBTeam Two3', segments: [] },
      ],
      mySlot: 7,
      leagueId: '996408758',
      lastHeartbeatAt: 123,
      // Attached from pick 1: the board was confirmed empty when the stream started (Step 6/7 offset
      // confirmation — see espnOffset.ts), so absolute overall === arrival index (offset 0).
      domMaxAtStreamStart: 0,
      domSampledBeforeStream: true,
    };
    const merged = mergeBridgeInit(base, live);
    expect(merged.slotToTeamName?.[1]).toBe('Koston\'s Top-Notch Team');
    expect(merged.slotToTeamName?.[2]).toBe('Team Two');
  });
});

describe('bridgePicksToNormalized', () => {
  const init = mergeBridgeInit(buildManualDraftInit({ leagueName: 'LeAgUe', teams: 10, rounds: 14, mySlot: 2 }), null);
  const index = buildEspnPlayerIndex(PLAYERS);

  it('maps the stream\'s ESPN team ids to draft positions and keeps the raw team id on providerTeamId', () => {
    const live: EspnLiveSnapshot = {
      schemaVersion: 2,
      streamPicks: [
        { overall: 1, slot: 10, playerId: '3139477' }, // team 10 picks 1st -> position 1
        { overall: 2, slot: 7, playerId: '15847' }, // team 7 picks 2nd -> position 2
        { overall: 3, slot: 9, playerId: 'not-in-index' }, // unresolved
      ],
      mySlot: 7,
      leagueId: '996408758',
      lastHeartbeatAt: 456,
      domMaxAtStreamStart: 0, // attached from pick 1 -> offset 0
      domSampledBeforeStream: true,
    };
    const picks = bridgePicksToNormalized(init, index, live);
    expect(picks).toHaveLength(3);
    expect(picks[0]).toMatchObject({ overall: 1, round: 1, slot: 1, teamId: '1', playerId: '1', providerPlayerId: '3139477', providerPlayerName: 'Christian McCaffrey', providerTeamId: '10' });
    expect(picks[1]).toMatchObject({ overall: 2, round: 1, slot: 2, teamId: '2', playerId: '2', providerPlayerName: 'James Cook', providerTeamId: '7' });
    // Never dropped: an unresolved id stays visible with a null canonical id.
    expect(picks[2]).toMatchObject({ overall: 3, round: 1, slot: 3, teamId: '3', playerId: null, providerTeamId: '9' });
    expect(picks[2]?.providerPlayerName).toBeUndefined();
  });

  it('resolves round-2 picks through the derived order (snake reversal)', () => {
    // Round 1 pins every position; round 2 opened 1, 5 (positions 10, 9 in the recon permutation).
    const roundOne = [10, 7, 9, 8, 3, 2, 6, 4, 5, 1];
    const live: EspnLiveSnapshot = {
      schemaVersion: 2,
      streamPicks: [
        ...roundOne.map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` })),
        { overall: 11, slot: 1, playerId: '15847' },
        { overall: 12, slot: 5, playerId: '3139477' },
      ],
      mySlot: 7,
      leagueId: '996408758',
      lastHeartbeatAt: 456,
      domMaxAtStreamStart: 0, // attached from pick 1 -> offset 0
      domSampledBeforeStream: true,
    };
    const picks = bridgePicksToNormalized(init, index, live);
    expect(picks[10]).toMatchObject({ overall: 11, round: 2, slot: 10, teamId: '10', providerTeamId: '1' });
    expect(picks[11]).toMatchObject({ overall: 12, round: 2, slot: 9, teamId: '9', providerTeamId: '5' });
  });

  it('resolves a DOM-enriched D/ST pick where the id-only path returns null', () => {
    const live: EspnLiveSnapshot = {
      schemaVersion: 2,
      streamPicks: [{ overall: 1, slot: 5, playerId: '-5000' }],
      domPicks: [{ pickNumber: 1, text: '1Commanders D/STWSHD/STMy Squad141141.2undo', segments: [] }],
      mySlot: 7,
      leagueId: '996408758',
      lastHeartbeatAt: 456,
      // Offset must confirm from board-depth here, not a crosswalk join: -5000 is out of the real
      // D/ST id range (Finding C) and never resolves via the id-only tiers on the stream side, so
      // this pick contributes no join evidence — attached from pick 1 is the only signal available.
      domMaxAtStreamStart: 0,
      domSampledBeforeStream: true,
    };
    // Id-only: the negative synthetic DEF id resolves to nothing.
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000' }).playerId).toBeNull();
    const picks = bridgePicksToNormalized(init, index, live);
    expect(picks[0]).toMatchObject({ overall: 1, playerId: 'WAS', providerPlayerName: 'Commanders D/ST', providerTeamId: '5' });
  });

  it('returns no picks without a live snapshot (extension missing)', () => {
    expect(bridgePicksToNormalized(init, index, null)).toEqual([]);
  });

  it('wires the self-calibrated posToken position through when DOM has no row, without crashing or mis-resolving', () => {
    // Documents the current, honest limitation on learnPosTokenPositions: a learned position alone
    // (no name, no team — DOM never supplied a row for this pick) still cannot satisfy any
    // resolveEspnPlayer tier, so this pick correctly stays unresolved. The value here is that the
    // learned position doesn't cause a crash or a wrong guess; a future team-text source (e.g. pool
    // enrichment) could combine with it.
    const live: EspnLiveSnapshot = {
      schemaVersion: 2,
      streamPicks: [
        { overall: 1, slot: 10, playerId: '3139477', posToken: 2 }, // resolves via ids.espn -> RB, calibrates token 2
        { overall: 2, slot: 7, playerId: 'not-in-index', posToken: 2 }, // learned RB, but no name/team -> stays unresolved
      ],
      mySlot: 7,
      leagueId: '996408758',
      lastHeartbeatAt: 456,
    };
    expect(learnPosTokenPositions(live.streamPicks, index)).toEqual(new Map([[2, 'RB']]));
    const picks = bridgePicksToNormalized(init, index, live);
    expect(picks[1]).toMatchObject({ overall: 2, playerId: null, providerPlayerName: undefined });
  });
});

describe('espnAdapter.picks', () => {
  it('derives status/on-the-clock from max(overall), not the array length, once a non-zero offset is confirmed (Step 6c)', async () => {
    // espnAdapter.picks() loads /data/players.json through its memoized loader; stub the fetch to
    // the same PLAYERS pool the rest of this file builds its crosswalk index from.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/data/players.json')) {
        return { ok: true, json: async () => PLAYERS };
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }));
    try {
      const init = mergeBridgeInit(buildManualDraftInit({ leagueName: 'LeAgUe', teams: 10, rounds: 14, mySlot: 2 }), null);
      // Confirmed offset 100 (board-depth 100 at stream start, corroborated by the DOM row that
      // joins CMC — arrival pick 1 — to absolute pick 101). Normalized picks therefore carry
      // GAPPED absolute overalls (101, 102): exactly the case picks.length undercounts.
      const live: EspnLiveSnapshot = {
        schemaVersion: 2,
        streamPicks: [
          { overall: 1, slot: 10, playerId: '3139477' },
          { overall: 2, slot: 7, playerId: '15847' },
        ],
        domPicks: [{ pickNumber: 101, text: "101Christian McCaffreySFRBKoston's Top-Notch Team2", segments: [] }],
        mySlot: 7,
        leagueId: '996408758',
        lastHeartbeatAt: 456,
        domMaxAtStreamStart: 100,
        domSampledBeforeStream: false,
      };
      const result = await espnAdapter.picks(init, live);
      expect(result.picks.map((pick) => pick.overall)).toEqual([101, 102]);
      expect(result.unattributedCount).toBe(0);
      // max(overall) = 102 -> the clock reads pick 103 (round 11, slot 3 of a 10-team snake). The
      // old picks.length (=2) math would have said pick 3 and put a round-1 team on the clock.
      expect(result.onTheClock?.overall).toBe(103);
      expect(result.onTheClock?.round).toBe(11);
      expect(result.onTheClock?.slot).toBe(3);
      expect(result.status).toBe('drafting'); // 102 < 10*14 total picks
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


// Step 6 test helper: a confirmed offset (crosswalk-join-sourced, matching what the real adapter
// would produce) vs an unconfirmed one, mirroring espnDraftOrder.test.ts's convention.
function confirmedOffset(offset: number): EspnStreamOffset {
  return { offset, confirmed: true, source: 'crosswalk-join', joins: 2, distinctCandidates: 1, reason: null };
}
const UNCONFIRMED_OFFSET: EspnStreamOffset = { offset: null, confirmed: false, source: null, joins: 0, distinctCandidates: 0, reason: 'test fixture' };

describe('espnDesyncReason', () => {
  function liveWith(picks: EspnLivePick[], domPicks: EspnDomPick[] = []): EspnLiveSnapshot {
    return { schemaVersion: 2, streamPicks: picks, domPicks, mySlot: null, leagueId: 'L1', lastHeartbeatAt: 1 };
  }

  it('returns null for a clean stream (open from pick 1, DOM in lockstep)', () => {
    const picks = [10, 7, 9, 8, 3, 2, 6, 4, 5, 1].map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` }));
    const domPicks: EspnDomPick[] = [1, 2, 3].map((n) => ({ pickNumber: n, text: `${n}Name`, segments: [] }));
    const offset = confirmedOffset(0);
    const order = deriveEspnDraftOrder(picks, 10, 'snake', offset);
    expect(order.reliable).toBe(true);
    expect(espnDesyncReason(liveWith(picks, domPicks), order, offset)).toBeNull();
  });

  it('flags an unconfirmed absolute-pick offset (Step 6) instead of the old repeat-detection heuristic', () => {
    // Any stream is unreliable without a confirmed offset now — the old mid-round-1 overlap-repeat
    // heuristic is gone; an unconfirmed offset is the sole, uniform gate (see espnDraftOrder.test.ts
    // for why the repeat heuristic missed a round-2-start stream entirely).
    const picks = [4, 5, 1, 1, 5, 4, 2, 6, 3, 8].map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` }));
    const order = deriveEspnDraftOrder(picks, 10, 'snake', UNCONFIRMED_OFFSET);
    expect(order.reliable).toBe(false);
    expect(espnDesyncReason(liveWith(picks), order, UNCONFIRMED_OFFSET)).toContain('not confirmed yet');
  });

  it('reports missed picks when the DOM runs ahead of the stream\'s latest confirmed absolute pick', () => {
    // Reliable order (open from pick 1, offset 0) but the board shows absolute pick #4 while the
    // stream's latest confirmed absolute pick is #3.
    const picks = [10, 7, 9].map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` }));
    const domPicks: EspnDomPick[] = [{ pickNumber: 4, text: '4Name', segments: [] }];
    const offset = confirmedOffset(0);
    const order = deriveEspnDraftOrder(picks, 10, 'snake', offset);
    expect(espnDesyncReason(liveWith(picks, domPicks), order, offset)).toContain('1 missing');
  });

  it('reports missed picks correctly even with a non-zero confirmed offset (a late attach)', () => {
    // The old `streamPicks.length` comparison would have used arrival length (3) here; the true
    // latest confirmed absolute pick is 3 + 137 = 140. The board showing #142 is 2 missing, not 139.
    const picks = [10, 7, 9].map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` }));
    const domPicks: EspnDomPick[] = [{ pickNumber: 142, text: '142Name', segments: [] }];
    const offset = confirmedOffset(137);
    const order = deriveEspnDraftOrder(picks, 10, 'snake', offset);
    expect(espnDesyncReason(liveWith(picks, domPicks), order, offset)).toContain('2 missing');
  });

  it('is a no-op with no live snapshot or no domPicks', () => {
    expect(espnDesyncReason(null, deriveEspnDraftOrder([], 10, 'snake', UNCONFIRMED_OFFSET), UNCONFIRMED_OFFSET)).toBeNull();
    const picks = [10, 7].map((slot, i) => ({ overall: i + 1, slot, playerId: 'p' }));
    const offset = confirmedOffset(0);
    expect(espnDesyncReason(liveWith(picks), deriveEspnDraftOrder(picks, 10, 'snake', offset), offset)).toBeNull();
  });
});

describe('espnSeatMismatch', () => {
  function liveWith(picks: EspnLivePick[], mySlot: number | null): EspnLiveSnapshot {
    return { schemaVersion: 2, streamPicks: picks, mySlot, leagueId: 'L1', lastHeartbeatAt: 1 };
  }

  it('is silent when the typed position matches the derived position', () => {
    const picks = [10, 7].map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` }));
    const order = deriveEspnDraftOrder(picks, 10, 'snake', confirmedOffset(0));
    // ESPN team 7 picks 2nd, and the form says position 2 — correct.
    expect(espnSeatMismatch(liveWith(picks, 7), order, 2)).toBeNull();
  });

  it('warns when the ESPN team id\'s derived position disagrees with the typed slot', () => {
    const picks = [10, 7].map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` }));
    const order = deriveEspnDraftOrder(picks, 10, 'snake', confirmedOffset(0));
    // The rehearsal bug: typed position 7, but team 7 is actually position 2.
    expect(espnSeatMismatch(liveWith(picks, 7), order, 7)).toContain('position 2');
  });

  it('is silent with no JOINED/TOKEN team id, no typed slot, or an unreliable order', () => {
    const order = deriveEspnDraftOrder([], 10, 'snake', confirmedOffset(0));
    expect(espnSeatMismatch(null, order, 2)).toBeNull();
    expect(espnSeatMismatch(liveWith([], null), order, 2)).toBeNull();
    expect(espnSeatMismatch(liveWith([], 7), order, null)).toBeNull();
    const unreliable = deriveEspnDraftOrder(
      [4, 5, 1, 1].map((slot, i) => ({ overall: i + 1, slot, playerId: `p${i + 1}` })),
      10, 'snake', UNCONFIRMED_OFFSET,
    );
    expect(espnSeatMismatch(liveWith([], 7), unreliable, 2)).toBeNull();
  });
});
