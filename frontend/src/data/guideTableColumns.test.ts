import { describe, expect, it } from 'vitest';
import { buildLaneCell, buildPositionRankByPlayer, formatRelativeAge, positionRankLabel, serializeGuideCsv, type GuideLane } from './guideTableColumns';
import type { GuideRow } from './guideBoard';

/** Presentation-facts fixtures: only identity, position, and the ordering inputs matter. */
function row(playerId: string, position: string, projectedPoints: number | null, engineRank: number | null = null): GuideRow {
  return {
    playerId,
    player: { playerId, name: `Player ${playerId}`, position, eligiblePositions: [position], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} } as GuideRow['player'],
    recommendation: projectedPoints != null ? ({ projectedPoints } as GuideRow['recommendation']) : null,
    engineRank,
    adpEntry: null,
  };
}

describe('buildPositionRankByPlayer', () => {
  it('ranks within each position by projected points desc (the RB1 chip)', () => {
    const rows = [
      row('rb-b', 'RB', 210),
      row('rb-a', 'RB', 240),
      row('wr-a', 'WR', 200),
      row('qb-a', 'QB', 300),
    ];
    const ranks = buildPositionRankByPlayer(rows);
    expect(ranks.get('rb-a')).toBe(1); // best RB, even though listed second
    expect(ranks.get('rb-b')).toBe(2);
    expect(ranks.get('wr-a')).toBe(1); // ranks are per-position, never cross-position
    expect(ranks.get('qb-a')).toBe(1);
  });

  it('places unprojected players after all projected peers, deterministically', () => {
    const rows = [
      row('r-c', 'RB', null, 3),
      row('r-b', 'RB', null, 2),
      row('r-a', 'RB', 100),
    ];
    const ranks = buildPositionRankByPlayer(rows);
    expect(ranks.get('r-a')).toBe(1);
    expect(ranks.get('r-b')).toBe(2); // engine rank breaks the unprojected tie
    expect(ranks.get('r-c')).toBe(3);
  });

  it('is deterministic across rebuilds', () => {
    const rows = [row('x', 'WR', 50), row('y', 'WR', 70), row('z', 'WR', null, 1)];
    expect(buildPositionRankByPlayer(rows)).toEqual(buildPositionRankByPlayer(rows));
  });
});

describe('positionRankLabel', () => {
  it('formats position + rank and returns null without a position or rank', () => {
    const rows = [row('rb1', 'RB', 100), row('fa', 'RB', 50)];
    const ranks = buildPositionRankByPlayer(rows);
    expect(positionRankLabel(rows[0]!, ranks)).toBe('RB1');
    expect(positionRankLabel(rows[1]!, ranks)).toBe('RB2');
    expect(positionRankLabel({ ...rows[0]!, player: undefined }, ranks)).toBeNull();
  });
});

describe('buildLaneCell', () => {
  const lane: GuideLane = {
    key: 'sleeper', label: 'Sleeper ADP', brandKey: 'sleeper', status: 'ready',
    rankByPlayer: new Map([['a', 1]]), adpByPlayer: new Map([['a', 2.5]]),
  };

  it('computes delta as lane ADP minus the anchor rank', () => {
    expect(buildLaneCell(lane, 'a', 1)).toEqual({ adp: 2.5, delta: 1.5 });
    expect(buildLaneCell(lane, 'a', 4)).toEqual({ adp: 2.5, delta: -1.5 });
  });

  it('returns nulls for unranked players, missing ADP, missing anchor, and unavailable lanes', () => {
    expect(buildLaneCell(lane, 'b', 1)).toEqual({ adp: null, delta: null });
    expect(buildLaneCell(lane, 'a', null)).toEqual({ adp: 2.5, delta: null });
    const unavailable: GuideLane = { ...lane, status: 'unavailable' };
    expect(buildLaneCell(unavailable, 'a', 1)).toEqual({ adp: null, delta: null });
  });
});

describe('serializeGuideCsv', () => {
  it('escapes commas and quotes, and always ends with a newline', () => {
    const rows = [row('p1', 'RB', 1)];
    const csv = serializeGuideCsv(rows, [
      { header: 'Player', value: () => 'Smith, John "JD"' },
      { header: 'Rank', value: () => '1' },
    ]);
    expect(csv).toBe('Player,Rank\n"Smith, John ""JD""",1\n');
  });
});

describe('formatRelativeAge', () => {
  const now = Date.parse('2026-08-25T12:00:00Z');
  it('formats minutes, hours, and days from an ISO timestamp', () => {
    expect(formatRelativeAge('2026-08-25T11:45:00Z', now)).toBe('15m ago');
    expect(formatRelativeAge('2026-08-24T22:00:00Z', now)).toBe('14h ago');
    expect(formatRelativeAge('2026-08-20T12:00:00Z', now)).toBe('5d ago');
  });

  it('accepts epoch ms and returns null for missing/invalid values', () => {
    expect(formatRelativeAge(now - 90_000, now)).toBe('2m ago');
    expect(formatRelativeAge(null, now)).toBeNull();
    expect(formatRelativeAge('not-a-date', now)).toBeNull();
    expect(formatRelativeAge(0, now)).toBeNull();
  });
});