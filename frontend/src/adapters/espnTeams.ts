/**
 * ESPN NFL-team identity helpers, ported from the Python pipeline so the draft-day D/ST crosswalk
 * can resolve a DEF pick by team identity instead of using ESPN's negative synthetic DEF ids.
 *
 * Sources: pipeline/espn_projections.py:PRO_TEAM_ABBR (proTeamId -> raw abbreviation; note the raw
 * map emits "WSH" for id 28) and pipeline/match.py:TEAM_ALIASES / DEF_TEAM_NAMES (the canonical
 * players.json keys, where Washington is "WAS" — the alias layer is what folds one onto the other).
 */

/** ESPN proTeamId -> raw abbreviation. */
const PRO_TEAM_ABBR: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
  15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

/** Folds legacy/ESPN spellings onto the players.json team keys. */
const TEAM_ALIASES: Record<string, string> = {
  ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU',
  JAC: 'JAX', KAN: 'KC', LA: 'LAR', STL: 'LAR',
  SD: 'LAC', OAK: 'LV', NWE: 'NE', NOR: 'NO',
  SFO: 'SF', TAM: 'TB', OTI: 'TEN', WSH: 'WAS',
};

/** Full franchise names -> players.json team keys. All 32, no exceptions. */
const DEF_TEAM_NAMES: Record<string, string> = {
  'arizona cardinals': 'ARI', 'atlanta falcons': 'ATL', 'baltimore ravens': 'BAL',
  'buffalo bills': 'BUF', 'carolina panthers': 'CAR', 'chicago bears': 'CHI',
  'cincinnati bengals': 'CIN', 'cleveland browns': 'CLE', 'dallas cowboys': 'DAL',
  'denver broncos': 'DEN', 'detroit lions': 'DET', 'green bay packers': 'GB',
  'houston texans': 'HOU', 'indianapolis colts': 'IND', 'jacksonville jaguars': 'JAX',
  'kansas city chiefs': 'KC', 'las vegas raiders': 'LV', 'los angeles chargers': 'LAC',
  'los angeles rams': 'LAR', 'miami dolphins': 'MIA', 'minnesota vikings': 'MIN',
  'new england patriots': 'NE', 'new orleans saints': 'NO', 'new york giants': 'NYG',
  'new york jets': 'NYJ', 'philadelphia eagles': 'PHI', 'pittsburgh steelers': 'PIT',
  'san francisco 49ers': 'SF', 'seattle seahawks': 'SEA', 'tampa bay buccaneers': 'TB',
  'tennessee titans': 'TEN', 'washington commanders': 'WAS',
};

/** Every known NFL team abbreviation the DOM pick-row parser must recognize: ESPN's pro-team
 * abbreviations, legacy/ESPN aliases, and the canonical players.json keys. Derived from the maps
 * above so it can never drift from them. */
export const KNOWN_TEAM_ABBREVS: readonly string[] = [...new Set([
  ...Object.values(PRO_TEAM_ABBR),
  ...Object.keys(TEAM_ALIASES),
  ...Object.values(DEF_TEAM_NAMES),
])].sort();

/** Canonical players.json team key for any abbreviation (alias-folded, e.g. WSH -> WAS). */
export function canonicalTeam(abbreviation: string | null | undefined): string | null {
  const upper = (abbreviation ?? '').trim().toUpperCase();
  return upper ? (TEAM_ALIASES[upper] ?? upper) : null;
}

/** Canonical team for an ESPN proTeamId, or null for unknown ids (0 = free agent). */
export function teamFromProTeamId(proTeamId: number | null | undefined): string | null {
  if (proTeamId == null) return null;
  return canonicalTeam(PRO_TEAM_ABBR[proTeamId]);
}

/** Canonical team from a franchise name (e.g. "Washington Commanders" or just "Commanders"), for
 * the DOM pick-row cross-check. Exact match first, then a contains-match on the full name. */
export function teamFromFranchiseName(name: string | null | undefined): string | null {
  const folded = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!folded) return null;
  const exact = DEF_TEAM_NAMES[folded];
  if (exact) return exact;
  // Whole-WORD match only (e.g. "Bills" inside "buffalo bills", "Commanders" inside "washington
  // commanders") -- a raw substring match previously let a short abbreviation-shaped input match
  // embedded inside an unrelated team's name (real recon regression, 2026-08-15: "NE" matched inside
  // "mi-NE-sota vikings" before "new england patriots" was ever considered, since Object.entries
  // iterates in declared order and Minnesota comes first). Short abbreviations belong to
  // canonicalTeam (the caller's next fallback), not here.
  const match = Object.entries(DEF_TEAM_NAMES).find(([full]) => full.split(' ').includes(folded));
  return match ? match[1] : null;
}
