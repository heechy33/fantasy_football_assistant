/** Which provider owns the active draft session — the neutral home for this vocabulary (it used
 * to live on `components/LandingPage`, which made the session provider and the draft workspace
 * import a type from a marketing component). 'none' means no session; a Sleeper takeover still
 * counts as 'sleeper'; a pure-manual ESPN session counts as 'espn'. */
export type ActiveProvider = 'none' | 'sleeper' | 'espn';