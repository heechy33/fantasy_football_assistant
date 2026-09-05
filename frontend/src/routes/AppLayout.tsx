import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ManualDraftSetup } from '../components/ManualDraftSetup';
import { ManualPickCorrection } from '../components/ManualPickCorrection';
import { YahooPastePicksModal } from '../components/YahooPastePicksModal';
import { SessionAlerts } from '../components/SessionAlerts';
import { TopNav, type AppPage } from '../components/TopNav';
import { useDraftSession } from '../session/DraftSessionProvider';
import { useDraftSync } from '../state/draftSync';

function pageForPathname(pathname: string): AppPage {
  if (pathname === '/draft-guide') return 'guide';
  if (pathname === '/draft') return 'draft';
  // The league hub owns '/leagues*' (including /leagues/connect), and the onboarding wizard is
  // part of that story — highlighting a real tab instead of silently falling back to Home.
  if (pathname.startsWith('/leagues') || pathname.startsWith('/onboarding')) return 'leagues';
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
    activeProvider,
    sessionAlerts,
    manualSetup,
    setManualSetup,
    pastePicksOpen,
    setPastePicksOpen,
    handleApplyBatchPicks,
    correcting,
    setCorrecting,
    correctingPick,
    correctingCurrentName,
    manualTargetInfo,
    unavailablePlayerIds,
    rankedPlayers,
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
        isStale={false}
        dataAgeMs={null}
        pollHealthRef={onDraft && session.kind === 'connected' ? poll.healthRef : null}
        // Provider pill only for a LIVE or in-progress session — a finished draft is not a live
        // connection, and claiming "<Provider> connected" over a finished draft would be a lie.
        statusProvider={onDraft && session.kind !== 'complete' ? (activeProvider === 'none' ? null : activeProvider) : null}
        showDisconnected={onDraft && session.kind === 'disconnected'}
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

      {manualSetup && (session.kind === 'manual' || session.kind === 'bridge') && session.frozenInit && (
        <ManualDraftSetup
          initial={session.frozenInit}
          onSubmit={handleManualSetupEdit}
          onCancel={() => setManualSetup(null)}
        />
      )}

      {pastePicksOpen && (session.kind === 'manual' || session.kind === 'bridge') && session.frozenInit && (
        <YahooPastePicksModal
          draftInit={session.frozenInit}
          players={rankedPlayers}
          onSubmit={(overrides, detectedSlot, slotToTeamName) => {
            handleApplyBatchPicks(overrides, detectedSlot, slotToTeamName);
          }}
          onClose={() => setPastePicksOpen(false)}
        />
      )}
      </main>
    </>
  );
}
