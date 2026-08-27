import { useNavigate } from 'react-router-dom';
import { DataHealth } from '../components/DataHealth';
import { DraftWorkspace } from '../components/DraftWorkspace';
import { MANUAL_SCORING_DIAGNOSTICS } from '../components/ManualDraftSetup';
import { SessionMenu } from '../components/SessionMenu';
import { useDraftSession } from '../session/DraftSessionProvider';

/** The live draft room — relocated verbatim from `App.tsx`'s `page === 'draft'` branch. */
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
    handleChooseAnotherDraft,
    handleReturnToConnect,
  } = useDraftSession();

  return (
    <>
      {session.kind === 'disconnected' && (
        <section className="draft-room-empty">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Draft Room</p>
              <h2>No active draft</h2>
            </div>
          </div>
          <p>Connect a league to track its draft live, or log one manually via ESPN setup.</p>
          <button type="button" onClick={() => navigate('/leagues')}>Go to My Leagues</button>
        </section>
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
              <button className="quiet-button" type="button" onClick={handleReturnToConnect}>Connect a draft</button>
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
          scoringDiagnostics={session.kind === 'manual' || session.kind === 'bridge' ? MANUAL_SCORING_DIAGNOSTICS : undefined}
        />
      )}
    </>
  );
}
