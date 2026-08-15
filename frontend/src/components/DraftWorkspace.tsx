import { useCallback, useMemo, useState } from 'react';
import type { DataManifest, DraftInit, OnTheClock, Pick, PlayerId } from '../../../shared/types';
import type { UserPickBoundaries } from '../adapters/draftOrder';
import { resolvePlayerContextFeedStatus } from '../data/playerContext';
import { buildTeamDepthRoles } from '../data/teamDepthRole';
import type { AdpFormat } from '../data/loadPlayerPool';
import { usePlayerBoardData } from '../hooks/usePlayerBoardData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Drawer } from './Drawer';
import { DraftLog } from './DraftLog';
import { MyTeamRail } from './MyTeamRail';
import { RecommendationBoard, type RecommendationBoardKind } from './RecommendationBoard';

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
  /** Clock memos computed once in `App` â€” never recomputed here (see App's lift comments). The
   * signature is what stops the board rebuild on a no-op poll tick; `onTheClock`/`boundaries` are
   * what the board, pagination-reset, DraftLog you-up chip, and PlayerDetailDrawer all read. */
  picksSignature: string;
  /** Id of the poll response that produced this effective-pick snapshot; dev timing only. */
  timingPollId?: number | null;
  onTheClock: OnTheClock | null;
  boundaries: UserPickBoundaries | null;
  /** Row-level "Edit pick" trigger threaded to the draft log (manual correction/takeover). */
  onCorrect?: (overall: number) => void;
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
  picksSignature,
  timingPollId = null,
  onTheClock,
  boundaries,
  onCorrect,
}: DraftWorkspaceProps) {
  const {
    players, playersById, projections, adp, usage, usageLoadStatus, loadError,
    fantasyProsArtifact = null,
    adpProvidersArtifact = null,
    providerProjectionsArtifact = null,
  } = usePlayerBoardData(adpFormat);
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
  const currentOverall = onTheClock?.overall ?? (draftInit ? effectivePicks.length + 1 : null);
  const picksUntilUserTurn = boundaries?.decisionPick != null && currentOverall != null
    ? Math.max(0, boundaries.decisionPick - currentOverall)
    : null;

  const boardKind = useMemo<RecommendationBoardKind>(() => {
    if (!draftInit || !players.length || !projections.length) return 'loading';
    if (draftInit.myTeamId == null) return 'no-seat';
    if (!boundaries) return 'loading';
    if (boundaries.decisionPick == null) {
      const totalPicks = draftInit.teams * draftInit.rounds;
      return effectivePicks.length >= totalPicks && totalPicks > 0 ? 'complete' : 'no-user-picks';
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
      timingPollId={timingPollId}
      playersById={playersById}
      onTheClock={onTheClock}
      onViewPlayer={handleViewDetails}
      onCorrect={onCorrect}
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
            timingPollId={timingPollId}
            onTheClock={onTheClock}
            boundaries={boundaries}
            adpFormat={adpFormat}
            manifest={manifest}
            players={players}
            playersById={playersById}
            projections={projections}
            adp={adp}
            usage={usage}
            loadError={loadError}
            fantasyProsArtifact={fantasyProsArtifact}
            adpProvidersArtifact={adpProvidersArtifact}
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
