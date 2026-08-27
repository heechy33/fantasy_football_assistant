import type { Position } from '../../../shared/types';
import { GUIDE_POSITIONS, GUIDE_ROUNDS, GUIDE_TEAMS, type GuideFormat } from '../data/guideLeagueSettings';
import type { GuideRankSource } from '../data/guideProviderColumns';

export interface GuideSourceOption {
  key: GuideRankSource;
  label: string;
  status: 'ready' | 'unavailable';
}

export interface DraftGuideFiltersProps {
  format: GuideFormat;
  onFormatChange: (patch: Partial<GuideFormat>) => void;
  source: GuideRankSource;
  onSourceChange: (source: GuideRankSource) => void;
  sources: readonly GuideSourceOption[];
  position: Position | 'ALL';
  onPositionChange: (position: Position | 'ALL') => void;
}

/** Fresh filter bar for the guide — deliberately NOT BoardFilters, whose Engine/ADP board-mode
 * toggle and live-draft position rules (All excludes K/DEF; QB drops once filled) are wrong for a
 * static public board. Every control is a plain select/button; state lives in the URL. */
export function DraftGuideFilters({
  format,
  onFormatChange,
  source,
  onSourceChange,
  sources,
  position,
  onPositionChange,
}: DraftGuideFiltersProps) {
  return (
    <div className="guide-filters">
      <label className="guide-filter">
        <span>Scoring</span>
        <select
          value={format.reception}
          onChange={(e) => onFormatChange({ reception: e.target.value as GuideFormat['reception'] })}
        >
          <option value="standard">Standard</option>
          <option value="half-ppr">Half PPR</option>
          <option value="ppr">PPR</option>
        </select>
      </label>

      <label className="guide-filter">
        <span>QB</span>
        <select
          value={format.qb}
          onChange={(e) => onFormatChange({ qb: e.target.value as GuideFormat['qb'] })}
        >
          <option value="one-qb">1QB</option>
          <option value="superflex">Superflex</option>
        </select>
      </label>

      <label className="guide-filter">
        <span>Teams</span>
        <select
          value={format.teams}
          onChange={(e) => onFormatChange({ teams: Number(e.target.value) })}
        >
          {GUIDE_TEAMS.map((teams) => <option key={teams} value={teams}>{teams}</option>)}
        </select>
      </label>

      <label className="guide-filter">
        <span>Rounds</span>
        <select
          value={format.rounds}
          onChange={(e) => onFormatChange({ rounds: Number(e.target.value) })}
        >
          {GUIDE_ROUNDS.map((rounds) => <option key={rounds} value={rounds}>{rounds}</option>)}
        </select>
      </label>

      <label className="guide-filter">
        <span>Ranked by</span>
        <select
          value={source}
          onChange={(e) => onSourceChange(e.target.value as GuideRankSource)}
        >
          {sources.map((option) => (
            <option key={option.key} value={option.key} disabled={option.status === 'unavailable'}>
              {option.label}{option.status === 'unavailable' ? ' (unavailable)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="guide-filter">
        <span>Position</span>
        <select
          value={position}
          onChange={(e) => onPositionChange(e.target.value as Position | 'ALL')}
        >
          {GUIDE_POSITIONS.map((pos) => (
            <option key={pos} value={pos}>{pos === 'ALL' ? 'All' : pos}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
