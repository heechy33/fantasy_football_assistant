import type { CSSProperties, MouseEvent } from 'react';
import type { AdpEntry, FantasyProsStars, PlayerId, PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import { adpPositionalRank, displayPositionalRank } from '../data/positionalRank';
import { playerStatusTag, statusTagClassName } from '../data/playerStatusTag';
import { teamLogoUrl } from '../data/playerPortrait';
import type { Recommendation } from '../engine/recommend';
import { NextPickSurvivalMeter } from './NextPickSurvivalMeter';
import { PlayerPortrait } from './PlayerPortrait';
import { PositionBadge } from './PositionBadge';
import { StarRating } from './StarRating';

export interface PlayerCardProps {
  playerId: PlayerId;
  /** `null` for a market-only row: an undrafted, ADP-ranked player with no FFToday projection. */
  recommendation: Recommendation | null;
  player: PlayerMeta | undefined;
  /** Card-face rank - engine rank in Engine mode, market-board rank in ADP mode. */
  rank: number;
  /** Market ADP for an ADP-mode row with no engine recommendation. */
  adp?: number | null;
  /** Full ADP board for the positional-rank fallback when FantasyPros is absent. */
  adpBoard?: readonly AdpEntry[];
  /** Display-only FantasyPros decoration; omitted when the optional artifact is absent. */
  fantasyPros?: FantasyProsStars;
  /** Prior-season usage for the single role-volume cell; omitted when missing. */
  usage?: PlayerUsage;
  /** Team-depth role for the Role tile — teamDepthRole.ts's display-only derivation. */
  depthRole?: TeamDepthRole | null;
  /** K/DEF's Role-tile replacement: average PPR points/week from `weekly-stats.json`'s real
   * per-week scoring (kicking/DST stats have no receiving/rushing production to show instead).
   * `usage.production` can't stand in here — it's built from `pprFromReceptions`/`pprFromRushes`
   * only, so it's always ~0 for a kicker or defense. */
  avgPointsPerGame?: number | null;

  onViewDetails: () => void;
}

function formatStat(value: number | null | undefined): string {
  return value == null ? '\u2014' : value.toFixed(1);
}

function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function cardUsageStat(
  position: string | null | undefined,
  usage: PlayerUsage | undefined,
): { label: string; value: string } | null {
  if (usage == null) return null;
  if (position === 'RB' && usage.carryShare != null) return { label: 'Carry', value: formatShare(usage.carryShare) };
  if ((position === 'WR' || position === 'TE') && usage.targetShare != null) {
    return { label: 'Tgt', value: formatShare(usage.targetShare) };
  }
  if (position === 'QB' && usage.completionPct != null) {
    return { label: 'Cmp%', value: formatShare(usage.completionPct) };
  }
  return null;
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

/** Compact card face: labeled 2×2 stats, small headshot beside the name, contained team logo watermark. */
export function PlayerCard({
  playerId, recommendation, player, rank, adp, adpBoard, fantasyPros, usage, depthRole, avgPointsPerGame, onViewDetails,
}: PlayerCardProps) {
  const name = player?.name ?? playerId;
  const { first, last } = splitName(name);
  const projectionValue = recommendation?.projectedPoints ?? null;
  const adpValue = recommendation?.availabilityAdp ?? adp ?? null;
  const positionalRank = displayPositionalRank(
    fantasyPros?.positionRank,
    adpPositionalRank(playerId, player?.position, adpBoard),
  );
  const usageStat = cardUsageStat(player?.position, usage);
  const statusTag = player ? playerStatusTag(player, usage) : null;
  const logoUrl = teamLogoUrl(player?.team);
  // K and DEF never get a depth-chart room (buildTeamDepthRoles only rooms QB/RB/WR/TE), so the
  // Role tile would always read the unknown em dash for them — show average fantasy points per
  // week (from real weekly scoring, passed in by the caller) instead of a tile that can never
  // say anything.
  const isRoleless = player?.position === 'K' || player?.position === 'DEF';

  function onDetailsClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onViewDetails();
  }

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
        <div title="Average Draft Position \u2014 the pick where this player is typically taken. Lower is earlier.">
          <dt>ADP</dt>
          <dd>{formatStat(adpValue)}</dd>
        </div>
        {usageStat && <div><dt>{usageStat.label}</dt><dd>{usageStat.value}</dd></div>}
      </dl>

      {recommendation ? (
        <NextPickSurvivalMeter probability={recommendation.availableNextPickProbability} />
      ) : (
        <p className="player-card-reason player-card-no-projection">
          {'No projection \u2014 ADP only.'}
        </p>
      )}

      {fantasyPros && (
        <div className="context-stars player-card-stars">
          <StarRating label="Upside" value={fantasyPros.upside} />
          <StarRating label="Bust" value={fantasyPros.bust} />
          <StarRating label="SOS" value={fantasyPros.sos} />
        </div>
      )}

      <button className="quiet-button player-card-details" type="button" onClick={onDetailsClick}>
        View details
      </button>
    </article>
  );
}

