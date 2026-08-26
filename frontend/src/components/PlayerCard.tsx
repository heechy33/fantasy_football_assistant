import type { CSSProperties } from 'react';
import type { AdpEntry, PlayerId, PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import { adpPositionalRank } from '../data/positionalRank';
import type { CardRoleStat } from '../data/cardRoleStats';
import { playerStatusTag, statusTagClassName } from '../data/playerStatusTag';
import { teamLogoUrl } from '../data/playerPortrait';
import type { Recommendation } from '../engine/recommend';
import { NextUpChip, type NextUpInfo } from './NextUpChip';
import { NextPickSurvivalMeter } from './NextPickSurvivalMeter';
import { PercentileBar } from './PercentileBar';
import { PlayerPortrait } from './PlayerPortrait';
import { PositionBadge } from './PositionBadge';
import { boardFaceValues, boardUsageStat, formatBoardStat } from './playerBoardFace';

export interface PlayerCardProps {
  playerId: PlayerId;
  /** `null` for a market-only row: an undrafted, ADP-ranked player with no FFToday projection. */
  recommendation: Recommendation | null;
  player: PlayerMeta | undefined;
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
  /** Whether the exact next-pick survival percentage may render. Shown ONLY while the user is
   * on the clock (the estimate targets the follow-up pick then). Defaults to true so isolated
   * card usage (landing demo, direct renders) keeps meter semantics. */
  availabilityVisible?: boolean;
  /** Headline role-page stats for the card-bottom slot (see `cardRoleStats.ts`). Computed by
   * the caller (RecommendationBoard) once per board render. The slot rule governs how many
   * render — see the JSX comment above the slot. Omitted/empty → the slot stays blank. */
  roleStats?: readonly CardRoleStat[] | null;
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
    playerId, recommendation, player, adpBoard, nextUp, usage, depthRole, avgPointsPerGame,
    availabilityVisible = true, roleStats, onViewDetails,
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
          <dd>{formatStat(adpValue)}</dd>
        </div>
        {usageStat && <div><dt>{usageStat.label}</dt><dd>{usageStat.value}</dd></div>}
      </dl>

      {/* Card-bottom slot rule (2026-08-25 user spec) — how much of the card's remaining room
          each draft state gets, filled with headline role-page stats (cardRoleStats.ts):
          - On the clock + next-up chip: meter only — the chip closes the card, no room left.
          - On the clock + no next-up: the meter, then 2 stats below the percentage.
          - Off the clock + next-up chip: 2 stats (the chip takes the bottom field).
          - Off the clock + no next-up: 4 stats — the slot has the most room, and 4 rows fill it
            without the dead space a shorter block left in the card's middle (user follow-up).
          The chip still renders LAST in every state where it exists. No stats data → the slot
          stays blank rather than showing a placeholder (see cardRoleStats.ts). */}
      {(() => {
        const onClock = availabilityValue != null && availabilityVisible;
        const statCount = onClock || nextUp ? 2 : 4;
        const slotStats = (roleStats ?? []).slice(0, statCount);
        const showStats = slotStats.length > 0 && !(onClock && nextUp);
        return (
          <>
            {onClock && <NextPickSurvivalMeter probability={availabilityValue} />}
            {showStats && (
              <div className="player-card-role-stats" data-count={slotStats.length}>
                {slotStats.map((stat) => (
                  <div
                    className="player-card-role-stat"
                    key={stat.label}
                    title={stat.title}
                    data-missing={stat.percentile == null || undefined}
                  >
                    <span className="player-card-role-stat-label">{stat.label}</span>
                    <PercentileBar
                      percentile={stat.percentile}
                      ariaLabel={stat.percentile != null
                        ? `${stat.label}: ${Math.round(stat.percentile)}th percentile, ${stat.display}`
                        : `${stat.label}: percentile unavailable, ${stat.display}`}
                    />
                    <span className="player-card-role-stat-value">{stat.display}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}

      {nextUp && <NextUpChip nextUp={nextUp} referencePoints={projectionValue} />}
    </article>
  );
}

