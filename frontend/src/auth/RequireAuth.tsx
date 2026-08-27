import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Guards `/draft`, `/teams`, `/onboarding/*` (see App.tsx's route tree). Redirects to `/sign-in`
 * with the attempted location in `state.from`, so SignInRoute can send the user back after they
 * sign in. Deliberately does NOT touch `localStorage` — `DraftSessionProvider` stays mounted
 * unconditionally above this guard, so an anonymous visitor's in-progress draft
 * (`ffa.draftSession.v2`) survives the bounce and is exactly where they left it once signed in.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <section className="draft-room-empty" aria-busy="true">
        <p>Loading your account…</p>
      </section>
    );
  }

  if (status === 'signed-out') {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
