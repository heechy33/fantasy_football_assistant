import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  GLOBAL_MIN_RADIUS,
  NFL_TEAM_ABBREVS,
  ORBIT_RINGS,
  teamAbbrevAt,
  teamAtlasCell,
  teamOrbitPlacement,
} from './landingTeamOrbit';

// Drift guard: every abbreviation this module drives around the trophy must have a real
// `--team-XX` declared in styles/teamColors.css (same source teamColors.test.ts parses), so the
// orbit and the color rims never silently fall back to the neutral --team-fa tint.
const teamColorsCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'teamColors.css'),
  'utf-8',
);

describe('NFL_TEAM_ABBREVS', () => {
  it('lists exactly 32 unique teams', () => {
    expect(NFL_TEAM_ABBREVS.length).toBe(32);
    expect(new Set(NFL_TEAM_ABBREVS).size).toBe(32);
  });

  it.each(NFL_TEAM_ABBREVS)('%s has a --team-XX custom property in teamColors.css', (team) => {
    expect(teamColorsCss).toContain(`--team-${team.toLowerCase()}:`);
    expect(teamColorsCss).toContain(`--team-${team.toLowerCase()}-ink:`);
  });
});

describe('ORBIT_RINGS', () => {
  it('ring counts sum to exactly 32 teams', () => {
    const total = ORBIT_RINGS.reduce((sum, ring) => sum + ring.count, 0);
    expect(total).toBe(NFL_TEAM_ABBREVS.length);
  });

  it('every ring minRadius clears the global floor', () => {
    for (const ring of ORBIT_RINGS) {
      expect(ring.minRadius).toBeGreaterThanOrEqual(GLOBAL_MIN_RADIUS);
    }
  });
});

describe('teamOrbitPlacement', () => {
  const sweep = Array.from({ length: 40 }, (_, i) => i * 3.7); // varied, non-periodic-looking t

  it('never produces NaN/Infinity across a time sweep, for every team', () => {
    for (let i = 0; i < NFL_TEAM_ABBREVS.length; i++) {
      for (const t of sweep) {
        const p = teamOrbitPlacement(i, t);
        for (const value of [p.x, p.y, p.z, p.scale]) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it('keeps planar radius within [GLOBAL_MIN_RADIUS, ring.baseRadius] for every team/time', () => {
    for (let i = 0; i < NFL_TEAM_ABBREVS.length; i++) {
      for (const t of sweep) {
        const { x, z } = teamOrbitPlacement(i, t);
        const radius = Math.hypot(x, z);
        expect(radius).toBeGreaterThanOrEqual(GLOBAL_MIN_RADIUS - 1e-9);
        expect(radius).toBeLessThanOrEqual(13.0 + 1e-9); // widest ring's baseRadius
      }
    }
  });

  it('is deterministic: same (i, t) always returns the same transform', () => {
    const a = teamOrbitPlacement(5, 12.3);
    const b = teamOrbitPlacement(5, 12.3);
    expect(a).toEqual(b);
  });

  it('throws for an out-of-range index', () => {
    expect(() => teamOrbitPlacement(-1, 0)).toThrow();
    expect(() => teamOrbitPlacement(32, 0)).toThrow();
  });
});

describe('teamAbbrevAt', () => {
  it('matches NFL_TEAM_ABBREVS ordering for every valid index', () => {
    for (let i = 0; i < NFL_TEAM_ABBREVS.length; i++) {
      expect(teamAbbrevAt(i)).toBe(NFL_TEAM_ABBREVS[i]);
    }
  });

  it('throws for an out-of-range index', () => {
    expect(() => teamAbbrevAt(-1)).toThrow();
    expect(() => teamAbbrevAt(32)).toThrow();
  });
});

describe('teamAtlasCell', () => {
  it('covers all 32 cells of the 8x4 atlas with no collisions', () => {
    expect(ATLAS_COLS * ATLAS_ROWS).toBe(32);
    const seen = new Set<string>();
    for (let i = 0; i < NFL_TEAM_ABBREVS.length; i++) {
      const cell = teamAtlasCell(i);
      expect(cell.col).toBeGreaterThanOrEqual(0);
      expect(cell.col).toBeLessThan(ATLAS_COLS);
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeLessThan(ATLAS_ROWS);
      expect(cell.u).toBeGreaterThanOrEqual(0);
      expect(cell.u).toBeLessThan(1);
      expect(cell.v).toBeGreaterThanOrEqual(0);
      expect(cell.v).toBeLessThan(1);
      const key = `${cell.col},${cell.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(32);
  });

  it('throws for an out-of-range index', () => {
    expect(() => teamAtlasCell(-1)).toThrow();
    expect(() => teamAtlasCell(32)).toThrow();
  });
});
