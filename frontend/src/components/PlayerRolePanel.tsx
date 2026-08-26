import type { PlayerMeta, PlayerUsage, PlayerUsageArtifact } from '../../../shared/types';
import { buildPercentileRankings } from '../data/percentileRankings';
import { buildQbPercentileRankings } from '../data/qbPercentileRankings';
import { buildRoleColumns } from '../data/playerRole';
import { buildSparklinePoints } from '../data/weeklyGameLog';
import type { WeeklyStatsState } from '../hooks/useWeeklyStats';
import type { PlayerContextFeedStatus } from './PlayerDetailDrawer';
import { PercentileBar } from './PercentileBar';
import { RoleColumnHeader } from './RoleColumnHeader';
import { StatBar } from './StatBar';

export interface PlayerRolePanelProps {
  player: PlayerMeta;
  usage: PlayerUsage | undefined;
  feedStatus: PlayerContextFeedStatus;
  weeklyStats?: WeeklyStatsState;
  /** Full prior-season usage artifact + player pool. When both are given, RB/WR/TE render the
   * STACKED-style position-cohort percentile rankings (see `percentileRankings.ts`) instead of
   * the legacy 2x2 role columns. Optional so existing callers/tests keep compiling. */
  usageArtifact?: PlayerUsageArtifact;
  players?: readonly PlayerMeta[];
}

/**
 * First-class prior-season role + PPR production panel. Display-only -- never a ranking input.
 *
 * RB/WR/TE (with `usageArtifact` + `players`): STACKED-style grouped percentile rows —
 * each metric's per-game value percent-ranked 0-100 within the same-position cohort.
 * QB (with a ready weekly-stats artifact): the same STACKED view, percent-ranked within the
 * weekly game log's QB cohort (`qbPercentileRankings.ts` — `player-usage.json` has no QB
 * passing/rushing fields). RB/WR/TE without the pool and QB without weekly stats: the legacy
 * position-aware 2x2 cards. K/DEF: always the weekly-game-log columns (`weeklyRoleColumns.ts`).
 */
export function PlayerRolePanel({
  player,
  usage,
  feedStatus,
  weeklyStats,
  usageArtifact,
  players,
}: PlayerRolePanelProps) {
  if (feedStatus === 'loading') {
    return (
      <section className="player-role-panel">
        <h3>Role</h3>
        <p className="muted">Loading prior-season context…</p>
      </section>
    );
  }
  if (feedStatus === 'unavailable') {
    return (
      <section className="player-role-panel">
        <h3>Role</h3>
        <p className="muted">Prior-season role is temporarily unavailable. Core projections and ADP are unaffected.</p>
      </section>
    );
  }

  const rankings = usageArtifact != null && players != null
    ? buildPercentileRankings({ player, usage: usageArtifact, players })
    : null;
  // QB gets the same STACKED percentile view as RB/WR/TE, but sourced from the weekly game log
  // cohort (see qbPercentileRankings.ts — `player-usage.json` has no QB passing/rushing fields).
  const qbRankings = player.position === 'QB' && weeklyStats?.status === 'ready' && weeklyStats.artifact != null
    ? buildQbPercentileRankings({ player, artifact: weeklyStats.artifact })
    : null;
  const stacked = rankings ?? qbRankings;
  if (stacked != null) {
    const season = usage?.season ?? weeklyStats?.artifact?.season;
    return (
      <section className="player-role-panel">
        <h3>{season != null ? `${season} ${player.position} percentile rankings` : `${player.position} percentile rankings`}</h3>
        {usage?.teamChanged && (
          <p className="muted">Team changed since the latest {season} appearance ({usage.recentTeam}).</p>
        )}
        <div className="percentile-groups">
          {stacked.groups.map((group) => (
            <div className="percentile-group" key={group.id}>
              <div className="percentile-group-head">{group.label}</div>
              {group.stats.map((stat) => {
                const unit = stat.ratio ? '' : ' per game';
                const ariaLabel = stat.percentile != null
                  ? `${stat.label}: ${Math.round(stat.percentile)}th percentile, ${stat.display ?? 'n/a'}${unit}`
                  : `${stat.label}: percentile unavailable, ${stat.display ?? 'n/a'}${unit}`;
                return (
                  <div
                    className="percentile-row"
                    key={stat.key}
                    data-missing={stat.percentile == null || undefined}
                  >
                    <span className="percentile-label">{stat.label}</span>
                    <PercentileBar percentile={stat.percentile} ariaLabel={ariaLabel} />
                    <span className="percentile-value">{stat.display ?? 'n/a'}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const artifact = weeklyStats?.status === 'ready' ? weeklyStats.artifact : null;
  const weeklySeries = artifact?.players[player.playerId];
  const weeks = artifact ? buildSparklinePoints(artifact, player.playerId) : [];
  const isWeeklyPosition = player.position === 'QB' || player.position === 'K' || player.position === 'DEF';

  const columns = buildRoleColumns({
    player,
    usage,
    weeks,
    weeklyStats: artifact ? { series: weeklySeries, columns: artifact.columns } : undefined,
  });
  const season = usage?.season;

  if (columns.length === 0) {
    const message = isWeeklyPosition
      ? weeklyStats?.status === 'loading'
        ? 'Loading weekly game log…'
        : artifact?.season != null
          ? `No ${artifact.season} weekly game log for this player.`
          : 'No weekly game log for this player.'
      : usage?.usageSeasonObserved === false
        ? `No verifiable ${usage.season} roster or snap history for this player.`
        : usage?.knownAbsent
          ? 'Rostered for at least one team game, with no recorded snaps.'
          : 'No verifiable prior-season roster history is available.';
    return (
      <section className="player-role-panel">
        <h3>Role</h3>
        <p className="muted">{message}</p>
      </section>
    );
  }

  return (
    <section className="player-role-panel">
      <h3>{season != null ? `${season} role` : 'Role'}</h3>
      {usage?.teamChanged && (
        <p className="muted">Team changed since the latest {season} appearance ({usage.recentTeam}).</p>
      )}
      {isWeeklyPosition && (
        <p className="muted player-role-source">
          {player.position} role is aggregated from the {artifact?.season} weekly game log.
        </p>
      )}
      <div className="player-role-columns">
        {columns.map((column) => (
          <article className="player-role-column" key={column.id}>
            <RoleColumnHeader title={column.label} rating={column.rating} />
            {column.result && <p className="player-role-result">{column.result}</p>}
            <div className="player-role-stats">
              {column.stats.map((stat) => (
                <StatBar
                  key={stat.label}
                  label={stat.label}
                  value={stat.display}
                  fill={stat.fill}
                  unknown={stat.display === 'n/a'}
                  delta={stat.delta}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
