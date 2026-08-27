import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SavedLeague } from '../../../shared/types';
import { ProviderBadge } from '../components/ProviderBadge';
import { useSavedLeagues } from '../data/useSavedLeagues';
import { useDraftSession } from '../session/DraftSessionProvider';

/**
 * The league hub (/leagues) — replaces TeamsPage's hard-coded empty state with real data: every
 * SavedLeague the signed-in user has, as an honest card (name/season/teams/provider) with Track
 * draft and Remove. No roster/waiver affordances: those are gated behind DECISIONS.md 2026-08-25's
 * scope boundary and must not pretend to exist.
 *
 * "Track draft" needs both pieces of saved identity (`providerUserId` for the SleeperCred,
 * `latestDraftId` for the draft); when either is missing the card omits the button rather than
 * pretending it can reconnect — /leagues/connect is the path in that case.
 */
export function LeaguesRoute() {
  const { handleConnect } = useDraftSession();
  const { leagues, loading, error, removeLeague } = useSavedLeagues();
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  if (loading) {
    return (
      <section className="leagues-page" aria-label="My leagues">
        <LeaguesHeading />
        <p className="muted">Loading your leagues…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="leagues-page" aria-label="My leagues">
        <LeaguesHeading />
        <p role="alert">Could not load your leagues: {error.message}</p>
      </section>
    );
  }
  if (leagues.length === 0) {
    return (
      <section className="leagues-page" aria-label="My leagues">
        <LeaguesHeading />
        <p>No leagues yet — no invented rosters here until one exists.</p>
        <Link to="/leagues/connect" className="primary-button">Connect your first league</Link>
      </section>
    );
  }

  return (
    <section className="leagues-page" aria-label="My leagues">
      <LeaguesHeading />
      <ul className="draft-list">
        {leagues.map((league) => (
          <LeagueCard
            key={league.id}
            league={league}
            pendingRemove={pendingRemoveId === league.id}
            onTrack={(cred) => handleConnect(cred, league.latestDraftId!)}
            onRequestRemove={() => setPendingRemoveId(league.id)}
            onConfirmRemove={() => {
              void removeLeague(league.id).then(() => setPendingRemoveId(null));
            }}
            onCancelRemove={() => setPendingRemoveId(null)}
          />
        ))}
      </ul>
    </section>
  );
}

function LeaguesHeading() {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">My Leagues</p>
        <h2>Your leagues</h2>
      </div>
      <Link to="/leagues/connect" className="primary-button">Connect a league</Link>
    </div>
  );
}

function LeagueCard({ league, pendingRemove, onTrack, onRequestRemove, onConfirmRemove, onCancelRemove }: {
  league: SavedLeague;
  pendingRemove: boolean;
  /** Only wired when both `providerUserId` and `latestDraftId` are saved on the league. */
  onTrack: (cred: { provider: 'sleeper'; userId: string }) => void;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  const canTrack = Boolean(league.providerUserId && league.latestDraftId);
  return (
    <li className="league-card">
      <div>
        <strong>{league.name}</strong>
        <span>{league.season || 'season unknown'} · {league.teams} teams</span>
      </div>
      {league.provider !== 'manual' && <ProviderBadge brandKey={league.provider} size="sm" />}
      <div>
        {canTrack && (
          <button type="button" onClick={() => onTrack({ provider: 'sleeper', userId: league.providerUserId! })}>
            Track draft
          </button>
        )}
        {pendingRemove ? (
          <>
            <button type="button" onClick={onConfirmRemove}>Confirm remove</button>
            <button className="quiet-button" type="button" onClick={onCancelRemove}>Keep</button>
          </>
        ) : (
          <button className="quiet-button" type="button" onClick={onRequestRemove}>Remove</button>
        )}
      </div>
    </li>
  );
}