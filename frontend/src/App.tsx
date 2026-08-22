import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DataManifest, DraftInit, OnTheClock, Pick, PlayerId, SleeperCred } from '../../shared/types';
import type { DraftBoardState } from './state/draftBoardState';
import { canonicalPicksSignature, computeOnTheClock, picksMade, roundForOverall, slotForOverall, userPickBoundaries, type UserPickBoundaries } from './adapters/draftOrder';
import { sleeperAdapter } from './adapters/sleeper';
import { DataHealth } from './components/DataHealth';
import { DraftWorkspace } from './components/DraftWorkspace';
import { LandingPage, type LandingActiveProvider } from './components/LandingPage';
import { MANUAL_SCORING_DIAGNOSTICS, ManualDraftSetup } from './components/ManualDraftSetup';
import { ManualPickCorrection } from './components/ManualPickCorrection';
import { SessionAlerts, type SessionAlert } from './components/SessionAlerts';
import { TeamsPage } from './components/TeamsPage';
import { TopNav, type AppPage } from './components/TopNav';
import { SessionMenu, type SessionAction } from './components/SessionMenu';
import { loadRankedPlayers, type AdpFormat, type RankedPlayer } from './data/loadPlayerPool';
import { adpBoardKeyFor } from './data/adpBoard';
import { useDraftBoardState } from './hooks/useDraftBoardState';
import { useDraftPoll } from './hooks/useDraftPoll';
import { useEspnBridge } from './hooks/useEspnBridge';
import { loadPersistedSession, savePersistedSession } from './state/persistence';
import './App.css';

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
      /** Settings come from the manual form; mySlot is the typed draft position (JOINED/TOKEN's
       * team id is a separate cross-check, not an override — see espnSeatMismatch). */
      frozenInit: DraftInit;
    };

interface Correcting {
  mode: 'correct-existing' | 'add-manual';
  overall: number;
}

/**
 * Which setup dialog is open. 'create' carries an explicit `target` rather than being inferred
 * from where the submit handler happens to be called — `ManualDraftSetup`'s "create" mode is
 * currently ESPN-only (see its prefilled league name/roster config), and the 2026-08-15 sync
 * regression was exactly this kind of ambiguity: the create flow silently produced a `'manual'`
 * session instead of a `'bridge'` one. Encoding the target here means a future non-ESPN create path
 * cannot accidentally inherit bridge behavior (or vice versa) just by sharing a dialog.
 */
type ManualSetupDialog = { mode: 'create'; target: 'espn' } | { mode: 'edit' };

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
  /** Which manual setup dialog is open: 'create' (first setup, ESPN-only today — see
   * ManualSetupDialog's doc) or 'edit' (correct mySlot mid-draft). */
  const [manualSetup, setManualSetup] = useState<ManualSetupDialog | null>(null);
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
        setSession({
          kind: 'manual',
          frozenInit: persisted.frozenInit,
          reconnectCred: persisted.userId ? { provider: 'sleeper', userId: persisted.userId } : null,
          reconnectDraftId: persisted.draftId,
        });
        setPage('draft');
      } else if (persisted.mode === 'espn' && persisted.frozenInit) {
        // ESPN bridge sessions run the board in 'live' mode — picks flow back in through the
        // bridge's `livePicks`, not through `overrides` (already replayed above for any prior
        // manual corrections layered on top).
        board.setMode('live');
        setSession({ kind: 'bridge', frozenInit: persisted.frozenInit });
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
    savePersistedSession({
      userId: session.kind === 'connected'
        ? session.cred.userId
        : (session.kind === 'manual' ? session.reconnectCred?.userId ?? null : null),
      draftId: session.kind === 'connected'
        ? session.draftId
        : (session.kind === 'manual' ? session.reconnectDraftId : null),
      mode: session.kind === 'manual' ? 'manual' : (session.kind === 'bridge' ? 'espn' : 'live'),
      overrides: [...board.state.overrides.values()],
      frozenInit: session.kind === 'manual' || session.kind === 'bridge' ? session.frozenInit : null,
    });
  }, [hydrated, session, board.state.overrides]);

  // Manual takeover freezes the latest DraftInit into the manual session, so the workspace and
  // clock math keep working with no live poll. `effectiveInit` is the single source for that:
  // connected sessions read the poll's init, takeover sessions read the frozen copy, and bridge
  // sessions read the bridge-merged init (form settings + JOINED/TOKEN mySlot).
  const effectiveInit = session.kind === 'connected'
    ? poll.draftInit
    : (session.kind === 'bridge'
        ? bridge.init
        : (session.kind === 'manual' ? session.frozenInit : null));
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
  const activeProvider: LandingActiveProvider = session.kind === 'connected'
    || (session.kind === 'manual' && session.reconnectCred != null)
    ? 'sleeper'
    : session.kind === 'bridge' || (session.kind === 'manual' && session.reconnectCred == null)
      ? 'espn'
      : 'none';

  /** Which ADP board the session should read — derived once here so DraftWorkspace, the manual
   * correction board, and DataHealth all agree (ESPN PPR sessions read the additive
   * `adp-espn-ppr.json`; everything else stays on the plain format board). The key travels, not
   * the provider string — see `data/adpBoard.ts`. */
  const adpBoardKey = useMemo(() => adpBoardKeyFor(activeProvider, adpFormat), [activeProvider, adpFormat]);

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
  }, [session, bridge.status, bridge.seatMismatch, bridge.relayWarning, bridge.picks]);

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
    setSession({ kind: 'connected', cred: newCred, draftId: newDraftId });
    setPage('draft');
  }

  function handleManualMode() {
    setManualSetup({ mode: 'create', target: 'espn' });
  }

  /** Commit a fresh ESPN bridge session from the setup form — a brand-new draft, so the board
   * resets. This lands directly in `kind: 'bridge'`, not `'manual'`: the setup form is reached only
   * via the explicit `{ mode: 'create', target: 'espn' }` intent (see `handleManualMode`/
   * `ManualSetupDialog`), and ManualDraftSetup's "create" mode is ESPN-only today (prefilled league
   * name, ESPN roster config). The previous build set `kind: 'manual'` here, which left the bridge
   * disarmed with no live source and no error shown — the 2026-08-15 sync regression. */
  function handleEspnSetupSubmit(init: DraftInit) {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'bridge', frozenInit: init });
    setManualSetup(null);
    setPage('draft');
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
    setSession({ kind: 'bridge', frozenInit: session.frozenInit });
  }

  /** Drop back to pure manual: the same atomic freeze as the Sleeper takeover button (every
   * effective pick — live-streamed or already-corrected — becomes a manual-entry override, then
   * the board switches to 'manual'). Without this, switching board.mode straight to 'manual' would
   * silently discard every pick that only ever existed in the live layer. */
  function handleBridgeToManual() {
    if (session.kind !== 'bridge') return;
    board.freeze();
    setCorrecting(null);
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
    setPage('draft');
  }

  /** Resume live polling for the taken-over session; falls back to the connect flow without one. */
  function handleReconnect() {
    if (session.kind === 'manual' && session.reconnectCred && session.reconnectDraftId) {
      board.reset('live');
      setCorrecting(null);
      setSession({ kind: 'connected', cred: session.reconnectCred, draftId: session.reconnectDraftId });
      setPage('draft');
      return;
    }
    handleReturnToConnect();
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

  /** Stable row-level correction trigger so the memoized DraftLog rows don't reconcile on every render. */
  const openCorrection = useCallback((overall: number) => {
    setCorrecting({ mode: 'correct-existing', overall });
  }, []);

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
        ]
      : session.kind === 'manual' && session.reconnectCred
        ? [
            logNextPickAction,
            { id: 'edit-setup', label: 'Edit draft setup', onSelect: () => setManualSetup({ mode: 'edit' }) },
            { id: 'reconnect', label: 'Reconnect', onSelect: handleReconnect },
          ]
        : session.kind === 'manual'
          ? [
              logNextPickAction,
              { id: 'edit-setup', label: 'Edit draft setup', onSelect: () => setManualSetup({ mode: 'edit' }) },
              { id: 'connect-espn', label: 'Connect ESPN tab', onSelect: handleEspnBridgeConnect },
              { id: 'connect-draft', label: 'Connect a draft', onSelect: handleReturnToConnect },
            ]
          : [];

  return (
    <>
      <TopNav
        active={page}
        onNavigate={setPage}
        immersive={page === 'home'}
        leagueName={page === 'draft' ? effectiveInit?.settings.name ?? null : null}
        adpFormat={page === 'draft' ? adpFormat : null}
        isStale={false}
        dataAgeMs={null}
        pollHealthRef={page === 'draft' && session.kind === 'connected' ? poll.healthRef : null}
        statusProvider={page === 'draft' ? (activeProvider === 'none' ? null : activeProvider) : null}
        pickCount={page === 'draft' ? picksMade(board.effectivePicks) : null}
      />
      <main className="app-shell">

      {/* Bridge health / seat-mismatch / "not connected" alerts are session-wide diagnostics, not
          Draft Room decoration — surfaced on every page (D8) so an ESPN session that silently
          isn't streaming (the 2026-08-15 regression: an ESPN pill with zero alerts anywhere) can't
          hide behind a page switch. */}
      {session.kind !== 'disconnected' && <SessionAlerts alerts={sessionAlerts} />}

      {page === 'home' && (
        <LandingPage
          active={activeProvider}
          leagueName={effectiveInit?.settings.name ?? null}
          onConnect={handleConnect}
          onStartEspn={handleManualMode}
          onResume={() => setPage('draft')}
        />
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
              <p>Choose Sleeper or ESPN on Home to track a live draft, or log one manually.</p>
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
                  activeProvider={activeProvider}
                  picksSignature={picksSignature}
                  onTheClock={onTheClock}
                  boundaries={boundaries}
                  onCorrect={openCorrection}
                  sessionActions={sessionActions}
                />
              )}
            </>
          )}

          {(session.kind === 'manual' || session.kind === 'bridge') && (session.frozenInit ? (
            <DraftWorkspace
              draftInit={effectiveInit}
              effectivePicks={board.effectivePicks}
              manifest={manifest}
              adpFormat={adpFormat}
              activeProvider={activeProvider}
              picksSignature={picksSignature}
              onTheClock={onTheClock}
              boundaries={boundaries}
              onCorrect={openCorrection}
              sessionActions={sessionActions}
            />
          ) : (
            <section className="manual-draft">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Offline mode</p>
                  <h2>Manual draft log</h2>
                </div>
                <div className="board-toolbar-right">
                  <button className="quiet-button" type="button" onClick={handleReturnToConnect}>Connect a draft</button>
                  {sessionActions.length > 0 && <SessionMenu actions={sessionActions} />}
                </div>
              </div>
              {board.effectivePicks.length === 0 ? (
                <p>No picks logged yet. Open the ranked board to record the first pick.</p>
              ) : (
                <ol className="manual-picks">
                  {board.effectivePicks.map((pick) => (
                    <li key={pick.overall}>
                      <span>#{pick.overall}</span>
                      <span>{effectiveInit?.slotToTeamName?.[pick.slot] ?? pick.teamId ?? 'unknown team'}</span>
                      <strong>{pick.providerPlayerName ?? pick.playerId ?? 'unmatched'}</strong>
                      <button className="quiet-button" type="button" onClick={() => setCorrecting({ mode: 'correct-existing', overall: pick.overall })}>Edit</button>
                    </li>
                  ))}
                </ol>
              )}
              <button type="button" onClick={() => setCorrecting({ mode: 'add-manual', overall: nextManualOverall })}>Log next pick</button>
            </section>
          ))}

          {(session.kind === 'connected' || session.kind === 'manual' || session.kind === 'bridge') && (
            <DataHealth
              manifest={manifest}
              effectivePicks={board.effectivePicks}
              isStale={session.kind === 'connected' ? poll.isStale : (session.kind === 'bridge' ? bridge.isStale : false)}
              dataAgeMs={session.kind === 'connected' ? poll.dataAgeMs : (session.kind === 'bridge' ? bridge.dataAgeMs : null)}
              consecutiveFailures={session.kind === 'connected' ? poll.consecutiveFailures : 0}
              lastError={session.kind === 'connected' ? poll.lastError : (session.kind === 'bridge' ? bridge.pickError : null)}
              pollHealthRef={session.kind === 'connected' ? poll.healthRef : null}
              adpFormat={adpFormat}
              activeProvider={activeProvider}
              scoringDiagnostics={session.kind === 'manual' || session.kind === 'bridge' ? MANUAL_SCORING_DIAGNOSTICS : undefined}
            />
          )}
        </>
      )}

      {page === 'teams' && <TeamsPage />}

      {correcting && (
        <ManualPickCorrection
          mode={correcting.mode}
          overall={correcting.overall}
          round={correcting.mode === 'add-manual' ? manualTargetInfo?.round : correctingPick?.round}
          slot={correcting.mode === 'add-manual' ? manualTargetInfo?.slot : correctingPick?.slot}
          teamId={correcting.mode === 'add-manual' ? manualTargetInfo?.teamId ?? undefined : correctingPick?.teamId}
          teamName={correcting.mode === 'add-manual' ? manualTargetInfo?.teamName : undefined}
          currentProviderName={correctingCurrentName || undefined}
          rankedPlayers={rankedPlayers}
          unavailablePlayerIds={unavailablePlayerIds}
          onSubmit={(override) => board.applyOverride(override)}
          onUndo={(overall) => board.undoOverride(overall)}
          onClose={() => setCorrecting(null)}
        />
      )}

      {manualSetup && (
        <ManualDraftSetup
          initial={manualSetup.mode === 'edit' && (session.kind === 'manual' || session.kind === 'bridge') ? session.frozenInit : null}
          onSubmit={manualSetup.mode === 'edit' ? handleManualSetupEdit : handleEspnSetupSubmit}
          onCancel={() => setManualSetup(null)}
        />
      )}
      </main>
    </>
  );
}
