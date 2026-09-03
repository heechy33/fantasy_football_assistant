import { type CSSProperties, type KeyboardEvent } from 'react';
import { statusTagClassName } from '../data/playerStatusTag';
import { teamLogoUrl } from '../data/playerPortrait';
import { PlayerPortrait } from './PlayerPortrait';
import { PositionBadge } from './PositionBadge';
import { formatBoardStat, type PlayerBoardFaceProps, boardFaceValues } from './playerBoardFace';
import { reachExplanation } from './ReachBookmark';
import type { NextUpInfo } from './NextUpChip';

export interface PlayerBoardRowProps extends PlayerBoardFaceProps {
  /** Draft-state decoration: the next-best player at this position on the remaining board. */
  nextUp?: NextUpInfo | null;
  selected?: boolean;
  /** Whether the exact next-pick survival percentage may render — see PlayerCard's doc. */
  availabilityVisible?: boolean;
  onViewDetails: () => void;
  /** Click-to-log: see PlayerCard's doc. The row is a div+role=button (not a <button>) precisely
   * so this affordance can be a real nested <button> — a nested button-in-button is invalid HTML. */
  onDraftPlayer?: () => void;
}

function teamChromeStyle(team: string | null | undefined): CSSProperties {
  const logo = teamLogoUrl(team);
  return { '--team-logo': logo ? `url(${logo})` : 'none' } as CSSProperties;
}

/** Keyboard-operable horizontal card representation of the same player information as PlayerCard. */
export function PlayerBoardRow({ selected = false, onViewDetails, onDraftPlayer, ...props }: PlayerBoardRowProps) {
  const values = boardFaceValues(props);
  const logoUrl = teamLogoUrl(props.player?.team);
  // The row is a `div role="button"` (not a real <button>) so the click-to-draft affordance
  // can be a real nested <button> — a nested button-in-button is invalid HTML. The reach detail
  // rides on the row's own accessible name (the row and its meta line are both `overflow:
  // hidden`, so an InfoTooltip-style hover reveal can't work here).
  const reachSuffix = values.reachGap != null ? `, reach: ${values.reachGap} picks past ADP` : '';

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Mirror the real <button> Enter/Space behavior now that the row is a div. Tab focus and the
    // explicit "Draft" button both work without extra wiring; only the row-as-a-whole activation
    // needs this shim.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onViewDetails();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="player-board-row"
      aria-label={`View details for ${values.name}${reachSuffix}`}
      aria-current={selected || undefined}
      data-position={props.player?.position ?? undefined}
      data-pick-action={props.recommendation?.pickAction}
      data-team={props.player?.team ?? undefined}
      style={teamChromeStyle(props.player?.team)}
      onClick={onViewDetails}
      onKeyDown={handleKeyDown}
    >
      {logoUrl && <img className="player-board-row-watermark" src={logoUrl} alt="" />}
      <span className="player-board-row-identity">
        {props.player && <PlayerPortrait player={props.player} className="player-board-row-portrait" />}
        <span className="player-board-row-name">
          <strong>{values.name}</strong>
          <span className="player-board-row-meta">
            <PositionBadge position={props.player?.position ?? null} />
            {values.statusTag && <span className={statusTagClassName(values.statusTag.kind)}>{values.statusTag.label}</span>}
            {values.reachGap != null && (
              <span
                className="player-board-row-reach"
                title={reachExplanation(values.reachGap, formatBoardStat(values.adpValue))}
              >
                Reach
              </span>
            )}
          </span>
        </span>
      </span>
      <span className="player-board-row-cell" title={values.isRoleless ? 'Average fantasy points per week this season' : values.roleTitle}>
        {values.isRoleless ? formatBoardStat(values.avgPointsPerGame) : values.roleLabel}
      </span>
      <span className="player-board-row-cell">{formatBoardStat(values.projectionValue)}</span>
      <span
        className="player-board-row-cell"
        title={values.adpSourceLabel
          ? `ADP (${values.adpSourceLabel}) — average draft position in ${values.adpSourceLabel}'s draft population`
          : 'Average Draft Position'}
      >
        {formatBoardStat(values.adpValue)}
      </span>
      <span className="player-board-row-cell">{values.usageStat ? values.usageStat.value : '\u2014'}</span>
      {onDraftPlayer && (
        <button
          type="button"
          className="player-board-row-draft-button"
          aria-label={`Draft ${values.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onDraftPlayer();
          }}
        >
          Draft
        </button>
      )}
    </div>
  );
}
