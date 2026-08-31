import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SavedLeague } from '../../../shared/types';
import { ProviderBadge } from '../components/ProviderBadge';
import { useSavedLeagues } from '../data/useSavedLeagues';

/**
 * The league hub (/leagues) — every SavedLeague the signed-in user has, as an honest card
 * (name/season/teams/provider). Since the 2026-08-27 connect/start split (DECISIONS.md) the card is
 * a LINK to /leagues/:leagueId (summary + the team you drafted); drafts start only from the Draft
 * Room launcher, never from here. The card never navigates to /draft — that's the regression the
 * connect/start split exists to prevent (routes.test.tsx asserts it).
 */
export function LeaguesRoute() {
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
      <ul className="league-grid">
        {leagues.map((league) => (
          <LeagueCard
            key={league.id}
            league={league}
            pendingRemove={pendingRemoveId === league.id}
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
      <Link to="/leagues/connect" className="primary-button">Connect</Link>
    </div>
  );
}

function LeagueCard({ league, pendingRemove, onRequestRemove, onConfirmRemove, onCancelRemove }: {
  league: SavedLeague;
  pendingRemove: boolean;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  return (
    <li className="league-tile">
      <div className="league-tile-head">
        <Link className="league-tile-link" to={`/leagues/${league.id}`}>
          <p className="league-tile-name">{league.name}</p>
        </Link>
        {league.provider !== 'manual' && <ProviderBadge brandKey={league.provider} size="sm" />}
      </div>
      <ul className="meta-chips">
        <li className="meta-chip">{league.season || 'season unknown'}</li>
        <li className="meta-chip">{league.teams} teams</li>
        {league.providerTeamName && <li className="meta-chip">your team: {league.providerTeamName}</li>}
      </ul>
      <div className="league-tile-actions">
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