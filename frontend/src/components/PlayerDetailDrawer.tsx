import { useEffect, useState, type KeyboardEvent } from 'react';
import type { FantasyProsAdpArtifact, LeagueSettings, PlayerMeta, PlayerUsage, ProviderProjectionsArtifact } from '../../../shared/types';
import { playerBioItems } from '../data/playerBio';
import { playerStatusTag, statusTagClassName } from '../data/playerStatusTag';
import { resolvePointsPerGame } from '../data/pprProduction';
import { buildGameLogRows, buildSparklinePoints } from '../data/weeklyGameLog';
import type { TeamDepthRole } from '../data/teamDepthRole';
import type { Recommendation } from '../engine/recommend';
import type { WeeklyStatsState } from '../hooks/useWeeklyStats';
import { PlayerBodyMap } from './PlayerBodyMap';
import type { AdpDisclosure, PlayerContextFeedStatus } from './PlayerContextBody';
import { PlayerMarketComparison } from './PlayerMarketComparison';
import { PlayerRolePanel } from './PlayerRolePanel';
import { TeamDepthRoleRow } from './TeamDepthRoleRow';
import { PositionBadge } from './PositionBadge';
import { WeeklyChart } from './WeeklyChart';
import { WeeklyStatGrid } from './WeeklyStatGrid';
import { WeeklyViewToggle, type WeeklyView } from './WeeklyViewToggle';
import { Drawer } from './Drawer';

export type { AdpDisclosure, PlayerContextFeedStatus };

const IDLE_WEEKLY_STATS: WeeklyStatsState = { artifact: null, status: 'idle' };

const DETAIL_TABS = ['overview', 'role', 'weekly', 'injury'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const TAB_LABEL: Readonly<Record<DetailTab, string>> = {
  overview: 'Overview',
  role: 'Role',
  weekly: 'Weekly',
  injury: 'Injury',
};

export interface PlayerDetailDrawerProps {
  player: PlayerMeta;
  usage: PlayerUsage | undefined;
  feedStatus: PlayerContextFeedStatus;
  recommendation?: Recommendation;
  adpDisclosure?: AdpDisclosure | null;
  /** Current overall pick, for the ADP steal/reach badge -- see
   * `PlayerMarketComparison`'s `currentPick` prop doc. */
  currentPick?: number | null;
  weeklyStats?: WeeklyStatsState;
  /** Optional local-only per-site ADP decoration; null in production deploys. */
  adpProvidersArtifact?: FantasyProsAdpArtifact | null;
  /** Committed multi-provider projections decoration (display-only). */
  providerProjectionsArtifact?: ProviderProjectionsArtifact | null;
  /** The connected draft's league settings â€” used to score provider projections
   * in the user's actual league. Null only when no draft is connected. */
  settings?: LeagueSettings | null;
  /** Team-depth role for the drawer's TeamDepthRoleRow — `teamDepthRole.ts` (Part B). */
  depthRole?: TeamDepthRole | null;
  onClose: () => void;
}

export function PlayerDetailDrawer({
  player,
  usage,
  feedStatus,
  recommendation,
  adpDisclosure,
  currentPick,
  weeklyStats,
  adpProvidersArtifact,
  providerProjectionsArtifact,
  settings,
  depthRole,
  onClose,
}: PlayerDetailDrawerProps) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [weeklyView, setWeeklyView] = useState<WeeklyView>('graph');
  const detailTabs: readonly DetailTab[] = player.position === 'DEF'
    ? DETAIL_TABS.filter((id) => id !== 'injury')
    : DETAIL_TABS;
  const resolvedWeeklyStats = weeklyStats ?? IDLE_WEEKLY_STATS;
  const artifact = resolvedWeeklyStats.status === 'ready' ? resolvedWeeklyStats.artifact : null;
  // Built once here and handed to both the sparkline and the grid below, so
  // the two views can never disagree about which week is played/bye/inactive/nodata.
  const gameLogRows = artifact ? buildGameLogRows(artifact, player.playerId, player.position) : [];
  const weeksFetched = artifact?.weeksFetched ?? [];
  const weeklySeason = artifact?.season ?? null;
  // K/DEF never get a depth-chart room (see TeamDepthRoleRow); this is their fallback stat.
  const avgPointsPerGame = resolvePointsPerGame(
    artifact ? buildSparklinePoints(artifact, player.playerId) : [],
    usage?.production,
  );
  const bioItems = playerBioItems(player);
  const statusTag = playerStatusTag(player, usage);
  // The anchor marker for the ADP-by-provider section: which number the engine
  // actually used (recommendation.availabilityAdp) and which upstream produced
  // it (adpDisclosure). Null when there is no engine recommendation.
  const boardAdp = recommendation != null && recommendation.availabilityAdp != null
    ? {
        adp: recommendation.availabilityAdp,
        source: adpDisclosure?.source === 'ffc-fallback' ? 'FFC fallback' : 'Sleeper',
      }
    : null;

  useEffect(() => {
    setTab('overview');
  }, [player.playerId]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = detailTabs.indexOf(tab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = detailTabs[(current + delta + detailTabs.length) % detailTabs.length] ?? 'overview';
      setTab(next);
    }
  }

  return (
    <Drawer
      open
      size="wide"
      label={`${player.name} context`}
      onClose={onClose}
    >
      <div
        className="player-detail-tabs"
        role="tablist"
        aria-label="Player detail sections"
        onKeyDown={handleTabKeyDown}
      >
        {detailTabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            id={`player-detail-tab-${id}`}
            className="player-detail-tab"
            onClick={() => setTab(id)}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="player-detail-panel" role="tabpanel" aria-labelledby="player-detail-tab-overview">
          <div className="player-detail-hero">
            <div className="player-detail-summary" data-team={player.team ?? undefined}>
              <h2>{player.name}</h2>
              <p className="muted player-context-meta">
                <PositionBadge position={player.position} />
                {' \u00b7 '}{player.team ?? 'Free agent'}
                {player.depthChartPosition ? ` \u00b7 ${player.depthChartPosition}` : ''}
                {player.depthChartOrder != null ? ` #${player.depthChartOrder}` : ''}
                {statusTag ? (
                  <span className={statusTagClassName(statusTag.kind)}>{statusTag.label}</span>
                ) : null}
              </p>
              {bioItems.length > 0 && (
                <dl className="player-detail-bio">
                  {bioItems.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <TeamDepthRoleRow
              depthRole={depthRole ?? null}
              playerId={player.playerId}
              feedStatus={feedStatus}
              position={player.position}
              avgPointsPerGame={avgPointsPerGame}
            />
          </div>
          <PlayerMarketComparison
            adpArtifact={adpProvidersArtifact ?? null}
            playerId={player.playerId}
            boardAdp={boardAdp}
            currentPick={currentPick}
            projectionsArtifact={providerProjectionsArtifact ?? null}
            player={player}
            scoring={settings?.scoring ?? {}}
            fftoday={recommendation ? { points: recommendation.projectedPoints, source: 'FFToday' } : null}
          />
        </div>
      )}

      {tab === 'role' && (
        <div className="player-detail-panel" role="tabpanel" aria-labelledby="player-detail-tab-role">
          <PlayerRolePanel
            player={player}
            usage={usage}
            feedStatus={feedStatus}
            weeklyStats={resolvedWeeklyStats}
          />
        </div>
      )}

      {tab === 'weekly' && (
        <div className="player-detail-panel" role="tabpanel" aria-labelledby="player-detail-tab-weekly">
          <section className="weekly-section">
            <WeeklyViewToggle view={weeklyView} onChange={setWeeklyView} />
            {weeklyView === 'graph' ? (
              <WeeklyChart
                rows={gameLogRows}
                season={weeklySeason}
                position={player.position}
                status={resolvedWeeklyStats.status}
                playerName={player.name}
              />
            ) : (
              <WeeklyStatGrid
                rows={gameLogRows}
                weeksFetched={weeksFetched}
                position={player.position}
                status={resolvedWeeklyStats.status}
                season={weeklySeason}
              />
            )}
          </section>
        </div>
      )}

      {tab === 'injury' && (
        <div className="player-detail-panel" role="tabpanel" aria-labelledby="player-detail-tab-injury">
          <PlayerBodyMap
            injuryHistory={usage?.injuryHistory}
            feedStatus={feedStatus}
            playerName={player.name}
          />
        </div>
      )}
    </Drawer>
  );
}

