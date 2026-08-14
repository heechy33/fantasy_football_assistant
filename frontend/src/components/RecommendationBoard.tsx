import { useEffect, useMemo, useState } from 'react';
import type {
  AdpEntry,
  DataManifest,
  DraftInit,
  FantasyProsAdpArtifact,
  FantasyProsArtifact,
  OnTheClock,
  Pick,
  PlayerId,
  PlayerMeta,
  PlayerUsageArtifact,
  Position,
  ProviderProjectionsArtifact,
  SeasonProjection,
} from '../../../shared/types';
import type { UserPickBoundaries } from '../adapters/draftOrder';
import type { PlayerContextFeedStatus } from './PlayerContextBody';
import { fantasyProsStarsForPlayer } from '../data/fantasyProsStars';
import type { AdpFormat } from '../data/loadPlayerPool';
import { pointsPerGame } from '../data/pprProduction';
import { buildSparklinePoints } from '../data/weeklyGameLog';
import type { TeamDepthRole } from '../data/teamDepthRole';
import { buildMarketRecommendations, DEFAULT_SCENARIOS, type MarketRecommendation, type Recommendation } from '../engine/recommend';
import type { RecommendationWorkerDynamicInput } from '../engine/recommendationWorkerProtocol';
import { draftMeasureSync } from '../lib/perf';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useRecommendationRefinement } from '../hooks/useRecommendationRefinement';
import { useBoardWeeklyStats, useWeeklyStats } from '../hooks/useWeeklyStats';
import { BoardFilters, type BoardMode, type BoardPresentation } from './BoardFilters';
import { BoardFilmstrip } from './BoardFilmstrip';
import { BoardRows } from './BoardRows';
import { PlayerBoardRow } from './PlayerBoardRow';
import { PlayerCard } from './PlayerCard';
import { PlayerDetailDrawer } from './PlayerDetailDrawer';
import type { AdpDisclosure } from './PlayerContextBody';

const PAGE_SIZES = [6, 12, 18, 24] as const;
const MAX_RESULT_ROWS = PAGE_SIZES[PAGE_SIZES.length - 1];
const ROLLOUT_DISPLAY_LIMIT = 5;
const SIMULATION_CANDIDATE_LIMIT = 10;
const ROLLOUT_TIME_BUDGET_MS = 1500;

const POSITION_TABS: ReadonlyArray<{ label: string; position: Position | null }> = [
  { label: 'All', position: null },
  { label: 'QB', position: 'QB' },
  { label: 'RB', position: 'RB' },
  { label: 'WR', position: 'WR' },
  { label: 'TE', position: 'TE' },
  { label: 'K', position: 'K' },
  { label: 'D/ST', position: 'DEF' },
];

export type RecommendationBoardKind = 'loading' | 'ready' | 'waiting' | 'complete' | 'no-seat' | 'no-user-picks';

export interface RecommendationBoardProps {
  draftInit: DraftInit;
  effectivePicks: Pick[];
  picksSignature: string;
  /** Correlates worker receipt diagnostics with the poll that changed the board. */
  timingPollId?: number | null;
  onTheClock: OnTheClock | null;
  boundaries: UserPickBoundaries | null;
  adpFormat: AdpFormat;
  manifest: DataManifest | null;
  players: PlayerMeta[];
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  projections: SeasonProjection[];
  adp: AdpEntry[];
  usage: PlayerUsageArtifact;
  loadError: string | null;
  fantasyProsArtifact: FantasyProsArtifact | null;
  adpProvidersArtifact: FantasyProsAdpArtifact | null;
  providerProjectionsArtifact: ProviderProjectionsArtifact | null;
  depthRoleByPlayer: ReadonlyMap<PlayerId, TeamDepthRole>;
  availabilityByPlayer: ReadonlyMap<PlayerId, number>;
  contextFeedStatus: PlayerContextFeedStatus;
  isMyTurn: boolean;
  currentOverall: number | null;
  boardKind: RecommendationBoardKind;
  selectedPlayerId: PlayerId | null;
  onViewDetails: (playerId: PlayerId) => void;
  onClosePlayer: () => void;
  onOpenRailDrawer: (kind: 'log' | 'team') => void;
}

export function RecommendationBoard({
  draftInit,
  effectivePicks,
  picksSignature,
  timingPollId = null,
  boundaries,
  adpFormat,
  manifest,
  players,
  playersById,
  projections,
  adp,
  usage,
  loadError,
  fantasyProsArtifact,
  adpProvidersArtifact,
  providerProjectionsArtifact,
  depthRoleByPlayer,
  availabilityByPlayer,
  contextFeedStatus,
  isMyTurn,
  currentOverall,
  boardKind,
  selectedPlayerId,
  onViewDetails,
  onClosePlayer,
  onOpenRailDrawer,
}: RecommendationBoardProps) {
  const [displayPosition, setDisplayPosition] = useState<Position | null>(null);
  const [boardMode, setBoardMode] = useState<BoardMode>('engine');
  const [boardPresentation, setBoardPresentation] = useState<BoardPresentation>('cards');
  const [cardsVisibleCount, setCardsVisibleCount] = useState<number>(PAGE_SIZES[0]);
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const effectivePresentation: BoardPresentation = isNarrow ? 'cards' : boardPresentation;
  const effectiveBoardMode: BoardMode = isMyTurn ? boardMode : 'adp';
  const cardsPerPage = isNarrow ? 1 : 3;
  const fantasyProsFor = (playerId: PlayerId) => fantasyProsStarsForPlayer(fantasyProsArtifact, playerId);

  useEffect(() => {
    setCardsVisibleCount(PAGE_SIZES[0]);
  }, [effectiveBoardMode, displayPosition, boundaries?.decisionPick, draftInit.draftId]);

  const workerInput = useMemo<RecommendationWorkerDynamicInput | null>(() => {
    if (boardKind !== 'ready' || draftInit.myTeamId == null || !boundaries) return null;
    return {
      settings: draftInit.settings,
      picks: effectivePicks,
      myTeamId: draftInit.myTeamId,
      nextPick: boundaries.followUpPick,
      currentPick: currentOverall ?? effectivePicks.length + 1,
      limit: MAX_RESULT_ROWS,
      rolloutDisplayLimit: ROLLOUT_DISPLAY_LIMIT,
      simulationCandidateLimit: SIMULATION_CANDIDATE_LIMIT,
      displayPosition: null,
      includeRecommendationViews: false,
      includeMarketRecommendations: false,
      includeExpansion: false,
      rosterSpotsPerTeam: draftInit.rounds,
      draftRounds: draftInit.rounds,
      availabilityEntries: [...availabilityByPlayer.entries()],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityByPlayer, boardKind, boundaries, currentOverall, draftInit, picksSignature]);

  const refinementKey = [
    draftInit.draftId,
    picksSignature,
    boundaries?.decisionPick ?? '',
    boundaries?.followUpPick ?? '',
  ].join('|');
  const refinement = useRecommendationRefinement({
    enabled: workerInput != null,
    requestKey: refinementKey,
    adpFormat,
    input: workerInput,
    timingPollId,
  });

  const board = refinement.result;
  const allRecommendations = board?.recommendations ?? [];
  const viewKey = displayPosition ?? 'ALL';
  const rankedRecommendations = board?.recommendationViews?.[viewKey]
    ?? (displayPosition == null
      ? allRecommendations
      : allRecommendations.filter((row) => playersById.get(row.playerId)?.position === displayPosition));
  const cardRecommendations = rankedRecommendations.slice(0, cardsVisibleCount);
  const diagnostics = board?.diagnostics ?? null;
  const specialTeams = diagnostics?.specialTeamsDraft ?? null;
  const specialTeamsRemaining = specialTeams ? specialTeams.remaining.K + specialTeams.remaining.DEF : 0;
  const selectedPlayer = selectedPlayerId ? playersById.get(selectedPlayerId) : undefined;
  const draftSeason = manifest != null ? Number(manifest.season) : null;
  const validDraftSeason = Number.isFinite(draftSeason) ? draftSeason : null;
  const weeklyStats = useWeeklyStats(selectedPlayerId, validDraftSeason);
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

  const drafted = useMemo(() => {
    const ids = new Set<PlayerId>();
    for (const pick of effectivePicks) {
      if (pick.playerId != null) ids.add(pick.playerId);
    }
    return ids;
  }, [effectivePicks]);
  const scoredIds = useMemo(() => new Set(projections.map((row) => row.playerId)), [projections]);
  const evaluatedById = useMemo(() => {
    const map = new Map<PlayerId, Recommendation>();
    for (const row of allRecommendations) map.set(row.playerId, row);
    return map;
  }, [allRecommendations]);
  const marketRows: MarketRecommendation[] = useMemo(() => {
    const fromEngine = board?.marketRecommendations ?? [];
    const all = fromEngine.length > 0
      ? fromEngine
      // The worker deliberately ships no market board (cheap S2/stageC payload), so the ADP
      // ordering fallback runs here on the main thread. It is a bounded sort over ~700 ADP rows —
      // measured, not chased: this is not the freeze, but a dev log proves it stays small.
      : draftMeasureSync(
          'main-thread ADP ordering',
          () => buildMarketRecommendations({
            adp,
            currentPick: currentOverall ?? effectivePicks.length + 1,
            drafted,
            evaluatedById,
            scoredIds,
          }),
        );
    return displayPosition == null
      ? all
      : all.filter((row) => playersById.get(row.playerId)?.position === displayPosition);
  }, [adp, board, currentOverall, displayPosition, drafted, effectivePicks.length, evaluatedById, playersById, scoredIds]);
  const visibleMarketRows = marketRows.slice(0, cardsVisibleCount);
  const hasMoreCards = effectiveBoardMode === 'adp'
    ? marketRows.length > cardsVisibleCount
    : rankedRecommendations.length > cardsVisibleCount;
  const nextCardPageSize = PAGE_SIZES.find((size) => size > cardsVisibleCount);
  const filmstripResetKey = [
    effectiveBoardMode,
    displayPosition ?? '',
    boundaries?.decisionPick ?? '',
    draftInit.draftId,
  ].join('|');

  const selectedRecommendation = selectedPlayerId
    ? rankedRecommendations.find((r) => r.playerId === selectedPlayerId)
      ?? marketRows.find((r) => r.playerId === selectedPlayerId)?.recommendation
      ?? undefined
    : undefined;

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

  const source = manifest?.sources.fftoday_projections;
  const scoringUnavailable = Object.keys(draftInit.settings.scoring).length === 0;
  const showSkeleton = boardKind === 'ready' && board == null && refinement.status !== 'refinement-error';

  return (
    <>
      <section className="recommendation-panel">
        <BoardFilters
          boardMode={boardMode}
          onBoardModeChange={setBoardMode}
          modeToggleVisible={isMyTurn}
          positionTabs={POSITION_TABS}
          displayPosition={displayPosition}
          onDisplayPositionChange={setDisplayPosition}
          boardPresentation={boardPresentation}
          onBoardPresentationChange={setBoardPresentation}
          presentationToggleVisible={!isNarrow}
        />

        {isNarrow && (
          <div className="workspace-drawer-toggles">
            <button className="quiet-button" type="button" onClick={() => onOpenRailDrawer('log')}>Draft log</button>
            <button className="quiet-button" type="button" onClick={() => onOpenRailDrawer('team')}>My team</button>
          </div>
        )}

        {!source || source.status !== 'ok' || loadError || scoringUnavailable ? (
          <p>{loadError ?? (scoringUnavailable
            ? 'This mock has custom or unknown scoring, which Sleeper does not expose through its draft payload. Live tracking remains active, but recommendations are unavailable.'
            : 'FFToday projections are unavailable or stale. Live draft tracking remains active; recommendations fall back to ADP/manual review.')}</p>
        ) : (
          <>
            {isMyTurn && refinement.status !== 'refined' && refinement.status !== 'refinement-error' && (
              <p className="recommendation-refinement-status" role="status">
                Updating recommendations for pick {currentOverall ?? effectivePicks.length + 1}...
              </p>
            )}
            {isMyTurn && refinement.status === 'refinement-error' && (
              <p className="recommendation-refinement-status" role="status">
                Recommendations are temporarily unavailable. Live draft tracking remains active.
              </p>
            )}
            {diagnostics != null && diagnostics.unmatchedPickCount > 0 && (
              <p className="warning-banner" role="alert">
                {diagnostics.unmatchedPickCount} drafted pick{diagnostics.unmatchedPickCount === 1 ? '' : 's'} (overall {diagnostics.unmatchedPickOveralls.join(', ')}) couldn't be matched to a player —
                someone recommended below may already be gone.
              </p>
            )}
            {diagnostics != null && diagnostics.coreStartingSlotsFilled && specialTeams != null && specialTeamsRemaining > 0
              && specialTeams.remainingPicks != null && specialTeams.impossibleToFill && (
              <p className="warning-banner" role="alert">
                Only {specialTeams.remainingPicks} selection{specialTeams.remainingPicks === 1 ? '' : 's'} remain for {specialTeamsRemaining} unfilled K/DEF slots. Overdue D/ST slots stay ahead of kicker.
              </p>
            )}

            {showSkeleton ? (
              <div className="recommendation-loading-skeleton" aria-hidden={true}>
                <span />
                <span />
                <span />
              </div>
            ) : (effectiveBoardMode === 'engine' ? rankedRecommendations.length === 0 : marketRows.length === 0) ? (
              <p>
                {boardKind === 'loading'
                  ? 'Waiting for a validated projection snapshot.'
                  : boardKind === 'complete'
                    ? 'The draft is complete.'
                    : boardKind === 'no-seat'
                      ? 'Your seat was not found in this draft. Reconnect with the Sleeper account that owns a roster slot.'
                      : boardKind === 'no-user-picks'
                        ? 'No remaining picks for your team.'
                        : displayPosition == null
                          ? 'No remaining projected players on the board.'
                          : `No remaining projected ${displayPosition === 'DEF' ? 'D/ST' : displayPosition} players.`}
              </p>
            ) : (
              <>
                {effectivePresentation === 'rows' ? (
                  <BoardRows
                    itemCount={effectiveBoardMode === 'engine' ? rankedRecommendations.length : marketRows.length}
                    label="Recommendation players"
                  >
                    {effectiveBoardMode === 'engine'
                      ? rankedRecommendations.map((recommendation) => (
                          <PlayerBoardRow
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
                            selected={selectedPlayerId === recommendation.playerId}
                            onViewDetails={() => onViewDetails(recommendation.playerId)}
                          />
                        ))
                      : marketRows.map((row) => (
                          <PlayerBoardRow
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
                            selected={selectedPlayerId === row.playerId}
                            onViewDetails={() => onViewDetails(row.playerId)}
                          />
                        ))}
                  </BoardRows>
                ) : (
                  <BoardFilmstrip
                    itemCount={effectiveBoardMode === 'engine' ? cardRecommendations.length : visibleMarketRows.length}
                    cardsPerPage={cardsPerPage}
                    canLoadMore={hasMoreCards}
                    onLoadMore={() => {
                      if (nextCardPageSize != null) setCardsVisibleCount(nextCardPageSize);
                    }}
                    id="recommendation-board"
                    label="Recommendation players"
                    resetKey={filmstripResetKey}
                  >
                    {effectiveBoardMode === 'engine'
                      ? cardRecommendations.map((recommendation) => (
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
                            onViewDetails={() => onViewDetails(recommendation.playerId)}
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
                            onViewDetails={() => onViewDetails(row.playerId)}
                          />
                        ))}
                  </BoardFilmstrip>
                )}
              </>
            )}
          </>
        )}
      </section>

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
          settings={draftInit.settings}
          depthRole={selectedPlayerId ? depthRoleByPlayer.get(selectedPlayerId) ?? null : null}
          onClose={onClosePlayer}
        />
      )}
    </>
  );
}
