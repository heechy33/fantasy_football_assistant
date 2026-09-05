import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataHealth, type EspnCaptureSummary } from '../components/DataHealth';
import { DraftLauncher } from '../components/DraftLauncher';
import { DraftWorkspace } from '../components/DraftWorkspace';
import { MANUAL_SCORING_DIAGNOSTICS } from '../components/ManualDraftSetup';
import { SessionMenu } from '../components/SessionMenu';
import { requestEspnResetSnapshot } from '../adapters/espnBridge';
import { hasDetailIdentity } from '../adapters/espn';
import { mapProvider, sessionKindToMode, shouldSyncDraft } from '../state/draftSync';
import { useSavedLeagues } from '../data/useSavedLeagues';
import { useDraftSession } from '../session/DraftSessionProvider';

/** The live draft room — relocated verbatim from `App.tsx`'s `page === 'draft'` branch. The
 * disconnected state is the DraftLauncher (2026-08-27 connect/start split). */
export function DraftRoomRoute() {
  const navigate = useNavigate();
  const {
    session,
    manifest,
    board,
    poll,
    bridge,
    effectiveInit,
    adpFormat,
    activeProvider,
    picksSignature,
    onTheClock,
    boundaries,
    sessionActions,
    nextManualOverall,
    setCorrecting,
    setPastePicksOpen,
    handleChooseAnotherDraft,
    handleEndDraft,
    handleDraftPlayer,
    handleDraftIdpPlayer,
  } = useDraftSession();
  const { saveLeague, saveDraft } = useSavedLeagues();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * "Save to My Leagues" on the completion banner (2026-08-29 live-only redesign): the Draft Room
   * no longer creates a SavedLeague as a side effect of syncing (see draftSync.ts's `syncNow`), so
   * a finished draft that was never separately saved — a live-detected ESPN draft, a friend's
   * Sleeper league tracked by pasted draft id — would otherwise leave no record at all once the
   * tab closes. One click does the upsertLeague + upsertDraft that used to happen silently, mirrored
   * from draftSync.ts's own write shape (`mapProvider`/`sessionKindToMode` reused, not
   * reimplemented). Never offered for a Sleeper mock (`shouldSyncDraft` — nothing worth keeping)
   * or once a SavedLeague already exists for this session (`session.savedLeagueId`).
   */
  async function handleSaveToMyLeagues() {
    if (session.kind !== 'complete') return;
    const init = session.frozenInit;
    const provider = mapProvider(init.provider);
    setSaving(true);
    setSaveError(null);
    try {
      const league = await saveLeague({
        provider,
        providerLeagueId: init.leagueId,
        name: init.settings.name,
        teams: init.teams,
        rounds: init.rounds,
        mySlot: init.mySlot,
        settings: init.settings,
        latestDraftId: provider === 'sleeper' ? init.draftId : null,
      });
      await saveDraft({
        leagueId: league.id,
        provider,
        providerDraftId: init.draftId,
        mode: sessionKindToMode(session.from),
        frozenInit: init,
        overrides: [...board.state.overrides.values()],
        picks: provider === 'sleeper' ? undefined : board.effectivePicks,
        status: 'complete',
      });
      navigate(`/leagues/${league.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this league.');
    } finally {
      setSaving(false);
    }
  }
  const canSaveToMyLeagues = session.kind === 'complete'
    && session.savedLeagueId == null
    && shouldSyncDraft(mapProvider(session.provider), session.frozenInit.leagueId);

  // Bridge sessions only — a raw view of the extension's captured live stream (see DataHealth's
  // EspnCapturePanel doc). Read straight off `bridge.live`/`bridge.offset`, never re-derived, so it
  // can never disagree with what the board actually rendered from.
  const espnCapture: EspnCaptureSummary | null = session.kind === 'bridge'
    ? {
        leagueId: bridge.live?.leagueId ?? null,
        epoch: bridge.live?.epoch ?? 0,
        resetReason: bridge.live?.resetReason ?? null,
        streamPicks: bridge.live?.streamPicks.length ?? 0,
        detailPicks: bridge.live?.detailPicks?.length ?? 0,
        detailIdentified: bridge.live?.detailPicks?.filter(hasDetailIdentity).length ?? 0,
        domPicks: bridge.live?.domPicks?.length ?? 0,
        currentPickNumber: bridge.live?.currentPickNumber ?? null,
        offsetSource: bridge.offset?.source ?? null,
        offsetValue: bridge.offset?.offset ?? null,
        offsetConfirmed: bridge.offset?.confirmed ?? false,
        offsetReason: bridge.offset?.reason ?? null,
        onReset: () => void requestEspnResetSnapshot(),
      }
    : null;

  return (
    <>
      {session.kind === 'disconnected' && <DraftLauncher />}

      {session.kind === 'complete' && (
        <>
          {/* Explicit-exit banner (2026-08-28) — the draft is over, the poll/bridge already
              stopped on their own (see the completion effect in DraftSessionProvider), and the
              board below stays visible read-only for review. Deliberately NOT auto-navigation:
              the user leaves via one of these two buttons, never automatically. */}
          <div className="draft-complete-banner" role="status">
            <p>
              <strong>This draft is complete.</strong>
            </p>
            {saveError && <p role="alert">{saveError}</p>}
            <div className="draft-complete-banner-actions">
              {canSaveToMyLeagues && (
                <button type="button" className="quiet-button" disabled={saving} onClick={() => void handleSaveToMyLeagues()}>
                  {saving ? 'Saving…' : 'Save to My Leagues'}
                </button>
              )}
              {sessionActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={action.id === 'view-league' ? 'primary-button' : 'quiet-button'}
                  onClick={action.onSelect}
                  disabled={action.disabled}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
          {effectiveInit && (
            <DraftWorkspace
              draftInit={effectiveInit}
              effectivePicks={board.effectivePicks}
              manifest={manifest}
              adpFormat={adpFormat}
              activeProvider={activeProvider}
              picksSignature={picksSignature}
              onTheClock={onTheClock}
              boundaries={boundaries}
              sessionActions={sessionActions}
            />
          )}
        </>
      )}

      {session.kind === 'connected' && (
        <>
          {poll.phase === 'init-error' && (
            <section className="connection-error" role="alert">
              <h2>That draft could not be loaded</h2>
              <p>{poll.lastError instanceof Error ? poll.lastError.message : 'Unknown error'}.</p>
              <button type="button" onClick={handleChooseAnotherDraft}>Choose another draft</button>
            </section>
          )}
          {poll.phase !== 'init-error' && (
            <DraftWorkspace
              draftInit={poll.draftInit}
              effectivePicks={board.effectivePicks}
              manifest={manifest}
              adpFormat={adpFormat}
              activeProvider={activeProvider}
              picksSignature={picksSignature}
              onTheClock={onTheClock}
              boundaries={boundaries}
              sessionActions={sessionActions}
            />
          )}
        </>
      )}

      {(session.kind === 'manual' || session.kind === 'bridge') && (session.frozenInit ? (
        <DraftWorkspace
          draftInit={effectiveInit}
          effectivePicks={board.effectivePicks}
          manifest={manifest}
          adpFormat={adpFormat}
          activeProvider={activeProvider}
          picksSignature={picksSignature}
          onTheClock={onTheClock}
          boundaries={boundaries}
          // Click-to-log: only manual/bridge sessions get the affordance — `kind: 'connected'`
          // (live Sleeper) keeps picks flowing through the poll. Yahoo sessions sync via paste
          // or manual entry modals and deliberately omit the row-level Draft button.
          onDraftPlayer={effectiveInit?.provider === 'yahoo' ? undefined : handleDraftPlayer}
          onDraftIdpPlayer={handleDraftIdpPlayer}
          // Row-level "Edit pick" via the dormant DraftLog.onCorrect prop — opens the same
          // ManualPickCorrection modal the `⋯ → Log next pick` menu already uses.
          onCorrectPick={(overall) => setCorrecting({ mode: 'correct-existing', overall })}
          onPastePicks={() => setPastePicksOpen(true)}
          sessionActions={sessionActions}
        />
      ) : (
        <section className="manual-draft">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Offline mode</p>
              <h2>Manual draft log</h2>
            </div>
            <div className="board-toolbar-right">
              <button className="quiet-button" type="button" onClick={handleEndDraft}>Connect a draft</button>
              {sessionActions.length > 0 && <SessionMenu actions={sessionActions} />}
            </div>
          </div>
          {board.effectivePicks.length === 0 ? (
            <p>No picks logged yet. Open the ranked board to record the first pick.</p>
          ) : (
            <ol className="manual-picks">
              {board.effectivePicks.map((pick) => (
                <li key={pick.overall}>
                  <span>#{pick.overall}</span>
                  <span>{effectiveInit?.slotToTeamName?.[pick.slot] ?? pick.teamId ?? 'unknown team'}</span>
                  <strong>{pick.providerPlayerName ?? pick.playerId ?? 'unmatched'}</strong>
                  <button className="quiet-button" type="button" onClick={() => setCorrecting({ mode: 'correct-existing', overall: pick.overall })}>Edit</button>
                </li>
              ))}
            </ol>
          )}
          <button type="button" onClick={() => setCorrecting({ mode: 'add-manual', overall: nextManualOverall })}>Log next pick</button>
        </section>
      ))}

      {(session.kind === 'connected' || session.kind === 'manual' || session.kind === 'bridge') && (
        <DataHealth
          manifest={manifest}
          effectivePicks={board.effectivePicks}
          isStale={session.kind === 'connected' ? poll.isStale : (session.kind === 'bridge' ? bridge.isStale : false)}
          dataAgeMs={session.kind === 'connected' ? poll.dataAgeMs : (session.kind === 'bridge' ? bridge.dataAgeMs : null)}
          consecutiveFailures={session.kind === 'connected' ? poll.consecutiveFailures : 0}
          lastError={session.kind === 'connected' ? poll.lastError : (session.kind === 'bridge' ? bridge.pickError : null)}
          pollHealthRef={session.kind === 'connected' ? poll.healthRef : null}
          adpFormat={adpFormat}
          activeProvider={activeProvider}
          scoringDiagnostics={
            session.kind === 'manual' || (session.kind === 'bridge' && session.usesPresetSettings)
              ? MANUAL_SCORING_DIAGNOSTICS
              : undefined
          }
          espnCapture={espnCapture}
        />
      )}
    </>
  );
}
