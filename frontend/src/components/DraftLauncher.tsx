import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { EspnLeagueSnapshot, EspnLiveSnapshot, LeagueSettings, SavedDraft, SavedLeague } from '../../../shared/types';
import { listSleeperDrafts, resolveUser, type SleeperDraftRef } from '../adapters/sleeper';
import { deriveEspnStreamOffsetSync } from '../adapters/espn';
import { deriveEspnDraftOrder } from '../adapters/espnDraftOrder';
import { espnLeagueToSettings } from '../adapters/espnLeague';
import { useEspnBridge } from '../hooks/useEspnBridge';
import { useSleeperAccount, type SleeperAccount } from '../data/useSleeperAccount';
import { useActiveSavedDrafts } from '../data/useSavedDrafts';
import { buildGuideSettings } from '../data/guideLeagueSettings';
import { CURRENT_SEASON } from '../data/season';
import { useDraftSession } from '../session/DraftSessionProvider';
import { ProviderBadge } from './ProviderBadge';

type LauncherProvider = 'sleeper' | 'espn';

/** A live-detected ESPN draft with no confirmed round count yet still needs SOME number to seed
 * `DraftInit.rounds` with — this is a display/grid fallback only, never a scoring guess, and the
 * in-workspace "Edit draft setup" dialog can correct it once ESPN's own answer lands late. */
const ROUNDS_FALLBACK = 15;

/**
 * The Draft Room launcher (2026-08-27 connect/start split; rebuilt 2026-08-28; **live-only
 * redesign 2026-08-29** — see DECISIONS.md). Rendered by /draft only while the session is
 * disconnected.
 *
 * The 2026-08-29 redesign removed the saved-ESPN-league cards entirely: the Draft Room now shows
 * ONLY what the extension detects live (mock or real — ESPN gives practice drafts a real league
 * record, so the same settings capture serves both), never a list of leagues the user separately
 * saved on /leagues/connect. Two bugs drove this: (1) `draftSync` used to CREATE a `SavedLeague` as
 * a side effect of syncing any live session, so the Draft Room silently populated My Leagues; (2) a
 * saved league's card and a live-detected draft's card, shown side by side, could cross-contaminate
 * — the saved card's "team detected"/"position detected" values were computed from whichever ESPN
 * snapshot the extension currently held, regardless of which draft the card was actually for.
 * Removing the saved-league card removes both failure classes outright rather than gating around
 * them. My Leagues (`/leagues`) remains the one place a league is saved, and only on explicit
 * action; `ResumeSection` below is the one way back into a saved league's IN-PROGRESS draft once
 * live detection lapses (the ESPN tab closed, the extension reloaded, "End draft" pressed by
 * mistake) — `/leagues/:id` cards deliberately never navigate to `/draft`.
 *
 * Sleeper drafts for the remembered account are still AUTO-LISTED (`listSleeperDrafts`), with a
 * paste-a-draft-id fallback; Sleeper's own `init()` always returns real scoring/roster settings for
 * any draft id, so it never had the "guessed preset" problem ESPN's live-detected card guards
 * against. NO navigation anywhere: this component already is /draft; setting the session
 * re-renders the route into the workspace. Connecting/saving leagues happens on /leagues/connect,
 * never here.
 */
export function DraftLauncher() {
  const { leagues, loading, error, refresh, account } = useSleeperAccount();
  const { handleConnect, handleEspnStart, handleResumeDraft } = useDraftSession();
  const { drafts: activeDrafts, removeDraft } = useActiveSavedDrafts();

  // ONE bridge poller for the whole launcher. ALWAYS on: live detection without a saved league
  // (ESPN mocks, a friend's league) requires listening even when nothing is connected — the draft
  // room is the one surface that pays this cost, by design. `detectedLeague` is the draft page's
  // own captured real settings (2026-08-29) — see useEspnBridge's doc.
  const { status: espnStatus, live: espnLive, detectedLeague } = useEspnBridge(null);

  // Same horizontal provider chooser as /leagues/connect (styles/leagues.css's .provider-chooser).
  // Defaults to Sleeper; auto-switches to ESPN the first time a live draft is detected so a
  // detected draft never hides behind an unclicked tab — but only until the user picks a tab
  // themselves, so a deliberate switch back to Sleeper isn't fought on the next bridge poll.
  const [activeProvider, setActiveProvider] = useState<LauncherProvider>('sleeper');
  const userChoseProviderRef = useRef(false);
  useEffect(() => {
    if (espnLive != null && !userChoseProviderRef.current) setActiveProvider('espn');
  }, [espnLive]);

  if (loading) {
    return (
      <section className="draft-room-empty">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Draft Room</p>
            <h2>Loading your leagues…</h2>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    // The API being down (vite proxies /api → the Functions host) must NOT read as "no leagues" —
    // that empty state is a factual claim about the user's data, and a failed fetch knows nothing
    // of the kind.
    return (
      <section className="draft-room-empty">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Draft Room</p>
            <h2>Could not load your leagues</h2>
          </div>
        </div>
        <p role="alert">{error.message}</p>
        <button type="button" onClick={() => void refresh()}>Retry</button>
      </section>
    );
  }

  return (
    <section className="draft-room-empty">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Draft Room</p>
          <h2>Start tracking a draft</h2>
        </div>
      </div>

      <ResumeSection drafts={activeDrafts} leagues={leagues} onResume={handleResumeDraft} onRemove={removeDraft} />

      <div className="provider-chooser" role="tablist" aria-label="Choose a provider">
        <button
          type="button"
          role="tab"
          aria-selected={activeProvider === 'sleeper'}
          className="provider-chip"
          onClick={() => { userChoseProviderRef.current = true; setActiveProvider('sleeper'); }}
        >
          <ProviderBadge brandKey="sleeper" size="sm" />
          Sleeper
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeProvider === 'espn'}
          className="provider-chip"
          onClick={() => { userChoseProviderRef.current = true; setActiveProvider('espn'); }}
        >
          <ProviderBadge brandKey="espn" size="sm" />
          ESPN
        </button>
        <button type="button" role="tab" aria-selected={false} className="provider-chip" disabled>
          <ProviderBadge brandKey="yahoo" size="sm" />
          Yahoo <span className="provider-chip-note">coming soon</span>
        </button>
      </div>

      {activeProvider === 'sleeper' && (
        <div className="draft-selection">
          {account && <SleeperDraftList account={account} onConnect={handleConnect} />}
          <TrackByDraftId cred={account ? { provider: 'sleeper', userId: account.userId } : null} onConnect={handleConnect} />
        </div>
      )}

      {activeProvider === 'espn' && (
        <div className="draft-selection">
          {espnLive != null ? (
            <ul className="draft-pick-list">
              <EspnLiveDetectedCard
                live={espnLive}
                status={espnStatus}
                detectedLeague={detectedLeague}
                resumable={espnLive.leagueId != null
                  ? activeDrafts.find(
                      (d) => d.mode === 'espn' && d.frozenInit != null && d.frozenInit.leagueId === espnLive.leagueId,
                    ) ?? null
                  : null}
                onResume={handleResumeDraft}
                onStart={(teams, rounds, seat, usesPresetSettings) =>
                  handleEspnStart(buildLiveDetectedLeague(espnLive, detectedLeague, teams, rounds), seat, usesPresetSettings)}
              />
            </ul>
          ) : (
            <p className="muted">{ESPN_STATUS_COPY[espnStatus] ?? ''}</p>
          )}
        </div>
      )}

      {leagues.length === 0 && (
        <p className="muted provider-card-note">
          Nothing connected yet? <Link to="/leagues/connect" className="quiet-button">Connect</Link>
        </p>
      )}
    </section>
  );
}

/** Active (in-progress) ESPN/manual drafts on a SAVED league — see the module doc for why this
 * exists. Renders nothing when there is nothing to resume, so it never adds an empty section. */
function ResumeSection({ drafts, leagues, onResume, onRemove }: {
  drafts: SavedDraft[];
  leagues: SavedLeague[];
  onResume: (draft: SavedDraft) => void;
  /** Deletes a stale transcript server-side and re-fetches — undefined only in tests that don't
   * exercise deletion; the Delete button simply doesn't render without it. */
  onRemove?: (id: string) => Promise<void>;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="draft-selection">
      <h3>Resume a draft</h3>
      <ul className="league-grid">
        {drafts.map((draft) => {
          const league = leagues.find((entry) => entry.id === draft.leagueId);
          return (
            <li className="league-tile" key={draft.id}>
              <div className="league-tile-head">
                <p className="league-tile-name">{league?.name ?? 'Saved draft'}</p>
              </div>
              <ul className="meta-chips">
                <li className="meta-chip">{draft.provider}</li>
                <li className="meta-chip">in progress</li>
              </ul>
              <div className="league-tile-actions">
                <button type="button" className="primary-button" onClick={() => onResume(draft)}>Resume</button>
                {onRemove && (
                  <button type="button" className="quiet-button" onClick={() => void onRemove(draft.id)}>Delete</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Auto-listed live drafts for the remembered Sleeper account. A load failure renders as an error,
 * NOT as "no drafts" — a failed fetch knows nothing of the kind. */
function SleeperDraftList({ account, onConnect }: {
  account: SleeperAccount;
  onConnect: (cred: { provider: 'sleeper'; userId: string }, draftId: string) => void;
}) {
  const [drafts, setDrafts] = useState<SleeperDraftRef[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry so the effect re-runs — a failed fetch must not dead-end the launcher.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listSleeperDrafts({ provider: 'sleeper', userId: account.userId }, CURRENT_SEASON)
      .then((result) => { if (active) setDrafts(result); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Could not load your Sleeper drafts.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account.userId, attempt]);

  if (loading) return <p className="muted">Loading drafts…</p>;
  if (error) {
    return (
      <>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </>
    );
  }
  if (!drafts || drafts.length === 0) {
    return <p className="muted">No {CURRENT_SEASON} Sleeper drafts on this account yet — paste a draft ID below.</p>;
  }
  return (
    <ul className="draft-pick-list">
      {drafts.map((draft) => (
        <SleeperDraftRow key={draft.draftId} draft={draft} account={account} onConnect={onConnect} />
      ))}
    </ul>
  );
}

const FINISHED_DRAFT_STATUSES = new Set(['complete']);

/** A listed draft. Finished drafts stay visible (disabled, with a "finished" chip) rather than
 * being hidden — hiding them would make the launcher look broken after a draft completes. */
function SleeperDraftRow({ draft, account, onConnect }: {
  draft: SleeperDraftRef;
  account: SleeperAccount;
  onConnect: (cred: { provider: 'sleeper'; userId: string }, draftId: string) => void;
}) {
  const finished = FINISHED_DRAFT_STATUSES.has(draft.status);
  return (
    <li className="draft-pick-row">
      <div className="draft-pick-info">
        <p className="draft-pick-name">{draft.name}</p>
        <ul className="meta-chips">
          {draft.totalTeams != null && <li className="meta-chip">{draft.totalTeams} teams</li>}
          <li className="meta-chip">{draft.type}</li>
          {finished && <li className="meta-chip">finished</li>}
        </ul>
      </div>
      <div className="draft-pick-actions">
        <button
          type="button"
          disabled={finished}
          onClick={() => onConnect({ provider: 'sleeper', userId: account.userId }, draft.draftId)}
        >
          {finished ? 'Finished' : 'Track draft'}
        </button>
      </div>
    </li>
  );
}

/** Paste-a-draft-id tracking (relocated from ConnectSleeper, 2026-08-27): for a mock or a friend's
 * draft. With zero saved leagues it resolves a Sleeper username first (the standalone escape
 * hatch — a mock-only user is never stranded by the connect/start split); with a saved Sleeper
 * league it reuses that league's stored credential. */
function TrackByDraftId({ cred, onConnect }: {
  cred: { provider: 'sleeper'; userId: string } | null;
  onConnect: (cred: { provider: 'sleeper'; userId: string }, draftId: string) => void;
}) {
  const [usernameInput, setUsernameInput] = useState('');
  const [draftId, setDraftId] = useState('');
  // Deliberately NOT seeded from the `cred` prop: `useSleeperAccount` resolves asynchronously, so
  // cred is null at mount and a state seed would lock that null in even after the account arrives
  // (forcing a known user through the username form). The prop is consulted live instead.
  const [resolvedCred, setResolvedCred] = useState<{ provider: 'sleeper'; userId: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived BEFORE the handlers that close over it — declaring it after them worked only because
  // the closures run post-render (TDZ by luck, not by design).
  const activeCred = resolvedCred ?? cred;

  async function handleResolve() {
    if (!usernameInput.trim()) return;
    setResolving(true);
    setError(null);
    try {
      const resolved = await resolveUser(usernameInput.trim());
      setResolvedCred({ provider: 'sleeper', userId: resolved.userId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find that Sleeper user.');
    } finally {
      setResolving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!activeCred && !resolvedCred) {
      if (usernameInput.trim()) await handleResolve();
      return;
    }
    const credToUse = resolvedCred ?? activeCred;
    if (credToUse && draftId.trim()) onConnect(credToUse, draftId.trim());
  }

  return (
    <form className="direct-draft-form" onSubmit={handleSubmit}>
      {!activeCred && !resolvedCred && (
        <label>
          Sleeper username
          <input value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} required />
        </label>
      )}
      <label>
        Draft ID
        <input value={draftId} onChange={(e) => setDraftId(e.target.value)} placeholder="Paste a draft ID" />
      </label>
      <button type="submit" disabled={!draftId.trim() || resolving}>
        {activeCred || resolvedCred ? 'Track' : 'Continue'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

const ESPN_STATUS_COPY: Record<string, string> = {
  'no-extension': 'Extension not detected — load it unpacked.',
  'no-espn-tab': 'Extension detected — open your ESPN draft tab, then start tracking.',
  'relay-silent': 'Extension stopped responding — reload this page and the ESPN tab.',
  live: 'ESPN draft tab connected.',
  stale: 'ESPN draft tab connection is stale.',
  disconnected: 'ESPN draft tab disconnected.',
};

/**
 * The ONE ESPN card (2026-08-29 live-only redesign): whatever the extension currently detects,
 * mock or real — never a saved-league list. Everything shown comes from either the live socket
 * snapshot (`live`) or the draft page's own periodic settings capture (`detectedLeague`); nothing
 * is typed except the seat, and the seat itself follows the existing rule exactly: NEVER seeded
 * from the ESPN team id, only "detected" once the CONFIRMED stream order maps that team id to a
 * position (`deriveEspnDraftOrder`).
 *
 * Teams/rounds are READ-ONLY chips, not typed inputs — unlike the old guessed-12/15-teams card,
 * ESPN's own mSettings answer (relayed via `live.leagueTeams`/`live.leagueRounds`, or
 * `detectedLeague`) is normally available within seconds of the first socket frame, so there is no
 * guess left to seed. A "detecting…" chip is shown honestly until then, and `seatValid` requires a
 * real team count — the button simply cannot be pressed on an unknown grid.
 *
 * Entry BLOCKS on real scoring settings by default (`hasRealSettings`) — the one guard this whole
 * redesign exists to add: drafting 15 rounds against a guessed PPR preset with no way to tell,
 * later, that it was ever a guess is worse than waiting a few seconds. "Start without ESPN's
 * scoring" is the one explicit, clearly-labeled escape hatch, and choosing it stamps
 * `usesPresetSettings: true` on the session — a persistent alert-strip disclosure
 * (DraftSessionProvider.tsx), never a one-time toast.
 *
 * ALL of `effTeams`/`effRounds`/`effSeason`/`derivedPosition`/`hasRealSettings` are gated on
 * `status === 'live'`: a stale/disconnected snapshot's numbers belong to whichever draft last
 * heartbeated, not necessarily this one (2026-08-29 "dead-draft snapshot" fix, DECISIONS.md).
 *
 * Renders NOTHING until `fullyDetected` (2026-08-30 simplification) — a dead/stale snapshot (the
 * ESPN tab closed, an old mock's residue) used to render a "Live draft detected" card whose own
 * status line said "disconnected", which read as broken rather than simply not-yet-connected.
 * `ResumeSection` (in the module above) already covers getting back into a saved league's
 * in-progress draft with no live detection required, so this card can afford to show nothing in
 * between rather than a half-known placeholder.
 */
function EspnLiveDetectedCard({ live, status, detectedLeague, resumable, onResume, onStart }: {
  live: EspnLiveSnapshot;
  status: string;
  detectedLeague: EspnLeagueSnapshot | null;
  /** An active saved transcript whose frozen init's league id matches the live snapshot — the
   * user already tracked THIS draft and its picks/settings live in Cosmos. Offer resume BEFORE
   * "Start tracking": a fresh start resets the board to zero picks and re-derives settings
   * (possibly the guessed PPR preset if the capture hasn't landed), which is exactly how a
   * re-entry into an existing draft looked like a total reset (2026-08-30). */
  resumable: SavedDraft | null;
  onResume: (draft: SavedDraft) => void;
  onStart: (teams: number, rounds: number, seat: number, usesPresetSettings: boolean) => void;
}) {
  const isLive = status === 'live';
  const leagueMatches = isLive && detectedLeague != null && live.leagueId != null && detectedLeague.leagueId === live.leagueId;
  const effTeams = isLive ? (live.leagueTeams ?? (leagueMatches ? detectedLeague!.teams : null)) : null;
  const effRounds = isLive ? (live.leagueRounds ?? (leagueMatches ? detectedLeague!.rounds : null)) : null;
  const effSeason = isLive
    ? (live.leagueSeason && live.leagueSeason !== '' ? live.leagueSeason : (leagueMatches ? detectedLeague!.season : null))
    : null;
  // Real scoring, not the guessed PPR preset — non-empty only once the draft page's own reconcile
  // has actually parsed a `scoringItems` list out of ESPN's payload (see espnLeague.ts's parser).
  const hasRealSettings = leagueMatches && Object.keys(detectedLeague!.scoring).length > 0;

  const offset = useMemo(() => deriveEspnStreamOffsetSync(live), [live]);
  const order = useMemo(
    () => deriveEspnDraftOrder(live.streamPicks, effTeams ?? 12, 'snake', offset),
    [live, effTeams, offset],
  );
  const derivedPosition = isLive && live.mySlot != null && order.reliable
    ? order.positionByTeam.get(live.mySlot) ?? null
    : null;

  const [seatInput, setSeatInput] = useState('');
  const [seatTouched, setSeatTouched] = useState(false);
  useEffect(() => {
    if (derivedPosition != null && !seatTouched) setSeatInput(String(derivedPosition));
  }, [derivedPosition, seatTouched]);
  const seat = Number(seatInput);
  const seatValid = Number.isInteger(seat) && effTeams != null && seat >= 1 && seat <= effTeams;
  const seatDetected = derivedPosition != null && seatInput === String(derivedPosition);

  const [overrideAccepted, setOverrideAccepted] = useState(false);
  const canEnter = (hasRealSettings || overrideAccepted) && seatValid;

  // Renders only once the live snapshot names the real draft grid — see the module doc above.
  const fullyDetected = isLive && effTeams != null && effRounds != null;
  if (!fullyDetected) return null;

  const cardName = live.leagueName && live.leagueName !== ''
    ? live.leagueName
    : (live.leagueId ? `ESPN live draft (${live.leagueId})` : 'ESPN live draft');
  const resumeButton = resumable != null && (
    <button
      type="button"
      className={resumable.picks?.length ? 'primary-button' : 'quiet-button'}
      onClick={() => onResume(resumable)}
    >
      Resume draft{resumable.picks?.length ? ` (${resumable.picks.length} picks logged)` : ''}
    </button>
  );

  return (
    <li className="draft-pick-row draft-pick-row-espn" data-testid="espn-live-detected-card">
      <div className="draft-pick-info">
        <p className="draft-pick-name">{cardName}</p>
        <ul className="meta-chips">
          <li className="meta-chip">{effSeason ?? String(CURRENT_SEASON)}</li>
          <li className="meta-chip">{effTeams} teams</li>
          <li className="meta-chip">{effRounds} rounds</li>
          {live.mySlot != null && (
            <li
              className="meta-chip"
              title="Your ESPN team id from the live draft room — a team id, not your draft position."
            >
              Team {live.mySlot}
            </li>
          )}
        </ul>
      </div>
      <div className="draft-pick-actions">
        <label className="draft-pick-seat">
          Position{seatDetected ? ' ✓' : ''}
          <input
            type="number"
            min={1}
            max={effTeams ?? undefined}
            value={seatInput}
            onChange={(e) => { setSeatTouched(true); setSeatInput(e.target.value); }}
            placeholder="e.g. 6"
          />
        </label>
        {resumeButton}
        <button
          type="button"
          className={resumable?.picks?.length ? 'quiet-button' : 'primary-button'}
          disabled={!canEnter}
          onClick={() => { if (canEnter && effTeams != null) onStart(effTeams, effRounds ?? ROUNDS_FALLBACK, seat, !hasRealSettings); }}
        >
          {derivedPosition != null ? 'Enter draft room' : 'Start tracking'}
        </button>
        {!hasRealSettings && !overrideAccepted && (
          <button type="button" className="quiet-button" onClick={() => setOverrideAccepted(true)}>
            Start without ESPN&apos;s scoring
          </button>
        )}
      </div>
      {!hasRealSettings && (
        <p className="muted draft-pick-note" data-testid="espn-settings-status">
          {overrideAccepted
            ? 'Tracking with a guessed PPR scoring preset.'
            : "Reading your league's real scoring settings from ESPN…"}
        </p>
      )}
    </li>
  );
}

/** Synthesize the SavedLeague `handleEspnStart` needs for a draft that was never separately saved
 * — the extension's live snapshot supplies the league id (once the draft-room socket has named
 * it), and `detectedLeague` (2026-08-29) supplies REAL scoring/roster settings whenever the draft
 * page's own capture has landed. Only falls back to the guide's PPR preset when the caller has
 * gone through the card's explicit override — see `EspnLiveDetectedCard`'s doc. */
function buildLiveDetectedLeague(live: EspnLiveSnapshot, detectedLeague: EspnLeagueSnapshot | null, teams: number, rounds: number): SavedLeague {
  const now = new Date().toISOString();
  const leagueId = live.leagueId ?? 'live-session';
  const leagueMatches = detectedLeague != null && detectedLeague.leagueId === leagueId;
  const hasRealSettings = leagueMatches && Object.keys(detectedLeague!.scoring).length > 0;
  // Prefer ESPN's own stamped league name (settings.name, either source) over the placeholder.
  const name = live.leagueName && live.leagueName !== ''
    ? live.leagueName
    : (leagueMatches && detectedLeague!.name && detectedLeague!.name !== 'ESPN league'
      ? detectedLeague!.name
      : (live.leagueId ? `ESPN live draft (${live.leagueId})` : 'ESPN live draft'));
  const season = live.leagueSeason != null && live.leagueSeason !== ''
    ? live.leagueSeason
    : (leagueMatches ? detectedLeague!.season : String(CURRENT_SEASON));
  const settings: LeagueSettings = hasRealSettings
    ? { ...espnLeagueToSettings(detectedLeague!), leagueId, name, season, teams }
    : { ...buildGuideSettings({ reception: 'ppr', qb: 'one-qb', teams, rounds }), provider: 'espn', leagueId, name, season, teams };
  return {
    id: `espn-live-${leagueId}`,
    userId: 'local',
    provider: 'espn',
    providerLeagueId: live.leagueId ?? null,
    name,
    season,
    teams,
    rounds,
    mySlot: null,
    settings,
    createdAt: now,
    updatedAt: now,
  };
}
