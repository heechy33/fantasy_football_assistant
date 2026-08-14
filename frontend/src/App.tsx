import { useEffect, useMemo, useState } from 'react';
import type { DataManifest, OnTheClock, Pick, PlayerId, SleeperCred } from '../../shared/types';
import { canonicalPicksSignature, computeOnTheClock, roundPickLabel, userPickBoundaries, type UserPickBoundaries } from './adapters/draftOrder';
import { sleeperAdapter } from './adapters/sleeper';
import { ConnectSleeper } from './components/ConnectSleeper';
import { DataHealth } from './components/DataHealth';
import { DraftWorkspace } from './components/DraftWorkspace';
import { ManualPickCorrection } from './components/ManualPickCorrection';
import { TeamsPage } from './components/TeamsPage';
import { APP_NAME, TopNav, type AppPage } from './components/TopNav';
import { loadRankedPlayers, type AdpFormat, type RankedPlayer } from './data/loadPlayerPool';
import { useDraftBoardState } from './hooks/useDraftBoardState';
import { useDraftPoll } from './hooks/useDraftPoll';
import { loadPersistedSession, savePersistedSession } from './state/persistence';
import './App.css';

type Session =
  | { kind: 'disconnected' }
  | { kind: 'connected'; cred: SleeperCred; draftId: string }
  | { kind: 'manual' };

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
        setSession({ kind: 'manual' });
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
  // Live picks flow straight from the poll into the effective draft state (merged with manual
  // overrides) — no effect-driven relay, so a changed poll renders the log/clock once, not twice.
  const board = useDraftBoardState(poll.draftPicks?.picks ?? EMPTY_PICKS, undefined, poll.lastChangedPollId);

  useEffect(() => {
    if (!hydrated) return;
    savePersistedSession({
      userId: session.kind === 'connected' ? session.cred.userId : null,
      draftId: session.kind === 'connected' ? session.draftId : null,
      mode: session.kind === 'manual' ? 'manual' : 'live',
      overrides: [...board.state.overrides.values()],
    });
  }, [hydrated, session, board.state.overrides]);

  const adpFormat = adpFormatForDraft(poll.draftInit?.settings.format.reception, poll.draftInit?.settings.format.qb);

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
    () => poll.draftInit
      ? computeOnTheClock(poll.draftInit.draftType, poll.draftInit.teams, poll.draftInit.rounds, board.effectivePicks.length, poll.draftInit.slotToTeam)
      : null,
    // picksSignature stands in for `effectivePicks` here — see the memo below's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poll.draftInit, picksSignature],
  );

  // Availability's target pick is always "the next time it's my decision after the currently-
  // relevant one" — when I'm on the clock right now that's my *following* turn (followUpPick),
  // otherwise it's my very next turn (decisionPick). See draftOrder.ts's UserPickBoundaries doc.
  // Computed independently of the board build so pagination-reset can depend on
  // `boundaries.decisionPick` without re-running the whole engine.
  const boundaries: UserPickBoundaries | null = useMemo(() => {
    if (!poll.draftInit || poll.draftInit.myTeamId == null) return null;
    return userPickBoundaries(
      poll.draftInit.draftType, poll.draftInit.teams, poll.draftInit.rounds, board.effectivePicks.length,
      poll.draftInit.slotToTeam, poll.draftInit.myTeamId,
    );
    // picksSignature stands in for `effectivePicks` here — see comment on the memo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.draftInit, picksSignature]);

  // Clock math is independent of recommendation-board readiness — the top-bar hero/countdown must
  // not hide while players/projections load.
  const currentOverall = onTheClock?.overall ?? (poll.draftInit ? board.effectivePicks.length + 1 : null);
  const picksUntilUserTurn = boundaries?.decisionPick != null && currentOverall != null
    ? Math.max(0, boundaries.decisionPick - currentOverall)
    : null;
  const roundPick = poll.draftInit && currentOverall != null
    ? roundPickLabel(poll.draftInit.teams, currentOverall)
    : null;

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
    board.reset('manual');
    setCorrecting(null);
    setSession({ kind: 'manual' });
    setPage('draft');
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
  const unavailablePlayerIds = useMemo(() => {
    const ids = new Set<PlayerId>();
    for (const pick of board.effectivePicks) {
      if (pick.overall !== correcting?.overall && pick.playerId) ids.add(pick.playerId);
    }
    return ids;
  }, [board.effectivePicks, correcting?.overall]);

  return (
    <>
      <TopNav
        active={page}
        onNavigate={setPage}
        roundPick={roundPick}
        picksUntilUserTurn={picksUntilUserTurn}
        onChooseAnotherDraft={session.kind === 'connected' ? handleChooseAnotherDraft : undefined}
        leagueName={poll.draftInit?.settings.name ?? null}
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
                <DraftWorkspace
                  draftInit={poll.draftInit}
                  effectivePicks={board.effectivePicks}
                  manifest={manifest}
                  adpFormat={adpFormat}
                  picksSignature={picksSignature}
                  timingPollId={poll.lastChangedPollId}
                  onTheClock={onTheClock}
                  boundaries={boundaries}
                />
              )}
            </>
          )}

          {session.kind === 'manual' && (
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
                      <span>{pick.teamId || 'unknown team'}</span>
                      <strong>{pick.providerPlayerName ?? pick.playerId ?? 'unmatched'}</strong>
                      <button className="quiet-button" type="button" onClick={() => setCorrecting({ mode: 'correct-existing', overall: pick.overall })}>Edit</button>
                    </li>
                  ))}
                </ol>
              )}
              <button type="button" onClick={() => setCorrecting({ mode: 'add-manual', overall: nextManualOverall })}>Log next pick</button>
            </section>
          )}

          {(session.kind === 'connected' || session.kind === 'manual') && (
            <DataHealth
              manifest={manifest}
              effectivePicks={board.effectivePicks}
              isStale={session.kind === 'connected' ? poll.isStale : false}
              dataAgeMs={session.kind === 'connected' ? poll.dataAgeMs : null}
              consecutiveFailures={session.kind === 'connected' ? poll.consecutiveFailures : 0}
              lastError={session.kind === 'connected' ? poll.lastError : null}
              pollHealthRef={session.kind === 'connected' ? poll.healthRef : null}
              adpFormat={adpFormat}
            />
          )}
        </>
      )}

      {page === 'teams' && <TeamsPage />}

      {correcting && (
        <ManualPickCorrection
          mode={correcting.mode}
          overall={correcting.overall}
          round={correctingPick?.round}
          slot={correctingPick?.slot}
          teamId={correctingPick?.teamId}
          currentProviderName={correctingCurrentName || undefined}
          rankedPlayers={rankedPlayers}
          unavailablePlayerIds={unavailablePlayerIds}
          onSubmit={(override) => board.applyOverride(override)}
          onUndo={(overall) => board.undoOverride(overall)}
          onClose={() => setCorrecting(null)}
        />
      )}
      </main>
    </>
  );
}
