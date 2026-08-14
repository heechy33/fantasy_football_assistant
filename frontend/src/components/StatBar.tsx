import { axisBand, type ScorePolarity } from '../data/scoreBand';
import type { DeltaTone } from '../data/playerRole';

export interface StatBarProps {
  label: string;
  value: string;
  fill: number | null;
  unknown?: boolean;
  polarity?: ScorePolarity;
  delta?: { text: string; tone: DeltaTone };
}

/** FIFA-style labeled horizontal bar: label, track, value, optional +/- chip. */
export function StatBar({ label, value, fill, unknown, polarity = 'higher-better', delta }: StatBarProps) {
  const clamped = fill == null || !Number.isFinite(fill) ? null : Math.max(0, Math.min(1, fill));
  const hatched = Boolean(unknown);
  const band = clamped == null ? undefined : axisBand(clamped * 100, polarity);
  return (
    <div className="stat-bar">
      <span className="stat-bar-label">{label}</span>
      <span
        className={hatched ? 'stat-bar-track stat-bar-track-unknown' : 'stat-bar-track'}
        role="img"
        aria-label={hatched ? `${label}: ${value}` : `${label}: ${value}`}
      >
        {!hatched && clamped != null && (
          <span className="stat-bar-fill" data-band={band} style={{ width: `${clamped * 100}%` }} />
        )}
      </span>
      <span className="stat-bar-value">{value}</span>
      {delta && (
        <span className="stat-bar-delta" data-tone={delta.tone}>{delta.text}</span>
      )}
    </div>
  );
}
