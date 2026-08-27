import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DataManifest, DraftInit, OnTheClock, Pick, PlayerId, SleeperCred } from '../../../shared/types';
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
import { loadPersistedSession, savePersistedSession } from '../state/persistence';

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

/**
 * Everything above the routes: one long-lived home for the draft-session machine (session state,
 * poll/bridge live layers, board state, clock math, alerts, transitions) so it keeps running while
 * the user browses any route — mounting it inside a route element would unmount (and kill the live
 * poll) on navigation. Relocated verbatim from `App.tsx` when routing landed; the only behavioral
 * change is that rehydration no longer force-navigates to `/draft` (the landing's Resume card is
 * the "you have a draft in progress" signal), and transition handlers navigate via
 * `useNavigate()` instead of a lifted `page` state.
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
        // No auto-navigation: the landing's ResumeCard ("Resume draft" → /draft) is the
        // in-progress indicator. A deep link to /draft-guide must not yank the user into
        // the draft room.
      } else if (persisted.mode === 'espn' && persisted.frozenInit) {
        // ESPN bridge sessions run the board in 'live' mode — picks flow back in through the
        // bridge's `livePicks`, not through `overrides` (already replayed above for any prior
        // manual corrections layered on top).
        board.setMode('live');
        setSession({ kind: 'bridge', frozenInit: persisted.frozenInit });
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
  const activeProvider: ActiveProvider = session.kind === 'connected'
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
    navigate('/draft');
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
    navigate('/draft');
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
    setSession({ kind: 'disconnected' });
    navigate('/');
  }

  function handleReturnToConnect() {
    board.reset('live');
    setCorrecting(null);
    setSession({ kind: 'disconnected' });
    navigate('/');
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
    handleManualMode,
    handleEspnSetupSubmit,
    handleManualSetupEdit,
    handleEspnBridgeConnect,
    handleBridgeToManual,
    handleTakeoverManual,
    handleReconnect,
    handleChooseAnotherDraft,
    handleReturnToConnect,
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
  handleManualMode: () => void;
  handleEspnSetupSubmit: (init: DraftInit) => void;
  handleManualSetupEdit: (init: DraftInit) => void;
  handleEspnBridgeConnect: () => void;
  handleBridgeToManual: () => void;
  handleTakeoverManual: () => void;
  handleReconnect: () => void;
  handleChooseAnotherDraft: () => void;
  handleReturnToConnect: () => void;
}

const DraftSessionContext = createContext<DraftSessionValue | null>(null);

/** The app's single draft-session machine — see {@link DraftSessionProvider}. Every route renders
 * under the provider, so this never throws in practice; the guard exists for stray tests. */
export function useDraftSession(): DraftSessionValue {
  const value = useContext(DraftSessionContext);
  if (!value) throw new Error('useDraftSession must be used within a DraftSessionProvider.');
  return value;
}
















