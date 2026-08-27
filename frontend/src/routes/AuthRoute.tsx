import { useLocation, type Location } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AuthPlaceholderRoute } from './AuthPlaceholderRoute';

function returnToFrom(location: Location): string {
  const from = (location.state as { from?: Location } | null)?.from;
  return from ? `${from.pathname}${from.search}` : '/draft';
}

/** `/sign-in` and `/sign-up` — renders whichever the active AuthAdapter supplies
 * (SignInComponent/SignUpComponent; Clerk's own <SignIn>/<SignUp> once Phase 4's env is
 * configured) or falls back to AuthPlaceholderRoute when the adapter has none (the mock
 * adapter, the default — see auth/adapter.ts). `returnTo` comes from RequireAuth's
 * `state.from`, so signing in returns the user to whatever gated page they tried to reach. */
export function SignInRoute() {
  const { adapter } = useAuth();
  const location = useLocation();
  const returnTo = returnToFrom(location);
  return adapter.SignInComponent
    ? <adapter.SignInComponent returnTo={returnTo} />
    : <AuthPlaceholderRoute mode="sign-in" returnTo={returnTo} />;
}

export function SignUpRoute() {
  const { adapter } = useAuth();
  const location = useLocation();
  const returnTo = returnToFrom(location);
  return adapter.SignUpComponent
    ? <adapter.SignUpComponent returnTo={returnTo} />
    : <AuthPlaceholderRoute mode="sign-up" returnTo={returnTo} />;
}
