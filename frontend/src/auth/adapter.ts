import type { ComponentType, ReactNode } from 'react';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthUser {
  id: string;
  displayName: string;
  email: string | null;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

export interface SignComponentProps {
  /** Where to land after the flow completes — usually `location.state?.from` from RequireAuth's
   * redirect, defaulting to '/draft'. Maps to whichever redirect prop the underlying vendor uses
   * (Clerk's fallbackRedirectUrl) without RequireAuth/SignInRoute knowing which vendor is active. */
  returnTo: string;
}

/**
 * Every auth vendor implements this. Nothing above this boundary (RequireAuth, useAuth, TopNav,
 * the Phase 5 repository) may import a vendor SDK directly — the same isolation discipline as
 * `ProviderAdapter` in shared/types.d.ts, applied to auth instead of fantasy providers.
 */
export interface AuthAdapter {
  /** Wraps the app so the vendor's own provider (context, session refresh, etc.) is available.
   * The mock adapter's Root is a plain passthrough. */
  Root: ComponentType<{ children: ReactNode }>;
  subscribe(callback: (state: AuthState) => void): () => void;
  signOut(): Promise<void>;
  /** Bearer token for Phase 5's authenticated /api/* calls. Null while signed out. */
  getToken(): Promise<string | null>;
  /** Vendor-owned sign-in/sign-up UI. Undefined on the mock adapter — SignInRoute/SignUpRoute fall
   * back to AuthPlaceholderRoute in that case. */
  SignInComponent?: ComponentType<SignComponentProps>;
  SignUpComponent?: ComponentType<SignComponentProps>;
}

export type AuthProviderKey = 'mock' | 'clerk';

/** Selects the active vendor from VITE_AUTH_PROVIDER, defaulting to 'mock' when unset — this is
 * what lets every existing test and a fresh clone's `npm run dev` work with no vendor SDK or keys
 * configured. Only 'clerk' pulls in @clerk/clerk-react. */
export function resolveAuthProviderKey(): AuthProviderKey {
  const raw = import.meta.env.VITE_AUTH_PROVIDER;
  return raw === 'clerk' ? 'clerk' : 'mock';
}
