import { cleanup, render, screen, within } from '@testing-library/react';
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
    ['/', /The Chip Is Yours/i],
    ['/draft-guide', /The board, before draft day/],
    ['/sign-up', /Create your account/],
  ])('renders %s as the right page (public)', async (route, marker) => {
    renderAt(route);
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });

  it.each([
    ['/draft', /Start tracking a draft/],
    ['/leagues', /No leagues yet/],
    ['/leagues/connect', /Sleeper username/],
    ['/onboarding/league', /Sleeper username/],
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

  // The 2026-08-27 connect/start split's core regression: the connect surface is save-only. It
  // must offer no way to start a draft — no Track buttons, no /draft link — and the league-detail
  // route must exist and never capture /leagues/connect.
  it('offers no way to start a draft from /leagues/connect (save-only surface)', async () => {
    mockSignIn();
    renderAt('/leagues/connect');
    await screen.findByText(/Sleeper username/);
    expect(screen.queryByRole('button', { name: /track draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set up espn draft/i })).not.toBeInTheDocument();
    // Scoped to the connect panel, NOT the whole document: TopNav intentionally renders a global
    // "Draft Room" nav link for signed-in users, which is a way *around* the app, not a way to
    // *start* a draft from this surface (the split's actual invariant — see DECISIONS.md).
    const panel = within(screen.getByRole('main'));
    expect(panel.queryByRole('link', { name: /track/i })).not.toBeInTheDocument();
    const draftLinks = panel
      .queryAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/draft');
    expect(draftLinks).toEqual([]);
  });

  it('renders /leagues/:id as league detail without capturing /leagues/connect', async () => {
    mockSignIn();
    renderAt('/leagues/connect');
    // /leagues/connect still renders the connect surface (the static route outranks :leagueId).
    expect(await screen.findByText(/Sleeper username/)).toBeInTheDocument();
    expect(screen.queryByText(/League not found/)).not.toBeInTheDocument();
  });

  it('renders /leagues/:leagueId as the league detail page', async () => {
    mockSignIn();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/leagues')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{
            id: 'league-doc-9', userId: 'user-1', provider: 'espn', providerLeagueId: '42',
            name: 'Detail League', season: '2026', teams: 10, rounds: 14, mySlot: null,
            settings: { provider: 'espn', leagueId: '42' }, providerUserId: null, latestDraftId: null,
            createdAt: '', updatedAt: '',
          }]),
        });
      }
      if (url.includes('manifest.json')) {
        manifestFetches += 1;
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }));
    try {
      renderAt('/leagues/league-doc-9');
      expect(await screen.findByText('Detail League')).toBeInTheDocument();
      // The drafted-team half is honest before any draft exists.
      expect(await screen.findByText(/No draft tracked for this league yet/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
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
    // and not left on /sign-in. (The launcher's heading since the 2026-08-28 rebuild.)
    expect(await screen.findByText(/Start tracking a draft/)).toBeInTheDocument();
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
    expect(await screen.findByText(/The Chip Is Yours/i)).toBeInTheDocument();

    // A remounted provider re-runs its mount effects → a second manifest fetch.
    expect(manifestFetches).toBe(1);

    // Deep-linking to /draft-guide while a session exists must NOT yank the user into
    // /draft (rehydration no longer auto-navigates; ResumeCard is the indicator).
    expect(screen.queryByText(/No active draft/)).not.toBeInTheDocument();
  });
});
