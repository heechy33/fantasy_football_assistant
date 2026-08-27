import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { APP_NAME, TopNav } from './TopNav';

// The nav tabs and brand are real <Link>s since Phase 3's deferred conversion — public pages need
// middle-click/open-in-new-tab targets. Every render needs a router context; assertions pin the
// link roles and hrefs instead of the old onNavigate callback.

function renderNav(props: Partial<Parameters<typeof TopNav>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TopNav active="home" {...props} />
    </MemoryRouter>,
  );
}

describe('TopNav', () => {
  it('renders the Fantasy Bob brand and all four page destinations when authenticated', () => {
    renderNav({ active: 'home', authenticated: true });
    expect(screen.getByRole('link', { name: `${APP_NAME} — go to Home` })).toBeInTheDocument();
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Draft Guide' })).toHaveAttribute('href', '/draft-guide');
    expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/draft');
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('href', '/teams');
  });

  it('shows only the public tabs plus placeholder auth CTAs while signed out', () => {
    renderNav();
    // Public surface stays reachable signed out (DECISIONS.md, 2026-08-25).
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft Guide' })).toBeInTheDocument();
    // Account features stay gated.
    expect(screen.queryByRole('link', { name: 'Draft Room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/sign-up');
  });

  it('shows a sign-out button instead of Sign in/Sign up while authenticated', () => {
    renderNav({ authenticated: true, onSignOut: () => {} });
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('marks the active page with aria-current', () => {
    renderNav({ active: 'draft', authenticated: true });
    expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Teams' })).not.toHaveAttribute('aria-current');
  });

  it('renders no status row when no draft is loaded', () => {
    renderNav();
    expect(screen.queryByText(/ADP/)).not.toBeInTheDocument();
  });

  it('renders the status pill with the league name, ADP format, and pick count', () => {
    renderNav({
      active: 'draft',
      leagueName: 'Chip Life',
      adpFormat: 'ppr',
      statusProvider: 'espn',
      pickCount: 29,
    });
    expect(screen.getByText(/Chip Life · ADP ppr · 29 picks/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ESPN' })).toBeInTheDocument();
  });
});