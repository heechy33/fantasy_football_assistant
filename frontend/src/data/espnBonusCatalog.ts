/**
 * ESPN statId → human-readable bonus label, for the connect confirm card's "not modeled" tag
 * group. This covers ONLY the ids the adapter deliberately leaves UNMAPPED — categories whose
 * ESPN meaning is a threshold/tier bonus the engine cannot score from linear projection data
 * (see espnLeague.ts's STAT_ID_MAP doc for why they are disclosed, never guessed into the map).
 *
 * Label provenance (2026-08-28, verified against espn-api's `PLAYER_STATS_MAP` — itself cross-
 * checked in-repo by pipeline/espn_projections.py's `_RAW_STAT_WEIGHTS`, which agrees on every
 * base id: 24/25 rush yd/TD, 42/43 rec yd/TD, 74/77/80/85 FG tiers):
 * - 35/36 = rush TD 40+/50+ yd; 37/38 = 100-199 / 200+ yd rushing game.
 * - 45/46 = receiving TD 40+/50+ yd; 56/57 = 100-199 / 200+ yd receiving game.
 * - 74/77/80/85 FG tiers verified IN-REPO (80 = made 0-39 @3, 77 = 40-49 @4, 74 = 50+ @5,
 *   85 = missed @-1).
 * ESPN's yardage-game ids sit in a DIFFERENT band than their TD ids — the long-TD family is
 * 35/36 (rush) and 45/46 (receive), NOT 45/46 (rush games) as a first guess reads. Any id
 * without a confident meaning here renders as the generic fallback tag — a wrong label would
 * be worse than a plain one (58/59 have no confident espn-api meaning and stay out).
 */
const BONUS_LABELS: Readonly<Record<number, string>> = {
  35: 'Rush TD 40+ yd',
  36: 'Rush TD 50+ yd',
  37: '100-199 yd rushing game',
  38: '200+ yd rushing game',
  45: 'Rec TD 40+ yd',
  46: 'Rec TD 50+ yd',
  56: '100-199 yd receiving game',
  57: '200+ yd receiving game',
  74: 'FG 50+ yd',
  77: 'FG 40-49 yd',
  80: 'FG 0-39 yd',
  85: 'Missed FG',
};

/** True when the catalog has a confident (non-generic) label for this id. */
export function hasEspnBonusLabel(statId: number): boolean {
  return statId in BONUS_LABELS;
}

/**
 * Display label for an unmodeled ESPN scoring item. Known ids get their catalog label; anything
 * else stays honest with the raw id rather than guessing a meaning.
 */
export function espnBonusLabel(statId: number): string {
  return BONUS_LABELS[statId] ?? `Bonus category (id ${statId})`;
}

/** "Rush TD 40+ yd +2" — the compact tag text the confirm card renders. */
export function formatEspnBonusTag(item: { statId: number; points: number }): string {
  const sign = item.points < 0 ? '−' : '+';
  return `${espnBonusLabel(item.statId)} ${sign}${Math.abs(item.points)}`;
}
