import type { Position } from '../../../shared/types';

export type BoardMode = 'engine' | 'adp';
export type BoardPresentation = 'cards' | 'rows';

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
  boardPresentation?: BoardPresentation;
  onBoardPresentationChange?: (presentation: BoardPresentation) => void;
  presentationToggleVisible?: boolean;
  modeToggleVisible?: boolean;
}

/**
 * Engine/ADP and position tablists that sit above the recommendation filmstrip â€” the Draft Sharks
 * filter row, not the sticky command bar.
 */
export function BoardFilters({
  boardMode,
  onBoardModeChange,
  positionTabs,
  displayPosition,
  onDisplayPositionChange,
  boardPresentation = 'cards',
  onBoardPresentationChange,
  presentationToggleVisible = false,
  modeToggleVisible = true,
}: BoardFiltersProps) {
  return (
    <div className="board-filters">
      {modeToggleVisible && <div className="board-mode-tabs" role="tablist" aria-label="Board mode">
        <button
          type="button"
          role="tab"
          aria-selected={boardMode === 'engine'}
          aria-controls="recommendation-board"
          className={boardMode === 'engine' ? 'active' : undefined}
          onClick={() => onBoardModeChange('engine')}
        >
          Engine
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={boardMode === 'adp'}
          aria-controls="recommendation-board"
          className={boardMode === 'adp' ? 'active' : undefined}
          onClick={() => onBoardModeChange('adp')}
        >
          ADP
        </button>
      </div>}

      <div className="board-position-layout-row">
        <div className="position-tabs" role="tablist" aria-label="Recommendation position">
          {positionTabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={displayPosition === tab.position}
              aria-controls="recommendation-board"
              className={displayPosition === tab.position ? 'active' : undefined}
              onClick={() => onDisplayPositionChange(tab.position)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {presentationToggleVisible && onBoardPresentationChange && (
          <div className="board-presentation-toggle" role="radiogroup" aria-label="Board layout">
            {(['cards', 'rows'] as const).map((presentation) => (
              <button
                key={presentation}
                type="button"
                role="radio"
                aria-checked={boardPresentation === presentation}
                className={boardPresentation === presentation ? 'active' : undefined}
                onClick={() => onBoardPresentationChange(presentation)}
              >
                {presentation === 'cards' ? 'Cards' : 'Rows'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
