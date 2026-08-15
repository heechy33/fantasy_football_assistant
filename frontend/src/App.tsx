import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DataManifest, DraftInit, OnTheClock, Pick, PlayerId, SleeperCred } from '../../shared/types';
import { canonicalPicksSignature, computeOnTheClock, roundForOverall, roundPickLabel, slotForOverall, userPickBoundaries, type UserPickBoundaries } from './adapters/draftOrder';
import { sleeperAdapter } from './adapters/sleeper';
import { ConnectSleeper } from './components/ConnectSleeper';
import { DataHealth } from './components/DataHealth';
import { DraftWorkspace } from './components/DraftWorkspace';
import { MANUAL_SCORING_DIAGNOSTICS, ManualDraftSetup } from './components/ManualDraftSetup';
import { ManualPickCorrection } from './components/ManualPickCorrection';
import { TeamsPage } from './components/TeamsPage';
import { APP_NAME, TopNav, type AppPage } from './components/TopNav';
import { loadRankedPlayers, type AdpFormat, type RankedPlayer } from './data/loadPlayerPool';
import { useDraftBoardState } from './hooks/useDraftBoardState';
import { useDraftPoll } from './hooks/useDraftPoll';
import { useEspnBridge } from './hooks/useEspnBridge';
import { loadPersistedSession, savePersistedSession } from './state/persistence';
import './App.css';

type Session =
  | { kind: 'disconnected' }
  | { kind: 'connected'; cred: SleeperCred; draftId: string }
  | {
      kind: 'manual';
      /** DraftInit frozen at takeover so the workspace/clock keep working with no live layer. */
      frozenInit: DraftInit | null;
      /** The live session that was taken over, so "Reconnect" restores polling in one click. */
      reconnectCred: SleeperCred | null;
      reconnectDraftId: string | null;
    }
  | {
      kind: 'bridge';
      /** Settings come from the manual form; JOINED/TOKEN override mySlot via the bridge init. */
      frozenInit: DraftInit;
    };

interface Correcting {
  mode: 'correct-existing' | 'add-manual';
  overall: number;
}

const IDLE_CRED: SleeperCred = { provider: 'sleeper', userId: '' };
/** Stable empty live layer so the board hook's `effectivePicks` memo keeps its identity while no
 * draft is connected — a fresh `[]` every render would defeat the memo (and the clock memos that
 * depend on it). */
const EMPTY_PICKS: Pick[] = [];

function adpFormatForDraft(reception: string | undefined, qb: string | undefined): AdpFormat {
  if (qb === 'two-qb' || qb === 'superflex') return '2qb';
  if (reception === 'standard' || reception === 'half-ppr' || reception === 'ppr') return reception;
  return 'ppr';
}

export default function App() {
  const [session, setSession] = useState<Session>({ kind: 'disconnected' });
  const [page, setPage] = useState<AppPage>('home');
  const [manifest, setManifest] = useState<DataManifest | null>(null);
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([]);
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  /** Which manual setup dialog is open: 'create' (first setup) or 'edit' (correct mySlot mid-draft). */
  const [manualSetup, setManualSetup] = useState<'create' | 'edit' | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    fetch('/data/manifest.json')
      .then((res) => (res.ok ? (res.json() as Promise<DataManifest>) : null))
      .then(setManifest)
      .catch(() => setManifest(null));
  }, []);

  useEffect(() => {
    const persisted = loadPersistedSession();
    if (persisted) {
      for (const override of persisted.overrides) board.applyOverride(override);

      if (persisted.mode === 'manual') {
        board.setMode('manual');
        setSession({
          kind: 'manual',
          frozenInit: persisted.frozenInit,
          reconnectCred: persisted.userId ? { provider: 'sleeper', userId: persisted.userId } : null,
          reconnectDraftId: persisted.draftId,
        });
        setPage('draft');
      } else if (persisted.userId && persisted.draftId) {
        setSession({
          kind: 'connected',
          cred: { provider: 'sleeper', userId: persisted.userId },
          draftId: persisted.draftId,
        });
        setPage('draft');
      }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftId = session.kind === 'connected' ? session.draftId : null;
  const cred = session.kind === 'connected' ? session.cred : IDLE_CRED;
  const poll = useDraftPoll({ adapter: sleeperAdapter, cred, draftId });
  const bridge = useEspnBridge(session.kind === 'bridge' ? session.frozenInit : null);
  // Live picks flow straight from the poll into the effective draft state (merged with manual
  // overrides) — no effect-driven relay, so a changed poll renders the log/clock once, not twice.
  const board = useDraftBoardState(poll.draftPicks?.picks ?? EMPTY_PICKS, undefined, poll.lastChangedPollId);

  useEffect(() => {
    if (!hydrated) return;
    savePersistedSession({
      userId: session.kind === 'connected'
        ? session.cred.userId
        : (session.kind === 'manual' ? session.reconnectCred?.userId ?? null : null),
      draftId: session.kind === 'connected'
        ? session.draftId
        : (session.kind === 'manual' ? session.reconnectDraftId : null),
      mode: session.kind === 'manual' || session.kind === 'bridge' ? 'manual' : 'live',
      overrides: [...board.state.overrides.values()],
      frozenInit: session.kind === 'manual' || session.kind === 'bridge' ? session.frozenInit : null,
    });
  }, [hydrated, session, board.state.overrides]);

  // Manual takeover freezes the latest DraftInit into the manual session, so the workspace and
  // clock math keep working with no live poll. `effectiveInit` is the single source for that:
  // connected sessions read the poll's init, takeover sessions read the frozen copy, and bridge
  // sessions read the bridge-merged init (form settings + JOINED/TOKEN mySlot).
  const effectiveInit = session.kind === 'connected'
    ? poll.draftInit
    : (session.kind === 'bridge'
        ? bridge.init
        : (session.kind === 'manual' ? session.frozenInit : null));
  const adpFormat = adpFormatForDraft(effectiveInit?.settings.format.reception, effectiveInit?.settings.format.qb);

  // Clock math lifted up from DraftWorkspace so the full-bleed TopNav hero/countdown and the
  // workspace board agree on the same pick without recomputing. These are the expensive memos
  // that must NOT be duplicated in both places — DraftWorkspace receives them as props.
  const picksSignature = useMemo(
    () => canonicalPicksSignature(board.effectivePicks),
    [board.effectivePicks],
  );

  // Computed from `effectivePicks` (not the raw `poll.draftPicks.onTheClock`) so it accounts for
  // manual corrections/additions to the live feed — the same source the engine board reads.
  const onTheClock: OnTheClock | null = useMemo(
    () => effectiveInit
      ? computeOnTheClock(effectiveInit.draftType, effectiveInit.teams, effectiveInit.rounds, board.effectivePicks.length, effectiveInit.slotToTeam)
      : null,
    // picksSignature stands in for `effectivePicks` here — see the memo below's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveInit, picksSignature],
  );

  // Availability's target pick is always "the next time it's my decision after the currently-
  // relevant one" — when I'm on the clock right now that's my *following* turn (followUpPick),
  // otherwise it's my very next turn (decisionPick). See draftOrder.ts's UserPickBoundaries doc.
  // Computed independently of the board build so pagination-reset can depend on
  // `boundaries.decisionPick` without re-running the whole engine.
  const boundaries: UserPickBoundaries | null = useMemo(() => {
    if (!effectiveInit || effectiveInit.myTeamId == null) return null;
    return userPickBoundaries(
      effectiveInit.draftType, effectiveInit.teams, effectiveInit.rounds, board.effectivePicks.length,
      effectiveInit.slotToTeam, effectiveInit.myTeamId,
    );
    // picksSignature stands in for `effectivePicks` here — see comment on the memo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInit, picksSignature]);

  // Clock math is independent of recommendation-board readiness — the top-bar hero/countdown must
  // not hide while players/projections load.
  const currentOverall = onTheClock?.overall ?? (effectiveInit ? board.effectivePicks.length + 1 : null);
  const picksUntilUserTurn = boundaries?.decisionPick != null && currentOverall != null
    ? Math.max(0, boundaries.decisionPick - currentOverall)
    : null;
  const roundPick = effectiveInit && currentOverall != null
    ? roundPickLabel(effectiveInit.teams, currentOverall)
    : null;

  /** One honest status line for the bridge bar: extension missing, tab silent, or streaming. */
  const bridgeStatus = session.kind === 'bridge'
    ? (!bridge.extensionPresent
        ? 'ESPN extension not detected — install the unpacked extension and reload this page. Picks can still be logged manually.'
        : bridge.lastHeartbeatAt != null && Date.now() - bridge.lastHeartbeatAt > 10000
          ? 'ESPN draft tab is silent — keep it open. Picks can still be logged manually.'
          : `Streaming ${bridge.picks?.picks.length ?? 0} pick(s) from the ESPN tab${bridge.live?.mySlot != null ? ` — your slot is ${bridge.live.mySlot}` : ''}.`)
    : null;
  /** Extension missing or the socket silent >10s reads as a stale bridge in the health banner. */
  const bridgeStale = session.kind === 'bridge'
    ? !bridge.extensionPresent || (bridge.lastHeartbeatAt != null && Date.now() - bridge.lastHeartbeatAt > 10000)
    : false;

  useEffect(() => {
    let active = true;
    loadRankedPlayers(adpFormat)
      .then((players) => { if (active) setRankedPlayers(players); })
      .catch(() => { if (active) setRankedPlayers([]); });
    return () => { active = false; };
  }, [adpFormat]);

  function handleConnect(newCred: SleeperCred, newDraftId: string) {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'connected', cred: newCred, draftId: newDraftId });
    setPage('draft');
  }

  function handleManualMode() {
    setManualSetup('create');
  }

  /** Commit a fresh manual draft from the setup form — a brand-new draft, so the board resets. */
  function handleManualSetupSubmit(init: DraftInit) {
    board.reset('manual');
    setCorrecting(null);
    setSession({ kind: 'manual', frozenInit: init, reconnectCred: null, reconnectDraftId: null });
    setManualSetup(null);
    setPage('draft');
  }

  /** Re-target an existing manual session (e.g. mySlot after the ~6:00 PM order reveal) without
   * touching the board — picks are keyed by slot, so changing mySlot only re-targets *my* math. */
  function handleManualSetupEdit(init: DraftInit) {
    setSession((current) => (current.kind === 'manual' ? { ...current, frozenInit: init } : current));
    setManualSetup(null);
  }

  /** Upgrade a pure-manual session to the ESPN bridge (settings stay from the form; picks auto-type
   * as manual-entry overrides so refresh/correction/takeover all keep working). */
  function handleEspnBridgeConnect() {
    if (session.kind !== 'manual' || !session.frozenInit || session.reconnectCred) return;
    setSession({ kind: 'bridge', frozenInit: session.frozenInit });
  }

  /** Drop back to pure manual. Every streamed pick is already a manual override, so nothing is lost. */
  function handleBridgeToManual() {
    if (session.kind !== 'bridge') return;
    setSession({ kind: 'manual', frozenInit: session.frozenInit, reconnectCred: null, reconnectDraftId: null });
  }

  // The ESPN bridge auto-types each normalized streamed pick as a manual-entry override — the same
  // model manual logging uses. User-authored overrides always win (skipped here), and the result
  // persists through refresh, survives correction, and degrades to manual by construction.
  useEffect(() => {
    if (session.kind !== 'bridge') return;
    for (const pick of bridge.picks?.picks ?? []) {
      if (board.state.overrides.has(pick.overall)) continue;
      board.applyOverride({
        overall: pick.overall,
        round: pick.round,
        slot: pick.slot,
        teamId: pick.teamId,
        playerId: pick.playerId,
        providerPlayerId: pick.providerPlayerId,
        providerPlayerName: pick.providerPlayerName,
        source: 'manual-entry',
        correctedAt: Date.now(),
      });
    }
    // New picks arrive only when `bridge.picks` changes; the skip-loop keeps this idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, bridge.picks]);

  /** Freeze the live board (picks → manual-entry overrides) plus the latest DraftInit, then stop polling. */
  function handleTakeoverManual() {
    board.freeze();
    setCorrecting(null);
    setSession({
      kind: 'manual',
      frozenInit: poll.draftInit,
      reconnectCred: session.kind === 'connected' ? session.cred : null,
      reconnectDraftId: session.kind === 'connected' ? session.draftId : null,
    });
    setPage('draft');
  }

  /** Resume live polling for the taken-over session; falls back to the connect flow without one. */
  function handleReconnect() {
    if (session.kind === 'manual' && session.reconnectCred && session.reconnectDraftId) {
      board.reset('live');
      setCorrecting(null);
      setSession({ kind: 'connected', cred: session.reconnectCred, draftId: session.reconnectDraftId });
      setPage('draft');
      return;
    }
    handleReturnToConnect();
  }

  function handleChooseAnotherDraft() {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'disconnected' });
    setPage('home');
  }

  function handleReturnToConnect() {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'disconnected' });
    setPage('home');
  }

  const nextManualOverall = board.effectivePicks.reduce((max, p) => Math.max(max, p.overall), 0) + 1;
  const correctingPick = correcting
    ? board.effectivePicks.find((p) => p.overall === correcting.overall)
    : undefined;
  const correctingCurrentName = correctingPick?.providerPlayerName;
  // Round/slot/team for a brand-new manual pick are fully determined by the snake draft order —
  // never re-typed by the user. `correct-existing` already carries these on the pick itself.
  const manualTargetInfo = useMemo(() => {
    if (!correcting || correcting.mode !== 'add-manual' || !effectiveInit) return null;
    if (effectiveInit.draftType === 'auction') return null;
    const round = roundForOverall(effectiveInit.teams, correcting.overall);
    const slot = slotForOverall(effectiveInit.draftType, effectiveInit.teams, correcting.overall);
    const teamId = effectiveInit.slotToTeam[slot] ?? null;
    if (teamId == null) return null;
    const teamName = effectiveInit.slotToTeamName?.[slot] ?? teamId;
    return { round, slot, teamId, teamName };
  }, [correcting, effectiveInit]);
  const unavailablePlayerIds = useMemo(() => {
    const ids = new Set<PlayerId>();
    for (const pick of board.effectivePicks) {
      if (pick.overall !== correcting?.overall && pick.playerId) ids.add(pick.playerId);
    }
    return ids;
  }, [board.effectivePicks, correcting?.overall]);

  /** Stable row-level correction trigger so the memoized DraftLog rows don't reconcile on every render. */
  const openCorrection = useCallback((overall: number) => {
    setCorrecting({ mode: 'correct-existing', overall });
  }, []);

  return (
    <>
      <TopNav
        active={page}
        onNavigate={setPage}
        roundPick={roundPick}
        picksUntilUserTurn={picksUntilUserTurn}
        onChooseAnotherDraft={session.kind === 'connected' ? handleChooseAnotherDraft : undefined}
        leagueName={effectiveInit?.settings.name ?? null}
        adpFormat={adpFormat}
        isStale={false}
        dataAgeMs={null}
        pollHealthRef={session.kind === 'connected' ? poll.healthRef : null}
      />
      <main className="app-shell">

      {page === 'home' && (
        <>
          <section className="landing-intro">
            <p className="eyebrow">Live draft assistant</p>
            <h2>Track the board. Get {APP_NAME}'s picks.</h2>
            <p>
              {APP_NAME} watches your Sleeper PPR redraft live, ranks who is left, explains the pick,
              and gives an honest measure of uncertainty. No Sleeper league on hand? Track any
              draft by hand instead.
            </p>
          </section>

          {session.kind === 'disconnected' ? (
            <ConnectSleeper onConnect={handleConnect} onManualMode={handleManualMode} />
          ) : (
            <section className="resume-draft">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Ready to draft</p>
                  <h2>Your draft is loaded</h2>
                </div>
              </div>
              <p>Your board is ready — jump back into the Draft Room.</p>
              <button type="button" onClick={() => setPage('draft')}>Open Draft Room</button>
            </section>
          )}
        </>
      )}

      {page === 'draft' && (
        <>
          {session.kind === 'disconnected' && (
            <section className="draft-room-empty">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Draft Room</p>
                  <h2>No active draft</h2>
                </div>
              </div>
              <p>Connect to Sleeper on the Home page to track a live draft, or log one manually.</p>
              <button type="button" onClick={() => setPage('home')}>Go to Home to connect</button>
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
                <>
                  <section className="draft-actions" aria-label="Draft controls">
                    <button type="button" onClick={() => setCorrecting({ mode: 'add-manual', overall: nextManualOverall })}>Log next pick</button>
                    <button className="quiet-button" type="button" onClick={handleTakeoverManual} disabled={!poll.draftInit}>Take over manually</button>
                  </section>
                  <DraftWorkspace
                    draftInit={poll.draftInit}
                    effectivePicks={board.effectivePicks}
                    manifest={manifest}
                    adpFormat={adpFormat}
                    picksSignature={picksSignature}
                    timingPollId={poll.lastChangedPollId}
                    onTheClock={onTheClock}
                    boundaries={boundaries}
                    onCorrect={openCorrection}
                  />
                </>
              )}
            </>
          )}

          {(session.kind === 'manual' || session.kind === 'bridge') && (session.frozenInit ? (
            <>
              <section className="manual-takeover-bar" aria-label="Manual takeover">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">{session.kind === 'bridge' ? 'ESPN bridge' : 'Manual takeover'}</p>
                    <h2>{session.kind === 'bridge' ? 'Live ESPN picks streaming' : 'Live sync stopped — frozen board'}</h2>
                    <p className="muted">
                      {session.kind === 'bridge'
                        ? bridgeStatus
                        : 'Picks and draft settings were frozen when sync stopped. The log, clock, and recommendations keep working from the frozen state.'}
                    </p>
                  </div>
                  <div className="draft-actions">
                    <button type="button" onClick={() => setCorrecting({ mode: 'add-manual', overall: nextManualOverall })}>Log next pick</button>
                    {session.kind === 'bridge' ? (
                      <button className="quiet-button" type="button" onClick={handleBridgeToManual}>Switch to manual</button>
                    ) : (
                      <>
                        <button className="quiet-button" type="button" onClick={() => setManualSetup('edit')}>Edit draft setup</button>
                        {!session.reconnectCred && (
                          <button className="quiet-button" type="button" onClick={handleEspnBridgeConnect}>Connect ESPN tab</button>
                        )}
                        <button className="quiet-button" type="button" onClick={handleReconnect}>Reconnect</button>
                      </>
                    )}
                  </div>
                </div>
              </section>
              <DraftWorkspace
                draftInit={effectiveInit}
                effectivePicks={board.effectivePicks}
                manifest={manifest}
                adpFormat={adpFormat}
                picksSignature={picksSignature}
                timingPollId={null}
                onTheClock={onTheClock}
                boundaries={boundaries}
                onCorrect={openCorrection}
              />
            </>
          ) : (
            <section className="manual-draft">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Offline mode</p>
                  <h2>Manual draft log</h2>
                </div>
                <button className="quiet-button" type="button" onClick={handleReturnToConnect}>Connect to Sleeper</button>
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
              isStale={session.kind === 'connected' ? poll.isStale : bridgeStale}
              dataAgeMs={session.kind === 'connected' ? poll.dataAgeMs : (bridgeStale && bridge.lastHeartbeatAt != null ? Date.now() - bridge.lastHeartbeatAt : null)}
              consecutiveFailures={session.kind === 'connected' ? poll.consecutiveFailures : 0}
              lastError={session.kind === 'connected' ? poll.lastError : (session.kind === 'bridge' ? bridge.lastError : null)}
              pollHealthRef={session.kind === 'connected' ? poll.healthRef : null}
              adpFormat={adpFormat}
              scoringDiagnostics={session.kind === 'manual' || session.kind === 'bridge' ? MANUAL_SCORING_DIAGNOSTICS : undefined}
            />
          )}
        </>
      )}

      {page === 'teams' && <TeamsPage />}

      {correcting && (
        <ManualPickCorrection
          mode={correcting.mode}
          overall={correcting.overall}
          round={correcting.mode === 'add-manual' ? manualTargetInfo?.round : correctingPick?.round}
          slot={correcting.mode === 'add-manual' ? manualTargetInfo?.slot : correctingPick?.slot}
          teamId={correcting.mode === 'add-manual' ? manualTargetInfo?.teamId ?? undefined : correctingPick?.teamId}
          teamName={correcting.mode === 'add-manual' ? manualTargetInfo?.teamName : undefined}
          currentProviderName={correctingCurrentName || undefined}
          rankedPlayers={rankedPlayers}
          unavailablePlayerIds={unavailablePlayerIds}
          onSubmit={(override) => board.applyOverride(override)}
          onUndo={(overall) => board.undoOverride(overall)}
          onClose={() => setCorrecting(null)}
        />
      )}

      {manualSetup && (
        <ManualDraftSetup
          initial={manualSetup === 'edit' && session.kind === 'manual' ? session.frozenInit : null}
          onSubmit={manualSetup === 'edit' ? handleManualSetupEdit : handleManualSetupSubmit}
          onCancel={() => setManualSetup(null)}
        />
      )}
      </main>
    </>
  );
}
