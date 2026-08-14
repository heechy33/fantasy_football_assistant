import { InfoTooltip } from './InfoTooltip';

export const SURVIVAL_BANDS = [
  { id: 'hell-nah', label: 'hell nah' },
  { id: 'nah', label: 'nah' },
  { id: 'shiii-mayb', label: 'shiii mayb' },
  { id: 'yee', label: 'yee' },
  { id: 'fs', label: 'fs' },
] as const;

export type SurvivalBandId = (typeof SURVIVAL_BANDS)[number]['id'];

/**
 * Half-open bands [0, .2) / [.2, .4) / [.4, .6) / [.6, .8) / [.8, 1]. 1.0 lands in `fs`.
 */
export function survivalBand(probability: number): (typeof SURVIVAL_BANDS)[number] {
  const p = Math.min(1, Math.max(0, probability));
  if (p >= 0.8) return SURVIVAL_BANDS[4];
  if (p >= 0.6) return SURVIVAL_BANDS[3];
  if (p >= 0.4) return SURVIVAL_BANDS[2];
  if (p >= 0.2) return SURVIVAL_BANDS[1];
  return SURVIVAL_BANDS[0];
}

export interface NextPickSurvivalMeterProps {
  probability: number | null | undefined;
}

/**
 * Display-only next-pick survival meter. Not an input — hovering highlights the active band;
 * dragging would imply the user can change the model.
 */
export function NextPickSurvivalMeter({ probability }: NextPickSurvivalMeterProps) {
  if (probability == null || !Number.isFinite(probability)) return null;
  const p = Math.min(1, Math.max(0, probability));
  const band = survivalBand(p);
  const percent = Math.round(p * 100);
  const valueText = `${percent} percent, ${band.label}`;

  return (
    <div className="survival-meter">
      <div className="survival-meter-head">
        <span className="survival-meter-label">
          Next pick
          <InfoTooltip
            label="What is Next pick?"
            text="Modeled chance this player is still there at your next pick."
          />
        </span>
        <strong className="survival-meter-percent">{percent}%</strong>
      </div>
      <div
        className="survival-meter-track"
        role="meter"
        aria-label="Chance still available at your next pick"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText}
        data-band={band.id}
        title={valueText}
      >
        {SURVIVAL_BANDS.map((entry) => (
          <span
            key={entry.id}
            className="survival-meter-band"
            data-band={entry.id}
            data-active={entry.id === band.id ? 'true' : undefined}
          >
            {entry.label}
          </span>
        ))}
        <span className="survival-meter-marker" style={{ left: `${p * 100}%` }} />
      </div>
    </div>
  );
}
