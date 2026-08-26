import type { Position } from '../../../shared/types';
import { SessionMenu, type SessionAction } from './SessionMenu';

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
  /**
   * Whether the recommendation engine is actually driving the board this turn. The engine only
   * computes on the user's pick (off-turn the board is forced to ADP), so when this is false the
   * Engine tab renders disabled — the toggle stays visible but never lies about what's on screen.
   */
  modeEnabled?: boolean;
  /** Session-management actions, rendered as the `⋯` menu next to the card/row toggle. */
  sessionActions?: ReadonlyArray<SessionAction>;
}

/**
 * Filter row above the recommendation board: position tabs on the left; Engine/ADP, the cards/rows
 * layout toggle, and the session menu share one right-aligned toolbar cluster.
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
  modeEnabled = true,
  sessionActions = [],
}: BoardFiltersProps) {
  return (
    <div className="board-filters">
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
        <div className="board-toolbar-right">
          <div className="board-mode-tabs" role="tablist" aria-label="Board mode">
            <button
              type="button"
              role="tab"
              aria-selected={boardMode === 'engine'}
              aria-controls="recommendation-board"
              className={boardMode === 'engine' ? 'active' : undefined}
              disabled={!modeEnabled}
              title={modeEnabled ? undefined : 'Engine rankings activate on your pick'}
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
          {sessionActions.length > 0 && <SessionMenu actions={sessionActions} />}
        </div>
      </div>
    </div>
  );
}
