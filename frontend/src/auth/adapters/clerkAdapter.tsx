import { useEffect, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth as useClerkAuth, useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { APP_NAME } from '../../components/TopNav';
import type { AuthAdapter, AuthState, SignComponentProps } from '../adapter';
import { clerkAppearance } from './clerkAppearance';


/** Same module-level subscribe/notify shape as mockAuthAdapter.ts, populated by `ClerkStateBridge`
 * below — Clerk's own state is hook-based (`useAuth`/`useUser`), but `AuthAdapter.subscribe` must
 * work outside React (see AuthProvider.tsx), so a bridge component forwards hook state into this
 * plain store exactly like the mock adapter's own store. */
let state: AuthState = { status: 'loading', user: null };
const listeners = new Set<(state: AuthState) => void>();
let liveGetToken: (() => Promise<string | null>) | null = null;
let liveSignOut: (() => Promise<void>) | null = null;

function setState(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

/** Mounted inside `<ClerkProvider>` by `Root` — forwards Clerk's reactive hook state into the
 * module store and captures `getToken`/`signOut` so the plain `AuthAdapter` functions below have
 * something to call. Renders nothing. */
function ClerkStateBridge() {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth();
  const { user } = useUser();

  useEffect(() => {
    liveGetToken = getToken;
    liveSignOut = async () => { await signOut(); };
  }, [getToken, signOut]);

  useEffect(() => {
    if (!isLoaded) {
      setState({ status: 'loading', user: null });
      return;
    }
    if (!isSignedIn) {
      setState({ status: 'signed-out', user: null });
      return;
    }
    setState({
      status: 'signed-in',
      user: {
        id: userId ?? user?.id ?? '',
        displayName: user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || 'Account',
        email: user?.primaryEmailAddress?.emailAddress ?? null,
      },
    });
  }, [isLoaded, isSignedIn, userId, user]);

  return null;
}

function Root({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    // Fails loudly rather than silently degrading to a broken auth state — a missing key is a
    // deploy/env misconfiguration, not a runtime condition the UI should paper over.
    throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set but VITE_AUTH_PROVIDER=clerk.');
  }
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      <ClerkStateBridge />
      {children}
    </ClerkProvider>
  );
}

/**
 * The split-screen auth page shell: a cinematic brand column on the left mirroring the landing
 * hero's treatment (eyebrow pill, Archivo Expanded headline, value bullets), and the themed Clerk
 * card on the right. Collapses to a compact centered header above the form at narrow widths — see
 * `.auth-screen-*` in App.css. Lives here rather than in routes/ so no Clerk import ever leaks
 * above the adapter boundary.
 */
function AuthScreenShell({ mode, returnTo }: SignComponentProps & { mode: 'sign-in' | 'sign-up' }) {
  return (
    <div className="auth-screen">
      <div className="auth-screen-brand">
        <p className="auth-screen-pill">{APP_NAME} · Draft-day co-pilot</p>
        <h2 className="auth-screen-title">
          {mode === 'sign-in' ? 'Back to your draft room.' : 'Your draft room is waiting.'}
        </h2>
        <ul className="auth-screen-points">
          <li>Live pick recommendations</li>
          <li>Saved leagues &amp; lineup optimizer</li>
          <li>One hub for all your leagues</li>
        </ul>
      </div>
      <div className="auth-screen-card">
        {mode === 'sign-in'
          ? <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={returnTo} appearance={clerkAppearance} />
          : <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl={returnTo} appearance={clerkAppearance} />}
      </div>
    </div>
  );
}

function SignInComponent({ returnTo }: SignComponentProps) {
  return <AuthScreenShell mode="sign-in" returnTo={returnTo} />;
}

function SignUpComponent({ returnTo }: SignComponentProps) {
  return <AuthScreenShell mode="sign-up" returnTo={returnTo} />;
}

export const clerkAdapter: AuthAdapter = {
  Root,
  subscribe(callback) {
    listeners.add(callback);
    callback(state);
    return () => listeners.delete(callback);
  },
  async signOut() {
    if (liveSignOut) await liveSignOut();
  },
  async getToken() {
    return liveGetToken ? liveGetToken() : null;
  },
  SignInComponent,
  SignUpComponent,
};
