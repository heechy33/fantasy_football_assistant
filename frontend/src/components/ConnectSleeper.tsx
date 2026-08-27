import { useState, type FormEvent } from 'react';
import type { LeagueRef, SleeperCred } from '../../../shared/types';
import { listSleeperDrafts, resolveUser, sleeperAdapter, type SleeperDraftRef } from '../adapters/sleeper';

export interface ConnectSleeperProps {
  onConnect: (cred: SleeperCred, draftId: string) => void;
  /** Optional so the ESPN path and any test mount keep working without a repository behind
   * them. Present on /leagues/connect and /onboarding/league — one connect surface. */
  onSaveLeague?: (cred: SleeperCred, ref: LeagueRef) => Promise<void>;
}

const CURRENT_SEASON = '2026';

/** Connection and draft-selection flow, hosted by `/onboarding/league` since Phase 3 (it used to
 * live in the Sleeper landing card). Sleeper lists mock drafts separately from leagues. The
 * manual/ESPN path lives on the ESPN card now — this component no longer offers a skip-connecting
 * escape hatch. */
export function ConnectSleeper({ onConnect, onSaveLeague }: ConnectSleeperProps) {
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
    <div className="connect-sleeper">
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
          {leagues && (
            <div className="draft-selection">
              <h3>Your leagues</h3>
              {leagues.length === 0 ? <p>No {CURRENT_SEASON} leagues found for this account.</p> : (
                <ul className="draft-list">
                  {leagues.map((league) => (
                    <li key={league.leagueId}>
                      <div>
                        <strong>{league.name}</strong>
                        <span>{league.totalTeams} teams · {league.season}{league.status ? ` · ${league.status}` : ''}</span>
                      </div>
                      <div>
                        {onSaveLeague && <SaveLeagueButton cred={cred} league={league} onSaveLeague={onSaveLeague} />}
                        {league.draftId && (
                          <button type="button" onClick={() => onConnect(cred, league.draftId ?? '')}>Track draft</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <form className="direct-draft-form" onSubmit={handleDirectDraftSubmit}>
            <label>
              Have a draft ID from someone else?
              <input value={directDraftId} onChange={(e) => setDirectDraftId(e.target.value)} placeholder="Paste draft ID" />
            </label>
            <button type="submit" disabled={!directDraftId.trim()}>Track this draft ID</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Per-league save button with its own pending/done/error state — a save hits Sleeper's settings
 * endpoint plus the API, so it must not freeze the whole connect surface while in flight. */
function SaveLeagueButton({ cred, league, onSaveLeague }: {
  cred: SleeperCred;
  league: LeagueRef;
  onSaveLeague: (cred: SleeperCred, ref: LeagueRef) => Promise<void>;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  async function handleClick() {
    setState('saving');
    try {
      await onSaveLeague(cred, league);
      setState('saved');
    } catch {
      setState('error');
    }
  }
  if (state === 'saved') return <span className="muted">Saved</span>;
  return (
    <>
      <button type="button" onClick={handleClick} disabled={state === 'saving'}>
        {state === 'saving' ? 'Saving…' : 'Save league'}
      </button>
      {state === 'error' && <span role="alert">Save failed — try again.</span>}
    </>
  );
}
