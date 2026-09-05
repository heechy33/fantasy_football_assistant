import { useEffect, useState, type KeyboardEvent } from 'react';
import type { AdpEntry, LeagueSettings, PlayerMeta, PlayerUsage, PlayerUsageArtifact, ProviderProjectionsArtifact } from '../../../shared/types';
import { playerBioItems } from '../data/playerBio';
import { playerStatusTags, statusTagClassName } from '../data/playerStatusTag';
import { resolvePointsPerGame } from '../data/pprProduction';
import { buildGameLogRows, buildSparklinePoints } from '../data/weeklyGameLog';
import type { TeamDepthRole } from '../data/teamDepthRole';
import type { Recommendation } from '../engine/recommend';
import type { WeeklyStatsState } from '../hooks/useWeeklyStats';
import { PlayerMarketComparison, type BoardAdpAnchor, type UnderdogAdpAnchor } from './PlayerMarketComparison';
import type { ProviderAdpLaneState } from '../hooks/useProviderAdpBoards';
import { PlayerRolePanel } from './PlayerRolePanel';
import { TeamDepthRoleRow } from './TeamDepthRoleRow';
import { PositionBadge } from './PositionBadge';
import { WeeklyChart } from './WeeklyChart';
import { WeeklyStatGrid } from './WeeklyStatGrid';
import { WeeklyViewToggle, type WeeklyView } from './WeeklyViewToggle';
import { Drawer } from './Drawer';
import { teamLogoUrl } from '../data/playerPortrait';
import { PlayerPortrait } from './PlayerPortrait';

export type PlayerContextFeedStatus = 'loading' | 'ready' | 'unavailable';

/** Which upstream actually produced the active `adp-<format>.json`, read off
 * `DataManifest.sources['adp_active_' + format]`. Sleeper's draft-lobby ADP is canonical; the
 * FFC-derived board only appears when Sleeper's endpoint was unavailable or too sparse; the ESPN
 * variant appears only on ESPN PPR sessions whose `adp-espn-ppr.json` board actually loaded. */
export type AdpDisclosure =
  | { source: 'sleeper'; format: string }
  | {
      source: 'ffc-fallback';
      mockDrafts: number | null;
      teams: number;
      format: string;
      /** FFC's pooled ADP window (e.g. start "2026-08-24" / end "2026-08-31") — under-reacts to
       * same-day news by construction, so the UI labels it rather than implying a live number. */
      startDate: string | null;
      endDate: string | null;
    }
  | { source: 'espn'; format: string }
  | { source: 'yahoo'; format: string };

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
  /** The full prior-season usage artifact + player pool — enables the STACKED-style percentile
   * rankings in the Role panel for RB/WR/TE (see `percentileRankings.ts`). Optional. */
  usageArtifact?: PlayerUsageArtifact;
  players?: readonly PlayerMeta[];
  feedStatus: PlayerContextFeedStatus;
  recommendation?: Recommendation;
  /** Off-clock/market fallback for the engine (FFToday) projection tile — same pick-invariant
   * number the card face's `Proj` tile falls back to (`playerBoardFace.ts`'s
   * `recommendation?.projectedPoints ?? projectedPoints`) when this player has no `recommendation`
   * because the bounded engine board never evaluated them (most market-only rows beyond the
   * top-ranked players). Without this, the drawer's FFToday tile would only ever appear for the
   * handful of players the engine actually scored, even though the card right behind it already
   * shows a projection number for everyone with an FFToday row. */
  fallbackProjectedPoints?: number | null;
  adpDisclosure?: AdpDisclosure | null;
  weeklyStats?: WeeklyStatsState;
  /** The active ADP board (the same `adp` array the board/cards render from). Lets the drawer
   * label the engine ADP with the *player's* provenance — the ESPN board is a mixed source
   * (native ESPN head + Sleeper-tail splice), so a board-wide "ESPN" label would be wrong for
   * tail players — and keeps the engine anchor visible even off-clock in market mode when
   * `recommendation` is null. */
  adpBoard?: readonly AdpEntry[];
  /** Underdog's best-ball ADP board (`data/adp-underdog-bestball.json`, fail-open — may be
   * absent if the pipeline hasn't produced it yet). A SEPARATE lane from `adpBoard`: never
   * merged into it, never used for the engine anchor, only for its own display tile. */
  underdogAdp?: readonly AdpEntry[];
  /** Display-only comparison ADP lanes (ESPN PPR / FFC mock drafts) for the Market ADP tile
   * grid — see `useProviderAdpBoards`. Optional; omitted lanes render nothing. */
  providerAdpLanes?: ReadonlyArray<ProviderAdpLaneState>;
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
  usageArtifact,
  players,
  feedStatus,
  recommendation,
  fallbackProjectedPoints,
  adpDisclosure,
  weeklyStats,
  adpBoard,
  underdogAdp,
  providerAdpLanes = [],
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
  // The drawer has room to show every applicable tag, unlike the card/row (playerStatusTag,
  // capped at one) — a player can be a rookie AND hurt, say, and both are worth surfacing here.
  const statusTags = playerStatusTags(player, usage);
  // The anchor marker for the ADP-by-provider section: which number the engine
  // actually used (recommendation.availabilityAdp, or the board entry's adp in
  // off-clock market mode when no recommendation exists) and which upstream
  // produced *this player's* value (adpEntry.adpSource — the ESPN board is a
  // mixed native-ESPN + Sleeper-tail splice, so the row-level source wins over
  // the board-wide adpDisclosure). Null only when the player has no board entry
  // and no recommendation.
  const adpEntry = adpBoard?.find((entry) => entry.playerId === player.playerId) ?? null;
  // FFC's ADP is a rolling pooled average over this window (e.g. "Aug 24-31"), which under-reacts
  // to same-day news by construction — labeled on the tile whenever the board actually fell back
  // to it, board-wide (adpDisclosure), not per-row (a single row's adpEntry.adpSource can't carry
  // the window itself).
  const ffcWindow = adpDisclosure?.source === 'ffc-fallback'
    ? { startDate: adpDisclosure.startDate, endDate: adpDisclosure.endDate, mockDrafts: adpDisclosure.mockDrafts }
    : null;
  const boardAdp: BoardAdpAnchor | null = adpEntry != null
    ? {
        adp: recommendation?.availabilityAdp ?? adpEntry.adp,
        source: adpEntry.adpSource === 'espn' ? 'ESPN'
          : adpEntry.adpSource === 'sleeper' && adpDisclosure?.source === 'espn' ? 'Sleeper (ESPN board tail)'
          : adpEntry.adpSource === 'sleeper' && adpDisclosure?.source === 'yahoo' ? 'Sleeper (Yahoo board tail)'
          : adpEntry.adpSource === 'sleeper' ? 'Sleeper'
          : adpEntry.adpSource === 'yahoo' ? 'Yahoo'
          : 'FFC fallback',
        brandKey: adpEntry.adpSource === 'espn' ? 'espn'
          : adpEntry.adpSource === 'sleeper' ? 'sleeper'
          : adpEntry.adpSource === 'yahoo' ? 'yahoo'
          : 'ffc',
        freshnessWindow: adpEntry.adpSource === 'espn' || adpEntry.adpSource === 'sleeper' || adpEntry.adpSource === 'yahoo' ? null : ffcWindow,
      }
    : recommendation != null && recommendation.availabilityAdp != null
      ? {
          adp: recommendation.availabilityAdp,
          source: adpDisclosure?.source === 'ffc-fallback' ? 'FFC fallback'
            : adpDisclosure?.source === 'espn' ? 'ESPN'
            : adpDisclosure?.source === 'yahoo' ? 'Yahoo'
            : 'Sleeper',
          brandKey: adpDisclosure?.source === 'ffc-fallback' ? 'ffc'
            : adpDisclosure?.source === 'espn' ? 'espn'
            : adpDisclosure?.source === 'yahoo' ? 'yahoo'
            : 'sleeper',
          freshnessWindow: ffcWindow,
        }
      : null;
  // Underdog is a wholly separate lane (see UnderdogAdpAnchor's doc) — looked up by playerId only,
  // never merged with adpEntry above.
  const underdogEntry = underdogAdp?.find((entry) => entry.playerId === player.playerId) ?? null;
  const underdogAnchor: UnderdogAdpAnchor | null = underdogEntry != null ? { adp: underdogEntry.adp } : null;

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

  const logoUrl = teamLogoUrl(player.team);

  return (
    <Drawer
      open
      size="wide"
      label={player.name}
      team={player.team}
      className="player-detail-drawer"
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
          <div className="player-detail-hero" data-team={player.team ?? undefined}>
            {logoUrl && (
              <img
                src={logoUrl}
                alt=""
                className="idp-hero-watermark"
                aria-hidden="true"
              />
            )}
            <div className="player-detail-hero-main">
              <div className="idp-detail-hero-content player-detail-summary">
                <div className="idp-detail-headline">
                  <div className="idp-detail-title-wrap">
                    <h2 className="idp-detail-name">{player.name}</h2>
                    <div className="idp-detail-subhead player-context-meta">
                      <PositionBadge position={player.position} />
                      {player.team ? (
                        <span className="idp-meta-team">
                          {logoUrl && <img src={logoUrl} alt="" className="idp-team-mini-logo" width={18} height={18} />}
                          {player.team}
                        </span>
                      ) : (
                        <span className="idp-meta-team">Free agent</span>
                      )}
                      {player.depthChartPosition && (
                        <span className="idp-slot-chip">{player.depthChartPosition}</span>
                      )}
                      {player.depthChartOrder != null && (
                        <span className="idp-meta-bye">#{player.depthChartOrder}</span>
                      )}
                      {player.byeWeek != null && (
                        <span className="idp-meta-bye">Bye {player.byeWeek}</span>
                      )}
                      {statusTags.map((tag) => (
                        <span key={tag.kind} className={statusTagClassName(tag.kind)}>{tag.label}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {(player.availability ?? 1) <= 0 && player.availabilityReason && (
                  <p className="player-detail-unavailable-reason">{player.availabilityReason}</p>
                )}

                {bioItems.length > 0 && (
                  <dl className="player-detail-bio idp-bio-grid">
                    {bioItems.map((item) => (
                      <div key={item.label} className="idp-bio-cell">
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <div className="idp-hero-portrait-frame">
                <PlayerPortrait
                  player={{
                    playerId: player.playerId,
                    name: player.name,
                    position: player.position,
                    team: player.team ?? 'FA',
                  }}
                  size="hero"
                  className="idp-hero-portrait"
                />
              </div>
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
            boardAdp={boardAdp}
            underdogAdp={underdogAnchor}
            providerAdpLanes={providerAdpLanes}
            projectionsArtifact={providerProjectionsArtifact ?? null}
            player={player}
            scoring={settings?.scoring ?? {}}
            fftoday={
              recommendation != null
                ? { points: recommendation.projectedPoints, source: 'FFToday' }
                : fallbackProjectedPoints != null
                  ? { points: fallbackProjectedPoints, source: 'FFToday' }
                  : null
            }
          />
        </div>
      )}

      {tab === 'role' && (
        <div className="player-detail-panel" role="tabpanel" aria-labelledby="player-detail-tab-role">
          <PlayerRolePanel
            player={player}
            usage={usage}
            usageArtifact={usageArtifact}
            players={players}
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
          <div className="coming-soon">
            <h4>Injury history</h4>
            <p className="muted">Coming soon.</p>
          </div>
        </div>
      )}
    </Drawer>
  );
}

