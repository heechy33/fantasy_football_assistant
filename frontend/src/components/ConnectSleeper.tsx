import { useEffect, useState, type FormEvent } from 'react';
import type { LeagueRef, SavedLeague, SleeperCred } from '../../../shared/types';
import { resolveUser, sleeperAdapter } from '../adapters/sleeper';
import { CURRENT_SEASON } from '../data/season';
import { useSleeperAccount, type SleeperAccount } from '../data/useSleeperAccount';

export interface ConnectSleeperProps {
  /** Optional so any test mount keeps working without a repository behind it. Present on
   * /leagues/connect (and the /onboarding/league alias) — the one connect surface. Since the
   * 2026-08-27 connect/start split (DECISIONS.md) this component is SAVE-ONLY: it never starts a
   * session and never navigates to /draft. Draft selection (tracked drafts, mock drafts, pasted
   * draft ids) lives in the Draft Room launcher, which reads what's already connected. */
  /** The `username` is what the account was resolved from (Sleeper's canonical username, kept so
   * `providerUsername` lands on the SavedLeague and "connected as X" needs no numeric id). */
  onSaveLeague?: (cred: SleeperCred, ref: LeagueRef, username: string | null) => Promise<void>;
  /** Already-saved leagues (from the connect route's own `useSavedLeagues()`), so a returning
   * user sees "Saved" instead of a duplicate Save button — this component has no fetch of its
   * own for that; it's the caller's existing data, just passed down (2026-08-28). */
  savedLeagues?: SavedLeague[];
}

/** Connection flow, hosted by `/leagues/connect` (and the /onboarding/league alias). Sleeper
 * leagues are saved to My Leagues; starting a draft is the Draft Room's job. When a Sleeper
 * account is already remembered (Workstream 1b) the username form is skipped entirely — the
 * "Use a different account" escape is local-only and never deletes the stored identity. Leagues
 * for a known account auto-load on mount (2026-08-28) — the "Show my leagues" button was pointless
 * friction once the account itself needs no re-entry. */
export function ConnectSleeper({ onSaveLeague, savedLeagues }: ConnectSleeperProps) {
  const { account } = useSleeperAccount();
  const [dismissedAccount, setDismissedAccount] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [localAccount, setLocalAccount] = useState<SleeperAccount | null>(null);
  const [leagues, setLeagues] = useState<LeagueRef[] | null>(null);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  // Bumped by Retry so the load effect re-runs — a failed mount-time fetch must not dead-end the
  // panel with no way forward (the same pattern as DraftLauncher's SleeperDraftList).
  const [attempt, setAttempt] = useState(0);

  // The stored account wins unless the user explicitly escaped it this visit.
  const effectiveAccount = dismissedAccount ? localAccount : (localAccount ?? account);
  const cred = effectiveAccount ? ({ provider: 'sleeper', userId: effectiveAccount.userId } as SleeperCred) : null;
  const displayName = effectiveAccount ? (effectiveAccount.username ?? effectiveAccount.userId) : null;

  useEffect(() => {
    if (!cred) return;
    let active = true;
    setLeaguesLoading(true);
    setLeaguesError(null);
    sleeperAdapter.listLeagues(cred, CURRENT_SEASON)
      .then((result) => { if (active) setLeagues(result); })
      .catch((err: unknown) => {
        // A failed fetch must never read as "you have no leagues" — that's a factual claim about
        // the account's data, and a network/API failure knows nothing of the kind.
        if (active) setLeaguesError(err instanceof Error ? err.message : 'Could not load your Sleeper leagues.');
      })
      .finally(() => { if (active) setLeaguesLoading(false); });
    return () => { active = false; };
    // cred's identity changes with effectiveAccount/dismissedAccount; re-keying on cred.userId
    // (a primitive) avoids depending on the freshly-built object literal every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cred?.userId, attempt]);

  async function handleResolve(e: FormEvent) {
    e.preventDefault();
    setResolving(true);
    setResolveError(null);
    try {
      const resolved = await resolveUser(usernameInput.trim());
      setLocalAccount({ userId: resolved.userId, username: resolved.username });
    } catch (err) {
      setLocalAccount(null);
      setResolveError(err instanceof Error ? err.message : 'Could not find that Sleeper user.');
    } finally {
      setResolving(false);
    }
  }

  function handleUseDifferentAccount() {
    // Local-only escape: the stored SavedLeague identity stays untouched; this just re-shows the
    // username form so a different account can be resolved this visit.
    setDismissedAccount(true);
    setLocalAccount(null);
    setLeagues(null);
    setLeaguesError(null);
  }

  function handleBackToStoredAccount() {
    // Undo the dismiss without refetching: the stored account is still in `account`.
    setDismissedAccount(false);
    setLocalAccount(null);
  }

  return (
    <div className="connect-sleeper">
      {!cred ? (
        <>
          <div className='sleeper-lookup-intro'>
            <p className='eyebrow'>Sleeper account</p>
            <h3>Find your leagues</h3>
          </div>
          <form className='sleeper-lookup-form' onSubmit={handleResolve} aria-busy={resolving}>
            <label htmlFor='sleeper-username'>
              <span className='sleeper-field-label'>Sleeper username</span>
              <input id='sleeper-username' value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} required />
            </label>
            <button type="submit" disabled={resolving || !usernameInput.trim()}>{resolving ? 'Looking up…' : 'Continue'}</button>
            {resolveError && <p role="alert">{resolveError}</p>}
          </form>
          {account && (
            <p className="muted">
              Or go back to your remembered account:{' '}
              <button className="quiet-button" type="button" onClick={handleBackToStoredAccount}>
                {account.username ?? account.userId}
              </button>
            </p>
          )}
        </>
      ) : (
        <div className="connect-sleeper-connected">
          <p>
            Connected as <strong>{displayName ?? cred.userId}</strong>.{' '}
            <button className="quiet-button" type="button" onClick={handleUseDifferentAccount}>Use a different account</button>
          </p>
          {leaguesLoading && <p className="muted">Loading your {CURRENT_SEASON} leagues…</p>}
          {leaguesError && (
            <>
              <p role="alert">{leaguesError}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
            </>
          )}
          {leagues && (
            <div className="draft-selection">
              <h3>Your leagues</h3>
              {leagues.length === 0 ? <p>No {CURRENT_SEASON} leagues found for this account.</p> : (
                <ul className="league-grid">
                  {leagues.map((league) => {
                    const alreadySaved = savedLeagues?.some(
                      (saved) => saved.provider === 'sleeper' && saved.providerLeagueId === league.leagueId,
                    ) ?? false;
                    return (
                      <li key={league.leagueId} className="league-tile">
                        <div className="league-tile-head">
                          <p className="league-tile-name">{league.name}</p>
                        </div>
                        <ul className="meta-chips">
                          <li className="meta-chip">{league.totalTeams} teams</li>
                          <li className="meta-chip">{league.season}</li>
                          {league.status && <li className="meta-chip">{league.status}</li>}
                        </ul>
                        <div className="league-tile-actions">
                          {alreadySaved ? (
                            <span className="muted">Saved</span>
                          ) : (
                            onSaveLeague && <SaveLeagueButton cred={cred} league={league} username={effectiveAccount?.username ?? null} onSaveLeague={onSaveLeague} />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Per-league save button with its own pending/done/error state — a save hits Sleeper's settings
 * endpoint plus the API, so it must not freeze the whole connect surface while in flight. */
function SaveLeagueButton({ cred, league, username, onSaveLeague }: {
  cred: SleeperCred;
  league: LeagueRef;
  username: string | null;
  onSaveLeague: (cred: SleeperCred, ref: LeagueRef, username: string | null) => Promise<void>;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  async function handleClick() {
    setState('saving');
    try {
      await onSaveLeague(cred, league, username);
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
