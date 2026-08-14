import { useEffect, useMemo, useState } from 'react';
import type { DataManifest, DraftInit, OnTheClock, Pick, PlayerId, Position } from '../../../shared/types';
import type { UserPickBoundaries } from '../adapters/draftOrder';
import { resolvePlayerContextFeedStatus } from '../data/playerContext';
import { fantasyProsStarsForPlayer } from '../data/fantasyProsStars';
import { buildTeamDepthRoles } from '../data/teamDepthRole';
import type { AdpFormat } from '../data/loadPlayerPool';
import { pointsPerGame } from '../data/pprProduction';
import { buildSparklinePoints } from '../data/weeklyGameLog';
import { buildNextPickPreview } from '../data/nextPickPreview';
import { buildRecommendationBoard, DEFAULT_SCENARIOS, type MarketRecommendation } from '../engine/recommend';
import type { RecommendationWorkerDynamicInput, RecommendationWorkerStaticData } from '../engine/recommendationWorkerProtocol';
import { usePlayerBoardData } from '../hooks/usePlayerBoardData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useRecommendationRefinement } from '../hooks/useRecommendationRefinement';
import { useBoardWeeklyStats, useWeeklyStats } from '../hooks/useWeeklyStats';
import { BoardFilters, type BoardMode } from './BoardFilters';
import { BoardFilmstrip } from './BoardFilmstrip';
import { Drawer } from './Drawer';
import { DraftLog } from './DraftLog';
import { MyTeamRail } from './MyTeamRail';
import { NextPickPreview } from './NextPickPreview';
import { PlayerCard } from './PlayerCard';
import { PlayerDetailDrawer, type AdpDisclosure } from './PlayerDetailDrawer';

/** UI page sizes for both board modes: starts at 6, expands through 12/18/24 (multiples of 3).
 * `ROLLOUT_DISPLAY_LIMIT` stays fixed regardless of `visibleCount` so Stage C's rollout/planning
 * pool never grows just because the user paged further — see `recommend.ts`'s
 * `RecommendationInput.rolloutDisplayLimit` doc. */
const PAGE_SIZES = [6, 12, 18, 24] as const;
const ROLLOUT_DISPLAY_LIMIT = 5;
const SIMULATION_CANDIDATE_LIMIT = 10;
const ROLLOUT_TIME_BUDGET_MS = 1500;

type OpenDrawer =
  | { kind: 'log' }
  | { kind: 'team' }
  | { kind: 'player'; playerId: PlayerId }
  | null;

export interface DraftWorkspaceProps {
  draftInit: DraftInit | null;
  effectivePicks: Pick[];
  onCorrectPick: (overall: number) => void;
  manifest: DataManifest | null;
  adpFormat: AdpFormat;
  /** Clock memos computed once in `App` — never recomputed here (see App's lift comments). The
   * signature is what stops the board rebuild on a no-op poll tick; `onTheClock`/`boundaries` are
   * what the board, pagination-reset, DraftLog you-up chip, and PlayerDetailDrawer all read. */
  picksSignature: string;
  onTheClock: OnTheClock | null;
  boundaries: UserPickBoundaries | null;
}

const POSITION_TABS: ReadonlyArray<{ label: string; position: Position | null }> = [
  { label: 'All', position: null },
  { label: 'QB', position: 'QB' },
  { label: 'RB', position: 'RB' },
  { label: 'WR', position: 'WR' },
  { label: 'TE', position: 'TE' },
  { label: 'K', position: 'K' },
  { label: 'D/ST', position: 'DEF' },
];

/**
 * Replaces the old stacked `DraftBoard` + `RecommendationPanel` in the connected session with a
 * three-column workspace: draft log, MUT-style recommendation cards with BoardFilters above the
 * filmstrip, and an optimized My Team rail. Polling, effective-pick state, and manual mode are all
 * owned by `App` and passed straight through — this component only presents them.
 */
export function DraftWorkspace({
  draftInit,
  effectivePicks,
  onCorrectPick,
  manifest,
  adpFormat,
  picksSignature,
  onTheClock,
  boundaries,
}: DraftWorkspaceProps) {
  const {
    players, playersById, projections, adp, usage, usageLoadStatus, loadError,
    fantasyProsArtifact = null,
    adpProvidersArtifact = null,
    providerProjectionsArtifact = null,
  } = usePlayerBoardData(adpFormat);
  // Bench-depth pricing input (see eligibility.ts's benchDepthValue) — a separate derived map, not
  // the raw PlayerUsageArtifact, so the engine stays a pure function of plain data and never imports
  // provider/UI-shaped types. Missing/loading usage degrades to benchDepthValue's own documented
  // DEFAULT_AVAILABILITY_RATE fallback, never blocks the board.
  const availabilityByPlayer = useMemo(() => {
    const map = new Map<PlayerId, number>();
    for (const [playerId, playerUsage] of Object.entries(usage)) {
      if (playerUsage.availabilityRate != null) map.set(playerId, playerUsage.availabilityRate);
    }
    return map;
  }, [usage]);

  // Team-depth role derivation (Part B): built here, not in usePlayerBoardData, because
  // `contextSignalsReady` is the only place that knows whether player-usage.json is trustworthy
  // (the manifest can mark nflverse_* sources degraded after a successful fetch). Deps change at
  // most a few times per session, and `picksSignature` is deliberately absent, so this never
  // touches the 2-3s poll hot path (~4.4k Map inserts + ~128 small sorts).
  const contextFeedStatus = resolvePlayerContextFeedStatus(manifest?.sources, usageLoadStatus);
  const contextSignalsReady = contextFeedStatus === 'ready';
  const depthRoleByPlayer = useMemo(
    () => buildTeamDepthRoles(players, contextSignalsReady ? usage : {}),
    [players, contextSignalsReady, usage],
  );
  const [displayPosition, setDisplayPosition] = useState<Position | null>(null);
  const [boardMode, setBoardMode] = useState<BoardMode>('engine');
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZES[0]);
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const cardsPerPage = isNarrow ? 1 : 3;
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);
  const selectedPlayerId = openDrawer?.kind === 'player' ? openDrawer.playerId : null;
  const fantasyProsFor = (playerId: PlayerId) => fantasyProsStarsForPlayer(fantasyProsArtifact, playerId);

  const isMyTurn = draftInit?.myTeamId != null && onTheClock?.teamId === draftInit.myTeamId;
  const currentOverall = onTheClock?.overall ?? (draftInit ? effectivePicks.length + 1 : null);
  const picksUntilUserTurn = boundaries?.decisionPick != null && currentOverall != null
    ? Math.max(0, boundaries.decisionPick - currentOverall)
    : null;

  const nextPickPreview = useMemo(() => {
    if (isMyTurn || currentOverall == null || boundaries?.decisionPick == null) return [];
    return buildNextPickPreview(
      playersById,
      adp,
      effectivePicks,
      currentOverall,
      boundaries.decisionPick,
      10,
    );
    // picksSignature stands in for effectivePicks so no-op poll snapshots keep this memo stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adp, boundaries?.decisionPick, currentOverall, isMyTurn, picksSignature, playersById]);

  // The picksSignature / onTheClock / boundaries memos that used to live here are computed once in
  // `App` (the full-bleed top bar's hero/countdown reads them too) and passed in as props — see
  // App's lift comments. This component never recomputes them.

  // Reset expansion (validated decisions) on board-mode, position, or user-decision-point changes.
  // Opponent picks alone never change `boundaries.decisionPick` (it only advances once the user
  // actually makes their own selection), so they leave pagination untouched.
  useEffect(() => {
    setVisibleCount(PAGE_SIZES[0]);
  }, [boardMode, displayPosition, boundaries?.decisionPick, draftInit?.draftId]);

  // Distinguish "still loading projections" from "draft/user picks are done" so the empty state
  // does not falsely claim the board is waiting on a snapshot after the last pick lands.
  const baseBoardState = useMemo(() => {
    if (!draftInit || !players.length || !projections.length) return { kind: 'loading' as const };
    if (draftInit.myTeamId == null) return { kind: 'no-seat' as const };
    if (!boundaries) return { kind: 'loading' as const };
    if (boundaries.decisionPick == null) {
      const totalPicks = draftInit.teams * draftInit.rounds;
      return effectivePicks.length >= totalPicks && totalPicks > 0
        ? { kind: 'complete' as const }
        : { kind: 'no-user-picks' as const };
    }
    if (!isMyTurn) return { kind: 'waiting' as const };
    const currentPick = currentOverall ?? effectivePicks.length + 1;
    return {
      kind: 'ready' as const,
      currentPick,
      board: buildRecommendationBoard({
        settings: draftInit.settings, players, projections, adp, picks: effectivePicks, myTeamId: draftInit.myTeamId,
        nextPick: boundaries.followUpPick, currentPick, limit: visibleCount,
        rolloutDisplayLimit: ROLLOUT_DISPLAY_LIMIT, displayPosition,
        rosterSpotsPerTeam: draftInit.rounds, draftRounds: draftInit.rounds, availabilityByPlayer,
      }),
    };
    // picksSignature stands in for `effectivePicks` here — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adp, availabilityByPlayer, boundaries, currentOverall, displayPosition, draftInit, isMyTurn, picksSignature, players, projections, visibleCount]);

  const workerStaticData = useMemo<RecommendationWorkerStaticData>(() => ({
    players,
    projections,
    adp,
    availabilityEntries: [...availabilityByPlayer.entries()],
  }), [adp, availabilityByPlayer, players, projections]);

  const workerInput = useMemo<RecommendationWorkerDynamicInput | null>(() => {
    if (baseBoardState.kind !== 'ready' || !draftInit || draftInit.myTeamId == null || !boundaries) return null;
    return {
      settings: draftInit.settings,
      picks: effectivePicks,
      myTeamId: draftInit.myTeamId,
      nextPick: boundaries.followUpPick,
      currentPick: baseBoardState.currentPick,
      limit: visibleCount,
      rolloutDisplayLimit: ROLLOUT_DISPLAY_LIMIT,
      simulationCandidateLimit: SIMULATION_CANDIDATE_LIMIT,
      displayPosition,
      rosterSpotsPerTeam: draftInit.rounds,
      draftRounds: draftInit.rounds,
      simulation: {
        draftId: draftInit.draftId,
        draftType: draftInit.draftType,
        teams: draftInit.teams,
        rounds: draftInit.rounds,
        slotToTeam: draftInit.slotToTeam,
        decisionPick: boundaries.decisionPick as number,
        followUpPick: boundaries.followUpPick,
        secondFollowUpPick: boundaries.secondFollowUpPick,
        executionMode: {
          mode: 'budgeted',
          scenarios: DEFAULT_SCENARIOS,
          timeBudgetMs: ROLLOUT_TIME_BUDGET_MS,
          batchSize: 1,
        },
      },
    };
    // picksSignature stands in for effectivePicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseBoardState, boundaries, displayPosition, draftInit, picksSignature, visibleCount]);

  const refinementKey = [
    draftInit?.draftId ?? '',
    picksSignature,
    boundaries?.decisionPick ?? '',
    boundaries?.followUpPick ?? '',
    displayPosition ?? '',
    visibleCount,
  ].join('|');
  const refinement = useRecommendationRefinement({
    enabled: workerInput != null && displayPosition !== 'K' && displayPosition !== 'DEF',
    requestKey: refinementKey,
    staticData: workerStaticData,
    input: workerInput,
  });

  const baseBoard = baseBoardState.kind === 'ready' ? baseBoardState.board : null;
  const board = refinement.result ?? baseBoard;
  // Clock math is independent of recommendation-board readiness. Gating on `boardState.currentPick`
  // hid "N until your turn" (and left DraftLog's you-up chip empty) while players/projections load.
  const recommendations = board?.recommendations ?? [];
  const diagnostics = board?.diagnostics ?? null;
  const specialTeams = diagnostics?.specialTeamsDraft ?? null;
  const specialTeamsRemaining = specialTeams ? specialTeams.remaining.K + specialTeams.remaining.DEF : 0;
  const selectedPlayer = selectedPlayerId ? playersById.get(selectedPlayerId) : undefined;
  const draftSeason = manifest != null ? Number(manifest.season) : null;
  const validDraftSeason = Number.isFinite(draftSeason) ? draftSeason : null;
  const weeklyStats = useWeeklyStats(selectedPlayerId, validDraftSeason);
  // Board-wide (not gated on a player detail view): K/DEF's card-face "Avg fpts" tile needs an
  // actual average across every card, not just whichever player is currently selected.
  const boardWeeklyStats = useBoardWeeklyStats(validDraftSeason);
  const avgPointsPerGameByPlayer = useMemo(() => {
    const map = new Map<PlayerId, number>();
    const artifact = boardWeeklyStats.artifact;
    if (boardWeeklyStats.status !== 'ready' || artifact == null) return map;
    for (const player of players) {
      if (player.position !== 'K' && player.position !== 'DEF') continue;
      const avg = pointsPerGame(buildSparklinePoints(artifact, player.playerId));
      if (avg != null) map.set(player.playerId, avg);
    }
    return map;
  }, [boardWeeklyStats, players]);
  // ADP-mode cards can select a player with no engine recommendation at all —
  // player details must still open for them, just without an engine tab.
  const selectedRecommendation = selectedPlayerId
    ? recommendations.find((r) => r.playerId === selectedPlayerId)
      ?? board?.marketRecommendations.find((r) => r.playerId === selectedPlayerId)?.recommendation
      ?? undefined
    : undefined;

  // ADP/market board: league-wide order filtered locally to the active position tab, preserving
  // each row's league-wide `rank` (validated decisions: "position filtering applies after the same
  // league-wide market ordering").
  const marketRows: MarketRecommendation[] = useMemo(() => {
    const all = board?.marketRecommendations ?? [];
    return displayPosition == null
      ? all
      : all.filter((row) => playersById.get(row.playerId)?.position === displayPosition);
  }, [board, displayPosition, playersById]);
  const visibleMarketRows = marketRows.slice(0, visibleCount);
  const hasMoreRows = boardMode === 'adp'
    ? marketRows.length > visibleCount
    : board?.hasMoreRecommendations ?? false;
  const nextPageSize = PAGE_SIZES.find((size) => size > visibleCount);
  const filmstripResetKey = [
    boardMode,
    displayPosition ?? '',
    boundaries?.decisionPick ?? '',
    draftInit?.draftId ?? '',
  ].join('|');

  // `adp_active_<format>` always names whichever upstream actually produced the committed board
  // that day (see pipeline/build_data.py's per-format fallback) — reading it, not `ffc_adp_<format>`
  // directly, is what keeps this disclosure from silently mislabeling a fallback day as "Sleeper."
  const activeAdpSource = manifest?.sources[`adp_active_${adpFormat}`];
  const ffcAdpSource = manifest?.sources[`ffc_adp_${adpFormat}`];
  const adpDisclosure: AdpDisclosure | null = activeAdpSource == null
    ? null
    : activeAdpSource.activeAdpSource === 'ffc-fallback'
      ? {
          source: 'ffc-fallback',
          mockDrafts: ffcAdpSource?.population?.mockDrafts ?? null,
          teams: ffcAdpSource?.population?.teams ?? 12,
          format: ffcAdpSource?.population?.format ?? adpFormat,
        }
      : { source: 'sleeper', format: adpFormat };

  const handleCorrectPick = (overall: number) => {
    // Close any open drawer first so Escape/focus traps do not stack with the correction dialog.
    setOpenDrawer(null);
    onCorrectPick(overall);
  };

  const handleViewDetails = (playerId: PlayerId) => {
    setOpenDrawer({ kind: 'player', playerId });
  };

  const handleOpenRailDrawer = (kind: 'log' | 'team') => {
    setOpenDrawer({ kind });
  };

  const draftLog = draftInit && (
    <DraftLog
      draftInit={draftInit}
      effectivePicks={effectivePicks}
      playersById={playersById}
      onTheClock={onTheClock}
      onCorrectPick={handleCorrectPick}
      onViewPlayer={handleViewDetails}
      userNextOverall={boundaries?.decisionPick ?? null}
      picksUntilUserTurn={picksUntilUserTurn}
    />
  );

  const myTeam = draftInit && (
    <MyTeamRail
      settings={draftInit.settings}
      effectivePicks={effectivePicks}
      myTeamId={draftInit.myTeamId}
      playersById={playersById}
      projections={projections}
      rounds={draftInit.rounds}
      onViewPlayer={handleViewDetails}
    />
  );

  const source = manifest?.sources.fftoday_projections;
  const scoringUnavailable = draftInit != null && Object.keys(draftInit.settings.scoring).length === 0;

  return (
    <>
      <div className="draft-workspace" data-narrow={isNarrow || undefined}>
      {!isNarrow && <div className="workspace-column workspace-column-log">{draftLog}</div>}

      <div className="workspace-column workspace-column-center">
        <section className="recommendation-panel">
          {draftInit && (
            <BoardFilters
              boardMode={boardMode}
              onBoardModeChange={setBoardMode}
              positionTabs={POSITION_TABS}
              displayPosition={displayPosition}
              onDisplayPositionChange={setDisplayPosition}
            />
          )}

          {isNarrow && (
            <div className="workspace-drawer-toggles">
              <button className="quiet-button" type="button" onClick={() => handleOpenRailDrawer('log')}>Draft log</button>
              <button className="quiet-button" type="button" onClick={() => handleOpenRailDrawer('team')}>My team</button>
            </div>
          )}

          {!draftInit ? null : !source || source.status !== 'ok' || loadError || scoringUnavailable ? (
            <p>{loadError ?? (scoringUnavailable
              ? 'This mock has custom or unknown scoring, which Sleeper does not expose through its draft payload. Live tracking remains active, but recommendations are unavailable.'
              : 'FFToday projections are unavailable or stale. Live draft tracking remains active; recommendations fall back to ADP/manual review.')}</p>
          ) : (
            <>
              {!isMyTurn && boundaries?.decisionPick != null && (
                <NextPickPreview nextPick={boundaries.decisionPick} rows={nextPickPreview} />
              )}
              {isMyTurn && refinement.status === 'refining' && (
                <p className='recommendation-refinement-status' role='status'>Refining rollout analysis...</p>
              )}
              {isMyTurn && refinement.status === 'refinement-error' && (
                <p className='recommendation-refinement-status' role='status'>
                  Rollout refinement unavailable. Deterministic recommendations remain active.
                </p>
              )}
              {diagnostics != null && diagnostics.unmatchedPickCount > 0 && (
                <p className="warning-banner" role="alert">
                  {diagnostics.unmatchedPickCount} drafted pick{diagnostics.unmatchedPickCount === 1 ? '' : 's'} (overall {diagnostics.unmatchedPickOveralls.join(', ')}) couldn't be matched to a player —
                  someone recommended below may already be gone. Use "Fix" in the draft log to correct it.
                </p>
              )}
              {diagnostics != null && diagnostics.coreStartingSlotsFilled && specialTeams != null && specialTeamsRemaining > 0
                && specialTeams.remainingPicks != null && specialTeams.impossibleToFill && (
                <p className="warning-banner" role="alert">
                  Only {specialTeams.remainingPicks} selection{specialTeams.remainingPicks === 1 ? '' : 's'} remain for {specialTeamsRemaining} unfilled K/DEF slots. Overdue D/ST slots stay ahead of kicker.
                </p>
              )}

              {baseBoardState.kind === 'waiting' ? null : (boardMode === 'engine' ? recommendations.length === 0 : visibleMarketRows.length === 0) ? (
                <p>
                  {baseBoardState.kind === 'loading'
                    ? 'Waiting for a validated projection snapshot.'
                    : baseBoardState.kind === 'complete'
                      ? 'The draft is complete.'
                      : baseBoardState.kind === 'no-seat'
                        ? 'Your seat was not found in this draft. Reconnect with the Sleeper account that owns a roster slot.'
                        : baseBoardState.kind === 'no-user-picks'
                          ? 'No remaining picks for your team.'
                          : displayPosition == null
                            ? 'No remaining projected players on the board.'
                            : `No remaining projected ${displayPosition === 'DEF' ? 'D/ST' : displayPosition} players.`}
                </p>
              ) : (
                <>
                  <BoardFilmstrip
                    itemCount={boardMode === 'engine' ? recommendations.length : visibleMarketRows.length}
                    cardsPerPage={cardsPerPage}
                    canLoadMore={hasMoreRows}
                    onLoadMore={() => {
                      if (nextPageSize != null) setVisibleCount(nextPageSize);
                    }}
                    id="recommendation-cards"
                    label="Recommendation players"
                    resetKey={filmstripResetKey}
                  >
                    {boardMode === 'engine'
                      ? recommendations.map((recommendation) => (
                          <PlayerCard
                            key={recommendation.playerId}
                            playerId={recommendation.playerId}
                            recommendation={recommendation}
                            player={playersById.get(recommendation.playerId)}
                            rank={recommendation.rank}
                            adpBoard={adp}
                            usage={usage[recommendation.playerId]}
                            depthRole={depthRoleByPlayer.get(recommendation.playerId) ?? null}
                            avgPointsPerGame={avgPointsPerGameByPlayer.get(recommendation.playerId) ?? null}
                            fantasyPros={fantasyProsFor(recommendation.playerId) ?? undefined}
                            onViewDetails={() => handleViewDetails(recommendation.playerId)}
                          />
                        ))
                      : visibleMarketRows.map((row) => (
                          <PlayerCard
                            key={row.playerId}
                            playerId={row.playerId}
                            recommendation={row.recommendation}
                            player={playersById.get(row.playerId)}
                            rank={row.rank}
                            adp={row.adp}
                            adpBoard={adp}
                            usage={usage[row.playerId]}
                            depthRole={depthRoleByPlayer.get(row.playerId) ?? null}
                            avgPointsPerGame={avgPointsPerGameByPlayer.get(row.playerId) ?? null}
                            fantasyPros={fantasyProsFor(row.playerId) ?? undefined}
                            onViewDetails={() => handleViewDetails(row.playerId)}
                          />
                        ))}
                  </BoardFilmstrip>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {!isNarrow && <div className="workspace-column workspace-column-team">{myTeam}</div>}

      {isNarrow && (
        <>
          <Drawer open={openDrawer?.kind === 'log'} label="Draft log" onClose={() => setOpenDrawer(null)}>{draftLog}</Drawer>
          <Drawer open={openDrawer?.kind === 'team'} label="My team" onClose={() => setOpenDrawer(null)}>{myTeam}</Drawer>
        </>
      )}

      {selectedPlayer && (
        <PlayerDetailDrawer
          player={selectedPlayer}
          usage={usage[selectedPlayer.playerId]}
          feedStatus={contextFeedStatus}
          recommendation={selectedRecommendation}
          adpDisclosure={adpDisclosure}
          currentPick={currentOverall}
          weeklyStats={weeklyStats}
          adpProvidersArtifact={adpProvidersArtifact}
          providerProjectionsArtifact={providerProjectionsArtifact}
          settings={draftInit?.settings ?? null}
          depthRole={selectedPlayerId ? depthRoleByPlayer.get(selectedPlayerId) ?? null : null}
          onClose={() => setOpenDrawer(null)}
        />
      )}
      </div>
    </>
  );
}
