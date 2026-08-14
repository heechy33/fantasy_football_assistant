export type RoleBand = 'elite' | 'good' | 'fair' | 'poor' | 'unknown';

/**
 * Maps the position-role rating words (playerRole.ts / weeklyRoleColumns.ts)
 * onto the shared score-band palette so the chip colors match the rest of the
 * app's good/bad language. Unknown/unavailable ratings render muted, never as a
 * false "good" or "bad".
 */
export function roleBand(rating: string): RoleBand {
  switch (rating) {
    case 'Elite':
    case 'Rising':
      return 'elite';
    case 'Strong':
    case 'Steady':
      return 'good';
    case 'Average':
      return 'fair';
    case 'Limited':
    case 'Falling':
      return 'poor';
    default:
      return 'unknown';
  }
}

export interface RoleColumnHeaderProps {
  /** The role aspect name, e.g. "Volume" or "Efficiency" -- visible, unlike the old gauge. */
  title: string;
  rating: string;
}

/**
 * Role-card header: a visible title plus a compact color-coded rating chip.
 * Replaces the old semicircle `ScoreGauge` inside each role box -- the gauge
 * only ever surfaced the rating word while hiding the aspect name, which is why
 * the boxes read as anonymous.
 */
export function RoleColumnHeader({ title, rating }: RoleColumnHeaderProps) {
  return (
    <header className="player-role-card-head">
      <h4 className="player-role-card-title">{title}</h4>
      <span className="player-role-rating-chip" data-band={roleBand(rating)}>{rating}</span>
    </header>
  );
}
