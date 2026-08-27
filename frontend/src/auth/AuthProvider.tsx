import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthAdapter, AuthState } from './adapter';
import { resolveAuthProviderKey } from './adapter';
import { mockAuthAdapter } from './adapters/mockAuthAdapter';
import { clerkAdapter } from './adapters/clerkAdapter';

function selectAdapter(): AuthAdapter {
  return resolveAuthProviderKey() === 'clerk' ? clerkAdapter : mockAuthAdapter;
}

interface AuthContextValue extends AuthState {
  adapter: AuthAdapter;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Mounts above `<Routes>` in App.tsx (outside DraftSessionProvider — the two are independent), so
 * `useAuth()` is available to `RequireAuth`, `AppLayout` (drives `TopNav.authenticated`), and the
 * `/sign-in` `/sign-up` routes. Which vendor is live is resolved once via `resolveAuthProviderKey`
 * — swapping vendors later is changing this one selection, not touching any consumer.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(selectAdapter, []);
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  useEffect(() => adapter.subscribe(setState), [adapter]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    adapter,
    signOut: () => adapter.signOut(),
    getToken: () => adapter.getToken(),
  }), [state, adapter]);

  // The Clerk adapter's Root wraps children in <ClerkProvider>; the mock adapter's Root is a
  // plain passthrough — see each adapter's module doc.
  return (
    <AuthContext.Provider value={value}>
      <adapter.Root>{children}</adapter.Root>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
