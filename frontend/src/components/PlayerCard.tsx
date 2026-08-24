import type { CSSProperties } from 'react';
import type { AdpEntry, PlayerId, PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import { adpPositionalRank } from '../data/positionalRank';
import { playerStatusTag, statusTagClassName } from '../data/playerStatusTag';
import { teamLogoUrl } from '../data/playerPortrait';
import type { Recommendation } from '../engine/recommend';
import { NextUpChip, type NextUpInfo } from './NextUpChip';
import { NextPickSurvivalMeter } from './NextPickSurvivalMeter';
import { PlayerPortrait } from './PlayerPortrait';
import { PositionBadge } from './PositionBadge';
import { boardFaceValues, boardUsageStat, formatBoardStat } from './playerBoardFace';

export interface PlayerCardProps {
  playerId: PlayerId;
  /** `null` for a market-only row: an undrafted, ADP-ranked player with no FFToday projection. */
  recommendation: Recommendation | null;
  player: PlayerMeta | undefined;
  /** Card-face rank - engine rank in Engine mode, market-board rank in ADP mode. */
  rank: number;
  /** Market ADP for an ADP-mode row with no engine recommendation. */
  adp?: number | null;
  /** Full ADP board for the positional-rank face label. */
  adpBoard?: readonly AdpEntry[];
  /** Per-player ADP provenance for the honest face label (see boardFaceValues). */
  adpSource?: AdpEntry['adpSource'] | null;
  /** Draft-state decoration: the next-best player at this position on the remaining board.
   * Computed by the caller (RecommendationBoard) from the same rows it renders. Omitted when
   * there is no next player or no board data — hidden, never a placeholder. */
  nextUp?: NextUpInfo | null;
  /** Prior-season usage for the single role-volume cell; omitted when missing. */
  usage?: PlayerUsage;
  /** Team-depth role for the Role tile â€” teamDepthRole.ts's display-only derivation. */
  depthRole?: TeamDepthRole | null;
  /** K/DEF's Role-tile replacement: average PPR points/week from `weekly-stats.json`'s real
   * per-week scoring (kicking/DST stats have no receiving/rushing production to show instead).
   * `usage.production` can't stand in here â€” it's built from `pprFromReceptions`/`pprFromRushes`
   * only, so it's always ~0 for a kicker or defense. */
  avgPointsPerGame?: number | null;
  /** Off-clock/market fallback when `recommendation` is null (see boardFaceValues). */
  projectedPoints?: number | null;
  /** Off-clock/market fallback when `recommendation` is null (see boardFaceValues). */
  availableNextPickProbability?: number | null;

  onViewDetails: () => void;
}

function formatStat(value: number | null | undefined): string {
  return formatBoardStat(value);
}

function cardUsageStat(
  position: string | null | undefined,
  usage: PlayerUsage | undefined,
): { label: string; value: string } | null {
  return boardUsageStat(position, usage);
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: '', last: parts[0] ?? name };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

function teamChromeStyle(team: string | null | undefined): CSSProperties {
  const logo = teamLogoUrl(team);
  return { '--team-logo': logo ? `url(${logo})` : 'none' } as CSSProperties;
}

/** Compact card face: labeled 2Ã—2 stats, small headshot beside the name, contained team logo watermark. */
export function PlayerCard(props: PlayerCardProps) {
  const {
    playerId, recommendation, player, rank, adpBoard, nextUp, usage, depthRole, avgPointsPerGame, onViewDetails,
  } = props;
  const values = boardFaceValues(props);
  const name = player?.name ?? playerId;
  const { first, last } = splitName(name);
  const { projectionValue, adpValue, availabilityValue, adpSourceLabel: adpSource } = values;
  const positionalRank = adpPositionalRank(playerId, player?.position, adpBoard);
  const usageStat = cardUsageStat(player?.position, usage);
  const statusTag = player ? playerStatusTag(player, usage) : null;
  const logoUrl = teamLogoUrl(player?.team);
  // K and DEF never get a depth-chart room (buildTeamDepthRoles only rooms QB/RB/WR/TE), so the
  // Role tile would always read the unknown em dash for them â€” show average fantasy points per
  // week (from real weekly scoring, passed in by the caller) instead of a tile that can never
  // say anything.
  const isRoleless = player?.position === 'K' || player?.position === 'DEF';

  return (
    <article
      className="player-card"
      data-confidence={recommendation?.confidence}
      data-pick-action={recommendation?.pickAction}
      data-position={player?.position ?? undefined}
      data-team={player?.team ?? undefined}
      style={teamChromeStyle(player?.team)}
      onClick={onViewDetails}
    >
      {logoUrl && (
        <img className="player-card-watermark" src={logoUrl} alt="" />
      )}
      <header className="player-card-head">
        <span className="player-card-board-rank">#{rank}</span>
        {positionalRank && <span className="player-card-pos-rank">{positionalRank}</span>}
        {logoUrl && (
          <img className="player-card-logo" src={logoUrl} alt="" width={28} height={28} />
        )}
      </header>

      <div className="player-card-identity">
        <div className="player-card-identity-text">
          {first ? <span className="player-card-first">{first}</span> : null}
          <strong className="player-card-last">{last}</strong>
          <span className="player-card-meta">
            <PositionBadge position={player?.position ?? null} />
            <span>{player?.team ?? 'FA'}</span>
            {player?.byeWeek != null ? <span>Bye {player.byeWeek}</span> : null}
            {statusTag ? (
              <span className={`${statusTagClassName(statusTag.kind)} player-card-injury`}>{statusTag.label}</span>
            ) : null}
          </span>
        </div>
        {player ? <PlayerPortrait player={player} className="player-card-portrait" /> : null}
      </div>

      <dl className="player-card-attributes">
        {isRoleless ? (
          <div><dt>Avg fpts</dt><dd title="Average fantasy points per week this season">{formatStat(avgPointsPerGame)}</dd></div>
        ) : (
          <div data-role-basis={depthRole?.basis ?? 'unknown'}><dt>Role</dt><dd title={depthRole?.headline ?? 'Team role unavailable'}>{depthRole?.label ?? '\u2014'}</dd></div>
        )}
        <div><dt>Proj</dt><dd>{formatStat(projectionValue)}</dd></div>
        <div
          title={adpSource
            ? `Average Draft Position (${adpSource}) — the pick where this player is typically taken in ${adpSource}'s draft population. Lower is earlier.`
            : 'Average Draft Position \u2014 the pick where this player is typically taken. Lower is earlier.'}
        >
          <dt>ADP</dt>
          <dd>
            {formatStat(adpValue)}
            {adpSource && <span className="player-card-adp-source">{adpSource}</span>}
          </dd>
        </div>
        {usageStat && <div><dt>{usageStat.label}</dt><dd>{usageStat.value}</dd></div>}
      </dl>

      <NextPickSurvivalMeter probability={availabilityValue} />

      {nextUp && <NextUpChip nextUp={nextUp} referencePoints={projectionValue} />}

    </article>
  );
}

