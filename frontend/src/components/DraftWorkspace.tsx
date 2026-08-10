import { useMemo, useState } from 'react';
import type { DataManifest, DraftInit, DraftStatus, Pick, Position } from '../../../shared/types';
import { computeOnTheClock, userPickBoundaries } from '../adapters/draftOrder';
import { buildPlayerContextSignals, resolvePlayerContextFeedStatus } from '../data/playerContext';
import type { AdpFormat } from '../data/loadPlayerPool';
import { buildRecommendationBoard } from '../engine/recommend';
import type { DraftPollPhase } from '../hooks/useDraftPoll';
import { usePlayerBoardData } from '../hooks/usePlayerBoardData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Drawer } from './Drawer';
import { DraftLog } from './DraftLog';
import { MyTeamRail } from './MyTeamRail';
import { PlayerContextModal, type AdpDisclosure } from './PlayerContextModal';
import { RecommendationCard } from './RecommendationCard';

export interface DraftWorkspaceProps {
  draftInit: DraftInit | null;
  effectivePicks: Pick[];
  status: DraftStatus | DraftPollPhase;
  isStale: boolean;
  dataAgeMs: number | null;
  onCorrectPick: (overall: number) => void;
  manifest: DataManifest | null;
  adpFormat: AdpFormat;
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
 * three-column workspace: draft log, five FIFA-style recommendation cards with position tabs, and
 * an optimized My Team rail. Polling, effective-pick state, and manual mode are all owned by `App`
 * and passed straight through — this component only presents them.
 */
export function DraftWorkspace({
  draftInit,
  effectivePicks,
  status,
  isStale,
  dataAgeMs,
  onCorrectPick,
  manifest,
  adpFormat,
}: DraftWorkspaceProps) {
  const { players, playersById, projections, adp, usage, usageLoadStatus, loadError } = usePlayerBoardData(adpFormat);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [displayPosition, setDisplayPosition] = useState<Position | null>(null);
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const [openDrawer, setOpenDrawer] = useState<'log' | 'team' | null>(null);

  // The live poll hands back a new `effectivePicks` array identity every ~2.5s even when nothing
  // changed (see useDraftPoll/draftBoardState), which would otherwise force a full engine rebuild
  // on every tick. This cheap signature lets the expensive memo below skip recompute when the
  // content didn't actually move, while still reading the current `effectivePicks` value once it does.
  const picksSignature = useMemo(
    () => effectivePicks.map((pick) => `${pick.overall}:${pick.playerId ?? '~'}`).join('|'),
    [effectivePicks],
  );

  // Computed from `effectivePicks` (not the raw `poll.draftPicks.onTheClock`) so it accounts for
  // manual corrections/additions to the live feed — the same source the engine board below reads,
  // and what `RecommendationPanel` computed before this component absorbed it.
  const onTheClock = useMemo(
    () => draftInit
      ? computeOnTheClock(draftInit.draftType, draftInit.teams, draftInit.rounds, effectivePicks.length, draftInit.slotToTeam)
      : null,
    // picksSignature stands in for `effectivePicks` here — see the memo below's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftInit, picksSignature],
  );

  // Distinguish "still loading projections" from "draft/user picks are done" so the empty state
  // does not falsely claim the board is waiting on a snapshot after the last pick lands.
  const boardState = useMemo(() => {
    if (!draftInit || !players.length || !projections.length) return { kind: 'loading' as const };
    // Availability's target pick is always "the next time it's my decision after the currently-
    // relevant one" — when I'm on the clock right now that's my *following* turn (followUpPick),
    // otherwise it's my very next turn (decisionPick). See draftOrder.ts's UserPickBoundaries doc.
    const boundaries = userPickBoundaries(
      draftInit.draftType, draftInit.teams, draftInit.rounds, effectivePicks.length, draftInit.slotToTeam, draftInit.myTeamId,
    );
    const nextPick = onTheClock?.teamId === draftInit.myTeamId ? boundaries.followUpPick : boundaries.decisionPick;
    if (nextPick == null) {
      const totalPicks = draftInit.teams * draftInit.rounds;
      return effectivePicks.length >= totalPicks && totalPicks > 0
        ? { kind: 'complete' as const }
        : { kind: 'no-user-picks' as const };
    }
    const currentPick = onTheClock?.overall ?? effectivePicks.length + 1;
    return {
      kind: 'ready' as const,
      board: buildRecommendationBoard({
        settings: draftInit.settings, players, projections, adp, picks: effectivePicks, myTeamId: draftInit.myTeamId,
        nextPick, currentPick, limit: 5, displayPosition,
        rosterSpotsPerTeam: draftInit.rounds, draftRounds: draftInit.rounds,
      }),
    };
    // picksSignature stands in for `effectivePicks` here — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adp, displayPosition, draftInit, picksSignature, onTheClock, players, projections]);

  const board = boardState.kind === 'ready' ? boardState.board : null;
  const recommendations = board?.recommendations ?? [];
  const diagnostics = board?.diagnostics ?? null;
  const specialTeams = diagnostics?.specialTeamsDraft ?? null;
  const specialTeamsRemaining = specialTeams ? specialTeams.remaining.K + specialTeams.remaining.DEF : 0;
  const contextFeedStatus = resolvePlayerContextFeedStatus(manifest?.sources, usageLoadStatus);
  const contextSignalsReady = contextFeedStatus === 'ready';
  const selectedPlayer = selectedPlayerId ? playersById.get(selectedPlayerId) : undefined;
  const selectedRecommendation = selectedPlayerId ? recommendations.find((r) => r.playerId === selectedPlayerId) : undefined;
  const nearTieActive = recommendations.some((r) => r.nearTieWithLeader);

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

  const draftLog = draftInit && (
    <DraftLog
      draftInit={draftInit}
      effectivePicks={effectivePicks}
      playersById={playersById}
      onTheClock={onTheClock}
      status={status}
      isStale={isStale}
      dataAgeMs={dataAgeMs}
      onCorrectPick={onCorrectPick}
    />
  );

  const myTeam = draftInit && (
    <MyTeamRail
      settings={draftInit.settings}
      effectivePicks={effectivePicks}
      myTeamId={draftInit.myTeamId}
      playersById={playersById}
      projections={projections}
    />
  );

  const source = manifest?.sources.fftoday_projections;
  const scoringUnavailable = draftInit != null && Object.keys(draftInit.settings.scoring).length === 0;

  return (
    <div className="draft-workspace" data-narrow={isNarrow || undefined}>
      {!isNarrow && <div className="workspace-column workspace-column-log">{draftLog}</div>}

      <div className="workspace-column workspace-column-center">
        <section className="recommendation-panel">
          <div className="section-heading">
            <div><p className="eyebrow">Recommendations</p><h2>Top deterministic values</h2></div>
            {source && <span>FFToday · updated {source.upstreamUpdatedAt ?? source.fetchedAt}</span>}
          </div>

          {isNarrow && (
            <div className="workspace-drawer-toggles">
              <button className="quiet-button" type="button" onClick={() => setOpenDrawer('log')}>Draft log</button>
              <button className="quiet-button" type="button" onClick={() => setOpenDrawer('team')}>My team</button>
            </div>
          )}

          {!draftInit ? null : !source || source.status !== 'ok' || loadError || scoringUnavailable ? (
            <p>{loadError ?? (scoringUnavailable
              ? 'This mock has custom or unknown scoring, which Sleeper does not expose through its draft payload. Live tracking remains active, but recommendations are unavailable.'
              : 'FFToday projections are unavailable or stale. Live draft tracking remains active; recommendations fall back to ADP/manual review.')}</p>
          ) : (
            <>
              <p className="warning-banner">Availability is context only and does not affect ordering. S3 will incorporate the cost of waiting.</p>
              <div className="position-tabs" role="tablist" aria-label="Recommendation position">
                {POSITION_TABS.map((tab) => (
                  <button
                    key={tab.label}
                    type="button"
                    role="tab"
                    aria-selected={displayPosition === tab.position}
                    className={displayPosition === tab.position ? 'active' : undefined}
                    onClick={() => setDisplayPosition(tab.position)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {diagnostics != null && diagnostics.unmatchedPickCount > 0 && (
                <p className="warning-banner" role="alert">
                  {diagnostics.unmatchedPickCount} drafted pick{diagnostics.unmatchedPickCount === 1 ? '' : 's'} (overall {diagnostics.unmatchedPickOveralls.join(', ')}) couldn't be matched to a player —
                  someone recommended below may already be gone. Use "Fix" in the draft log to correct it.
                </p>
              )}
              {diagnostics != null && diagnostics.positionalDemand.source !== 'adp' && (
                <p className="warning-banner">
                  {diagnostics.positionalDemand.source === 'adp-extrapolated'
                    ? 'Replacement levels are estimated from a shallow ADP board, extrapolated to the full roster universe.'
                    : 'Replacement levels use a default positional mix because usable ADP coverage was below 50% of the full roster universe.'}
                </p>
              )}
              {diagnostics != null && specialTeamsRemaining > 0 && !diagnostics.coreStartingSlotsFilled && (
                <p className="muted">Core QB/RB/WR/TE/FLEX starters stay ahead of K/DEF, even inside the late-draft window.</p>
              )}
              {diagnostics != null && diagnostics.coreStartingSlotsFilled && specialTeams != null && specialTeamsRemaining > 0 && specialTeams.remainingPicks != null && (
                <p className={specialTeams.impossibleToFill ? 'warning-banner' : 'muted'} role={specialTeams.impossibleToFill ? 'alert' : undefined}>
                  {specialTeams.impossibleToFill
                    ? `Only ${specialTeams.remainingPicks} selection${specialTeams.remainingPicks === 1 ? '' : 's'} remain for ${specialTeamsRemaining} unfilled K/DEF slots. Overdue D/ST slots stay ahead of kicker.`
                    : specialTeams.due.length > 0
                      ? `${specialTeams.due.map((position) => position === 'DEF' ? 'D/ST' : 'K').join(' and ')} ${specialTeams.due.length === 1 ? 'is' : 'are'} due under the late-draft plan.`
                      : specialTeams.remaining.DEF > 0 && specialTeams.remaining.K > 0
                        ? `Late-draft plan: reserve D/ST for the selection immediately before kicker, and kicker for your final team selection (${specialTeams.remainingPicks} picks remain).`
                        : specialTeams.remaining.K > 0
                          ? `Late-draft plan: reserve kicker for your final team selection (${specialTeams.remainingPicks} picks remain).`
                          : `Late-draft plan: reserve D/ST for your final team selection (${specialTeams.remainingPicks} picks remain).`}
                </p>
              )}
              {nearTieActive && (
                <p className="warning-banner">
                  Two or more of these cards are close enough that the heuristic projection model cannot justify a confident order between them.
                </p>
              )}

              {recommendations.length === 0 ? (
                <p>
                  {boardState.kind === 'loading'
                    ? 'Waiting for a validated projection snapshot.'
                    : boardState.kind === 'complete'
                      ? 'The draft is complete.'
                      : boardState.kind === 'no-user-picks'
                        ? 'No remaining picks for your team.'
                        : displayPosition == null
                          ? 'No remaining projected players on the board.'
                          : `No remaining projected ${displayPosition === 'DEF' ? 'D/ST' : displayPosition} players.`}
                </p>
              ) : (
                <div className="recommendation-cards">
                  {recommendations.map((recommendation) => {
                    const player = playersById.get(recommendation.playerId);
                    const contextSignals = player && contextSignalsReady ? buildPlayerContextSignals(player, usage[player.playerId]) : [];
                    return (
                      <RecommendationCard
                        key={recommendation.playerId}
                        recommendation={recommendation}
                        player={player}
                        contextSignals={contextSignals}
                        onViewDetails={() => setSelectedPlayerId(recommendation.playerId)}
                      />
                    );
                  })}
                </div>
              )}
              <p className="muted">Custom scoring is recomputed from normalized components. Replacement levels are modeled estimates of the last rosterable player at a position, not observed league truth. S2 values starter impact only, so bench depth is not yet priced. K/DEF timing is a late-draft strategy guardrail, and their custom-scoring values remain low-confidence even when due.</p>
            </>
          )}
        </section>
      </div>

      {!isNarrow && <div className="workspace-column workspace-column-team">{myTeam}</div>}

      {isNarrow && (
        <>
          <Drawer open={openDrawer === 'log'} label="Draft log" onClose={() => setOpenDrawer(null)}>{draftLog}</Drawer>
          <Drawer open={openDrawer === 'team'} label="My team" onClose={() => setOpenDrawer(null)}>{myTeam}</Drawer>
        </>
      )}

      {selectedPlayer && (
        <PlayerContextModal
          player={selectedPlayer}
          usage={usage[selectedPlayer.playerId]}
          feedStatus={contextFeedStatus}
          recommendation={selectedRecommendation}
          adpDisclosure={adpDisclosure}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}
