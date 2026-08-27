import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';
import { mockSignIn, setMockAuthState, __resetMockAuthState } from './adapters/mockAuthAdapter';

function Protected() {
  return <p>Protected content</p>;
}
function SignIn() {
  return <p>Sign-in page</p>;
}

function renderGuarded(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route element={<RequireAuth />}>
            <Route path="/draft" element={<Protected />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __resetMockAuthState();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('RequireAuth', () => {
  it('renders a loading state before redirecting, never flashing the redirect', async () => {
    setMockAuthState({ status: 'loading', user: null });
    renderGuarded('/draft');
    expect(screen.getByText(/Loading your account/)).toBeInTheDocument();
    expect(screen.queryByText('Sign-in page')).not.toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('redirects to /sign-in when signed out', async () => {
    renderGuarded('/draft');
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
  });

  it('renders the protected route when signed in', async () => {
    mockSignIn();
    renderGuarded('/draft');
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  it('does not touch a localStorage draft session while bouncing to sign-in', async () => {
    localStorage.setItem('ffa.draftSession.v2', JSON.stringify({ marker: 'untouched' }));
    renderGuarded('/draft');
    await screen.findByText('Sign-in page');
    expect(localStorage.getItem('ffa.draftSession.v2')).toBe(JSON.stringify({ marker: 'untouched' }));
  });
});
