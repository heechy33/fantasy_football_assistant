import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EspnDomPick, EspnLiveSnapshot, PlayerMeta, Position } from '../../../shared/types';
import { buildEspnPlayerIndex } from './espn';
import { deriveEspnStreamOffset } from './espnOffset';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'espn');

function loadFixture<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, fileName), 'utf-8')) as T;
}

interface LiveFixture {
  groundTruth: { offset: number; teams: number; [key: string]: unknown };
  live: EspnLiveSnapshot;
}

const ROUND1_FIXTURE = loadFixture<LiveFixture>('live-stream-2026-08-15.json');
const LATE_ATTACH_FIXTURE = loadFixture<LiveFixture>('live-stream-late-attach-2026-08-15.json');

function player(playerId: string, name: string, position: Position | null, team: string | null, espnId?: string): PlayerMeta {
  return {
    playerId, name, position, eligiblePositions: position ? [position] : [], team,
    byeWeek: null, age: null, yearsExp: null, injuryStatus: null,
    ids: espnId ? { espn: espnId } : {},
  };
}

// Covers both fixtures' real crosswalk resolutions (see each fixture's groundTruth.expectedResolution).
// Team fields match data/players.json's committed values, including its DET quirk for Pacheco --
// the test oracle must match what resolveEspnPlayer actually returns, not real-world rosters.
const INDEX = buildEspnPlayerIndex([
  player('gibbs', 'Jahmyr Gibbs', 'RB', 'DET', '4429795'),
  player('chase', "Ja'Marr Chase", 'WR', 'CIN', '4362628'),
  player('nacua', 'Puka Nacua', 'WR', 'LAR', '4426515'),
  player('cmc', 'Christian McCaffrey', 'RB', 'SF', '3117251'),
  player('taylor', 'Jonathan Taylor', 'RB', 'IND', '4242335'),
  player('stbrown', 'Amon-Ra St. Brown', 'WR', 'DET', '4374302'),
  player('bijan', 'Bijan Robinson', 'RB', 'ATL', '4430807'),
  player('jsn', 'Jaxon Smith-Njigba', 'WR', 'SEA', '4430878'),
  player('achane', "De'Von Achane", 'RB', 'MIA', '4429160'),
  player('lamb', 'CeeDee Lamb', 'WR', 'DAL', '4241389'),
  player('pacheco', 'Isiah Pacheco', 'RB', 'DET', '4361529'),
  player('goff', 'Jared Goff', 'QB', 'DET', '3046779'),
  player('kamara', 'Alvin Kamara', 'RB', 'NO', '3054850'),
  player('DEN', 'Denver Broncos', 'DEF', 'DEN'),
  player('HOU', 'Houston Texans', 'DEF', 'HOU'),
  player('LAR-DEF', 'Los Angeles Rams', 'DEF', 'LAR'),
  player('PIT', 'Pittsburgh Steelers', 'DEF', 'PIT'),
  player('NE', 'New England Patriots', 'DEF', 'NE'),
  player('BAL', 'Baltimore Ravens', 'DEF', 'BAL'),
  player('CLE', 'Cleveland Browns', 'DEF', 'CLE'),
]);

function liveWith(overrides: Partial<EspnLiveSnapshot>): EspnLiveSnapshot {
  return {
    schemaVersion: 2, streamPicks: [], mySlot: null, leagueId: 'L1', lastHeartbeatAt: 1,
    domPicks: [], domMaxSeen: 0, domMaxAtStreamStart: null, domSampledBeforeStream: false,
    currentPickNumber: null, currentPickTeam: null,
    ...overrides,
  };
}

describe('deriveEspnStreamOffset', () => {
  it('confirms offset 0 from the real round-1 fixture (board confirmed empty, no DOM rows needed)', () => {
    const result = deriveEspnStreamOffset(ROUND1_FIXTURE.live, INDEX);
    expect(result).toMatchObject({ offset: 0, confirmed: true, source: 'board-empty' });
    expect(result.offset).toBe(ROUND1_FIXTURE.groundTruth.offset);
  });

  it('confirms the real late-attach fixture at the recorded ground-truth offset (137)', () => {
    const result = deriveEspnStreamOffset(LATE_ATTACH_FIXTURE.live, INDEX);
    expect(result.confirmed).toBe(true);
    expect(result.source).toBe('corroborated');
    expect(result.offset).toBe(LATE_ATTACH_FIXTURE.groundTruth.offset);
    expect(result.offset).toBe(137);
    // 4 D/ST picks (arrivals 5-8) join against the 4-row DOM ticker; the other 6 arrivals (3 skill
    // players + 3 late D/ST picks outside the ticker window) contribute no join evidence -- expected
    // per the fixture's own notes, not a defect.
    expect(result.joins).toBe(4);
    expect(result.distinctCandidates).toBe(1);
  });

  it('returns unconfirmed with no stream picks yet', () => {
    expect(deriveEspnStreamOffset(liveWith({ streamPicks: [] }), INDEX)).toMatchObject({ confirmed: false, offset: null });
    expect(deriveEspnStreamOffset(null, INDEX)).toMatchObject({ confirmed: false, offset: null });
  });

  it('does not confirm offset 0 on an UNSAMPLED empty board (domSampledBeforeStream false) -- the DOM-reconcile-vs-first-SELECTED race', () => {
    const live = liveWith({
      streamPicks: [{ overall: 1, slot: 1, playerId: '4429795', source: 'frame' }],
      domMaxAtStreamStart: 0,
      domSampledBeforeStream: false, // never confirmed sampled -- correction #1
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result.confirmed).toBe(false);
    expect(result.offset).toBeNull();
  });

  it('does not confirm a non-zero board-depth candidate with zero crosswalk joins (correction #2: board-depth alone never confirms a non-zero offset)', () => {
    const live = liveWith({
      streamPicks: [{ overall: 1, slot: 5, playerId: '9999999', source: 'frame' }], // unresolvable -> no join possible
      domMaxAtStreamStart: 20,
      domSampledBeforeStream: true,
      domPicks: [],
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result.confirmed).toBe(false);
    expect(result.reason).toMatch(/corroborated it yet/);
  });

  it('blocks confirmation when a crosswalk join contradicts the board-depth estimate, trusting neither', () => {
    const domPicks: EspnDomPick[] = [{ pickNumber: 25, text: "25Jahmyr GibbsDETRBSomebody's Team1", segments: [] }];
    const live = liveWith({
      streamPicks: [{ overall: 1, slot: 5, playerId: '4429795', source: 'frame' }], // Gibbs
      domMaxAtStreamStart: 20, // disagrees with the join's implied offset of 24
      domSampledBeforeStream: true,
      domPicks,
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result.confirmed).toBe(false);
    expect(result.reason).toMatch(/disagree/);
  });

  it('blocks confirmation when two crosswalk joins imply different offsets (contradictory evidence)', () => {
    const domPicks: EspnDomPick[] = [
      { pickNumber: 25, text: "25Jahmyr GibbsDETRBSomebody's Team1", segments: [] },
      { pickNumber: 40, text: "40Ja'Marr ChaseCINWRSomebody's Team1", segments: [] },
    ];
    const live = liveWith({
      streamPicks: [
        { overall: 1, slot: 5, playerId: '4429795', source: 'frame' }, // Gibbs -> implies offset 24
        { overall: 2, slot: 1, playerId: '4362628', source: 'frame' }, // Chase -> implies offset 38
      ],
      domPicks,
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result.confirmed).toBe(false);
    expect(result.distinctCandidates).toBe(2);
    expect(result.reason).toMatch(/disagree/);
  });

  it('does not confirm a single crosswalk join with no board-depth corroboration', () => {
    const domPicks: EspnDomPick[] = [{ pickNumber: 25, text: "25Jahmyr GibbsDETRBSomebody's Team1", segments: [] }];
    const live = liveWith({
      streamPicks: [{ overall: 1, slot: 5, playerId: '4429795', source: 'frame' }],
      domPicks,
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result.confirmed).toBe(false);
    expect(result.joins).toBe(1);
    expect(result.reason).toMatch(/only 1 crosswalk join/);
  });

  it('confirms via crosswalk-join alone once >= 2 independent joins agree, with no board-depth signal', () => {
    const domPicks: EspnDomPick[] = [
      { pickNumber: 25, text: "25Jahmyr GibbsDETRBSomebody's Team1", segments: [] },
      { pickNumber: 26, text: "26Ja'Marr ChaseCINWRSomebody's Team1", segments: [] },
    ];
    const live = liveWith({
      streamPicks: [
        { overall: 1, slot: 5, playerId: '4429795', source: 'frame' }, // Gibbs -> offset 24
        { overall: 2, slot: 1, playerId: '4362628', source: 'frame' }, // Chase -> offset 24
      ],
      domPicks,
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result).toMatchObject({ offset: 24, confirmed: true, source: 'crosswalk-join', joins: 2, distinctCandidates: 1 });
  });

  it('rejects a negative offset outright -- the DOM cannot lag the stream by a whole pick', () => {
    const domPicks: EspnDomPick[] = [{ pickNumber: 1, text: "1Jahmyr GibbsDETRBSomebody's Team1", segments: [] }];
    const live = liveWith({
      streamPicks: [{ overall: 5, slot: 5, playerId: '4429795', source: 'frame' }], // arrival 5 -> DOM says pick 1: implies -4
      domPicks,
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result.confirmed).toBe(false);
    expect(result.reason).toMatch(/negative offset/);
  });

  it('D/ST-only joins never satisfy MIN_JOINS_WITHOUT_BOARD_DEPTH alone if fewer than 2 (documents the tier-1 limitation for skill positions, not a defect)', () => {
    const domPicks: EspnDomPick[] = [{ pickNumber: 141, text: '141Broncos D/STDEND/STSomebody1', segments: [] }];
    const live = liveWith({
      streamPicks: [{ overall: 1, slot: 5, playerId: '-16007', source: 'frame' }], // DEN D/ST -> offset 140
      domPicks,
    });
    const result = deriveEspnStreamOffset(live, INDEX);
    expect(result.joins).toBe(1);
    // A single D/ST join is real evidence but still needs a second join or board-depth corroboration.
    expect(result.confirmed).toBe(false);
  });
});
