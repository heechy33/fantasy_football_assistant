import { memo } from 'react';
import type { Position } from '../../../shared/types';

export interface PositionBadgeProps {
  position: Position | null;
  className?: string;
}

/** Display label for a canonical engine position. `DEF` stays `DEF` in data; the chip shows `DST`. */
export function positionBadgeLabel(position: Position | null): string {
  if (position == null) return '—';
  return position === 'DEF' ? 'DST' : position;
}

export const PositionBadge = memo(function PositionBadge({ position, className }: PositionBadgeProps) {
  const classes = ['position-badge', position == null ? 'position-badge-unknown' : null, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} data-position={position ?? undefined}>
      {positionBadgeLabel(position)}
    </span>
  );
});
