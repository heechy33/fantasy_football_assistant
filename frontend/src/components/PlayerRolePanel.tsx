import type { PlayerMeta, PlayerUsage } from '../../../shared/types';
import { buildRoleColumns } from '../data/playerRole';
import { buildSparklinePoints } from '../data/weeklyGameLog';
import type { WeeklyStatsState } from '../hooks/useWeeklyStats';
import type { PlayerContextFeedStatus } from './PlayerDetailDrawer';
import { RoleColumnHeader } from './RoleColumnHeader';
import { StatBar } from './StatBar';

export interface PlayerRolePanelProps {
  player: PlayerMeta;
  usage: PlayerUsage | undefined;
  feedStatus: PlayerContextFeedStatus;
  weeklyStats?: WeeklyStatsState;
}

/**
 * First-class prior-season role + PPR production panel. Position-aware 2x2
 * cards; each card gets a visible title + rating chip (RoleColumnHeader) over
 * its StatBar rows -- see RoleColumnHeader's doc for why the old semicircle
 * gauge was removed. Fail-opens when usage/weekly data is missing. Display-only
 * -- never a ranking input.
 *
 * RB/WR/TE columns are derived from `usage.opportunity` (a season aggregate,
 * unchanged from before). QB/K/DEF columns are derived entirely from the
 * weekly game log instead -- see playerRole.ts's `buildRoleColumns` doc for why
 * that's a deliberate split, not an oversight.
 */
export function PlayerRolePanel({ player, usage, feedStatus, weeklyStats }: PlayerRolePanelProps) {
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
