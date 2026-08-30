import { useEffect, useMemo, useState } from 'react';
import type {
  AdpEntry,
  DataManifest,
  DraftInit,
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
import { picksMade } from '../adapters/draftOrder';
import type { AdpBoardKey } from '../data/adpBoard';
import { buildCardRoleStatsIndex } from '../data/cardRoleStats';
import type { AdpFormat } from '../data/loadPlayerPool';
import type { NextUpInfo } from './NextUpChip';
import { pointsPerGame } from '../data/pprProduction';
import { buildSparklinePoints } from '../data/weeklyGameLog';
import type { TeamDepthRole } from '../data/teamDepthRole';
import { buildMarketRecommendations, buildRecommendationBoard, DEFAULT_SCENARIOS, type MarketRecommendation, type Recommendation, type RecommendationInput, type RecommendationResult } from '../engine/recommend';
import type { RecommendationWorkerDynamicInput } from '../engine/recommendationWorkerProtocol';
import { estimateAvailability } from '../engine/availability';
import { scoreProjection } from '../engine/scoring';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useRecommendationRefinement } from '../hooks/useRecommendationRefinement';
import { useBoardWeeklyStats, useWeeklyStats } from '../hooks/useWeeklyStats';
import { useUnderdogAdp } from '../hooks/useUnderdogAdp';
import { useProviderAdpBoards } from '../hooks/useProviderAdpBoards';
import { BoardFilters, type BoardMode, type BoardPresentation } from './BoardFilters';
import { BoardFilmstrip } from './BoardFilmstrip';
import { BoardRows } from './BoardRows';
import { PlayerBoardRow } from './PlayerBoardRow';
import { PlayerCard } from './PlayerCard';
import { PlayerDetailDrawer, type AdpDisclosure, type PlayerContextFeedStatus } from './PlayerDetailDrawer';
import type { SessionAction } from './SessionMenu';

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

/**
 * Draft-state decoration for the card face: the next-best player at the same position on the rows
 * this board is about to render. In engine mode that's engine order; in market mode it's ADP
 * order — either way "next up" means the next card the user scrolls past at this position.
 * Pure display computed from the already-rendered rows; never a ranking term.
 */
function nextUpAt(
  rows: ReadonlyArray<{ playerId: PlayerId; recommendation?: Recommendation | null }>,
  index: number,
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
): NextUpInfo | null {
  const current = rows[index];
  if (!current) return null;
  const position = playersById.get(current.playerId)?.position ?? null;
  if (position == null) return null;
  for (let j = index + 1; j < rows.length; j += 1) {
    const candidate = rows[j]!;
    if (playersById.get(candidate.playerId)?.position !== position) continue;
    const name = playersById.get(candidate.playerId)?.name;
    if (name == null) return null;
    const mine = current.recommendation?.projectedPoints ?? null;
    const theirs = candidate.recommendation?.projectedPoints ?? null;
    return {
      name,
      position,
      gap: mine != null && theirs != null ? Math.max(0, mine - theirs) : null,
      tierBoundaryGap: current.recommendation?.tierBoundaryGap ?? 0,
      nearTie: current.recommendation?.nearTie ?? false,
    };
  }
  return null;
}

export type RecommendationBoardKind = 'loading' | 'ready' | 'waiting' | 'complete' | 'no-seat' | 'no-user-picks';

export interface RecommendationBoardProps {
  draftInit: DraftInit;
  effectivePicks: Pick[];
  picksSignature: string;
  onTheClock: OnTheClock | null;
  boundaries: UserPickBoundaries | null;
  adpFormat: AdpFormat;
  /** The requested ADP board for this session — forwarded to the worker's init so it loads the
   * same board the main thread does (`'espn-ppr'` only for ESPN PPR sessions). */
  adpBoardKey: AdpBoardKey;
  /** Which board actually loaded after `fetchAdpBoard`'s fail-open fallback. Drives the ADP
   * disclosure: `'espn-ppr'` emits the ESPN variant; a fallback to the format board keeps the
   * honest Sleeper/FFC label (never-switch-sources-silently). */
  resolvedAdpKey: AdpBoardKey;
  manifest: DataManifest | null;
  players: PlayerMeta[];
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  projections: SeasonProjection[];
  adp: AdpEntry[];
  usage: PlayerUsageArtifact;
  loadError: string | null;
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
  /** Session-management actions, rendered in the board's `⋯` menu next to the card/row toggle. */
  sessionActions?: ReadonlyArray<SessionAction>;
}

export function RecommendationBoard({
  draftInit,
  effectivePicks,
  picksSignature,
  boundaries,
  adpFormat,
  adpBoardKey,
  resolvedAdpKey,
  manifest,
  players,
  playersById,
  projections,
  adp,
  usage,
  loadError,
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
  sessionActions = [],
}: RecommendationBoardProps) {
  const [displayPosition, setDisplayPosition] = useState<Position | null>(null);
  // "All" excludes K/D-ST *except when their reserved late-draft window arrives* — see the
  // `specialTeamsDuePositions` note at the filtered lists below. Non-due K/D-ST stay reachable
  // via their own tabs, whose rows (already correctly scoped by the engine/ADP source) are left
  // untouched by this exclusion.
  const isSpecialTeamsPosition = (position: Position | null | undefined) => position === 'K' || position === 'DEF';
  // Display-only, same shape as the K/D-ST exclusion above: once the one-QB starting slot(s) are
  // filled, a backup QB is bad redraft advice (bench a bye, don't roster one) even though the
  // engine still prices it as a small real asset (eligibility.ts's benchDepthValue). This does not
  // touch buildRecommendationBoard — the QB tab still lists QBs, and a manual QB pick still works.
  // The SUPER_FLEX guard is belt-and-braces: adapters/sleeper.ts derives format.qb from SUPER_FLEX
  // presence, so the two should never disagree, but startingSlots is the authoritative source.
  const qbSlotsFilled = useMemo(() => {
    const { settings, myTeamId } = draftInit;
    if (settings.format.qb !== 'one-qb' || settings.startingSlots.includes('SUPER_FLEX') || myTeamId == null) {
      return false;
    }
    const qbSlotsNeeded = settings.startingSlots.filter((slot) => slot === 'QB').length;
    if (qbSlotsNeeded === 0) return false;
    const myQbCount = effectivePicks.filter((pick) =>
      pick.teamId === myTeamId && pick.playerId != null && playersById.get(pick.playerId)?.position === 'QB').length;
    return myQbCount >= qbSlotsNeeded;
  }, [draftInit, effectivePicks, playersById]);
  const [boardMode, setBoardMode] = useState<BoardMode>('engine');
  const [boardPresentation, setBoardPresentation] = useState<BoardPresentation>('cards');
  const [cardsVisibleCount, setCardsVisibleCount] = useState<number>(PAGE_SIZES[0]);
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const effectivePresentation: BoardPresentation = isNarrow ? 'cards' : boardPresentation;
  const effectiveBoardMode: BoardMode = isMyTurn ? boardMode : 'adp';
  const cardsPerPage = isNarrow ? 1 : 3;

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
      currentPick: currentOverall ?? picksMade(effectivePicks) + 1,
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
    adpBoardKey,
    adpFormat,
    input: workerInput,
  });

  // Main-thread fallback: the worker is the primary path, but a worker error currently leaves the
  // board permanently blank (`refinement-error` returns `result: null` and nothing else computes).
  // When that happens on the clock, compute the legacy full deterministic board synchronously here
  // (market rows + position expansion included, Stage C omitted) so the user is never left with an
  // empty panel. Stage C's Monte Carlo rollout is deliberately NOT run on the UI thread (that
  // freeze is why the worker exists); the deterministic pass alone (~0.3-0.6s) is the "slower,
  // never blank" fallback.
  const [fallbackBoard, setFallbackBoard] = useState<{
    status: 'idle' | 'computing' | 'done' | 'error';
    requestKey: string | null;
    result: RecommendationResult | null;
  }>({ status: 'idle', requestKey: null, result: null });

  // A new request (a new pick or board snapshot) invalidates any fallback result — never let a
  // stale fallback board from a previous pick show for the current one.
  useEffect(() => {
    setFallbackBoard((current) =>
      current.status === 'idle' && current.requestKey === refinementKey
        ? current
        : { status: 'idle', requestKey: null, result: null },
    );
  }, [refinementKey]);

  useEffect(() => {
    if (refinement.status !== 'refinement-error') return;
    if (refinement.result != null || workerInput == null) return;
    // Only one compute per request; a completed result for this key stays put (the reset effect
    // above clears it when the request changes). While 'computing', re-running this effect on a
    // workerInput/availability change simply reschedules the same compute with fresh closures.
    if (fallbackBoard.status === 'done' || fallbackBoard.status === 'error') {
      if (fallbackBoard.requestKey === refinementKey) return;
    }
    setFallbackBoard({ status: 'computing', requestKey: refinementKey, result: null });
    const timer = setTimeout(() => {
      try {
        // `workerInput` is the RecommendationInput minus the static pool, and ships availability
        // as `availabilityEntries` pairs (a Map is not structured-clonable). Reconstruct the full
        // input here with the main-thread pool. The `include*` flags default to the legacy
        // non-worker behavior (market rows + position expansion on), which is the richest board
        // the sync overload can produce. `simulation` is deliberately omitted: the sync overload
        // otherwise runs Stage C synchronously (its no-options path calls `runSimulation`) —
        // exactly the UI-thread freeze this fallback must not cause.
        const input: RecommendationInput = {
          settings: workerInput.settings,
          picks: workerInput.picks,
          myTeamId: workerInput.myTeamId,
          nextPick: workerInput.nextPick,
          currentPick: workerInput.currentPick,
          limit: workerInput.limit,
          rolloutDisplayLimit: workerInput.rolloutDisplayLimit,
          simulationCandidateLimit: workerInput.simulationCandidateLimit,
          displayPosition: workerInput.displayPosition,
          rosterSpotsPerTeam: workerInput.rosterSpotsPerTeam,
          draftRounds: workerInput.draftRounds,
          players,
          projections,
          adp,
          availabilityByPlayer,
        };
        const result = buildRecommendationBoard(input);
        setFallbackBoard({ status: 'done', requestKey: refinementKey, result });
      } catch {
        setFallbackBoard({ status: 'error', requestKey: refinementKey, result: null });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [adp, availabilityByPlayer, fallbackBoard.requestKey, fallbackBoard.status, players, projections, refinement.result, refinement.status, refinementKey, workerInput]);

  const board = refinement.result ?? (fallbackBoard.requestKey === refinementKey ? fallbackBoard.result : null);
  const allRecommendations = board?.recommendations ?? [];
  const viewKey = displayPosition ?? 'ALL';
  const diagnostics = board?.diagnostics ?? null;
  const specialTeams = diagnostics?.specialTeamsDraft ?? null;
  // Late-draft gate: D/ST is due at the penultimate selection and kicker at the final one
  // (engine's special-teams schedule). When a position is due, its rows surface on "All" —
  // the engine already sorts them to the top of its own ordering — instead of hiding behind
  // their position tab exactly when the user must draft them.
  const specialTeamsDuePositions = useMemo(
    () => new Set(specialTeams?.due ?? []),
    [specialTeams],
  );
  const visibleOnAllBoard = (position: Position | null | undefined): boolean => {
    if (position == null) return true; // unmatched player — never silently dropped
    if (qbSlotsFilled && position === 'QB') return false;
    if (!isSpecialTeamsPosition(position)) return true;
    return specialTeamsDuePositions.has(position);
  };
  const rankedRecommendationsForView = board?.recommendationViews?.[viewKey]
    ?? (displayPosition == null
      ? allRecommendations
      : allRecommendations.filter((row) => playersById.get(row.playerId)?.position === displayPosition));
  // Applied only to "All" — resolved above from either source (the worker's precomputed `ALL`
  // view, or the main-thread filter fallback) — so the K/QB/RB/... tabs' own rows pass through
  // untouched regardless of which one served this render.
  const rankedRecommendations = displayPosition == null
    ? rankedRecommendationsForView.filter((row) => visibleOnAllBoard(playersById.get(row.playerId)?.position))
    : rankedRecommendationsForView;
  const cardRecommendations = rankedRecommendations.slice(0, cardsVisibleCount);
  const specialTeamsRemaining = specialTeams ? specialTeams.remaining.K + specialTeams.remaining.DEF : 0;
  const selectedPlayer = selectedPlayerId ? playersById.get(selectedPlayerId) : undefined;
  const draftSeason = manifest != null ? Number(manifest.season) : null;
  const validDraftSeason = Number.isFinite(draftSeason) ? draftSeason : null;
  const weeklyStats = useWeeklyStats(selectedPlayerId, validDraftSeason);
  const boardWeeklyStats = useBoardWeeklyStats(validDraftSeason);
  const underdogAdp = useUnderdogAdp();
  const providerAdpLanes = useProviderAdpBoards(adpFormat);
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

  // Per-card role-page stats for the card-bottom slot (see cardRoleStats.ts / PlayerCard's slot
  // rule): RB/WR/TE from the usage artifact already in memory, QB from the weekly game log's
  // STACKED percentile view, K/DEF from their weekly series. Computed once here — not inside
  // each memoized PlayerCard — so a board redraw never recomputes cohort percentiles per card.
  const roleStatsByPlayer = useMemo(() => {
    const weeklyArtifact = boardWeeklyStats.status === 'ready' ? boardWeeklyStats.artifact : null;
    return buildCardRoleStatsIndex({ players, usage, weeklyArtifact });
  }, [boardWeeklyStats, players, usage]);

  // Off-clock (and manually-toggled ADP mode) fallback for Proj: `buildMarketRecommendations`
  // attaches `recommendation: null` to any player the worker hasn't scored, which is every player
  // whenever `boardKind !== 'ready'`. Projected points are pick-invariant, so they're cheap to
  // score directly here — same approach as MyTeamRail.tsx's roster-points memo — rather than
  // requiring the worker to be running just to show a number that doesn't depend on the clock.
  const projectedPointsByPlayer = useMemo(() => {
    const map = new Map<PlayerId, number>();
    for (const projection of projections) {
      const player = playersById.get(projection.playerId);
      map.set(projection.playerId, scoreProjection(projection, draftInit.settings, player?.position).points);
    }
    return map;
  }, [projections, playersById, draftInit.settings]);

  // Exact next-pick survival percentage renders ONLY while the user is on the clock — then
  // `nextPick` is the *following* turn (followUpPick), because the current turn is already
  // being decided right now. Off the clock the map stays empty: cards fall through to the
  // profile line, and the rows' Avail cell reads em dash. Rationale: the mid-band estimate is
  // experimental (see benchmarks/reports/2026-08-10-availability-calibration.md's calibration
  // caveat) and showing it everywhere crowded out recent form on every card.
  const marketAvailabilityByPlayer = useMemo(() => {
    const map = new Map<PlayerId, number>();
    if (!isMyTurn) return map;
    const nextPick = boundaries?.followUpPick;
    const currentPick = currentOverall ?? picksMade(effectivePicks) + 1;
    if (nextPick == null) return map;
    for (const entry of adp) {
      if (entry.playerId == null) continue;
      const estimate = estimateAvailability(entry, { currentPick, nextPick });
      if (estimate != null) map.set(entry.playerId, estimate.probability);
    }
    return map;
  }, [adp, isMyTurn, boundaries, currentOverall, effectivePicks]);

  const drafted = useMemo(() => {
    const ids = new Set<PlayerId>();
    for (const pick of effectivePicks) {
      if (pick.playerId != null) ids.add(pick.playerId);
    }
    return ids;
  }, [effectivePicks]);
  // Per-player ADP provenance for the honest face/drawer label. The ESPN board is
  // a mixed source (native ESPN head + Sleeper-tail splice), so the source must be
  // read off each player's own board entry — never a board-wide badge.
  const adpSourceByPlayer = useMemo(() => {
    const map = new Map<PlayerId, (typeof adp)[number]['adpSource']>();
    for (const entry of adp) {
      if (entry.playerId != null && !map.has(entry.playerId)) map.set(entry.playerId, entry.adpSource);
    }
    return map;
  }, [adp]);
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
      : buildMarketRecommendations({
          adp,
          currentPick: currentOverall ?? picksMade(effectivePicks) + 1,
          drafted,
          evaluatedById,
          scoredIds,
        });
    return displayPosition == null
      ? all.filter((row) => visibleOnAllBoard(playersById.get(row.playerId)?.position))
      : all.filter((row) => playersById.get(row.playerId)?.position === displayPosition);
  }, [adp, board, currentOverall, displayPosition, drafted, picksMade(effectivePicks), evaluatedById, playersById, qbSlotsFilled, scoredIds, specialTeamsDuePositions]);
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

  const activeAdpSource = manifest?.sources[resolvedAdpKey === 'espn-ppr' ? 'adp_active_espn_ppr' : `adp_active_${adpFormat}`];
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
      : activeAdpSource.activeAdpSource === 'espn'
        ? { source: 'espn', format: adpFormat }
        : { source: 'sleeper', format: adpFormat };

  const source = manifest?.sources.fftoday_projections;
  const scoringUnavailable = Object.keys(draftInit.settings.scoring).length === 0;
  const showSkeleton = boardKind === 'ready' && board == null && refinement.status !== 'refinement-error';

  return (
    <>
      <section className="recommendation-panel">
        <div className="section-heading">
          <h2 className="section-title-accent">Recommendations</h2>
        </div>
        <BoardFilters
          boardMode={effectiveBoardMode}
          onBoardModeChange={setBoardMode}
          modeEnabled={isMyTurn}
          positionTabs={POSITION_TABS}
          displayPosition={displayPosition}
          onDisplayPositionChange={setDisplayPosition}
          boardPresentation={boardPresentation}
          onBoardPresentationChange={setBoardPresentation}
          presentationToggleVisible={!isNarrow}
          sessionActions={sessionActions}
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
                Updating recommendations for pick {currentOverall ?? picksMade(effectivePicks) + 1}...
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
            ) : board == null && refinement.status === 'refinement-error' ? (
              <p className="recommendation-refinement-status" role="status">
                {fallbackBoard.status === 'computing'
                  ? `Computing recommendations on the main thread for pick ${currentOverall ?? picksMade(effectivePicks) + 1}...`
                  : 'Recommendations are temporarily unavailable. Live draft tracking remains active.'}
              </p>
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
                      ? rankedRecommendations.map((recommendation, index) => (
                          <PlayerBoardRow
                            key={recommendation.playerId}
                            playerId={recommendation.playerId}
                            recommendation={recommendation}
                            player={playersById.get(recommendation.playerId)}
                            adpBoard={adp}
                            adpSource={adpSourceByPlayer.get(recommendation.playerId) ?? null}
                            usage={usage[recommendation.playerId]}
                            depthRole={depthRoleByPlayer.get(recommendation.playerId) ?? null}
                            avgPointsPerGame={avgPointsPerGameByPlayer.get(recommendation.playerId) ?? null}
                            projectedPoints={projectedPointsByPlayer.get(recommendation.playerId) ?? null}
                            availableNextPickProbability={marketAvailabilityByPlayer.get(recommendation.playerId) ?? null}
                            availabilityVisible={isMyTurn}
                            currentPick={currentOverall}
                            nextUp={nextUpAt(rankedRecommendations.map((r) => ({ playerId: r.playerId, recommendation: r })), index, playersById)}
                            selected={selectedPlayerId === recommendation.playerId}
                            onViewDetails={() => onViewDetails(recommendation.playerId)}
                          />
                        ))
                      : marketRows.map((row, index) => (
                          <PlayerBoardRow
                            key={row.playerId}
                            playerId={row.playerId}
                            recommendation={row.recommendation}
                            player={playersById.get(row.playerId)}
                            adp={row.adp}
                            adpBoard={adp}
                            adpSource={adpSourceByPlayer.get(row.playerId) ?? null}
                            usage={usage[row.playerId]}
                            depthRole={depthRoleByPlayer.get(row.playerId) ?? null}
                            avgPointsPerGame={avgPointsPerGameByPlayer.get(row.playerId) ?? null}
                            projectedPoints={projectedPointsByPlayer.get(row.playerId) ?? null}
                            availableNextPickProbability={marketAvailabilityByPlayer.get(row.playerId) ?? null}
                            availabilityVisible={isMyTurn}
                            currentPick={currentOverall}
                            nextUp={nextUpAt(marketRows, index, playersById)}
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
                      ? cardRecommendations.map((recommendation, index) => (
                          <PlayerCard
                            key={recommendation.playerId}
                            playerId={recommendation.playerId}
                            recommendation={recommendation}
                            player={playersById.get(recommendation.playerId)}
                            adpBoard={adp}
                            adpSource={adpSourceByPlayer.get(recommendation.playerId) ?? null}
                            usage={usage[recommendation.playerId]}
                            depthRole={depthRoleByPlayer.get(recommendation.playerId) ?? null}
                            avgPointsPerGame={avgPointsPerGameByPlayer.get(recommendation.playerId) ?? null}
                            roleStats={roleStatsByPlayer.get(recommendation.playerId) ?? null}
                            projectedPoints={projectedPointsByPlayer.get(recommendation.playerId) ?? null}
                            availableNextPickProbability={marketAvailabilityByPlayer.get(recommendation.playerId) ?? null}
                            availabilityVisible={isMyTurn}
                            currentPick={currentOverall}
                            nextUp={nextUpAt(cardRecommendations.map((r) => ({ playerId: r.playerId, recommendation: r })), index, playersById)}
                            onViewDetails={() => onViewDetails(recommendation.playerId)}
                          />
                        ))
                      : visibleMarketRows.map((row, index) => (
                          <PlayerCard
                            key={row.playerId}
                            playerId={row.playerId}
                            recommendation={row.recommendation}
                            player={playersById.get(row.playerId)}
                            adp={row.adp}
                            adpBoard={adp}
                            adpSource={adpSourceByPlayer.get(row.playerId) ?? null}
                            usage={usage[row.playerId]}
                            depthRole={depthRoleByPlayer.get(row.playerId) ?? null}
                            avgPointsPerGame={avgPointsPerGameByPlayer.get(row.playerId) ?? null}
                            roleStats={roleStatsByPlayer.get(row.playerId) ?? null}
                            projectedPoints={projectedPointsByPlayer.get(row.playerId) ?? null}
                            availableNextPickProbability={marketAvailabilityByPlayer.get(row.playerId) ?? null}
                            availabilityVisible={isMyTurn}
                            currentPick={currentOverall}
                            nextUp={nextUpAt(visibleMarketRows, index, playersById)}
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
          usageArtifact={usage}
          players={players}
          feedStatus={contextFeedStatus}
          recommendation={selectedRecommendation}
          fallbackProjectedPoints={selectedPlayerId ? projectedPointsByPlayer.get(selectedPlayerId) ?? null : null}
          adpDisclosure={adpDisclosure}
          weeklyStats={weeklyStats}
          adpBoard={adp}
          underdogAdp={underdogAdp.entries}
          providerAdpLanes={providerAdpLanes.filter((lane) => lane.status === 'ready')}
          providerProjectionsArtifact={providerProjectionsArtifact}
          settings={draftInit.settings}
          depthRole={selectedPlayerId ? depthRoleByPlayer.get(selectedPlayerId) ?? null : null}
          onClose={onClosePlayer}
        />
      )}
    </>
  );
}
