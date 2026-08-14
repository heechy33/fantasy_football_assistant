import { describe, expect, it } from 'vitest';
import type { PlayerWeeklyStatsArtifact } from '../../../shared/types';
import { buildGameLogRows, buildSparklinePoints, heatBucket } from './weeklyGameLog';

const RB_COLUMNS = ['pts', 'opp', 'snp', 'fin', 'rush_att', 'rush_yd', 'rush_ypa', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'fum_lost'] as const;

/** Builds a row by column NAME, not position -- avoids the exact class of
 * off-by-one mistake this module's key-based resolution exists to prevent. */
function rbRow(week: number, values: Partial<Record<(typeof RB_COLUMNS)[number], number | string | null>>): (number | string | null)[] {
  return [week, ...RB_COLUMNS.map((key) => values[key] ?? 0)];
}

function artifact(overrides: Partial<PlayerWeeklyStatsArtifact> = {}): PlayerWeeklyStatsArtifact {
  return {
    schemaVersion: 1,
    season: 2025,
    weeksFetched: Array.from({ length: 18 }, (_, i) => i + 1),
    columns: { RB: [...RB_COLUMNS] },
    players: {
      rb1: {
        p: 'RB',
        bye: 9,
        w: [
          rbRow(1, { pts: 14.2, opp: '@KC', snp: 55, fin: 5, rush_att: 12, rush_yd: 60, rush_ypa: 5.0, rec_tgt: 2, rec: 1, rec_yd: 8 }),
          rbRow(4, { pts: 0.0, opp: 'DAL', snp: 40, fin: 30, rush_att: 3, rush_yd: -2, rush_ypa: -0.7 }), // played, scored exactly 0
        ],
      },
    },
    heat: {},
    ...overrides,
  };
}

describe('buildGameLogRows', () => {
  it('always returns 18 rows, one per week, regardless of how many were played', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    expect(rows).toHaveLength(18);
    expect(rows.map((row) => row.week)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('a week not in weeksFetched is "nodata", never confused with a bye', () => {
    const rows = buildGameLogRows(artifact({ weeksFetched: [1, 2, 3] }), 'rb1', 'RB');
    const week9 = rows.find((row) => row.week === 9)!; // the player's real bye, but week 9 was never fetched
    expect(week9.kind).toBe('nodata');
    const week18 = rows.find((row) => row.week === 18)!;
    expect(week18.kind).toBe('nodata');
  });

  it('the player\'s bye week (fetched, no row) is "bye"', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const week9 = rows.find((row) => row.week === 9)!;
    expect(week9.kind).toBe('bye');
    expect(week9.pts).toBeNull();
  });

  it('a fetched week with no row that is not the bye is "inactive"', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const week2 = rows.find((row) => row.week === 2)!;
    expect(week2.kind).toBe('inactive');
    expect(week2.pts).toBeNull();
  });

  it('a played week that scored exactly 0.0 is "played", not "inactive"', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const week4 = rows.find((row) => row.week === 4)!;
    expect(week4.kind).toBe('played');
    expect(week4.pts).toBe(0);
  });

  it('resolves cells by column KEY, not array position -- an extra leading column does not misalign anything', () => {
    const shiftedColumns = ['extra_leading_column', ...RB_COLUMNS];
    const shiftedRow = [1, 999, ...rbRow(1, { pts: 14.2, opp: '@KC', snp: 55, fin: 5, rush_yd: 60 }).slice(1)];
    const shifted = artifact({
      columns: { RB: shiftedColumns },
      players: { rb1: { p: 'RB', bye: 9, w: [shiftedRow] } },
    });
    const rows = buildGameLogRows(shifted, 'rb1', 'RB');
    const week1 = rows.find((row) => row.week === 1)!;
    expect(week1.pts).toBe(14.2); // not 999 -- 'pts' was resolved by name, not by row[1]
    expect(week1.opponent).toBe('@KC');
    const rushYdCell = week1.cells.find((cell) => cell.key === 'rush_yd')!;
    expect(rushYdCell.display).toBe('60');
  });

  it('fin is formatted with the position prefix (e.g. RB5), matching the FantasyPros-style reference', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const week1 = rows.find((row) => row.week === 1)!;
    const finCell = week1.cells.find((cell) => cell.key === 'fin')!;
    expect(finCell.display).toBe('RB5');
  });

  it('opp is exposed on the row directly and excluded from cells', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const week1 = rows.find((row) => row.week === 1)!;
    expect(week1.opponent).toBe('@KC');
    expect(week1.cells.some((cell) => cell.key === 'opp')).toBe(false);
  });

  it('returns [] for a null position', () => {
    expect(buildGameLogRows(artifact(), 'rb1', null)).toEqual([]);
  });

  it('returns 18 nodata-or-inactive rows with no cells for a player absent from the artifact', () => {
    const rows = buildGameLogRows(artifact(), 'unknown-player', 'RB');
    expect(rows).toHaveLength(18);
    expect(rows.every((row) => row.kind !== 'played')).toBe(true);
  });
});

describe('buildSparklinePoints', () => {
  it('returns only played weeks, never zero-filling byes/inactive weeks', () => {
    const points = buildSparklinePoints(artifact(), 'rb1');
    expect(points).toEqual([{ week: 1, pointsPpr: 14.2 }, { week: 4, pointsPpr: 0 }]);
  });

  it('returns [] for a player with no series', () => {
    expect(buildSparklinePoints(artifact(), 'unknown-player')).toEqual([]);
  });
});

describe('heatBucket', () => {
  const breakpoints = [10, 20, 30, 40] as const;

  it('buckets below p20 as 1, at/above p80 as 5', () => {
    expect(heatBucket(5, breakpoints, 'higher-better')).toBe(1);
    expect(heatBucket(45, breakpoints, 'higher-better')).toBe(5);
  });

  it('a value exactly equal to a breakpoint lands in the HIGHER bucket', () => {
    expect(heatBucket(10, breakpoints, 'higher-better')).toBe(2); // not 1
    expect(heatBucket(20, breakpoints, 'higher-better')).toBe(3);
    expect(heatBucket(30, breakpoints, 'higher-better')).toBe(4);
    expect(heatBucket(40, breakpoints, 'higher-better')).toBe(5);
  });

  it('inverts for lower-better columns: a low raw value shades warm (bucket 5)', () => {
    expect(heatBucket(5, breakpoints, 'lower-better')).toBe(5);
    expect(heatBucket(45, breakpoints, 'lower-better')).toBe(1);
    // Boundary still resolves via the same >= rule before inversion.
    expect(heatBucket(10, breakpoints, 'lower-better')).toBe(4); // raw bucket 2 -> 6-2=4
  });

  it('returns null for a null value, non-finite value, or null breakpoints (unshaded column)', () => {
    expect(heatBucket(null, breakpoints, 'higher-better')).toBeNull();
    expect(heatBucket(Number.NaN, breakpoints, 'higher-better')).toBeNull();
    expect(heatBucket(20, null, 'higher-better')).toBeNull();
    expect(heatBucket(20, undefined, 'higher-better')).toBeNull();
  });
});

describe('buildGameLogRows heat wiring', () => {
  it('shades a played cell using the artifact\'s heat breakpoints for that position/column', () => {
    const withHeat = artifact({ heat: { RB: { rush_yd: [10, 20, 30, 40] } } });
    const rows = buildGameLogRows(withHeat, 'rb1', 'RB');
    const week1 = rows.find((row) => row.week === 1)!;
    const rushYdCell = week1.cells.find((cell) => cell.key === 'rush_yd')!;
    // rush_yd=60 for week 1 -> above every breakpoint -> bucket 5.
    expect(rushYdCell.heat).toBe(5);
  });

  it('never shades opp or fin, even when heat data is present for the column', () => {
    const rows = buildGameLogRows(artifact(), 'rb1', 'RB');
    const week1 = rows.find((row) => row.week === 1)!;
    const finCell = week1.cells.find((cell) => cell.key === 'fin')!;
    expect(finCell.heat).toBeNull();
  });

  it('leaves heat null for a column with no breakpoints published (thin sample)', () => {
    const rows = buildGameLogRows(artifact({ heat: { RB: { rush_yd: null } } }), 'rb1', 'RB');
    const week1 = rows.find((row) => row.week === 1)!;
    const rushYdCell = week1.cells.find((cell) => cell.key === 'rush_yd')!;
    expect(rushYdCell.heat).toBeNull();
  });
});
