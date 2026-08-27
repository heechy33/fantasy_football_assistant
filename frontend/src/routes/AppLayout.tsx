import { Outlet, useLocation } from 'react-router-dom';
import { picksMade } from '../adapters/draftOrder';
import { useAuth } from '../auth/AuthProvider';
import { ManualDraftSetup } from '../components/ManualDraftSetup';
import { ManualPickCorrection } from '../components/ManualPickCorrection';
import { SessionAlerts } from '../components/SessionAlerts';
import { TopNav, type AppPage } from '../components/TopNav';
import { useDraftSession } from '../session/DraftSessionProvider';
import { useDraftSync } from '../state/draftSync';

function pageForPathname(pathname: string): AppPage {
  if (pathname === '/draft-guide') return 'guide';
  if (pathname === '/draft') return 'draft';
  if (pathname === '/teams') return 'teams';
  // Home is both '/' and every path without its own tab yet (e.g. /onboarding, /sign-up).
  return 'home';
}

/** Route shell: brand/nav bar, session-wide alert strip, and the global pick-correction and
 * manual-setup dialogs around whichever child route is active. */
export function AppLayout() {
  const location = useLocation();
  const {
    session,
    board,
    poll,
    effectiveInit,
    adpFormat,
    activeProvider,
    sessionAlerts,
    manualSetup,
    setManualSetup,
    correcting,
    setCorrecting,
    correctingPick,
    correctingCurrentName,
    manualTargetInfo,
    unavailablePlayerIds,
    rankedPlayers,
    handleEspnSetupSubmit,
    handleManualSetupEdit,
  } = useDraftSession();
  const { status, signOut } = useAuth();
  useDraftSync();

  const active = pageForPathname(location.pathname);
  const onDraft = active === 'draft';

  return (
    <>
      <TopNav
        active={active}
        authenticated={status === 'signed-in'}
        onSignOut={() => { void signOut(); }}
        immersive={location.pathname === '/'}
        leagueName={onDraft ? effectiveInit?.settings.name ?? null : null}
        adpFormat={onDraft ? adpFormat : null}
        isStale={false}
        dataAgeMs={null}
        pollHealthRef={onDraft && session.kind === 'connected' ? poll.healthRef : null}
        statusProvider={onDraft ? (activeProvider === 'none' ? null : activeProvider) : null}
        pickCount={onDraft ? picksMade(board.effectivePicks) : null}
      />
      <main className="app-shell">

      {/* Bridge health / seat-mismatch / "not connected" alerts are session-wide diagnostics, not
          Draft Room decoration — surfaced on every page (D8) so an ESPN session that silently
          isn't streaming (the 2026-08-15 regression: an ESPN pill with zero alerts anywhere) can't
          hide behind a page switch. */}
      {session.kind !== 'disconnected' && <SessionAlerts alerts={sessionAlerts} />}

      <Outlet />

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
