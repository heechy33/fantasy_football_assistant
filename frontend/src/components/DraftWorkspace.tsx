import { useCallback, useMemo, useState } from 'react';
import type { DataManifest, DraftInit, OnTheClock, Pick, PlayerId } from '../../../shared/types';
import type { UserPickBoundaries } from '../adapters/draftOrder';
import { picksMade, roundPickLabel } from '../adapters/draftOrder';
import { resolvePlayerContextFeedStatus } from '../data/playerContext';
import { adpBoardKeyFor } from '../data/adpBoard';
import { buildTeamDepthRoles } from '../data/teamDepthRole';
import type { AdpFormat } from '../data/loadPlayerPool';
import { usePlayerBoardData } from '../hooks/usePlayerBoardData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Drawer } from './Drawer';
import { DraftLog } from './DraftLog';
import type { ActiveProvider } from '../session/activeProvider';
import { MyTeamRail } from './MyTeamRail';
import { RecommendationBoard, type RecommendationBoardKind } from './RecommendationBoard';
import type { SessionAction } from './SessionMenu';

type OpenDrawer =
  | { kind: 'log' }
  | { kind: 'team' }
  | { kind: 'player'; playerId: PlayerId }
  | null;

export interface DraftWorkspaceProps {
  draftInit: DraftInit | null;
  effectivePicks: Pick[];
  manifest: DataManifest | null;
  adpFormat: AdpFormat;
  /** Which provider owns the session — selects the ADP board (`'espn-ppr'` only for ESPN PPR
   * sessions; Sleeper connected and Sleeper-manual sessions stay on the plain format board). */
  activeProvider: ActiveProvider;
  /** Clock memos computed once in `App` â€” never recomputed here (see App's lift comments). The
   * signature is what stops the board rebuild on a no-op poll tick; `onTheClock`/`boundaries` are
   * what the board, pagination-reset, DraftLog you-up chip, and PlayerDetailDrawer all read. */
  picksSignature: string;
  onTheClock: OnTheClock | null;
  boundaries: UserPickBoundaries | null;
  /** Click-to-log handler (2026-09-01). The parent (`App`) owns this — it has the `useDraftSession`
   * hook, so it can call `board.applyOverride` with the snake-order `manualTargetInfo`. Provided
   * for manual/Yahoo sessions and any future from-scratch provider; `undefined` for live
   * Sleeper/ESPN-bridge sessions (those handle picks through the live layer instead). */
  onDraftPlayer?: (playerId: PlayerId) => void;
  /** Row-level "Edit pick" handler for the DraftLog (the existing modal path). The parent owns
   * the `setCorrecting` state in `useDraftSession` — same pattern as `onDraftPlayer`. */
  onCorrectPick?: (overall: number) => void;
  /** Session-management actions (log a pick, edit setup, switch modes, reconnect, choose another
   * draft) rendered in the board's `⋯` menu, next to the card/row presentation toggle. */
  sessionActions?: ReadonlyArray<SessionAction>;
}

/**
 * Replaces the old stacked `DraftBoard` + `RecommendationPanel` in the connected session with a
 * three-column workspace: draft log, MUT-style recommendation cards with BoardFilters above the
 * filmstrip, and an optimized My Team rail. Polling, effective-pick state, and manual mode are all
 * owned by `App` and passed straight through â€” this component only presents them.
 *
 * Recommendation refinement lives in `RecommendationBoard` so Stage C patches cannot reconcile
 * the log or My Team rail.
 */
export function DraftWorkspace({
  draftInit,
  effectivePicks,
  manifest,
  adpFormat,
  activeProvider,
  picksSignature,
  onTheClock,
  boundaries,
  onDraftPlayer,
  onCorrectPick,
  sessionActions = [],
}: DraftWorkspaceProps) {
  const adpBoardKey = useMemo(() => adpBoardKeyFor(activeProvider, adpFormat), [activeProvider, adpFormat]);
  const {
    players, playersById, projections, adp, usage, usageLoadStatus, loadError, resolvedAdpKey,
    providerProjectionsArtifact = null,
  } = usePlayerBoardData(adpBoardKey, adpFormat);
  const availabilityByPlayer = useMemo(() => {
    const map = new Map<PlayerId, number>();
    for (const [playerId, playerUsage] of Object.entries(usage)) {
      if (playerUsage.availabilityRate != null) map.set(playerId, playerUsage.availabilityRate);
    }
    return map;
  }, [usage]);

  const contextFeedStatus = resolvePlayerContextFeedStatus(manifest?.sources, usageLoadStatus);
  const contextSignalsReady = contextFeedStatus === 'ready';
  const depthRoleByPlayer = useMemo(
    () => buildTeamDepthRoles(players, contextSignalsReady ? usage : {}),
    [players, contextSignalsReady, usage],
  );
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);
  const selectedPlayerId = openDrawer?.kind === 'player' ? openDrawer.playerId : null;

  const isMyTurn = draftInit?.myTeamId != null && onTheClock?.teamId === draftInit.myTeamId;
  const currentOverall = onTheClock?.overall ?? (draftInit ? picksMade(effectivePicks) + 1 : null);
  const picksUntilUserTurn = boundaries?.decisionPick != null && currentOverall != null
    ? Math.max(0, boundaries.decisionPick - currentOverall)
    : null;
  const roundPick = draftInit && currentOverall != null
    ? roundPickLabel(draftInit.teams, currentOverall)
    : null;

  const boardKind = useMemo<RecommendationBoardKind>(() => {
    if (!draftInit || !players.length || !projections.length) return 'loading';
    if (draftInit.myTeamId == null) return 'no-seat';
    if (!boundaries) return 'loading';
    if (boundaries.decisionPick == null) {
      const totalPicks = draftInit.teams * draftInit.rounds;
      return picksMade(effectivePicks) >= totalPicks && totalPicks > 0 ? 'complete' : 'no-user-picks';
    }
    if (!isMyTurn) return 'waiting';
    return 'ready';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaries, currentOverall, draftInit, isMyTurn, picksSignature, players.length, projections.length]);

  const handleViewDetails = useCallback((playerId: PlayerId) => {
    setOpenDrawer({ kind: 'player', playerId });
  }, []);

  const handleOpenRailDrawer = useCallback((kind: 'log' | 'team') => {
    setOpenDrawer({ kind });
  }, []);

  const handleClosePlayer = useCallback(() => {
    setOpenDrawer(null);
  }, []);

  const draftLog = draftInit && (
    <DraftLog
      draftInit={draftInit}
      effectivePicks={effectivePicks}
      playersById={playersById}
      onTheClock={onTheClock}
      onViewPlayer={handleViewDetails}
      onCorrect={onCorrectPick}
      userNextOverall={boundaries?.decisionPick ?? null}
      picksUntilUserTurn={picksUntilUserTurn}
      roundPick={roundPick}
    />
  );

  const myTeam = draftInit && (
    <MyTeamRail
      settings={draftInit.settings}
      effectivePicks={effectivePicks}
      myTeamId={draftInit.myTeamId}
      playersById={playersById}
      projections={projections}
      onViewPlayer={handleViewDetails}
    />
  );

  return (
    <>
      <div className="draft-workspace" data-narrow={isNarrow || undefined}>
      {!isNarrow && <div className="workspace-column workspace-column-log">{draftLog}</div>}

      <div className="workspace-column workspace-column-center">
        {draftInit ? (
          <RecommendationBoard
            draftInit={draftInit}
            effectivePicks={effectivePicks}
            picksSignature={picksSignature}
            onTheClock={onTheClock}
            boundaries={boundaries}
            adpFormat={adpFormat}
            adpBoardKey={adpBoardKey}
            resolvedAdpKey={resolvedAdpKey}
            manifest={manifest}
            players={players}
            playersById={playersById}
            projections={projections}
            adp={adp}
            usage={usage}
            loadError={loadError}
            providerProjectionsArtifact={providerProjectionsArtifact}
            depthRoleByPlayer={depthRoleByPlayer}
            availabilityByPlayer={availabilityByPlayer}
            contextFeedStatus={contextFeedStatus}
            isMyTurn={isMyTurn}
            currentOverall={currentOverall}
            boardKind={boardKind}
            selectedPlayerId={selectedPlayerId}
            onViewDetails={handleViewDetails}
            onClosePlayer={handleClosePlayer}
            onOpenRailDrawer={handleOpenRailDrawer}
            onDraftPlayer={onDraftPlayer}
            sessionActions={sessionActions}
          />
        ) : null}
      </div>

      {!isNarrow && <div className="workspace-column workspace-column-team">{myTeam}</div>}

      {isNarrow && (
        <>
          <Drawer open={openDrawer?.kind === 'log'} label="Draft log" onClose={() => setOpenDrawer(null)}>{draftLog}</Drawer>
          <Drawer open={openDrawer?.kind === 'team'} label="My team" onClose={() => setOpenDrawer(null)}>{myTeam}</Drawer>
        </>
      )}
      </div>
    </>
  );
}
