import type { PlayerProduction, WeeklyFantasyPoints } from '../../../shared/types';

/** Standard PPR receiving score. Matches the committed weekly-ppr artifact — do not re-score
 * prior-season actuals with the live league map. */
export function pprFromReceptions(
  receptions: number,
  receivingYards: number,
  receivingTds: number,
): number {
  return receptions + 0.1 * receivingYards + 6 * receivingTds;
}

export function pprFromRushes(rushingYards: number, rushingTds: number): number {
  return 0.1 * rushingYards + 6 * rushingTds;
}

/** Mean PPR over observed weeks only — never zero-fills byes or missing rows. */
export function pointsPerGame(weeks: readonly WeeklyFantasyPoints[]): number | null {
  if (weeks.length === 0) return null;
  const total = weeks.reduce((sum, week) => sum + week.pointsPpr, 0);
  return total / weeks.length;
}

/** Prefer the weekly series (already loaded for the chart). Fall back to the usage production
 * block when the series is empty so an older weekly artifact still shows a season PPG. */
export function resolvePointsPerGame(
  weeks: readonly WeeklyFantasyPoints[],
  production: PlayerProduction | null | undefined,
): number | null {
  return pointsPerGame(weeks) ?? production?.pointsPprPerGame ?? null;
}
