import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PlayerMeta, Roster, SeasonProjection } from '../../../shared/types';
import { ProviderBadge } from '../components/ProviderBadge';
import { MyTeamRail } from '../components/MyTeamRail';
import { adpBoardKeyFor } from '../data/adpBoard';
import { loadPlayerPool, type AdpFormat } from '../data/loadPlayerPool';
import { draftToDisplay, useSavedDrafts } from '../data/useSavedDrafts';
import { useSavedLeagues } from '../data/useSavedLeagues';
import { sleeperAdapter } from '../adapters/sleeper';

/** ADP-format key for the board data a league-detail roster needs (mirrors the session
 * provider's `adpFormatForDraft`). */
function adpFormatFor(settings: { format: { reception: string; qb: string } }): AdpFormat {
  if (settings.format.qb === 'two-qb' || settings.format.qb === 'superflex') return '2qb';
  if (settings.format.reception === 'standard' || settings.format.reception === 'half-ppr' || settings.format.reception === 'ppr') {
    return settings.format.reception;
  }
  return 'ppr';
}

/**
 * League detail (/leagues/:leagueId, 2026-08-27 connect/start split): the league's summary plus
 * the team you drafted. This deliberately widens the 2026-08-25 "no roster affordances" boundary
 * in one narrow way — the drafted roster, reconstructed from data the app already holds (see
 * DECISIONS.md 2026-08-27). No waiver/lineup management, no invented rosters.
 *
 * Roster, by provider:
 * - ESPN/manual: reconstructed from the saved draft (`frozenInit` + `picks`) via MyTeamRail —
 *   picks persist only for providers with no upstream record to re-read.
 * - Sleeper: fetched live via `sleeperAdapter.rosters()` — its own API is the permanent record,
 *   which is exactly why the completed transcript is deleted.
 * - Neither available: an honest empty state. Never an invented roster.
 */
export function LeagueDetailRoute() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { leagues, loading: leaguesLoading, error: leaguesError } = useSavedLeagues();
  const league = useMemo(() => leagues.find((entry) => entry.id === leagueId) ?? null, [leagues, leagueId]);
  const { drafts } = useSavedDrafts(league?.id ?? null);
  const draft = draftToDisplay(drafts);

  if (leaguesLoading) {
    return (
      <section className="leagues-page" aria-label="League detail">
        <p className="muted">Loading league…</p>
      </section>
    );
  }
  if (leaguesError) {
    return (
      <section className="leagues-page" aria-label="League detail">
        <p role="alert">Could not load your leagues: {leaguesError.message}</p>
      </section>
    );
  }
  if (!league) {
    return (
      <section className="leagues-page" aria-label="League detail">
        <p role="alert">League not found — it may have been removed.</p>
        <Link to="/leagues" className="primary-button">Back to My Leagues</Link>
      </section>
    );
  }

  return (
    <section className="leagues-page" aria-label="League detail">
      <div className="section-heading">
        <div>
          <p className="eyebrow">My Leagues</p>
          <h2>{league.name}</h2>
        </div>
        {league.provider !== 'manual' && <ProviderBadge brandKey={league.provider} size="sm" />}
      </div>

      <ul className="meta-chips">
        <li className="meta-chip">{league.season || 'season unknown'}</li>
        <li className="meta-chip">{league.teams} teams</li>
        <li className="meta-chip">
          {league.providerTeamName
            ? `your team: ${league.providerTeamName}`
            : league.provider === 'sleeper' && league.providerUserId
              ? `connected as ${league.providerUsername ?? league.providerUserId}`
              : 'no account stored'}
        </li>
        <li className="meta-chip">{draft ? `last draft: ${draft.status}` : 'no draft tracked yet'}</li>
      </ul>

      <div className="league-roster-panel">
        <LeagueRoster
          provider={league.provider}
          providerLeagueId={league.providerLeagueId}
          providerUserId={league.providerUserId ?? null}
          draft={draft}
        />
      </div>
    </section>
  );
}

type DraftForDisplay = ReturnType<typeof draftToDisplay>;

/** The drafted-team half of the page, resolved per provider (see the route's doc). */
function LeagueRoster({ provider, providerLeagueId, providerUserId, draft }: {
  provider: 'sleeper' | 'espn' | 'manual';
  providerLeagueId: string | null;
  providerUserId: string | null;
  draft: DraftForDisplay;
}) {
  const { playersById, projections } = useBoardData(draft?.frozenInit?.settings ?? null);
  const [rosters, setRosters] = useState<Roster[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const isSleeper = provider === 'sleeper' && Boolean(providerUserId && providerLeagueId);
  useEffect(() => {
    if (!isSleeper || !providerUserId || !providerLeagueId) return;
    let active = true;
    setRosters(null);
    setRosterError(null);
    sleeperAdapter.rosters({ provider: 'sleeper', userId: providerUserId }, providerLeagueId)
      .then((result) => { if (active) setRosters(result); })
      .catch((err: unknown) => { if (active) setRosterError(err instanceof Error ? err.message : 'Could not load the roster from Sleeper.'); });
    return () => { active = false; };
  }, [isSleeper, providerUserId, providerLeagueId]);

  const emptyState = (
    <p>
      No draft tracked for this league yet. Start one from{' '}
      <Link to="/draft">the Draft Room</Link> — nothing is invented here until a real draft exists.
    </p>
  );

  if (isSleeper) {
    if (rosterError) return <p role="alert">{rosterError}</p>;
    if (!rosters) return <p className="muted">Loading the roster from Sleeper…</p>;
    const mine = rosters.find((roster) => roster.ownerId === providerUserId) ?? null;
    if (!mine) return emptyState;
    return <StoredRoster playersById={playersById} label="Your roster (live from Sleeper)" starters={mine.starters} bench={mine.bench} ir={mine.ir} />;
  }

  if (provider === 'espn' || provider === 'manual') {
    if (!draft || !draft.frozenInit || !draft.picks || draft.picks.length === 0) return emptyState;
    return (
      <MyTeamRail
        settings={draft.frozenInit.settings}
        effectivePicks={draft.picks}
        myTeamId={draft.frozenInit.myTeamId}
        playersById={playersById}
        projections={projections}
      />
    );
  }

  return emptyState;
}

/** The player pool the roster views join against. Loaded only when a roster will render. */
function useBoardData(settings: { format: { reception: string; qb: string } } | null): {
  playersById: ReadonlyMap<string, PlayerMeta>;
  projections: SeasonProjection[];
} {
  const [playersById, setPlayersById] = useState<ReadonlyMap<string, PlayerMeta>>(new Map());
  const [projections, setProjections] = useState<SeasonProjection[]>([]);

  const adpBoardKey = useMemo(
    () => (settings ? adpBoardKeyFor('sleeper', adpFormatFor(settings)) : null),
    [settings],
  );

  useEffect(() => {
    if (!adpBoardKey) return;
    let active = true;
    loadPlayerPool().then((players) => {
      if (active) setPlayersById(new Map(players.map((player) => [player.playerId, player])));
    }).catch(() => { if (active) setPlayersById(new Map()); });
    return () => { active = false; };
  }, [adpBoardKey]);

  useEffect(() => {
    let active = true;
    fetch('/data/projections-season.json')
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<SeasonProjection[]>; })
      .then((result) => { if (active) setProjections(result); })
      .catch(() => { if (active) setProjections([]); });
    return () => { active = false; };
  }, []);

  return { playersById, projections };
}

/** Plain stored-roster view (used for Sleeper's live fetch — MyTeamRail's slot optimizer is for
 * reconstructed drafts, and Sleeper already tells us the real slot assignment). */
function StoredRoster({ playersById, label, starters, bench, ir }: {
  playersById: ReadonlyMap<string, PlayerMeta>;
  label: string;
  starters: (string | null)[];
  bench: string[];
  ir: string[];
}) {
  const name = (playerId: string | null) => (playerId ? playersById.get(playerId)?.name ?? playerId : '—');
  return (
    <div className="stored-roster">
      <div>
        <h3>{label}</h3>
        <ul className="stored-roster-slots">
          {starters.map((playerId, index) => (
            <li key={`starter-${index}`} className="stored-roster-slot">
              <span className="stored-roster-slot-label">#{index + 1}</span>
              <span>{name(playerId)}</span>
            </li>
          ))}
        </ul>
      </div>
      {bench.length > 0 && (
        <div>
          <h4>Bench</h4>
          <ul className="stored-roster-chips">
            {bench.map((playerId) => <li key={playerId} className="stored-roster-chip">{name(playerId)}</li>)}
          </ul>
        </div>
      )}
      {ir.length > 0 && (
        <div>
          <h4>IR</h4>
          <ul className="stored-roster-chips">
            {ir.map((playerId) => <li key={playerId} className="stored-roster-chip">{name(playerId)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}