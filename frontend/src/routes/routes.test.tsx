import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { mockSignIn, __resetMockAuthState } from '../auth/adapters/mockAuthAdapter';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';

// Phase 1 routing suite: each path renders its page, unknown paths hit NotFound, and — the
// load-bearing constraint — the DraftSessionProvider does NOT remount when the user navigates.
// The provider owns the live Sleeper poll and the ESPN bridge; if a future refactor moves it
// inside a route element, navigation would silently kill an in-flight draft. The observable
// proof is the provider's one-shot manifest fetch: it must happen exactly once across navigations.
//
// Phase 4 gated `/draft`, `/teams`, `/onboarding/*` behind RequireAuth — this suite's account-page
// cases sign in via the mock auth adapter first (see auth/RequireAuth.test.tsx for the gating
// behavior itself: redirect-on-signed-out, return-to, and that the bounce never touches
// localStorage).

let manifestFetches = 0;

beforeEach(() => {
  localStorage.clear();
  __resetPlayerPoolCache();
  __resetMockAuthState();
  manifestFetches = 0;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('manifest.json')) {
      manifestFetches += 1;
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('routes', () => {
  it.each([
    ['/', /The Chip Is Yours/],
    ['/draft-guide', /The board, before draft day/],
    ['/sign-up', /Create your account/],
  ])('renders %s as the right page (public)', async (route, marker) => {
    renderAt(route);
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });

  it.each([
    ['/draft', /No active draft/],
    ['/leagues', /No leagues yet/],
    ['/leagues/connect', /Connect your Sleeper account/],
    ['/onboarding/league', /Connect your Sleeper account/],
  ])('renders %s as the right page when signed in', async (route, marker) => {
    mockSignIn();
    renderAt(route);
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });

  it('redirects /teams to /leagues (retired route)', async () => {
    mockSignIn();
    renderAt('/teams');
    expect(await screen.findByText(/No leagues yet/)).toBeInTheDocument();
  });

  it.each([
    ['/draft'],
    ['/leagues'],
    ['/onboarding/league'],
  ])('redirects %s to sign-in when signed out', async (route) => {
    renderAt(route);
    // Heading, not link text — "Sign in" also appears in TopNav's own nav link while signed out.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('returns to the originally-requested gated page after signing in', async () => {
    const user = userEvent.setup();
    renderAt('/draft');
    // Signed out → bounced to the sign-in placeholder (no vendor configured in tests).
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.click(screen.getByRole('button', { name: /Continue as test user/ }));
    // RequireAuth's state.from carried '/draft' through — not dropped to the '/draft' default,
    // and not left on /sign-in.
    expect(await screen.findByText(/No active draft/)).toBeInTheDocument();
  });

  it('renders NotFound for an unknown path', async () => {
    renderAt('/definitely-not-a-page');
    expect(await screen.findByText(/Page not found/)).toBeInTheDocument();
  });

  it('keeps the session provider mounted across navigation (live poll survives route changes)', async () => {
    const user = userEvent.setup();
    renderAt('/');

    // Land on Home, browse to the guide, come back — all via the nav links AppLayout renders.
    await screen.findByRole('link', { name: 'Draft Guide' });
    await user.click(screen.getByRole('link', { name: 'Draft Guide' }));
    expect(await screen.findByText(/The board, before draft day/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText(/The Chip Is Yours/)).toBeInTheDocument();

    // A remounted provider re-runs its mount effects → a second manifest fetch.
    expect(manifestFetches).toBe(1);

    // Deep-linking to /draft-guide while a session exists must NOT yank the user into
    // /draft (rehydration no longer auto-navigates; ResumeCard is the indicator).
    expect(screen.queryByText(/No active draft/)).not.toBeInTheDocument();
  });
});
