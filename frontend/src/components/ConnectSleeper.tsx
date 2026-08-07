import { useState, type FormEvent } from 'react';
import type { LeagueRef, SleeperCred } from '../../../shared/types';
import { listSleeperDrafts, resolveUser, sleeperAdapter, type SleeperDraftRef } from '../adapters/sleeper';

export interface ConnectSleeperProps {
  onConnect: (cred: SleeperCred, draftId: string) => void;
  onManualMode: () => void;
}

const CURRENT_SEASON = '2026';

/** Connection and draft-selection flow. Sleeper lists mock drafts separately from leagues. */
export function ConnectSleeper({ onConnect, onManualMode }: ConnectSleeperProps) {
  const [usernameInput, setUsernameInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [cred, setCred] = useState<SleeperCred | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<LeagueRef[] | null>(null);
  const [drafts, setDrafts] = useState<SleeperDraftRef[] | null>(null);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [directDraftId, setDirectDraftId] = useState('');

  async function handleResolve(e: FormEvent) {
    e.preventDefault();
    setResolving(true);
    setResolveError(null);
    try {
      const resolved = await resolveUser(usernameInput.trim());
      setCred({ provider: 'sleeper', userId: resolved.userId });
      setDisplayName(resolved.displayName);
    } catch (err) {
      setCred(null);
      setResolveError(err instanceof Error ? err.message : 'Could not find that Sleeper user.');
    } finally {
      setResolving(false);
    }
  }

  async function handleLoadDrafts() {
    if (!cred) return;
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      const [loadedLeagues, loadedDrafts] = await Promise.all([
        sleeperAdapter.listLeagues(cred, CURRENT_SEASON),
        listSleeperDrafts(cred, CURRENT_SEASON),
      ]);
      setLeagues(loadedLeagues);
      setDrafts(loadedDrafts);
    } catch (err) {
      setDraftsError(err instanceof Error ? err.message : 'Could not load your Sleeper drafts.');
    } finally {
      setDraftsLoading(false);
    }
  }

  function handleDirectDraftSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cred || !directDraftId.trim()) return;
    onConnect(cred, directDraftId.trim());
  }

  function handleUseDifferentAccount() {
    setCred(null);
    setDisplayName(null);
    setLeagues(null);
    setDrafts(null);
    setDraftsError(null);
  }

  return (
    <section>
      <h2>Connect to Sleeper</h2>
      {!cred ? (
        <form onSubmit={handleResolve}>
          <label>
            Sleeper username or user ID
            <input value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} required />
          </label>
          <button type="submit" disabled={resolving || !usernameInput.trim()}>{resolving ? 'Looking up…' : 'Continue'}</button>
          {resolveError && <p role="alert">{resolveError}</p>}
        </form>
      ) : (
        <div>
          <p>
            Connected as <strong>{displayName}</strong> ({cred.userId}).{' '}
            <button className="quiet-button" type="button" onClick={handleUseDifferentAccount}>Use a different account</button>
          </p>
          <button type="button" onClick={handleLoadDrafts} disabled={draftsLoading}>
            {draftsLoading ? 'Loading drafts…' : `Show my ${CURRENT_SEASON} leagues and drafts`}
          </button>
          {draftsError && <p role="alert">{draftsError}</p>}
          {drafts && (
            <div className="draft-selection">
              <h3>Your drafts</h3>
              {drafts.length === 0 ? <p>No {CURRENT_SEASON} drafts found. Create or join a Sleeper mock, then refresh this list.</p> : (
                <ul className="draft-list">
                  {drafts.map((draft) => (
                    <li key={draft.draftId}>
                      <div>
                        <strong>{draft.name}</strong>
                        <span>{draft.totalTeams ?? '?'} teams · {draft.type} · {draft.status}</span>
                      </div>
                      <button type="button" onClick={() => onConnect(cred, draft.draftId)}>Track draft</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {leagues && <p className="muted">{leagues.length} league{leagues.length === 1 ? '' : 's'} found for {CURRENT_SEASON}.</p>}
          <form className="direct-draft-form" onSubmit={handleDirectDraftSubmit}>
            <label>
              Have a draft ID from someone else?
              <input value={directDraftId} onChange={(e) => setDirectDraftId(e.target.value)} placeholder="Paste draft ID" />
            </label>
            <button type="submit" disabled={!directDraftId.trim()}>Track this draft ID</button>
          </form>
        </div>
      )}
      <hr />
      <button className="quiet-button" type="button" onClick={onManualMode}>Skip connecting — track this draft manually</button>
    </section>
  );
}
