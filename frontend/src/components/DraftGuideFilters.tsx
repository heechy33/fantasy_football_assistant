import type { Position } from '../../../shared/types';
import { GUIDE_POSITIONS, type GuideFormat } from '../data/guideLeagueSettings';

export interface DraftGuideFiltersProps {
  format: GuideFormat;
  onFormatChange: (patch: Partial<GuideFormat>) => void;
  position: Position | 'ALL';
  onPositionChange: (position: Position | 'ALL') => void;
}

/** Segmented chip-group control — the guide's filter idiom. One-click switching (no dropdown
 * round-trip), and the selected value is always visible text, never a black-on-black native
 * select. State still lives in the URL; these are pure presentation. */
function ChipGroup<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ key: T; label: string; disabled?: boolean }>;
  onChange: (key: T) => void;
}) {
  return (
    <div className="guide-filter guide-chip-filter" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="guide-chip-row">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className="guide-chip"
            aria-pressed={option.key === value}
            disabled={option.disabled}
            title={option.disabled ? `${option.label} is unavailable right now` : undefined}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Fresh filter bar for the guide — deliberately NOT BoardFilters, whose Engine/ADP board-mode
 * toggle and live-draft position rules (All excludes K/DEF; QB drops once filled) are wrong for a
 * static public board. Every control is a chip group; state lives in the URL.
 *
 * Deliberately absent: Teams and Rounds (they never change the rank order — the ADP lane is keyed
 * on scoring + QB only — so they were noise) and a "Ranked by" selector (the board is Sleeper-ADP
 * ordered with the other providers as reference columns; the old selector just duplicated what the
 * column sort already does). Defaults for both still live in the URL parser for deep links. */
export function DraftGuideFilters({
  format,
  onFormatChange,
  position,
  onPositionChange,
}: DraftGuideFiltersProps) {
  return (
    <div className="guide-filters">
      <ChipGroup
        label="Scoring"
        value={format.reception}
        onChange={(reception) => onFormatChange({ reception: reception as GuideFormat['reception'] })}
        options={[
          { key: 'standard', label: 'Standard' },
          { key: 'half-ppr', label: 'Half PPR' },
          { key: 'ppr', label: 'PPR' },
        ]}
      />

      <ChipGroup
        label="QB"
        value={format.qb}
        onChange={(qb) => onFormatChange({ qb: qb as GuideFormat['qb'] })}
        options={[
          { key: 'one-qb', label: '1QB' },
          { key: 'superflex', label: 'Superflex' },
        ]}
      />

      <ChipGroup
        label="Position"
        value={position}
        onChange={(pos) => onPositionChange(pos as Position | 'ALL')}
        options={GUIDE_POSITIONS.map((pos) => ({ key: pos, label: pos === 'ALL' ? 'All' : pos }))}
      />
    </div>
  );
}
