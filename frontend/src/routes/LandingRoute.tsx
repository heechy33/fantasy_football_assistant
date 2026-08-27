import { LandingPage } from '../components/LandingPage';
import { useDraftSession } from '../session/DraftSessionProvider';

/** Home. The landing is illustration-only since Phase 3 — this wrapper only feeds it session
 * state for the Resume card / provider-aware copy. */
export function LandingRoute() {
  const { activeProvider, effectiveInit } = useDraftSession();

  return (
    <LandingPage
      active={activeProvider}
      leagueName={effectiveInit?.settings.name ?? null}
    />
  );
}

