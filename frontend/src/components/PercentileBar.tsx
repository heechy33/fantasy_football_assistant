import { axisBand, type ScorePolarity } from '../data/scoreBand';

export interface PercentileBarProps {
  /** 0-100 cohort percentile, or null when no rank could be computed — renders an empty rail
   * with no fill/badge. The caller's row wrapper carries `data-missing` so the hatched-rail CSS
   * (App.css) can target it — this component only draws the track/fill/badge. */
  percentile: number | null;
  /** Accessible label for the track, e.g. "Target share: 61st percentile, 22.4%". */
  ariaLabel: string;
  polarity?: ScorePolarity;
}

/** The percentile rail + fill + boxed rank badge shared by the Role page's percentile rows
 * (`PlayerRolePanel.tsx`) and the card-bottom slot (`PlayerCard.tsx`) — extracted out of
 * `PlayerRolePanel.tsx`'s formerly-inline JSX so both surfaces render pixel-identical markup;
 * only CSS sizing differs between them (App.css scopes the card down from the Role page's size).
 * Display-only: never a ranking input. */
export function PercentileBar({ percentile, ariaLabel, polarity = 'higher-better' }: PercentileBarProps) {
  const band = percentile != null ? axisBand(percentile, polarity) : null;
  return (
    <span className="percentile-track" role="img" aria-label={ariaLabel}>
      {percentile != null && (
        <span className="percentile-fill" data-band={band} style={{ width: `${Math.max(2, percentile)}%` }} />
      )}
      {percentile != null && (
        <span className="percentile-badge" data-band={band}>{Math.round(percentile)}</span>
      )}
    </span>
  );
}
