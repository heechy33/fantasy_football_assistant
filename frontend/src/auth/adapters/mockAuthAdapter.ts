import type { ReactNode } from 'react';
import type { AuthAdapter, AuthState } from '../adapter';

/** Module-level store so every consumer (RequireAuth, TopNav, tests) sees the same state without
 * a React context of its own — AuthProvider.tsx supplies the context wrapper on top of this. */
let state: AuthState = { status: 'signed-out', user: null };
const listeners = new Set<(state: AuthState) => void>();

function notify(): void {
  for (const listener of listeners) listener(state);
}

/** Test- and dev-only: drive the mock adapter's state directly. Not part of `AuthAdapter` — real
 * vendors have no equivalent, and nothing outside tests/AuthPlaceholderRoute's dev affordance
 * should call this. */
export function setMockAuthState(next: AuthState): void {
  state = next;
  notify();
}

/** Dev convenience so a fresh clone (no Clerk keys) can still exercise gated routes locally —
 * wired into AuthPlaceholderRoute's sign-in placeholder, only when the mock adapter is active. */
export function mockSignIn(): void {
  setMockAuthState({ status: 'signed-in', user: { id: 'mock-user', displayName: 'Test User', email: 'test@example.com' } });
}

function Root({ children }: { children: ReactNode }): ReactNode {
  return children;
}

/** Default adapter (see `resolveAuthProviderKey`) — lets every existing test and `npm run dev` on
 * a fresh clone run with zero vendor SDK and zero keys configured. No SignInComponent/
 * SignUpComponent: SignInRoute/SignUpRoute fall back to AuthPlaceholderRoute, which offers the
 * dev-only `mockSignIn()` affordance above instead of a real form. */
export const mockAuthAdapter: AuthAdapter = {
  Root,
  subscribe(callback) {
    listeners.add(callback);
    callback(state);
    return () => listeners.delete(callback);
  },
  async signOut() {
    setMockAuthState({ status: 'signed-out', user: null });
  },
  async getToken() {
    return state.status === 'signed-in' ? 'mock-token' : null;
  },
};

/** Test-only: reset to signed-out between tests so state doesn't leak across files/cases. */
export function __resetMockAuthState(): void {
  state = { status: 'signed-out', user: null };
  listeners.clear();
}
