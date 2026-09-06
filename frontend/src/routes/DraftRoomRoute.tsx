import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { DataHealth, type EspnCaptureSummary } from '../components/DataHealth';
import { DraftLauncher } from '../components/DraftLauncher';
import { DraftWorkspace } from '../components/DraftWorkspace';
import { MANUAL_SCORING_DIAGNOSTICS } from '../components/ManualDraftSetup';
import { SessionMenu, type SessionAction } from '../components/SessionMenu';
import { requestEspnResetSnapshot } from '../adapters/espnBridge';
import { hasDetailIdentity } from '../adapters/espn';
import { mapProvider, sessionKindToMode, shouldSyncDraft } from '../state/draftSync';
import { useSavedLeagues } from '../data/useSavedLeagues';
import { useDraftSession } from '../session/DraftSessionProvider';

/** The live draft room — relocated verbatim from `App.tsx`'s `page === 'draft'` branch. The
 * disconnected state is the DraftLauncher (2026-08-27 connect/start split). */
export function DraftRoomRoute() {
  const navigate = useNavigate();
  const { status: authStatus } = useAuth();
  const {
    session,
    savedLeagueId,
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
    reportSavedLeagueId,
  } = useDraftSession();
  const { leagues, saveLeague, saveDraft } = useSavedLeagues();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const matchingSavedLeague = effectiveInit != null
    ? leagues.find((l) => l.provider === mapProvider(effectiveInit.provider) && l.providerLeagueId === effectiveInit.leagueId)
    : undefined;

  useEffect(() => {
    if (matchingSavedLeague && savedLeagueId == null) {
      reportSavedLeagueId(matchingSavedLeague.id);
    }
  }, [matchingSavedLeague, savedLeagueId, reportSavedLeagueId]);

  const canSaveActiveToMyLeagues = (session.kind === 'connected' || session.kind === 'manual' || session.kind === 'bridge')
    && authStatus === 'signed-in'
    && savedLeagueId == null
    && matchingSavedLeague == null
    && effectiveInit != null
    && shouldSyncDraft(mapProvider(effectiveInit.provider), effectiveInit.leagueId);

  async function handleSaveActiveToMyLeagues() {
    if (!effectiveInit || session.kind === 'disconnected' || session.kind === 'complete') return;
    const provider = mapProvider(effectiveInit.provider);
    const providerUserId = session.kind === 'connected'
      ? session.cred.userId
      : (session.kind === 'manual' && session.reconnectCred ? session.reconnectCred.userId : undefined);
    setSaving(true);
    setSaveError(null);
    try {
      const league = await saveLeague({
        provider,
        providerLeagueId: effectiveInit.leagueId,
        name: effectiveInit.settings.name,
        teams: effectiveInit.teams,
        rounds: effectiveInit.rounds,
        mySlot: effectiveInit.mySlot,
        settings: effectiveInit.settings,
        latestDraftId: provider === 'sleeper' ? effectiveInit.draftId : null,
        providerUserId: providerUserId ?? null,
      });
      await saveDraft({
        leagueId: league.id,
        provider,
        providerDraftId: effectiveInit.draftId,
        mode: sessionKindToMode(session.kind),
        frozenInit: session.kind === 'manual' || session.kind === 'bridge' ? effectiveInit : null,
        overrides: [...board.state.overrides.values()],
        picks: provider === 'sleeper' ? undefined : board.effectivePicks,
        status: 'active',
      });
      reportSavedLeagueId(league.id);
      setSavedSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this league.');
    } finally {
      setSaving(false);
    }
  }

  const effectiveSessionActions: SessionAction[] = useMemo(() => {
    if (!canSaveActiveToMyLeagues) return sessionActions;
    const saveAction: SessionAction = {
      id: 'save-to-my-leagues',
      label: saving ? 'Saving to My Leagues…' : 'Save to My Leagues',
      onSelect: () => void handleSaveActiveToMyLeagues(),
      disabled: saving,
    };
    return [saveAction, ...sessionActions];
  }, [canSaveActiveToMyLeagues, saving, sessionActions, effectiveInit, session, board]);

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
      reportSavedLeagueId(league.id);
      navigate(`/leagues/${league.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this league.');
    } finally {
      setSaving(false);
    }
  }
  const canSaveToMyLeagues = session.kind === 'complete'
    && session.savedLeagueId == null
    && savedLeagueId == null
    && matchingSavedLeague == null
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

      {canSaveActiveToMyLeagues && !bannerDismissed && (
        <div className="draft-room-save-banner" role="status">
          <div className="draft-room-save-banner-text">
            <p>
              <strong>Save to My Leagues:</strong> Save this {activeProvider === 'sleeper' ? 'Sleeper' : activeProvider === 'espn' ? 'ESPN' : 'Yahoo'} league to your account so you can access it on your iPad and other devices.
            </p>
            {saveError && <p className="save-banner-error" role="alert">{saveError}</p>}
          </div>
          <div className="draft-room-save-banner-actions">
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() => void handleSaveActiveToMyLeagues()}
            >
              {saving ? 'Saving…' : 'Save to My Leagues'}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setBannerDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {savedSuccess && (
        <div className="draft-room-save-banner draft-room-save-banner-success" role="status">
          <p>
            ✓ <strong>Saved to My Leagues!</strong> This draft is now linked to your account and syncing across devices.
          </p>
          <button
            type="button"
            className="quiet-button"
            onClick={() => setSavedSuccess(false)}
          >
            Dismiss
          </button>
        </div>
      )}

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
              onCorrectPick={(overall) => {
                const existing = board.effectivePicks.some((p) => p.overall === overall);
                setCorrecting({ mode: existing ? 'correct-existing' : 'add-manual', overall });
              }}
              sessionActions={effectiveSessionActions}
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
          // Click-to-log: manual/bridge sessions get the affordance — `kind: 'connected'`
          // (live Sleeper) keeps picks flowing through the poll. Yahoo sessions omit the
          // row-level Draft button per RecommendationBoard's view-specific logic, but cards
          // retain the compact button for fast click-to-log drafting.
          onDraftPlayer={handleDraftPlayer}
          onDraftIdpPlayer={handleDraftIdpPlayer}
          // Row-level "Edit pick" via DraftLog.onCorrect — opens ManualPickCorrection modal to
          // edit/replace the drafted player or log a missing pick.
          onCorrectPick={(overall) => {
            const existing = board.effectivePicks.some((p) => p.overall === overall);
            setCorrecting({ mode: existing ? 'correct-existing' : 'add-manual', overall });
          }}
          onPastePicks={() => setPastePicksOpen(true)}
          sessionActions={effectiveSessionActions}
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
              {effectiveSessionActions.length > 0 && <SessionMenu actions={effectiveSessionActions} />}
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
