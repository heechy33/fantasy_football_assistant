import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DataManifest, LeagueSettings, PlayerMeta, Roster, SeasonProjection } from '../../../shared/types';
import { ProviderBadge } from '../components/ProviderBadge';
import { MyTeamRail } from '../components/MyTeamRail';
import { PositionBadge } from '../components/PositionBadge';
import { PlayerDetailDrawer, type AdpDisclosure, type PlayerContextFeedStatus } from '../components/PlayerDetailDrawer';
import { IdpDetailDrawer } from '../components/IdpDetailDrawer';
import { scoreProjection } from '../engine/scoring';
import type { AdpFormat } from '../data/loadPlayerPool';
import { adpBoardKeyFor } from '../data/adpBoard';
import { buildTeamDepthRoles } from '../data/teamDepthRole';
import { resolvePlayerContextFeedStatus } from '../data/playerContext';
import { usePlayerBoardData } from '../hooks/usePlayerBoardData';
import { useProviderAdpBoards } from '../hooks/useProviderAdpBoards';
import { useUnderdogAdp } from '../hooks/useUnderdogAdp';
import { loadAllIdpPlayers, type IdpPlayer } from '../data/idpProjections';
import { draftToDisplay, useSavedDrafts } from '../data/useSavedDrafts';
import { useSavedLeagues } from '../data/useSavedLeagues';
import { sleeperAdapter } from '../adapters/sleeper';
import { useWeeklyStats } from '../hooks/useWeeklyStats';
import { teamLogoUrl } from '../data/playerPortrait';
import { useOptionalDraftSession } from '../session/DraftSessionProvider';

function rowStyle(team: string | null): CSSProperties {
  const logo = teamLogoUrl(team);
  return { '--team-logo': logo ? `url(${logo})` : 'none' } as CSSProperties;
}

/**
 * League detail (/leagues/:leagueId): the league's summary plus the team you drafted.
 * Allows clicking any player on your roster to open the player detail drawer with full
 * stats, projections, weekly charts, and team context.
 */
export function LeagueDetailRoute() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { leagues, loading: leaguesLoading, error: leaguesError } = useSavedLeagues();
  const league = useMemo(() => leagues.find((entry) => entry.id === leagueId) ?? null, [leagues, leagueId]);
  const { drafts } = useSavedDrafts(league?.id ?? null);
  const draft = draftToDisplay(drafts);

  const adpFormat: AdpFormat = useMemo(() => {
    const settings = draft?.frozenInit?.settings;
    if (!settings) return 'ppr';
    const rec = settings.scoring?.rec;
    const is2qb = settings.format?.qb === 'two-qb' || settings.format?.qb === 'superflex';
    if (is2qb) return '2qb';
    if (rec === 0) return 'standard';
    if (rec === 0.5) return 'half-ppr';
    return 'ppr';
  }, [draft?.frozenInit?.settings]);

  const providerKey = league?.provider ?? 'sleeper';
  const adpBoardKey = useMemo(() => adpBoardKeyFor(providerKey, adpFormat), [providerKey, adpFormat]);

  const {
    players,
    playersById: rawPlayersById,
    projections,
    adp,
    resolvedAdpKey,
    usage,
    usageLoadStatus,
    providerProjectionsArtifact,
  } = usePlayerBoardData(adpBoardKey, adpFormat);

  const playersById = useMemo(() => {
    const map = new Map<string, PlayerMeta>(rawPlayersById);
    for (const p of players) {
      if (p.ids?.espn) map.set(String(p.ids.espn), p);
      if (p.ids?.yahoo) map.set(String(p.ids.yahoo), p);
    }
    return map;
  }, [players, rawPlayersById]);

  const allIdpPlayers = useMemo(() => loadAllIdpPlayers(), []);
  const idpById = useMemo(() => {
    const map = new Map<string, IdpPlayer>();
    for (const p of allIdpPlayers) {
      map.set(p.id, p);
      if (p.sleeperId) map.set(p.sleeperId, p);
    }
    return map;
  }, [allIdpPlayers]);

  const sessionValue = useOptionalDraftSession();
  const sessionManifest = sessionValue?.manifest ?? null;
  const [localManifest, setLocalManifest] = useState<DataManifest | null>(null);

  useEffect(() => {
    if (sessionManifest) return;
    let active = true;
    fetch('/data/manifest.json')
      .then((res) => (res.ok ? (res.json() as Promise<DataManifest>) : null))
      .then((data) => {
        if (active && data && typeof data === 'object' && !Array.isArray(data) && 'sources' in data) {
          setLocalManifest(data as DataManifest);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sessionManifest]);

  const effectiveManifest = sessionManifest ?? localManifest;

  const contextFeedStatus: PlayerContextFeedStatus = useMemo(() => {
    if (usageLoadStatus === 'loading') return 'loading';
    if (usageLoadStatus === 'error') return 'unavailable';
    if (effectiveManifest?.sources) {
      return resolvePlayerContextFeedStatus(effectiveManifest.sources, usageLoadStatus);
    }
    return 'ready';
  }, [effectiveManifest, usageLoadStatus]);

  const depthRoleByPlayer = useMemo(
    () => buildTeamDepthRoles(players, contextFeedStatus === 'ready' ? usage : {}),
    [players, contextFeedStatus, usage],
  );

  const underdog = useUnderdogAdp();
  const providerLanes = useProviderAdpBoards(adpFormat);

  const activeSourceManifestKey = resolvedAdpKey === 'espn-ppr'
    ? 'adp_active_espn_ppr'
    : resolvedAdpKey === 'yahoo-half-ppr' ? 'adp_active_yahoo_half-ppr'
      : resolvedAdpKey === 'yahoo-ppr' ? 'adp_active_yahoo_ppr'
        : resolvedAdpKey === 'yahoo-standard' ? 'adp_active_yahoo_standard'
          : `adp_active_${adpFormat}`;
  const activeAdpSource = effectiveManifest?.sources?.[activeSourceManifestKey];
  const ffcAdpSource = effectiveManifest?.sources?.[`ffc_adp_${adpFormat}`];
  const adpDisclosure: AdpDisclosure | null = useMemo(() => {
    if (!activeAdpSource) return null;
    if (activeAdpSource.activeAdpSource === 'ffc-fallback') {
      return {
        source: 'ffc-fallback',
        mockDrafts: ffcAdpSource?.population?.mockDrafts ?? null,
        teams: ffcAdpSource?.population?.teams ?? 12,
        format: ffcAdpSource?.population?.format ?? adpFormat,
        startDate: ffcAdpSource?.population?.startDate ?? null,
        endDate: ffcAdpSource?.population?.endDate ?? null,
      };
    }
    if (activeAdpSource.activeAdpSource === 'espn') {
      return { source: 'espn', format: adpFormat };
    }
    if (activeAdpSource.activeAdpSource === 'yahoo') {
      return { source: 'yahoo', format: adpFormat };
    }
    return { source: 'sleeper', format: adpFormat };
  }, [activeAdpSource, ffcAdpSource, adpFormat]);

  const effectiveSettings: LeagueSettings = useMemo(() => {
    if (draft?.frozenInit?.settings) return draft.frozenInit.settings;
    return {
      provider: league?.provider ?? 'sleeper',
      leagueId: league?.providerLeagueId ?? league?.id ?? '',
      name: league?.name ?? 'League',
      season: league?.season ?? '2026',
      format: {
        reception: adpFormat === 'standard' ? 'standard' : adpFormat === 'half-ppr' ? 'half-ppr' : 'ppr',
        qb: adpFormat === '2qb' ? 'two-qb' : 'one-qb',
        draft: 'snake',
      },
      teams: league?.teams ?? 12,
      rounds: league?.rounds ?? 15,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
      scoring: {
        rec: adpFormat === 'standard' ? 0 : adpFormat === 'half-ppr' ? 0.5 : 1,
        pass_yd: 0.04,
        pass_td: 4,
        rush_yd: 0.1,
        rush_td: 6,
        rec_yd: 0.1,
        rec_td: 6,
        int: -2,
        fum_lost: -2,
      },
    };
  }, [draft?.frozenInit?.settings, league, adpFormat]);

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const selectedOffensivePlayer = useMemo(() => {
    if (!selectedPlayerId) return null;
    return playersById.get(selectedPlayerId) ?? null;
  }, [selectedPlayerId, playersById]);

  const selectedIdpPlayer = useMemo(() => {
    if (!selectedPlayerId) return null;
    const direct = idpById.get(selectedPlayerId);
    if (direct) return direct;
    if (selectedOffensivePlayer) {
      return allIdpPlayers.find((p) => p.name.toLowerCase() === selectedOffensivePlayer.name.toLowerCase()) ?? null;
    }
    return null;
  }, [selectedPlayerId, idpById, selectedOffensivePlayer, allIdpPlayers]);

  const effectivePlayer = useMemo<PlayerMeta | null>(() => {
    if (!selectedPlayerId || selectedIdpPlayer) return null;
    if (selectedOffensivePlayer) return selectedOffensivePlayer;
    return {
      playerId: selectedPlayerId,
      name: selectedPlayerId,
      position: 'WR',
      eligiblePositions: ['WR'],
      team: null,
      byeWeek: null,
      age: null,
      yearsExp: null,
      injuryStatus: null,
      ids: {},
    };
  }, [selectedPlayerId, selectedIdpPlayer, selectedOffensivePlayer]);

  const fallbackProjectedPoints = useMemo(() => {
    if (!effectivePlayer) return null;
    const proj = projections.find((p) => p.playerId === effectivePlayer.playerId);
    if (!proj) return null;
    return scoreProjection(proj, effectiveSettings, effectivePlayer.position ?? undefined).points;
  }, [effectivePlayer, projections, effectiveSettings]);

  const weeklyStats = useWeeklyStats(selectedPlayerId, Number(league?.season) || 2025);

  if (leaguesLoading) {
    return (
      <section className="leagues-page" aria-label="League detail">
        <p className="muted">Loading league…</p>
      </section>
    );
  }
  if (leaguesError) {
    return (
      <section className="leagues-page" aria-label="League detail">
        <p role="alert">Could not load your leagues: {leaguesError.message}</p>
      </section>
    );
  }
  if (!league) {
    return (
      <section className="leagues-page" aria-label="League detail">
        <p role="alert">League not found — it may have been removed.</p>
        <Link to="/leagues" className="primary-button">Back</Link>
      </section>
    );
  }

  return (
    <section className="leagues-page league-detail-page" aria-label="League detail">
      <div className="league-detail-top-nav">
        <Link to="/leagues" className="league-back-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>All Leagues</span>
        </Link>
      </div>

      <div className="league-hero-card">
        <div className="league-hero-main">
          <div className="league-hero-title-area">
            <div className="league-hero-tags">
              <span className="league-season-pill">{league.season || '2026 Season'}</span>
              {league.provider !== 'manual' && <ProviderBadge brandKey={league.provider} size="sm" />}
            </div>
            <h2 className="league-hero-title">{league.name}</h2>
            {league.providerTeamName ? (
              <p className="league-hero-team">
                Your Team: <strong>{league.providerTeamName}</strong>
              </p>
            ) : league.provider === 'sleeper' && league.providerUserId ? (
              <p className="league-hero-team">
                Connected as: <strong>{league.providerUsername ?? league.providerUserId}</strong>
              </p>
            ) : null}
          </div>
          <div className="league-hero-cta">
            <Link to="/draft" className="primary-button league-draft-cta">
              Draft Room
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          </div>
        </div>

        <div className="league-stats-grid">
          <div className="league-stat-tile">
            <span className="league-stat-label">Teams</span>
            <strong className="league-stat-val">{league.teams}</strong>
          </div>
          <div className="league-stat-tile">
            <span className="league-stat-label">Format</span>
            <strong className="league-stat-val">{draft?.frozenInit?.settings?.format?.reception?.toUpperCase() ?? 'PPR'}</strong>
          </div>
          <div className="league-stat-tile">
            <span className="league-stat-label">Draft Status</span>
            <strong className="league-stat-val status-badge">{draft ? draft.status : 'No draft tracked yet'}</strong>
          </div>
          <div className="league-stat-tile">
            <span className="league-stat-label">Provider</span>
            <strong className="league-stat-val provider-name">{league.provider.toUpperCase()}</strong>
          </div>
        </div>
      </div>

      <div className="league-roster-panel">
        <LeagueRoster
          provider={league.provider}
          providerLeagueId={league.providerLeagueId}
          providerUserId={league.providerUserId ?? null}
          draft={draft}
          playersById={playersById}
          projections={projections}
          idpById={idpById}
          onViewPlayer={setSelectedPlayerId}
        />
      </div>

      {selectedIdpPlayer && (
        <IdpDetailDrawer
          player={selectedIdpPlayer}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}

      {effectivePlayer && !selectedIdpPlayer && (
        <PlayerDetailDrawer
          player={effectivePlayer}
          usage={usage[effectivePlayer.playerId]}
          usageArtifact={usage}
          players={players}
          feedStatus={contextFeedStatus}
          fallbackProjectedPoints={fallbackProjectedPoints}
          adpDisclosure={adpDisclosure}
          weeklyStats={weeklyStats}
          adpBoard={adp}
          underdogAdp={underdog.entries}
          providerAdpLanes={providerLanes.filter((lane) => lane.status === 'ready')}
          providerProjectionsArtifact={providerProjectionsArtifact}
          settings={effectiveSettings}
          depthRole={depthRoleByPlayer.get(effectivePlayer.playerId) ?? null}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </section>
  );
}

type DraftForDisplay = ReturnType<typeof draftToDisplay>;

/** The drafted-team half of the page, resolved per provider. */
function LeagueRoster({
  provider,
  providerLeagueId,
  providerUserId,
  draft,
  playersById,
  projections,
  idpById,
  onViewPlayer,
}: {
  provider: 'sleeper' | 'espn' | 'manual';
  providerLeagueId: string | null;
  providerUserId: string | null;
  draft: DraftForDisplay;
  playersById: ReadonlyMap<string, PlayerMeta>;
  projections: SeasonProjection[];
  idpById: ReadonlyMap<string, IdpPlayer>;
  onViewPlayer: (playerId: string) => void;
}) {
  const [rosters, setRosters] = useState<Roster[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const isSleeper = provider === 'sleeper' && Boolean(providerUserId && providerLeagueId);
  useEffect(() => {
    if (!isSleeper || !providerUserId || !providerLeagueId) return;
    let active = true;
    setRosters(null);
    setRosterError(null);
    sleeperAdapter.rosters({ provider: 'sleeper', userId: providerUserId }, providerLeagueId)
      .then((result) => { if (active) setRosters(result); })
      .catch((err: unknown) => { if (active) setRosterError(err instanceof Error ? err.message : 'Could not load the roster from Sleeper.'); });
    return () => { active = false; };
  }, [isSleeper, providerUserId, providerLeagueId]);

  const emptyState = (
    <p>
      No draft tracked for this league yet. Start one from{' '}
      <Link to="/draft">the Draft Room</Link> — nothing is invented here until a real draft exists.
    </p>
  );

  if (isSleeper) {
    if (rosterError) return <p role="alert">{rosterError}</p>;
    if (!rosters) return <p className="muted">Loading the roster from Sleeper…</p>;
    const mine = rosters.find((roster) => roster.ownerId === providerUserId) ?? null;
    if (!mine) return emptyState;
    return (
      <StoredRoster
        playersById={playersById}
        idpById={idpById}
        label="Your roster (live from Sleeper)"
        starters={mine.starters}
        bench={mine.bench}
        ir={mine.ir}
        onViewPlayer={onViewPlayer}
      />
    );
  }

  if (provider === 'espn' || provider === 'manual') {
    if (!draft || !draft.frozenInit || !draft.picks || draft.picks.length === 0) return emptyState;
    return (
      <MyTeamRail
        settings={draft.frozenInit.settings}
        effectivePicks={draft.picks}
        myTeamId={draft.frozenInit.myTeamId}
        playersById={playersById}
        projections={projections}
        onViewPlayer={onViewPlayer}
      />
    );
  }

  return emptyState;
}


/** Stored-roster view with interactive player cards, team theming, and detail drawer triggers. */
function StoredRoster({
  playersById,
  idpById,
  label,
  starters,
  bench,
  ir,
  onViewPlayer,
}: {
  playersById: ReadonlyMap<string, PlayerMeta>;
  idpById: ReadonlyMap<string, IdpPlayer>;
  label: string;
  starters: (string | null)[];
  bench: string[];
  ir: string[];
  onViewPlayer: (playerId: string) => void;
}) {
  function getPlayerInfo(playerId: string) {
    const player = playersById.get(playerId);
    const idp = idpById.get(playerId);
    return {
      name: player?.name ?? idp?.name ?? playerId,
      pos: player?.position ?? idp?.pos ?? null,
      team: player?.team ?? idp?.team ?? null,
      bye: player?.byeWeek ?? idp?.bye ?? null,
    };
  }

  return (
    <div className="stored-roster">
      <div className="stored-roster-header">
        <h3>{label}</h3>
        <span className="stored-roster-total-badge">
          {starters.filter(Boolean).length + bench.length + ir.length} Players
        </span>
      </div>

      <div className="stored-roster-section">
        <div className="stored-roster-section-head">
          <h4>Starters</h4>
          <span className="stored-roster-section-count">{starters.filter(Boolean).length} Active</span>
        </div>
        <div className="stored-roster-grid">
          {starters.map((playerId, index) => {
            if (!playerId) {
              return (
                <div key={`starter-empty-${index}`} className="stored-roster-slot-card empty">
                  <span className="stored-roster-slot-label">#{index + 1}</span>
                  <span className="stored-roster-empty-text">Empty Slot</span>
                </div>
              );
            }
            const info = getPlayerInfo(playerId);
            const logo = teamLogoUrl(info.team);
            return (
              <button
                key={`starter-${playerId}-${index}`}
                type="button"
                className="stored-roster-slot-card"
                data-team={info.team ?? undefined}
                style={rowStyle(info.team)}
                onClick={() => onViewPlayer(playerId)}
              >
                <div className="stored-card-main">
                  <span className="stored-roster-slot-label">#{index + 1}</span>
                  {info.pos && <PositionBadge position={info.pos} />}
                  <div className="stored-name-team">
                    <span className="stored-player-name">{info.name}</span>
                    <span className="stored-player-sub">
                      {logo && <img src={logo} alt="" className="stored-team-logo" width={14} height={14} />}
                      {info.team ?? 'FA'}
                    </span>
                  </div>
                </div>
                {info.bye != null && <span className="stored-player-bye">Bye {info.bye}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {bench.length > 0 && (
        <div className="stored-roster-section">
          <div className="stored-roster-section-head">
            <h4>Bench</h4>
            <span className="stored-roster-section-count">{bench.length} Players</span>
          </div>
          <div className="stored-roster-grid">
            {bench.map((playerId) => {
              const info = getPlayerInfo(playerId);
              const logo = teamLogoUrl(info.team);
              return (
                <button
                  key={`bench-${playerId}`}
                  type="button"
                  className="stored-roster-slot-card bench"
                  data-team={info.team ?? undefined}
                  style={rowStyle(info.team)}
                  onClick={() => onViewPlayer(playerId)}
                >
                  <div className="stored-card-main">
                    {info.pos && <PositionBadge position={info.pos} />}
                    <div className="stored-name-team">
                      <span className="stored-player-name">{info.name}</span>
                      <span className="stored-player-sub">
                        {logo && <img src={logo} alt="" className="stored-team-logo" width={14} height={14} />}
                        {info.team ?? 'FA'}
                      </span>
                    </div>
                  </div>
                  {info.bye != null && <span className="stored-player-bye">Bye {info.bye}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {ir.length > 0 && (
        <div className="stored-roster-section">
          <div className="stored-roster-section-head">
            <h4>Injured Reserve (IR)</h4>
            <span className="stored-roster-section-count">{ir.length}</span>
          </div>
          <div className="stored-roster-grid">
            {ir.map((playerId) => {
              const info = getPlayerInfo(playerId);
              return (
                <button
                  key={`ir-${playerId}`}
                  type="button"
                  className="stored-roster-slot-card ir"
                  data-team={info.team ?? undefined}
                  style={rowStyle(info.team)}
                  onClick={() => onViewPlayer(playerId)}
                >
                  <div className="stored-card-main">
                    {info.pos && <PositionBadge position={info.pos} />}
                    <div className="stored-name-team">
                      <span className="stored-player-name">{info.name}</span>
                      <span className="stored-player-sub">{info.team ?? 'FA'}</span>
                    </div>
                  </div>
                  {info.bye != null && <span className="stored-player-bye">Bye {info.bye}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}