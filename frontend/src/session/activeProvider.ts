/** Which provider owns the active draft session — the neutral home for this vocabulary (it used
 * to live on `components/LandingPage`, which made the session provider and the draft workspace
 * import a type from a marketing component). 'none' means no session; a Sleeper takeover still
 * counts as 'sleeper'; a pure-manual ESPN session counts as 'espn'; a from-scratch Yahoo
 * session counts as 'yahoo' (the chip-driven click-to-log flow added 2026-09-01, see
 * DECISIONS.md 2026-09-01). */
export type ActiveProvider = 'none' | 'sleeper' | 'espn' | 'yahoo';