import { memo } from 'react';

export interface NextUpInfo {
  /** Name of the next-best player at the same position on the remaining board. */
  name: string;
  /** Projected-points gap from this player to that next player (>= 0); null when either side lacks a projection. */
  gap: number | null;
  /** `Recommendation.tierBoundaryGap` — lowest score in this player's tier minus the best score in the next tier. */
  tierBoundaryGap: number;
  /** `Recommendation.nearTie` — the engine's own near-tie band signal. */
  nearTie: boolean;
}

/**
 * Mirrors `tiers.ts`'s tier-boundary heuristic (a boundary is worth a tier at
 * max(6 points, 8% of the tier's best score)) so the chip's "big drop-off"
 * qualifier can never disagree with the tier math it summarizes.
 * `referencePoints` is the player's own projected points — a conservative
 * stand-in for the tier leader, since the leader's score is >= any member's.
 */
export function isBigDropOff(tierBoundaryGap: number, referencePoints: number | null | undefined): boolean {
  if (!(tierBoundaryGap > 0)) return false;
  const reference = referencePoints != null && referencePoints > 0 ? referencePoints : 0;
  return tierBoundaryGap >= Math.max(6, reference * 0.08);
}

function qualifier(info: NextUpInfo, referencePoints: number | null | undefined): string | null {
  // Silence is the no-urgency signal: a chip that always says something trains users to ignore it.
  if (info.nearTie) return 'near-identical to next';
  if (isBigDropOff(info.tierBoundaryGap, referencePoints)) return 'big drop-off after him';
  return null;
}

function tooltip(info: NextUpInfo): string {
  const parts: string[] = [];
  if (info.gap != null) parts.push(`${info.name} projects ${info.gap.toFixed(1)} points lower.`);
  if (info.tierBoundaryGap > 0) parts.push(`The next tier starts ${info.tierBoundaryGap.toFixed(1)} points lower.`);
  return parts.join(' ') || `Next-best player at this position: ${info.name}.`;
}

/**
 * Display-only draft-state decoration: who's next at this position, in plain
 * language. Names are the headline; numbers live in the tooltip. Never a
 * ranking term — the underlying fields (`tierBoundaryGap`/`nearTie`) are
 * explanation-only by locked contract (see DECISIONS.md).
 */
export const NextUpChip = memo(function NextUpChip({
  nextUp,
  referencePoints,
}: {
  nextUp: NextUpInfo;
  referencePoints: number | null | undefined;
}) {
  const note = qualifier(nextUp, referencePoints);
  return (
    <div className="next-up-chip" title={tooltip(nextUp)}>
      <span className="next-up-label">Next up</span>
      <span className="next-up-name">{nextUp.name}</span>
      {note && (
        <span className="next-up-note" data-kind={note.startsWith('near') ? 'near-tie' : 'drop-off'}>
          {note}
        </span>
      )}
    </div>
  );
});