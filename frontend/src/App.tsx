import { useEffect, useMemo, useState } from 'react';
import type { DataManifest, PlayerId, SleeperCred } from '../../shared/types';
import { sleeperAdapter } from './adapters/sleeper';
import { ConnectSleeper } from './components/ConnectSleeper';
import { DataHealth } from './components/DataHealth';
import { DraftBoard } from './components/DraftBoard';
import { ManualPickCorrection } from './components/ManualPickCorrection';
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

function adpFormatForDraft(reception: string | undefined, qb: string | undefined): AdpFormat {
  if (qb === 'two-qb' || qb === 'superflex') return '2qb';
  if (reception === 'standard' || reception === 'half-ppr' || reception === 'ppr') return reception;
  return 'ppr';
}

export default function App() {
  const [session, setSession] = useState<Session>({ kind: 'disconnected' });
  const [manifest, setManifest] = useState<DataManifest | null>(null);
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([]);
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const board = useDraftBoardState();

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
      } else if (persisted.userId && persisted.draftId) {
        setSession({
          kind: 'connected',
          cred: { provider: 'sleeper', userId: persisted.userId },
          draftId: persisted.draftId,
        });
      }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePersistedSession({
      userId: session.kind === 'connected' ? session.cred.userId : null,
      draftId: session.kind === 'connected' ? session.draftId : null,
      mode: session.kind === 'manual' ? 'manual' : 'live',
      overrides: [...board.state.overrides.values()],
    });
  }, [hydrated, session, board.state.overrides]);

  const draftId = session.kind === 'connected' ? session.draftId : null;
  const cred = session.kind === 'connected' ? session.cred : IDLE_CRED;
  const poll = useDraftPoll({ adapter: sleeperAdapter, cred, draftId });
  const adpFormat = adpFormatForDraft(poll.draftInit?.settings.format.reception, poll.draftInit?.settings.format.qb);

  useEffect(() => {
    let active = true;
    loadRankedPlayers(adpFormat)
      .then((players) => { if (active) setRankedPlayers(players); })
      .catch(() => { if (active) setRankedPlayers([]); });
    return () => { active = false; };
  }, [adpFormat]);

  useEffect(() => {
    if (poll.draftPicks) board.setLivePicks(poll.draftPicks.picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.draftPicks]);

  function handleConnect(newCred: SleeperCred, newDraftId: string) {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'connected', cred: newCred, draftId: newDraftId });
  }

  function handleManualMode() {
    board.reset('manual');
    setCorrecting(null);
    setSession({ kind: 'manual' });
  }

  function handleChooseAnotherDraft() {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'disconnected' });
  }

  function handleReturnToConnect() {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'disconnected' });
  }

  const nextManualOverall = board.effectivePicks.reduce((max, p) => Math.max(max, p.overall), 0) + 1;
  const correctingCurrentName =
    correcting && board.effectivePicks.find((p) => p.overall === correcting.overall)?.providerPlayerName;
  const unavailablePlayerIds = useMemo(() => {
    const ids = new Set<PlayerId>();
    for (const pick of board.effectivePicks) {
      if (pick.overall !== correcting?.overall && pick.playerId) ids.add(pick.playerId);
    }
    return ids;
  }, [board.effectivePicks, correcting?.overall]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Draft companion</p>
        <h1>Fantasy Football Co-Pilot</h1>
      </header>

      {session.kind === 'disconnected' && <ConnectSleeper onConnect={handleConnect} onManualMode={handleManualMode} />}

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
              <DraftBoard
                draftInit={poll.draftInit}
                effectivePicks={board.effectivePicks}
                onTheClock={poll.draftPicks?.onTheClock ?? null}
                status={poll.draftPicks?.status ?? poll.phase}
                isStale={poll.isStale}
                dataAgeMs={poll.dataAgeMs}
                onCorrectPick={(overall) => setCorrecting({ mode: 'correct-existing', overall })}
              />
              <button type="button" onClick={poll.reconnect}>Reconnect</button>
            </>
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
        />
      )}

      {correcting && (
        <ManualPickCorrection
          mode={correcting.mode}
          overall={correcting.overall}
          currentProviderName={correctingCurrentName || undefined}
          rankedPlayers={rankedPlayers}
          unavailablePlayerIds={unavailablePlayerIds}
          onSubmit={(override) => board.applyOverride(override)}
          onUndo={(overall) => board.undoOverride(overall)}
          onClose={() => setCorrecting(null)}
        />
      )}
    </main>
  );
}
