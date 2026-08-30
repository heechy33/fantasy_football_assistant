import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DataManifest, DraftInit, OnTheClock, Pick, PlayerId, SavedDraft, SavedLeague, SleeperCred } from '../../../shared/types';
import type { DraftBoardState } from '../state/draftBoardState';
import { canonicalPicksSignature, computeOnTheClock, picksMade, roundForOverall, slotForOverall, userPickBoundaries, type UserPickBoundaries } from '../adapters/draftOrder';
import { sleeperAdapter } from '../adapters/sleeper';
import type { ActiveProvider } from './activeProvider';
import type { SessionAlert } from '../components/SessionAlerts';
import type { SessionAction } from '../components/SessionMenu';
import { loadRankedPlayers, type AdpFormat, type RankedPlayer } from '../data/loadPlayerPool';
import { adpBoardKeyFor } from '../data/adpBoard';
import { useDraftBoardState } from '../hooks/useDraftBoardState';
import { useDraftPoll } from '../hooks/useDraftPoll';
import { useEspnBridge } from '../hooks/useEspnBridge';
import { observedTeamCount, observedTeamCountFromDetail } from '../adapters/espn';
import { requestEspnResetSnapshot } from '../adapters/espnBridge';
import { loadPersistedSession, savePersistedSession, clearPersistedSession } from '../state/persistence';
import { buildEspnDraftInit } from '../components/ManualDraftSetup';
import { isSessionComplete } from './completion';

/** The session kinds that can actually finish — the argument to `isSessionComplete`'s
 * `'complete'` transition and the value stored on `{ kind: 'complete' }.from`. Kept as its own
 * alias since it appears on both the completion effect and the new session variant below. */
type CompletableSessionKind = 'connected' | 'manual' | 'bridge';

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
      /** League config comes from the SAVED ESPN league (via buildEspnDraftInit) — the manual
       * create form is retired; mySlot is the typed draft position (JOINED/TOKEN's team id is a
       * separate cross-check, not an override — see espnSeatMismatch). */
      frozenInit: DraftInit;
      /** True when this session started before the draft page's own league-settings capture had
       * landed, on the launcher's explicit "start without ESPN's scoring" override (2026-08-29
       * live-only redesign) — `frozenInit.settings` is the guessed PPR preset, not this league's
       * real scoring/roster shape. Drives a persistent alert-strip disclosure and the same
       * `MANUAL_SCORING_DIAGNOSTICS` DataHealth already shows for pure-manual sessions (see
       * DraftRoomRoute.tsx). NOT persisted across a refresh (a known, accepted gap — the
       * underlying scoring model is unchanged by a refresh, only the banner would need re-deriving
       * from the SavedDraft/session history to survive one, which isn't wired up). */
      usesPresetSettings: boolean;
    }
  | {
      /** Terminal state (2026-08-28): a `connected`/`manual`/`bridge` session whose draft just
       * finished. Read-only — the workspace renders the frozen board under a completion banner,
       * with no live poll/bridge (both stop on their own since `draftId`/the bridge init derive
       * from `session.kind`, and neither of those kinds is `'complete'`). Exits only by explicit
       * user action (`View league` / `Start another draft`), never auto-navigation — see
       * DECISIONS.md, 2026-08-28. */
      kind: 'complete';
      frozenInit: DraftInit;
      /** Which kind this completed FROM — drives `sessionKindToMode`'s mapping in draftSync (an
       * unchecked cast used to let this fall through to 'manual' silently; see draftSync.ts).
       * Deliberately NOT used to derive `activeProvider` — a manual session's `kind` alone can't
       * tell a Sleeper takeover from an ESPN one (that's `reconnectCred`, which this variant
       * doesn't carry); `provider` below is the already-correct value captured at the moment of
       * transition instead. */
      from: CompletableSessionKind;
      /** `activeProvider` as computed for the session the instant before it completed — captured
       * directly rather than re-derived from `from`, since re-deriving would lose the
       * `reconnectCred` distinction for a completed manual (takeover) session. Narrowed to
       * exclude 'none': only `connected`/`manual`/`bridge` sessions ever reach `complete`, and
       * `activeProvider` is never 'none' for any of those three. */
      provider: 'sleeper' | 'espn';
      /** Captured once at the moment of transition (not recomputed on every persistence-effect
       * run, which would drift on every subsequent override edit to the frozen board). */
      completedAt: string;
      /** The SavedLeague this draft belongs to, when known, so "View league" can go straight to
       * `/leagues/:id` — see the `reportSavedLeagueId`/`handleEspnStart` call sites below. Null
       * for mock drafts (no league exists) and for any Sleeper draft draftSync hasn't resolved a
       * saved league for yet; both fall back to `/leagues`. */
      savedLeagueId: string | null;
    };

interface Correcting {
  mode: 'correct-existing' | 'add-manual';
  overall: number;
}

/**
 * Which setup dialog is open. Only 'edit' remains (2026-08-28): the manual-create path was
 * removed — ESPN drafts start only from a saved league via the Draft Room launcher
 * (`handleEspnStart`), and Sleeper drafts via `handleConnect`. The edit dialog corrects the seat
 * (mySlot) mid-draft for both session kinds. The old `'create'` variant's doc survives this note:
 * its ESPN-only create form was the last remaining way to start a draft without the extension,
 * which is exactly the ambiguity-prone path being retired.
 */
type ManualSetupDialog = { mode: 'edit' };

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

/**
 * Everything above the routes: one long-lived home for the draft-session machine (session state,
 * poll/bridge live layers, board state, clock math, alerts, transitions) so it keeps running while
 * the user browses any route — mounting it inside a route element would unmount (and kill the live
 * poll) on navigation. Relocated verbatim from `App.tsx` when routing landed; the only behavioral
 * change is that rehydration no longer force-navigates to `/draft` (the landing's Resume card is
 * the "you have a draft in progress" signal), and transition handlers navigate via
 * `useNavigate()` instead of a lifted `page` state. Since the 2026-08-27 connect/start split,
 * the session-start handlers (`handleConnect`/`handleEspnStart`) no longer
 * navigate at all — they fire from /draft itself (the Draft Room launcher), so setting the session
 * re-renders the route into the workspace. `navigate` now only serves the in-room session menu
 * (takeover/reconnect, already no-ops on /draft) and the "choose another draft" exits to /leagues.
 *
 * If profiling ever shows non-draft routes re-rendering on poll ticks, split this into
 * StateContext/ActionsContext — start with one until measured.
 */
export function DraftSessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session>({ kind: 'disconnected' });
  const [manifest, setManifest] = useState<DataManifest | null>(null);
  const [rankedPlayers, setRankedPlayers] = useState<RankedPlayer[]>([]);
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  /** Which setup dialog is open — only 'edit' (correct mySlot mid-draft); see ManualSetupDialog. */
  const [manualSetup, setManualSetup] = useState<ManualSetupDialog | null>(null);
  const [hydrated, setHydrated] = useState(false);
  /** The current session's SavedLeague id, when known — set directly at ESPN start (the league is
   * already in hand) or reported asynchronously by `useDraftSync` for Sleeper (draftSync resolves
   * it server-side; see `reportSavedLeagueId` below). Captured onto `{ kind: 'complete' }` when a
   * draft finishes so its banner's "View league" has somewhere to go. Reset only when a genuinely
   * NEW session starts (`handleConnect`, `handleEspnStart`, `handleChooseAnotherDraft`,
   * `handleReturnToConnect`) — takeover/reconnect/downgrade transitions keep it, since they're the
   * same underlying draft. */
  const [savedLeagueId, setSavedLeagueId] = useState<string | null>(null);

  /** The last seat auto-correction (see the effect below) — announced in the alert strip. Null
   * until a correction actually happens; cleared on any new session start. */
  const [seatCorrection, setSeatCorrection] = useState<{ from: number; to: number } | null>(null);
  /** The last league-size auto-correction (see the effect below) — announced in the alert strip.
   * The live-detected card seeds `teams` with a guess (the socket never states it); the stream
   * itself reveals the real size once one full round has completed. */
  const [teamsCorrection, setTeamsCorrection] = useState<{ from: number; to: number; source: 'espn' | 'derived' } | null>(null);
  /** The last draft-length correction — ESPN's mSettings rounds vs the session's value. */
  const [roundsCorrection, setRoundsCorrection] = useState<{ from: number; to: number } | null>(null);

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

      if (persisted.mode === 'complete' && persisted.frozenInit) {
        // A refresh on the completion banner must restore the banner, not resurrect a live poll
        // against a draft that's already over — this is the read side of the fix for the
        // "stuck on local storage" bug (DECISIONS.md, 2026-08-28). No live layer to arm here.
        board.setMode('manual');
        setSession({
          kind: 'complete',
          frozenInit: persisted.frozenInit,
          from: persisted.from === 'live' ? 'connected' : persisted.from === 'espn' ? 'bridge' : 'manual',
          // Stored explicitly at completion (see PersistedSession's doc) rather than re-derived
          // from `from` — a manual (takeover) session's kind alone can't tell Sleeper from ESPN.
          // Only a corrupted/pre-migration record would lack it; 'espn' is the safer default since
          // it never claims a Sleeper account that isn't there.
          provider: persisted.provider ?? 'espn',
          savedLeagueId: persisted.savedLeagueId,
          completedAt: persisted.completedAt ?? new Date().toISOString(),
        });
      } else if (persisted.mode === 'manual') {
        board.setMode('manual');
        setSession({
          kind: 'manual',
          frozenInit: persisted.frozenInit,
          reconnectCred: persisted.userId ? { provider: 'sleeper', userId: persisted.userId } : null,
          reconnectDraftId: persisted.draftId,
        });
        // No auto-navigation: the landing's ResumeCard ("Resume draft" → /draft) is the
        // in-progress indicator. A deep link to /draft-guide must not yank the user into
        // the draft room.
      } else if (persisted.mode === 'espn' && persisted.frozenInit) {
        // ESPN bridge sessions run the board in 'live' mode — picks flow back in through the
        // bridge's `livePicks`, not through `overrides` (already replayed above for any prior
        // manual corrections layered on top).
        board.setMode('live');
        // usesPresetSettings does not survive a refresh (see the session variant's doc) — false is
        // the safer default: it never CLAIMS the preset disclosure for a session that was actually
        // running real ESPN settings, it only risks the reverse (silently dropping a disclosure a
        // rare mid-draft refresh happened to lose).
        setSession({ kind: 'bridge', frozenInit: persisted.frozenInit, usesPresetSettings: false });
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

  const draftId = session.kind === 'connected' ? session.draftId : null;
  const cred = session.kind === 'connected' ? session.cred : IDLE_CRED;
  const poll = useDraftPoll({ adapter: sleeperAdapter, cred, draftId });

  const bridge = useEspnBridge(session.kind === 'bridge' ? session.frozenInit : null);
  // Live picks flow straight from whichever provider is active into the effective draft state
  // (merged with manual overrides) — no effect-driven relay, so a changed poll/bridge tick renders
  // the log/clock once, not twice. The ESPN bridge is a second live source, not a manual one: its
  // picks flow through `livePicks` exactly like Sleeper's poll, so board.mode stays 'live' while
  // connected and only a takeover freezes them into overrides (see handleBridgeToManual).
  const livePicks = session.kind === 'bridge'
    ? (bridge.picks?.picks ?? EMPTY_PICKS)
    : (poll.draftPicks?.picks ?? EMPTY_PICKS);
  const board = useDraftBoardState(livePicks);

  // D9 backstop: the board's live/manual mode must always match what the session implies (bridge
  // and connected sessions run live; everything else runs manual). The transition handlers below
  // (handleEspnBridgeConnect, handleBridgeToManual, the hydration branch, etc.) already set this
  // explicitly at the moment of transition — that stays, since it keeps the very next render
  // consistent instead of flashing one extra render with the live layer unmerged. This effect is
  // the safety net: `setMode` is a no-op when the mode already matches, so it never fights those
  // explicit calls, but it guarantees convergence even if a future session-creating path forgets to
  // call setMode itself (the exact class of bug this session's ESPN sync regression traced back to).
  useEffect(() => {
    const derivedMode: DraftBoardState['mode'] = session.kind === 'bridge' || session.kind === 'connected' ? 'live' : 'manual';
    board.setMode(derivedMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind]);

  useEffect(() => {
    if (!hydrated) return;
    // `disconnected` writes NOTHING and clears instead — before this fix the effect always wrote
    // an empty-but-present record here (`{userId:null, draftId:null, mode:'live', ...}`), which is
    // why `handleChooseAnotherDraft`/`handleReturnToConnect`'s own `clearPersistedSession()` call
    // never stayed cleared: this effect immediately re-ran on the resulting re-render and wrote
    // the empty record straight back (DECISIONS.md, 2026-08-28).
    if (session.kind === 'disconnected') {
      clearPersistedSession();
      return;
    }
    savePersistedSession({
      userId: session.kind === 'connected'
        ? session.cred.userId
        : (session.kind === 'manual' ? session.reconnectCred?.userId ?? null : null),
      draftId: session.kind === 'connected'
        ? session.draftId
        : (session.kind === 'manual' ? session.reconnectDraftId : null),
      mode: session.kind === 'complete'
        ? 'complete'
        : (session.kind === 'manual' ? 'manual' : (session.kind === 'bridge' ? 'espn' : 'live')),
      overrides: [...board.state.overrides.values()],
      frozenInit: session.kind === 'manual' || session.kind === 'bridge' || session.kind === 'complete'
        ? session.frozenInit
        : null,
      completedAt: session.kind === 'complete' ? session.completedAt : null,
      from: session.kind === 'complete'
        ? (session.from === 'connected' ? 'live' : session.from === 'bridge' ? 'espn' : 'manual')
        : null,
      provider: session.kind === 'complete' ? session.provider : null,
      savedLeagueId: session.kind === 'complete' ? session.savedLeagueId : null,
    });
  }, [hydrated, session, board.state.overrides]);

  // Manual takeover freezes the latest DraftInit into the manual session, so the workspace and
  // clock math keep working with no live poll. `effectiveInit` is the single source for that:
  // connected sessions read the poll's init, takeover sessions read the frozen copy, bridge
  // sessions read the bridge-merged init (form settings + JOINED/TOKEN mySlot), and a completed
  // session reads its own frozen init (there is no live poll/bridge left to read from by then).
  const effectiveInit = session.kind === 'connected'
    ? poll.draftInit
    : (session.kind === 'bridge'
        ? bridge.init
        : (session.kind === 'manual' || session.kind === 'complete' ? session.frozenInit : null));
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
      ? computeOnTheClock(effectiveInit.draftType, effectiveInit.teams, effectiveInit.rounds, picksMade(board.effectivePicks), effectiveInit.slotToTeam)
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
      effectiveInit.draftType, effectiveInit.teams, effectiveInit.rounds, picksMade(board.effectivePicks),
      effectiveInit.slotToTeam, effectiveInit.myTeamId,
    );
    // picksSignature stands in for `effectivePicks` here — see comment on the memo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInit, picksSignature]);

  /** Which provider owns the live/frozen session — drives the status pill and Home's per-card
   * resume. A manual session with no `reconnectCred` is always the ESPN path (ConnectSleeper no
   * longer offers a manual-skip link, so nothing else reaches that combination). */
  const activeProvider: ActiveProvider = session.kind === 'connected'
    || (session.kind === 'manual' && session.reconnectCred != null)
    || (session.kind === 'complete' && session.from === 'connected')
    ? 'sleeper'
    : session.kind === 'bridge'
      || (session.kind === 'manual' && session.reconnectCred == null)
      || (session.kind === 'complete' && session.provider !== 'sleeper')
      ? 'espn'
      : 'none';
  const preCompletionActiveProvider = activeProvider;

  // Draft-end detection (2026-08-28): the ONE place a live session gets flagged finished. Both
  // adapters have always computed `DraftPicks.status`, and nobody consumed it — this effect is
  // that consumer. On the transition it freezes the board (same atomic freeze
  // `handleTakeoverManual` uses, so nothing typed/streamed in is lost) and moves to `{ kind:
  // 'complete' }`; because `draftId`/the bridge init both derive from `session.kind`, the poll and
  // the bridge stop polling on their own the next render — no separate teardown needed. Only a
  // Sleeper `connected` session has a `pollStatus` to pass (bridge/manual have no poll at all — see
  // `isSessionComplete`'s doc), so the count rule is what actually detects ESPN/manual completion.
  //
  // `preCompletionActiveProvider` is `activeProvider` computed for the CURRENT (pre-transition)
  // session, captured before this effect runs so the new `complete` session can carry the right
  // pill color forward without re-deriving it (a manual session's `kind` alone can't distinguish a
  // Sleeper takeover from an ESPN one — see the `provider` field's doc on the Session type).
  useEffect(() => {
    if (session.kind !== 'connected' && session.kind !== 'manual' && session.kind !== 'bridge') return;
    if (!effectiveInit) return;
    const pollStatus = session.kind === 'connected' ? poll.draftPicks?.status : undefined;
    if (!isSessionComplete({ init: effectiveInit, effectivePicks: board.effectivePicks, pollStatus })) return;
    const from = session.kind;
    // Defensive, not just a type narrowing: preCompletionActiveProvider is 'none' only for a
    // disconnected session, which the guard above already excludes — but a `complete` session
    // must never claim provider 'none', so this bails rather than casting past the type.
    if (preCompletionActiveProvider === 'none') return;
    const provider = preCompletionActiveProvider;
    board.freeze();
    setCorrecting(null);
    setSession({ kind: 'complete', frozenInit: effectiveInit, from, provider, savedLeagueId, completedAt: new Date().toISOString() });
    // picksSignature stands in for `board.effectivePicks` here — see its own memo's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, effectiveInit, picksSignature, poll.draftPicks?.status, savedLeagueId, preCompletionActiveProvider]);

  /** Which ADP board the session should read — derived once here so DraftWorkspace, the manual
   * correction board, and DataHealth all agree (ESPN PPR sessions read the additive
   * `adp-espn-ppr.json`; everything else stays on the plain format board). The key travels, not
   * the provider string — see `data/adpBoard.ts`. */
  const adpBoardKey = useMemo(() => adpBoardKeyFor(activeProvider, adpFormat), [activeProvider, adpFormat]);

  /** The extension's live-snapshot `leagueId`/`epoch` captured the first time THIS bridge session
   * observes a live snapshot — the baseline the "streaming a different draft" alert (inside the
   * sessionAlerts memo below) diffs against. Reset to `null` at every bridge-session transition
   * (`handleEspnStart`, `handleEspnBridgeConnect`, `handleBridgeToManual`, `handleEndDraft`) so a
   * fresh session establishes its own baseline instead of comparing against a previous one.
   * DECLARED BEFORE the sessionAlerts memo deliberately: that memo reads this ref, and a `const`
   * declaration read by code that runs earlier is a temporal-dead-zone ReferenceError at first
   * render — the black-page crash of 2026-08-29, invisible to the suite because jsdom tests never
   * render a bridge session with a live snapshot on the first pass. */
  const bridgeBaselineRef = useRef<{ leagueId: string | null; epoch: number } | null>(null);

  /** Bumped by `handleEndDraft` so draftSync (which owns the Cosmos SavedDraft id) can delete the
   * ended draft's transcript — see draftSync.ts's end-draft effect. The provider deliberately does
   * NOT track the saved-draft id itself: draftSync's reconcile resolves it, so the signal is just
   * a monotonic "an intentional End just happened" event the sync layer consumes exactly once. */
  const [endDraftSeq, setEndDraftSeq] = useState(0);

  /** Honest-failure signals for the ESPN bridge, surfaced in the alert strip under the top bar
  /** Honest-failure signals for the ESPN bridge, surfaced in the alert strip under the top bar
   * (see SessionAlerts) instead of the old always-on "ESPN bridge" chrome slab — driven by the same
   * status enum/seatMismatch/desyncReason as before, just re-routed. Empty while
   * `bridge.status === 'live'`; the status pill covers the healthy case.
   *
   * Also covers the state that caused the 2026-08-15 sync regression: a `manual` session that
   * `activeProvider` still reports as `'espn'` (i.e. the ESPN bridge was never armed, or was
   * switched off via "Switch to manual") used to render NO alert at all — an ESPN status pill with
   * zero picks streaming and nothing on screen saying why. That state must always self-announce. */
  const sessionAlerts: SessionAlert[] = useMemo(() => {
    const alerts: SessionAlert[] = [];
    if (session.kind === 'bridge') {
      if (bridge.status === 'no-extension') {
        alerts.push({ id: 'no-extension', message: 'ESPN extension not detected — install the unpacked extension and reload this page. Picks can still be logged manually.' });
      } else if (bridge.status === 'relay-silent') {
        alerts.push({ id: 'relay-silent', message: 'The ESPN extension stopped responding — it was likely reloaded. Reload this page AND the ESPN draft tab to reconnect. Picks can still be logged manually.', severity: 'danger' });
      } else if (bridge.status === 'no-espn-tab') {
        alerts.push({ id: 'no-espn-tab', message: 'Extension detected, but no ESPN draft tab is open yet. Open the ESPN draft page and keep it open. Picks can still be logged manually.' });
      } else if (bridge.status === 'stale' || bridge.status === 'disconnected') {
        alerts.push({ id: 'bridge-silent', message: 'ESPN draft tab is silent — keep it open. Picks can still be logged manually.' });
      }
      // Guard that would have caught the 2026-08-15 rehearsal bug: the typed draft position
      // disagrees with the position the live order assigns to your ESPN team id.
      if (bridge.seatMismatch) {
        alerts.push({
          id: 'seat-mismatch',
          message: bridge.seatMismatch,
          severity: 'danger',
          action: { label: 'Edit draft setup', onSelect: () => setManualSetup({ mode: 'edit' }) },
        });
      }
      if (bridge.relayWarning) {
        alerts.push({ id: 'relay-warning', message: bridge.relayWarning, severity: 'danger' });
      }
      // A confirmed non-zero offset means this tab attached mid-draft (Step 6) — the earlier picks
      // simply aren't in the log. Informational (warn); the healthy offset needs no action.
      const attachPoint = bridge.picks && bridge.picks.unattributedCount === 0
        && bridge.picks.picks.length > 0 && bridge.picks.picks[0]!.overall > 1
        ? bridge.picks.picks[0]!.overall
        : null;
      if (attachPoint != null) {
        alerts.push({
          id: 'late-attach',
          message: `This ESPN tab attached mid-draft at pick ${attachPoint} — earlier picks aren't in the log.`,
          severity: 'warn',
        });
      }
      // Attribution unconfirmed — every pick is honest about not knowing its team/position. Danger
      // with a concrete escape hatch (the existing "Switch to manual" flow).
      if ((bridge.picks?.unattributedCount ?? 0) > 0) {
        alerts.push({
          id: 'unattributed-picks',
          message: 'Pick attribution isn\'t confirmed yet — team and position may be off until it resolves. Switch to manual to log picks yourself.',
          severity: 'danger',
          action: { label: 'Switch to manual', onSelect: handleBridgeToManual },
        });
      }

      // Desync now reports only offset-CONFIRMED problems (missed frames); the "not confirmed yet"
      // case and the rare internally-inconsistent order both leave picks unattributed, and are
      // surfaced by the dedicated unattributed-picks alert above instead.
      if (bridge.picks?.desyncReason && (bridge.picks.unattributedCount ?? 0) === 0) {
        alerts.push({ id: 'desync', message: bridge.picks.desyncReason });
      }

      // The seat auto-correction below is never silent — this announces what changed and why.
      if (seatCorrection) {
        alerts.push({
          id: 'seat-corrected',
          message: `Draft position corrected to ${seatCorrection.to} — derived from the live draft order (was ${seatCorrection.from}).`,
        });
      }
      // Same for the league-size correction (live-detected sessions start with a seeded guess).
      // The wording reflects the ACTUAL source (ESPN's own stamped answer vs. derived from the
      // live draft order's pick pattern) — this message is how the user judges whether to trust
      // the number, so it must not claim "derived" when the value was actually read from ESPN.
      if (teamsCorrection) {
        alerts.push({
          id: 'teams-corrected',
          message: teamsCorrection.source === 'espn'
            ? `League size corrected to ${teamsCorrection.to} teams — read from ESPN (was ${teamsCorrection.from}).`
            : `League size corrected to ${teamsCorrection.to} teams — derived from the live draft order (was ${teamsCorrection.from}).`,
        });
      }
      // And the draft length (read from ESPN's own settings, not derived from pick patterns).
      if (roundsCorrection) {
        alerts.push({
          id: 'rounds-corrected',
          message: `Draft length corrected to ${roundsCorrection.to} rounds — read from ESPN (was ${roundsCorrection.from}).`,
        });
      }
      // Preset-settings disclosure (2026-08-29 live-only redesign): this session started on the
      // launcher's explicit "start without ESPN's scoring" override because the draft page's own
      // settings capture hadn't landed yet — frozenInit.settings is a guessed PPR preset, not this
      // league's real scoring/roster shape. PERSISTENT for the whole session (not a one-time
      // toast): the underlying scoring model doesn't change once the draft is under way, so the
      // disclosure must not either. DataHealth's scoringDiagnostics carries the matching detail —
      // see DraftRoomRoute.tsx.
      if (session.usesPresetSettings) {
        alerts.push({
          id: 'preset-settings',
          message: 'Tracking with a guessed PPR scoring preset — ESPN\'s real league settings had not been read yet when this draft started.',
          severity: 'danger',
        });
      }
      // Wedged-session guard (2026-08-29): the shared extension key is one browser-wide slot, so
      // opening a DIFFERENT ESPN draft (a new mock after abandoning this one, a friend's league)
      // while this room is still open starts overwriting it — a different `leagueId`, or the same
      // league restarted (`epoch` advanced past this session's baseline). Without this the board
      // just silently stops updating with no explanation. "Switch to that draft" reuses End draft:
      // the launcher's live-detection card (DraftLauncher.tsx) picks the new stream straight up.
      if (bridge.live && bridgeBaselineRef.current) {
        const baseline = bridgeBaselineRef.current;
        const differentLeague = bridge.live.leagueId != null && baseline.leagueId != null && bridge.live.leagueId !== baseline.leagueId;
        const restarted = (bridge.live.epoch ?? 0) > baseline.epoch;
        if (differentLeague || restarted) {
          alerts.push({
            id: 'streaming-different-draft',
            message: `The extension is now streaming a different ESPN draft. This room is still tracking ${session.frozenInit.settings.name}.`,
            severity: 'danger',
            action: { label: 'Switch to that draft', onSelect: handleEndDraft },
          });
        }
      }
    } else if (session.kind === 'manual' && session.reconnectCred == null && session.frozenInit) {
      // An ESPN-eligible manual session (created via ESPN setup, or downgraded from a bridge via
      // "Switch to manual") that isn't currently streaming — the exact state the header can't
      // distinguish from a healthy bridge on its own.
      alerts.push({
        id: 'bridge-not-connected',
        message: 'Not connected to your ESPN draft tab — picks are being logged manually. Connect the extension to stream picks live.',
        action: { label: 'Connect ESPN tab', onSelect: handleEspnBridgeConnect },
      });
    }
    return alerts;
  }, [session, bridge.status, bridge.seatMismatch, bridge.relayWarning, bridge.picks, bridge.live, seatCorrection, teamsCorrection, roundsCorrection]);

  // SEAT AUTO-CORRECTION (2026-08-28): the moment the CONFIRMED live draft order assigns your
  // ESPN team id a draft position that disagrees with the session's seat, adopt the derived
  // position. The workspace's pick timing, on-the-clock math, and recommendation planning all key
  // off `mySlot` — a wrong seat (e.g. ESPN's team id 1 mistaken for position 1) silently corrupts
  // all three, and the old warn-only path made the user go fix it by hand mid-draft. Correction
  // reuses `handleManualSetupEdit`'s board-preserving re-target (picks are re-derived from the
  // stream on the next tick), and the change is announced via the `seat-corrected` alert above —
  // never silent. The ref prevents re-firing on every render; a genuinely different derived value
  // (conflict resolution) corrects again.
  const correctedSeatRef = useRef<number | null>(null);
  useEffect(() => {
    if (session.kind !== 'bridge' || !bridge.live) return;
    if (bridgeBaselineRef.current == null) {
      bridgeBaselineRef.current = { leagueId: bridge.live.leagueId, epoch: bridge.live.epoch ?? 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, bridge.live?.leagueId, bridge.live?.epoch]);
  useEffect(() => {
    if (session.kind !== 'bridge') return;
    // Never auto-correct from a stale/disconnected snapshot (2026-08-29): the shared key survives
    // a finished draft, and its order would rewrite the seat to the OLD draft's position.
    if (bridge.isStale) return;
    const derived = bridge.derivedSeat;
    if (derived == null || derived === correctedSeatRef.current) return;
    correctedSeatRef.current = derived;
    const from = session.frozenInit.mySlot;
    if (from === derived) return;
    handleManualSetupEdit({ ...session.frozenInit, mySlot: derived, myTeamId: String(derived) });
    setSeatCorrection({ from: from ?? 0, to: derived });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, bridge.derivedSeat]);

  // LEAGUE-SIZE AUTO-CORRECTION (2026-08-28): the live-detected card seeds `teams` with a guess,
  // and every grid computation — round headers, positions, the clock, completion — keys off it.
  // A from-pick-1 snake stream reveals the real size: the first team id to REPEAT marks one full
  // round, so the repeat's arrival index IS the league size. Corrected once per session,
  // board-preserving (picks re-derive from the stream on the next tick), and announced below —
  // never silent. A mid-draft attach repeats immediately, which observedTeamCount rejects.
  const correctedTeamsRef = useRef<number | null>(null);
  useEffect(() => {
    if (session.kind !== 'bridge') return;
    // Same stale gate as the seat correction above — a corpse's team-id pattern is not evidence.
    if (bridge.isStale) return;
    const live = bridge.live;
    // Precedence (2026-08-28 fix): ESPN's OWN stamped answer first, then the detail history's
    // from-pick-1 team-id sequence (immune to the snake-turnaround false repeat that made a
    // mid-draft STREAM attach read "6 teams" for a 10-team league), and only then the stream
    // pattern for a confirmed from-pick-1 attach.
    const observed = live?.leagueTeams
      ?? observedTeamCountFromDetail(live?.detailPicks)
      ?? observedTeamCount(live?.streamPicks ?? []);
    if (observed == null || observed === correctedTeamsRef.current) return;
    correctedTeamsRef.current = observed;
    const init = session.frozenInit;
    if (observed === init.teams) return;
    const slotToTeam: Record<number, string> = {};
    const slotToTeamName: Record<number, string> = {};
    for (let slot = 1; slot <= observed; slot += 1) {
      slotToTeam[slot] = String(slot);
      slotToTeamName[slot] = `Team ${slot}`;
    }
    handleManualSetupEdit({
      ...init,
      teams: observed,
      slotToTeam,
      slotToTeamName,
      settings: { ...init.settings, teams: observed },
    });
    setTeamsCorrection({ from: init.teams, to: observed, source: live?.leagueTeams === observed ? 'espn' : 'derived' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, bridge.live]);

  // DRAFT LENGTH + SEASON (2026-08-28): ESPN's own mSettings answer for the two things the socket
  // can never say. Rounds drive the clock total and completion detection — a wrong value silently
  // moves the finish line. Same board-preserving re-target + announcement as the teams correction.
  // Season is record-keeping only (the hub's cards) and corrects silently. A mid-draft attach is
  // exactly when these matter: the launcher could only have guessed.
  const correctedRoundsRef = useRef<number | null>(null);
  useEffect(() => {
    if (session.kind !== 'bridge') return;
    // Same stale gate as the seat/teams corrections above.
    if (bridge.isStale) return;
    const live = bridge.live;
    if (live == null) return;
    const init = session.frozenInit;
    let changed = false;
    let next = init;
    if (live.leagueRounds != null && live.leagueRounds >= 1 && live.leagueRounds <= 30 && live.leagueRounds !== init.rounds) {
      if (correctedRoundsRef.current !== live.leagueRounds) {
        correctedRoundsRef.current = live.leagueRounds;
        setRoundsCorrection({ from: init.rounds, to: live.leagueRounds });
      }
      next = { ...next, rounds: live.leagueRounds };
      changed = true;
    }
    if (live.leagueSeason != null && live.leagueSeason !== '' && live.leagueSeason !== init.settings.season) {
      next = { ...next, settings: { ...next.settings, season: live.leagueSeason } };
      changed = true;
    }
    if (changed) handleManualSetupEdit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, bridge.live]);

  useEffect(() => {
    let active = true;
    loadRankedPlayers(adpBoardKey)
      .then((players) => { if (active) setRankedPlayers(players); })
      .catch(() => { if (active) setRankedPlayers([]); });
    return () => { active = false; };
  }, [adpBoardKey]);

  function handleConnect(newCred: SleeperCred, newDraftId: string) {
    board.reset('live');
    setCorrecting(null);
    setSeatCorrection(null);
    setTeamsCorrection(null);
    setRoundsCorrection(null);
    // A brand-new draft: whatever SavedLeague id draftSync resolved for the PREVIOUS draft must
    // not leak into this one's eventual completion banner. draftSync reports the new one in
    // asynchronously as it resolves — see `reportSavedLeagueId`.
    setSavedLeagueId(null);
    setSession({ kind: 'connected', cred: newCred, draftId: newDraftId });
  }

  /** Start tracking a LIVE-DETECTED ESPN draft from the Draft Room launcher (2026-08-29 live-only
   * redesign — see DECISIONS.md). `league` is synthesized by the launcher directly from the
   * extension's snapshot (`buildLiveDetectedLeague`), never read from a saved-league list — the
   * Draft Room no longer shows saved ESPN leagues at all. The only thing ESPN can't know ahead of
   * time is the seat — the snake order isn't revealed until ~6:00 PM — so that stays the one typed
   * input (prefilled/detected from the bridge's JOINED/TOKEN signal when present). Everything else
   * comes off `league` via {@link buildEspnDraftInit}. `usesPresetSettings` (default false) is true
   * only when the launcher's explicit "start without ESPN's scoring" override was used because the
   * draft page's own settings capture hadn't landed yet — see the `bridge` session variant's doc.
   * Called from /draft itself, so — like handleConnect — no navigation: setting the session
   * re-renders the route into the workspace. */
  function handleEspnStart(league: SavedLeague, mySlot: number, usesPresetSettings = false) {
    board.reset('live');
    setCorrecting(null);
    setSeatCorrection(null);
    setTeamsCorrection(null);
    setRoundsCorrection(null);
    // A fresh session gets a fresh auto-correction history (see the effects below) — all three
    // refs, not just the seat one, or a second bridge session in the same page life silently
    // refuses to auto-correct teams/rounds (it thinks it already corrected them once).
    correctedSeatRef.current = null;
    correctedTeamsRef.current = null;
    correctedRoundsRef.current = null;
    // A fresh session also gets a fresh "streaming a different draft" baseline (see the alert
    // above) — otherwise it would immediately compare against whatever the PREVIOUS bridge session
    // last saw.
    bridgeBaselineRef.current = null;
    // No SavedLeague exists for a live-detected draft (the Draft Room never saves one) — draftSync
    // only updates an EXISTING saved league, so a null id here correctly means "write nothing".
    setSavedLeagueId(null);
    setSession({ kind: 'bridge', frozenInit: buildEspnDraftInit(league, mySlot), usesPresetSettings });
    setManualSetup(null);
  }

  /**
   * Resume an in-progress SAVED draft (ESPN or manual) from its Cosmos `SavedDraft` transcript —
   * the launcher's one way back into a session whose live detection lapsed (the ESPN tab closed,
   * the extension reloaded, "End draft" pressed by mistake). Since the 2026-08-29 live-only
   * redesign the Draft Room no longer lists saved leagues at all, so without this a lapsed
   * in-progress draft on a saved league would be permanently stranded — `/leagues/:id` cards
   * deliberately never navigate to `/draft` (DECISIONS.md, 2026-08-27). Sleeper never reaches here
   * in practice — `useActiveSavedDrafts` (data/useSavedDrafts.ts) filters it out deliberately, not
   * because it never syncs (a real Sleeper league's in-progress draft does), but because the
   * Sleeper section already resumes any live Sleeper draft straight from Sleeper's own API, and a
   * synced Sleeper row's `frozenInit` is always null anyway (see that hook's doc). Mirrors the
   * hydration effect's `'espn'`/`'manual'` branches above, sourced from a fetched `SavedDraft`
   * instead of localStorage. `usesPresetSettings` is
   * always false here: a saved draft's `frozenInit.settings` came from a real ESPN league capture
   * at connect time (or a manual form), never the launcher's guessed-preset override.
   */
  function handleResumeDraft(draft: SavedDraft) {
    if (!draft.frozenInit) return; // Should not happen for espn/manual rows — nothing to resume without one.
    board.reset(draft.mode === 'espn' ? 'live' : 'manual');
    for (const override of draft.overrides) board.applyOverride(override);
    setCorrecting(null);
    setSeatCorrection(null);
    setTeamsCorrection(null);
    setRoundsCorrection(null);
    correctedSeatRef.current = null;
    correctedTeamsRef.current = null;
    correctedRoundsRef.current = null;
    bridgeBaselineRef.current = null;
    setSavedLeagueId(draft.leagueId);
    if (draft.mode === 'espn') {
      setSession({ kind: 'bridge', frozenInit: draft.frozenInit, usesPresetSettings: false });
    } else {
      setSession({ kind: 'manual', frozenInit: draft.frozenInit, reconnectCred: null, reconnectDraftId: null });
    }
    setManualSetup(null);
  }

  /** Re-target an existing manual or ESPN-bridge session (e.g. mySlot after the ~6:00 PM order
   * reveal, or correcting a seat-mismatch warning) without touching the board — picks are keyed by
   * draft position, and the bridge re-derives them from the stream on its next tick, so no
   * freeze/reset is needed for either session kind. */
  function handleManualSetupEdit(init: DraftInit) {
    setSession((current) => (
      current.kind === 'manual' || current.kind === 'bridge' ? { ...current, frozenInit: init } : current
    ));
    setManualSetup(null);
  }

  /** Upgrade a pure-manual session to the ESPN bridge. Settings stay from the form; the bridge's
   * picks flow in through `livePicks` (same live layer Sleeper uses), so the board must switch to
   * 'live' mode. Any picks already logged by hand before connecting stay put — they're
   * `manual-correction`/`manual-entry` overrides, and an override always wins over a live pick at
   * the same `overall` (see draftBoardState.ts), so the ESPN stream fills in only what wasn't
   * already typed. */
  function handleEspnBridgeConnect() {
    if (session.kind !== 'manual' || !session.frozenInit || session.reconnectCred) return;
    board.setMode('live');
    bridgeBaselineRef.current = null;
    // A manual session's settings never came from the launcher's guessed-preset override (that
    // path only exists on a fresh handleEspnStart) — real settings either way.
    setSession({ kind: 'bridge', frozenInit: session.frozenInit, usesPresetSettings: false });
  }

  /** Drop back to pure manual: the same atomic freeze as the Sleeper takeover button (every
   * effective pick — live-streamed or already-corrected — becomes a manual-entry override, then
   * the board switches to 'manual'). Without this, switching board.mode straight to 'manual' would
   * silently discard every pick that only ever existed in the live layer. */
  function handleBridgeToManual() {
    if (session.kind !== 'bridge') return;
    board.freeze();
    setCorrecting(null);
    bridgeBaselineRef.current = null;
    setSession({ kind: 'manual', frozenInit: session.frozenInit, reconnectCred: null, reconnectDraftId: null });
  }

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
    navigate('/draft');
  }

  /** Resume live polling for the taken-over session; falls back to the connect flow without one. */
  function handleReconnect() {
    if (session.kind === 'manual' && session.reconnectCred && session.reconnectDraftId) {
      board.reset('live');
      setCorrecting(null);
      setSession({ kind: 'connected', cred: session.reconnectCred, draftId: session.reconnectDraftId });
      navigate('/draft');
      return;
    }
    handleReturnToConnect();
  }

  function handleChooseAnotherDraft() {
    board.reset('live');
    setCorrecting(null);
    setSavedLeagueId(null);
    setSession({ kind: 'disconnected' });
    // Intentional exit from the draft story — the localStorage resume record must not survive it
    // (the persistence-save effect above now clears on `disconnected` itself, but calling this
    // explicitly here keeps the exit synchronous rather than waiting on that effect's next run),
    // and the league hub is the natural landing now that leagues are first-class.
    clearPersistedSession();
    navigate('/leagues');
  }

  /** Ends a `bridge` or `manual` session that has no other exit (2026-08-29 fix — see
   * DECISIONS.md). Before this, an abandoned ESPN draft left the Draft Room permanently wedged:
   * `sessionActions` offered `bridge`/`manual` no exit action at all, `DraftRoomRoute` only renders
   * the launcher for a `disconnected` session, and `persistence.ts` restores the same wedged
   * session on every reload — connecting a NEW league on `/leagues/connect` (save-only by design)
   * could not help. Does everything `handleChooseAnotherDraft` does, plus: clears the auto-
   * correction ref history (a later `handleEspnStart` must start clean, not think it already
   * corrected the new draft's teams/rounds/seat) and, for an ESPN session, asks the extension to
   * drop its captured live stream (`requestEspnResetSnapshot`) so a fresh draft in the same browser
   * profile never inherits the abandoned one's picks. Lands on `/draft` (disconnected `/draft` IS
   * the launcher) rather than `/leagues` — the point of this action is starting a different draft,
   * not leaving the Draft Room. */
  function handleEndDraft() {
    board.reset('live');
    setCorrecting(null);
    setSeatCorrection(null);
    setTeamsCorrection(null);
    setRoundsCorrection(null);
    setSavedLeagueId(null);
    correctedSeatRef.current = null;
    correctedTeamsRef.current = null;
    correctedRoundsRef.current = null;
    bridgeBaselineRef.current = null;
    // Tell draftSync to delete this draft's Cosmos transcript — an intentional End must not leave
    // a permanent "in progress / Resume" ghost behind (see draftSync.ts's end-draft effect).
    setEndDraftSeq((n) => n + 1);
    if (activeProvider === 'espn') void requestEspnResetSnapshot();
    setSession({ kind: 'disconnected' });
    clearPersistedSession();
    navigate('/draft');
  }

  function handleReturnToConnect() {
    board.reset('live');
    setCorrecting(null);
    setSavedLeagueId(null);
    setSession({ kind: 'disconnected' });
    clearPersistedSession();
    navigate('/leagues');
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
  /** Session-management controls for the top bar's `⋯` menu — replaces the old `.draft-actions` row
   * and the `.manual-takeover-bar` chrome slab with the same handlers, just relocated. Recomputed
   * every render (cheap: a handful of closures) rather than memoized, since memoizing would freeze
   * stale handler closures across renders where the deps didn't change. */
  const logNextPickAction: SessionAction = {
    id: 'log-next-pick',
    label: 'Log next pick',
    onSelect: () => setCorrecting({ mode: 'add-manual', overall: nextManualOverall }),
  };
  const sessionActions: SessionAction[] = session.kind === 'connected'
    ? [
        logNextPickAction,
        { id: 'take-over', label: 'Take over manually', onSelect: handleTakeoverManual, disabled: !poll.draftInit },
        { id: 'choose-another', label: 'Choose another draft', onSelect: handleChooseAnotherDraft },
      ]
    : session.kind === 'bridge'
      ? [
          logNextPickAction,
          { id: 'edit-setup', label: 'Edit draft setup', onSelect: () => setManualSetup({ mode: 'edit' }) },
          { id: 'switch-manual', label: 'Switch to manual', onSelect: handleBridgeToManual },
          { id: 'end-draft', label: 'End draft', onSelect: handleEndDraft },
        ]
      : session.kind === 'manual' && session.reconnectCred
        ? [
            logNextPickAction,
            { id: 'edit-setup', label: 'Edit draft setup', onSelect: () => setManualSetup({ mode: 'edit' }) },
            { id: 'reconnect', label: 'Reconnect', onSelect: handleReconnect },
            { id: 'end-draft', label: 'End draft', onSelect: handleEndDraft },
          ]
        : session.kind === 'manual'
          ? [
              logNextPickAction,
              { id: 'edit-setup', label: 'Edit draft setup', onSelect: () => setManualSetup({ mode: 'edit' }) },
              { id: 'connect-espn', label: 'Connect ESPN tab', onSelect: handleEspnBridgeConnect },
              { id: 'connect-draft', label: 'Connect a draft', onSelect: handleReturnToConnect },
              { id: 'end-draft', label: 'End draft', onSelect: handleEndDraft },
            ]
          : session.kind === 'complete'
            ? [
                {
                  id: 'view-league',
                  label: 'View league',
                  onSelect: () => navigate(session.savedLeagueId ? `/leagues/${session.savedLeagueId}` : '/leagues'),
                },
                { id: 'start-another', label: 'Start another draft', onSelect: handleChooseAnotherDraft },
              ]
            : [];
  const value: DraftSessionValue = {
    session,
    manifest,
    rankedPlayers,
    correcting,
    setCorrecting,
    manualSetup,
    setManualSetup,
    poll,
    bridge,
    board,
    effectiveInit,
    adpFormat,
    activeProvider,
    adpBoardKey,
    picksSignature,
    onTheClock,
    boundaries,
    sessionAlerts,
    sessionActions,
    nextManualOverall,
    correctingPick,
    correctingCurrentName,
    manualTargetInfo,
    unavailablePlayerIds,
    handleConnect,
    handleEspnStart,
    handleResumeDraft,
    handleManualSetupEdit,
    handleEspnBridgeConnect,
    handleBridgeToManual,
    handleTakeoverManual,
    handleReconnect,
    handleChooseAnotherDraft,
    handleReturnToConnect,
    handleEndDraft,
    /** Monotonic End-draft event counter for draftSync's transcript cleanup — see draftSync.ts. */
    endDraftSeq,
    reportSavedLeagueId: setSavedLeagueId,
  };

  return <DraftSessionContext.Provider value={value}>{children}</DraftSessionContext.Provider>;
}
interface DraftSessionValue {
  session: Session;
  manifest: DataManifest | null;
  rankedPlayers: RankedPlayer[];
  correcting: Correcting | null;
  setCorrecting: (value: Correcting | null) => void;
  manualSetup: ManualSetupDialog | null;
  setManualSetup: (value: ManualSetupDialog | null) => void;
  poll: ReturnType<typeof useDraftPoll>;
  bridge: ReturnType<typeof useEspnBridge>;
  board: ReturnType<typeof useDraftBoardState>;
  effectiveInit: DraftInit | null;
  adpFormat: AdpFormat;
  activeProvider: ActiveProvider;
  adpBoardKey: ReturnType<typeof adpBoardKeyFor>;
  picksSignature: string;
  onTheClock: OnTheClock | null;
  boundaries: UserPickBoundaries | null;
  sessionAlerts: SessionAlert[];
  sessionActions: SessionAction[];
  nextManualOverall: number;
  correctingPick: Pick | undefined;
  correctingCurrentName: string | undefined;
  manualTargetInfo: { round: number; slot: number; teamId: string | null; teamName: string } | null;
  unavailablePlayerIds: Set<PlayerId>;
  handleConnect: (cred: SleeperCred, draftId: string) => void;
  handleEspnStart: (league: SavedLeague, mySlot: number, usesPresetSettings?: boolean) => void;
  /** Resume an in-progress saved ESPN/manual draft from its Cosmos transcript — the launcher's way
   * back into a session whose live detection lapsed. See the implementation's doc. */
  handleResumeDraft: (draft: SavedDraft) => void;
  handleManualSetupEdit: (init: DraftInit) => void;
  handleEspnBridgeConnect: () => void;
  handleBridgeToManual: () => void;
  handleTakeoverManual: () => void;
  handleReconnect: () => void;
  handleChooseAnotherDraft: () => void;
  handleReturnToConnect: () => void;
  /** Ends a `bridge`/`manual` session with no other exit and returns to the (disconnected) Draft
   * Room launcher — see the implementation's doc for the wedge this closes. */
  handleEndDraft: () => void;
  /** Monotonic counter bumped by every `handleEndDraft` call — draftSync's end-draft deletion
   * effect consumes it to delete the ended draft's Cosmos transcript. A seq (not a boolean) so
   * back-to-back ends each fire, and `0` means "no end has happened yet". */
  endDraftSeq: number;
  /** Lets `useDraftSync` (mounted separately, in `AppLayout`) report the SavedLeague id it
   * resolves for a Sleeper draft, so a later completion can offer "View league" — see
   * `savedLeagueId`'s doc above. ESPN doesn't need this for a fresh live-detected start (no
   * SavedLeague exists yet); `handleResumeDraft` and the completion banner's "Save to My Leagues"
   * both call it directly once a real id exists. */
  reportSavedLeagueId: (id: string) => void;
}

const DraftSessionContext = createContext<DraftSessionValue | null>(null);

/** The app's single draft-session machine — see {@link DraftSessionProvider}. Every route renders
 * under the provider, so this never throws in practice; the guard exists for stray tests. */
export function useDraftSession(): DraftSessionValue {
  const value = useContext(DraftSessionContext);
  if (!value) throw new Error('useDraftSession must be used within a DraftSessionProvider.');
  return value;
}
















