import { useId, type MouseEvent } from 'react';

/**
 * Shared copy for the reach explanation — used by both PlayerCard's interactive bookmark bubble
 * and PlayerBoardRow's hover `title` (its row twin, see CLAUDE.md's PlayerCard/PlayerBoardRow
 * parity note), so the two faces can never say something different about the same gap.
 */
export function reachExplanation(reachGap: number, adpText: string): string {
  return `The market typically drafts this player ${reachGap} picks later (ADP ${adpText}). The engine still ranks them here on value — reach is context, not a veto.`;
}

export interface ReachBookmarkProps {
  /** Already threshold-filtered by playerBoardFace's boardFaceValues (REACH_WARNING_GAP). */
  reachGap: number;
  /** Pre-formatted ADP text (formatStat/formatBoardStat's output — a number string or an em dash). */
  adpText: string;
}

/**
 * Reach bookmark (2026-08-28 redesign, take 2): a bookmark-shaped tab on the card's top edge —
 * a below-ADP recommendation is draft CONTEXT, not a player stat, so it stays off the stat grid.
 * The face shows only the word "Reach" — no number — and reveals the full explanation (including
 * the actual pick gap) through a real interactive control instead of a bare `title` hover: reuses
 * InfoTooltip's proven `.info-tooltip-bubble` hover/focus-visible reveal mechanic (see App.css),
 * not the InfoTooltip component itself (its trigger is a fixed round "?" badge — wrong shape/
 * content model for a labeled ribbon with real visible text). `stopPropagation` keeps the ribbon
 * from also triggering the card's own onClick (onViewDetails). Accessible name is the visible
 * text "Reach" (WCAG label-in-name); the detail is attached via `aria-describedby`, not
 * `aria-label`, since there's real visible text here (unlike InfoTooltip's "?").
 */
export function ReachBookmark({ reachGap, adpText }: ReachBookmarkProps) {
  const bubbleId = useId();

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <span className="player-card-reach">
      <button
        type="button"
        className="player-card-reach-bookmark"
        aria-describedby={bubbleId}
        onClick={onClick}
      >
        Reach
      </button>
      <span className="info-tooltip-bubble" role="tooltip" id={bubbleId}>
        {reachExplanation(reachGap, adpText)}
      </span>
    </span>
  );
}
