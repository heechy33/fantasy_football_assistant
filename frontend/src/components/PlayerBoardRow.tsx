import type { CSSProperties } from 'react';
import { statusTagClassName } from '../data/playerStatusTag';
import { teamLogoUrl } from '../data/playerPortrait';
import { PlayerPortrait } from './PlayerPortrait';
import { PositionBadge } from './PositionBadge';
import { formatBoardStat, type PlayerBoardFaceProps, boardFaceValues } from './playerBoardFace';

export interface PlayerBoardRowProps extends PlayerBoardFaceProps {
  selected?: boolean;
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

  return (
    <button
      type="button"
      className="player-board-row"
      aria-label={`View details for ${values.name}`}
      aria-current={selected || undefined}
      data-position={props.player?.position ?? undefined}
      data-pick-action={props.recommendation?.pickAction}
      data-team={props.player?.team ?? undefined}
      style={teamChromeStyle(props.player?.team)}
      onClick={onViewDetails}
    >
      {logoUrl && <img className="player-board-row-watermark" src={logoUrl} alt="" />}
      <span className="player-board-row-rank">#{props.rank}</span>
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
          </span>
        </span>
      </span>
      <span className="player-board-row-cell" title={values.isRoleless ? 'Average fantasy points per week this season' : values.roleTitle}>
        {values.isRoleless ? formatBoardStat(values.avgPointsPerGame) : values.roleLabel}
      </span>
      <span className="player-board-row-cell">{formatBoardStat(values.projectionValue)}</span>
      <span className="player-board-row-cell">{formatBoardStat(values.adpValue)}</span>
      <span className="player-board-row-cell">{values.usageStat ? values.usageStat.value : '\u2014'}</span>
    </button>
  );
}
