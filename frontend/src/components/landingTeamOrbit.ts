/**
 * Pure orbit math for the landing hero's 32 team medallions. No `three` import — this is directly
 * unit-testable, unlike `LandingHeroCanvas.tsx` itself (it early-returns without a WebGL context,
 * and `LandingPage.test.tsx` mocks it away entirely). `LandingHeroCanvas.tsx` turns
 * `teamOrbitPlacement`/`teamAtlasCell` into an `InstancedMesh` transform and a logo-atlas UV
 * offset per frame.
 *
 * Sleeper-canonical team abbreviations, matching the `--team-XX` keys `styles/teamColors.css`
 * declares (`EXPECTED_TEAMS` in `teamColors.test.ts`, minus `'FA'` — there's no free-agent
 * medallion). Kept as its own list rather than importing `adapters/espnTeams.ts`'s
 * `KNOWN_TEAM_ABBREVS`: CLAUDE.md reserves provider-specific modules for the adapter boundary,
 * and this file sits above it, alongside the rest of `components/`.
 */
export const NFL_TEAM_ABBREVS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND',
  'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF',
  'TB', 'TEN', 'WAS',
] as const;

export type TeamAbbrev = (typeof NFL_TEAM_ABBREVS)[number];

/** One nested ring of medallions. Rings breathe inward/outward out of phase with each other so
 * the whole formation reads as waves of teams closing in on the trophy, not one static halo. */
interface OrbitRing {
  count: number;
  baseRadius: number; // radius at full extension
  convergeAmplitude: number; // how far inward the ring pulls at full convergence
  minRadius: number; // ring-specific floor — never lets this ring cross the one inside it
  centerY: number; // ring's vertical center
  tiltAmplitude: number; // vertical bob as a function of orbital angle (fakes an inclined ring)
  tiltPhase: number;
  precessionSpeed: number; // angular drift per second (sign sets direction)
  convergeSpeed: number; // breathing speed per second
  convergePhase: number;
  phaseOffset: number; // starting angle offset for slot 0 in this ring
}

/** Outer 12 / mid 12 / inner 8 = all 32 teams. Alternating precession direction and out-of-phase
 * convergence keep the formation from ever reading as one rigid, synchronized object. Radii sit
 * outside the landing camera's own orbit (5.4-8.2 world units, see `LandingHeroCanvas.tsx`'s
 * `CAMERA_KEYS`) so the medallions read as a formation around the room rather than props the
 * camera pushes through. */
export const ORBIT_RINGS: readonly OrbitRing[] = [
  {
    count: 12, baseRadius: 13.0, convergeAmplitude: 2.4, minRadius: 10.6, centerY: 0.9,
    tiltAmplitude: 0.55, tiltPhase: 0, precessionSpeed: 0.028, convergeSpeed: 0.19,
    convergePhase: 0, phaseOffset: 0,
  },
  {
    count: 12, baseRadius: 10.5, convergeAmplitude: 2.1, minRadius: 8.4, centerY: 0.3,
    tiltAmplitude: 0.4, tiltPhase: 1.1, precessionSpeed: -0.045, convergeSpeed: 0.24,
    convergePhase: 2.1, phaseOffset: 0.26,
  },
  {
    count: 8, baseRadius: 8.0, convergeAmplitude: 2.0, minRadius: 6.0, centerY: -0.1,
    tiltAmplitude: 0.3, tiltPhase: 2.4, precessionSpeed: 0.06, convergeSpeed: 0.31,
    convergePhase: 4.0, phaseOffset: 0.5,
  },
];

/** Absolute floor across every ring — no medallion may ever cross the trophy silhouette,
 * regardless of ring config drift. Must stay <= the smallest ring's `minRadius` above (6.0). */
export const GLOBAL_MIN_RADIUS = 5.8;

export interface OrbitPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/** Resolve team index `i` (0..31, matching `NFL_TEAM_ABBREVS`) to its ring and slot within it. */
function ringSlot(i: number): { ring: OrbitRing; ringIndex: number; slot: number } {
  if (i < 0 || i >= NFL_TEAM_ABBREVS.length) {
    throw new Error(`team index ${i} out of range (${NFL_TEAM_ABBREVS.length} teams expected)`);
  }
  let idx = i;
  for (let r = 0; r < ORBIT_RINGS.length; r++) {
    const ring = ORBIT_RINGS[r]!;
    if (idx < ring.count) return { ring, ringIndex: r, slot: idx };
    idx -= ring.count;
  }
  throw new Error(`team index ${i} out of range (${NFL_TEAM_ABBREVS.length} teams expected)`);
}

/**
 * Placement of team index `i` at continuous time `t` (seconds, matching the frame loop's
 * `THREE.Clock`). Deterministic and pure — the same `(i, t)` always produces the same transform.
 * Radius is clamped to `[GLOBAL_MIN_RADIUS, ring.baseRadius]` so convergence can never send a
 * medallion through the trophy or fling it past its ring's resting radius.
 */
export function teamOrbitPlacement(i: number, t: number): OrbitPlacement {
  const { ring, slot } = ringSlot(i);
  const angle = (slot / ring.count) * Math.PI * 2 + ring.phaseOffset + t * ring.precessionSpeed;
  const breathe = 0.5 + 0.5 * Math.sin(t * ring.convergeSpeed + ring.convergePhase);
  const radius = Math.min(
    ring.baseRadius,
    Math.max(GLOBAL_MIN_RADIUS, ring.minRadius, ring.baseRadius - ring.convergeAmplitude * breathe),
  );
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = ring.centerY + Math.sin(angle + ring.tiltPhase) * ring.tiltAmplitude;
  // Subtle scale pulse: medallions read very slightly larger as their ring converges, echoing the
  // sense of closing distance without a per-frame camera-distance computation.
  const scale = 1 + 0.08 * breathe;
  return { x, y, z, scale };
}

/** Team abbreviation for orbit index `i`, matching the ordering `teamOrbitPlacement` uses. */
export function teamAbbrevAt(i: number): TeamAbbrev {
  const abbrev = NFL_TEAM_ABBREVS[i];
  if (!abbrev) throw new Error(`team index ${i} out of range (${NFL_TEAM_ABBREVS.length} teams expected)`);
  return abbrev;
}

/** Shared logo atlas is an 8x4 grid — one 256px cell per team, 32 cells exactly. */
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

/**
 * UV placement of team index `i`'s logo cell inside the shared atlas texture built in
 * `LandingHeroCanvas.tsx`. `u`/`v` is the cell's origin with `v` measured from the top (canvas
 * drawing convention); callers flip to three's bottom-left UV origin when they build the
 * geometry/shader offset.
 */
export function teamAtlasCell(i: number): { col: number; row: number; u: number; v: number; du: number; dv: number } {
  if (i < 0 || i >= NFL_TEAM_ABBREVS.length) {
    throw new Error(`team index ${i} out of range (${NFL_TEAM_ABBREVS.length} teams expected)`);
  }
  const col = i % ATLAS_COLS;
  const row = Math.floor(i / ATLAS_COLS);
  const du = 1 / ATLAS_COLS;
  const dv = 1 / ATLAS_ROWS;
  return { col, row, u: col * du, v: row * dv, du, dv };
}
