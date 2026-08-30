import type { CSSProperties } from 'react';
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
}

function teamChromeStyle(team: string | null | undefined): CSSProperties {
  const logo = teamLogoUrl(team);
  return { '--team-logo': logo ? `url(${logo})` : 'none' } as CSSProperties;
}

/** Keyboard-operable horizontal card representation of the same player information as PlayerCard. */
export function PlayerBoardRow({ selected = false, onViewDetails, ...props }: PlayerBoardRowProps) {
  const values = boardFaceValues(props);
  const logoUrl = teamLogoUrl(props.player?.team);
  // The row is itself a <button> with an explicit aria-label, which swallows all descendant text
  // — a nested interactive control isn't valid HTML here either — so the reach detail rides on
  // the row's OWN accessible name instead of a bubble (which InfoTooltip-style hover reveal can't
  // use here anyway: the row and its meta line are both `overflow: hidden`, see App.css).
  const reachSuffix = values.reachGap != null ? `, reach: ${values.reachGap} picks past ADP` : '';

  return (
    <button
      type="button"
      className="player-board-row"
      aria-label={`View details for ${values.name}${reachSuffix}`}
      aria-current={selected || undefined}
      data-position={props.player?.position ?? undefined}
      data-pick-action={props.recommendation?.pickAction}
      data-team={props.player?.team ?? undefined}
      style={teamChromeStyle(props.player?.team)}
      onClick={onViewDetails}
    >
      {logoUrl && <img className="player-board-row-watermark" src={logoUrl} alt="" />}
      <span className="player-board-row-identity">
        {props.player && <PlayerPortrait player={props.player} className="player-board-row-portrait" />}
        <span className="player-board-row-name">
          <strong>{values.name}</strong>
          <span className="player-board-row-meta">
            <PositionBadge position={props.player?.position ?? null} />
            <span>{props.player?.team ?? 'FA'}</span>
            {props.player?.byeWeek != null && <span>Bye {props.player.byeWeek}</span>}
            {values.statusTag && <span className={statusTagClassName(values.statusTag.kind)}>{values.statusTag.label}</span>}
            {values.positionalRank && <span>{values.positionalRank}</span>}
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
        {values.adpSourceLabel && <small className="player-board-row-adp-source">{values.adpSourceLabel}</small>}
      </span>
      <span className="player-board-row-cell">{values.usageStat ? values.usageStat.value : '\u2014'}</span>
      <span className="player-board-row-cell">
        {props.availabilityVisible === false || values.availabilityValue == null ? '\u2014' : `${Math.round(values.availabilityValue * 100)}%`}
      </span>
    </button>
  );
}
