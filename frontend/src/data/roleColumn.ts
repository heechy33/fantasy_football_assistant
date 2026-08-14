/**
 * Shared RoleColumn/RoleStat shape and small formatters used by both
 * `playerRole.ts` (RB/WR/TE, from the season `opportunity` aggregate) and
 * `weeklyRoleColumns.ts` (QB/K/DEF, from the weekly game log). Split into its
 * own module so those two can both build `RoleColumn`s without one importing
 * the other -- `playerRole.ts` calls into `weeklyRoleColumns.ts` for QB/K/DEF,
 * so the reverse import would be circular.
 */

export type RoleColumnId =
  | 'volume' | 'receiving' | 'air' | 'scoring' | 'form' | 'snaps'
  // QB/K/DEF columns, built from the weekly game log (weeklyRoleColumns.ts) --
  // distinct stable ids so PlayerRolePanel's `key={column.id}` never collides
  // with the season-`opportunity`-derived ids above.
  | 'passing' | 'rushing' | 'efficiency'
  | 'kicking-volume' | 'accuracy' | 'distance'
  | 'pressure' | 'takeaways' | 'prevention';

export type DeltaTone = 'up' | 'down' | 'neutral';

export interface RoleStat {
  label: string;
  display: string;
  fill: number | null;
  delta?: { text: string; tone: DeltaTone };
}

export interface RoleColumn {
  id: RoleColumnId;
  label: string;
  rating: string;
  fill: number | null;
  result?: string;
  stats: RoleStat[];
}

export function formatShare(value: number | null): string {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`;
}

export function formatCount(value: number | null, digits = 1): string {
  return value == null ? 'n/a' : value.toFixed(digits);
}

export function formatWhole(value: number | null): string {
  return value == null ? 'n/a' : String(Math.round(value));
}

export function deltaTone(value: number | null): DeltaTone {
  if (value == null || value === 0) return 'neutral';
  return value > 0 ? 'up' : 'down';
}
