import type { Position } from '../../../shared/types';

export type BoardMode = 'engine' | 'adp';

export interface PositionTab {
  label: string;
  position: Position | null;
}

export interface BoardFiltersProps {
  boardMode: BoardMode;
  onBoardModeChange: (mode: BoardMode) => void;
  positionTabs: readonly PositionTab[];
  displayPosition: Position | null;
  onDisplayPositionChange: (position: Position | null) => void;
}

/**
 * Engine/ADP and position tablists that sit above the recommendation filmstrip — the Draft Sharks
 * filter row, not the sticky command bar.
 */
export function BoardFilters({
  boardMode,
  onBoardModeChange,
  positionTabs,
  displayPosition,
  onDisplayPositionChange,
}: BoardFiltersProps) {
  return (
    <div className="board-filters">
      <div className="board-mode-tabs" role="tablist" aria-label="Board mode">
        <button
          type="button"
          role="tab"
          aria-selected={boardMode === 'engine'}
          aria-controls="recommendation-cards"
          className={boardMode === 'engine' ? 'active' : undefined}
          onClick={() => onBoardModeChange('engine')}
        >
          Engine
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={boardMode === 'adp'}
          aria-controls="recommendation-cards"
          className={boardMode === 'adp' ? 'active' : undefined}
          onClick={() => onBoardModeChange('adp')}
        >
          ADP
        </button>
      </div>

      <div className="position-tabs" role="tablist" aria-label="Recommendation position">
        {positionTabs.map((tab) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={displayPosition === tab.position}
            aria-controls="recommendation-cards"
            className={displayPosition === tab.position ? 'active' : undefined}
            onClick={() => onDisplayPositionChange(tab.position)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
