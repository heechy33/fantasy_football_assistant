import { memo } from 'react';

export interface NextUpInfo {
  /** Name of the next-best player at the same position on the remaining board. */
  name: string;
  /** The shared position both players are compared at (e.g. "RB") — drives the chip's
   * "Next up at RB" micro-label. Null only when the current row's position is unknown. */
  position: string | null;
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

type QualifierKind = 'near-tie' | 'drop-off' | 'step-down';

interface Qualifier {
  text: string;
  kind: QualifierKind;
}

/**
 * Always returns a phrase — a bare name reads as an unfinished sentence, and this chip is one of
 * the only things anchoring the card's bottom half. The three branches are a strict severity
 * order (first match wins), all derived from fields the engine already computes for this pair,
 * never a new signal: a real near-tie, a real tier cliff, or — when neither applies but a
 * measured gap exists — a plain "step down" so the line still reads as a claim about the numbers
 * rather than filler. When even the gap is unknown (both sides unscored, e.g. a market-mode
 * pairing with no recommendation on either side), there's nothing honest left to say beyond the
 * name, so this returns null.
 */
function qualifier(info: NextUpInfo, referencePoints: number | null | undefined): Qualifier | null {
  if (info.nearTie) return { text: 'similar value', kind: 'near-tie' };
  if (isBigDropOff(info.tierBoundaryGap, referencePoints)) return { text: 'big drop-off after him', kind: 'drop-off' };
  if (info.gap != null && info.gap > 0) return { text: 'clear step down', kind: 'step-down' };
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
 *
 * Styled to read as one more field of the card (same micro-label typography as the Role/Proj/ADP
 * tiles, a team-tinted wash instead of a flat surface fill) rather than a widget pasted on top —
 * see App.css's `.next-up-chip`.
 */
export const NextUpChip = memo(function NextUpChip({
  nextUp,
  referencePoints,
}: {
  nextUp: NextUpInfo;
  referencePoints: number | null | undefined;
}) {
  const note = qualifier(nextUp, referencePoints);
  const label = nextUp.position ? `Next up at ${nextUp.position}` : 'Next up';
  return (
    <div className="next-up-chip" title={tooltip(nextUp)}>
      <span className="next-up-label">{label}</span>
      <span className="next-up-line">
        <span className="next-up-name">{nextUp.name}</span>
        {note && (
          <span className="next-up-note" data-kind={note.kind}>
            {note.text}
          </span>
        )}
      </span>
    </div>
  );
});