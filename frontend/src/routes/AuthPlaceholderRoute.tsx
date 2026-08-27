import { Link, useNavigate } from 'react-router-dom';
import { APP_NAME } from '../components/TopNav';
import { resolveAuthProviderKey } from '../auth/adapter';
import { mockSignIn } from '../auth/adapters/mockAuthAdapter';

export interface AuthPlaceholderRouteProps {
  mode: 'sign-in' | 'sign-up';
  /** Where to land once signed in — from RequireAuth's `state.from`, defaulting to '/draft'. Only
   * exercised by the dev sign-in affordance below; the real Clerk adapter never reaches this
   * component since it always supplies SignInComponent/SignUpComponent (see AuthRoute.tsx). */
  returnTo: string;
}

/** Fallback rendered by AuthRoute.tsx when the active auth adapter has no SignInComponent/
 * SignUpComponent — i.e. the mock adapter, meaning no vendor is configured. Lets a fresh clone
 * without Clerk keys still exercise gated routes locally via `mockSignIn()`, instead of dead-
 * ending at "coming soon" with no way to reach a signed-in state. */
export function AuthPlaceholderRoute({ mode, returnTo }: AuthPlaceholderRouteProps) {
  const navigate = useNavigate();
  const title = mode === 'sign-in' ? 'Sign in' : 'Create your account';
  const isMock = resolveAuthProviderKey() === 'mock';

  function handleDevSignIn() {
    mockSignIn();
    navigate(returnTo, { replace: true });
  }

  return (
    <section className="draft-room-empty" aria-label={title}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{APP_NAME}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {isMock ? (
        <>
          <p>No auth provider is configured for this environment yet.</p>
          <button type="button" onClick={handleDevSignIn}>Continue as test user (dev only)</button>
        </>
      ) : (
        <p>Accounts are coming soon.</p>
      )}
      <p>
        Meanwhile, the <Link to="/draft-guide">Draft Guide</Link> needs no account at all.
      </p>
    </section>
  );
}
