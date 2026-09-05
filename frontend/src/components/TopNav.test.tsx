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
    expect(screen.getByRole('link', { name: 'My Leagues' })).toHaveAttribute('href', '/leagues');
  });

  it('shows only the public tabs plus a single Sign up CTA while signed out', () => {
    renderNav();
    // Public surface stays reachable signed out (DECISIONS.md, 2026-08-25).
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft Guide' })).toBeInTheDocument();
    // Account features stay gated.
    expect(screen.queryByRole('link', { name: 'Draft Room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Leagues' })).not.toBeInTheDocument();
    // One CTA only (2026-09-01): sign-up doubles as sign-in, so the separate Sign in link is gone.
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'My Leagues' })).not.toHaveAttribute('aria-current');
  });

  it('renders no status row when no draft is loaded', () => {
    renderNav();
    expect(screen.queryByText(/connected/)).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });

  it('renders the connected pill as blinker dot → provider logo → "ESPN connected"', () => {
    renderNav({ active: 'draft', statusProvider: 'espn' });
    expect(screen.getByText('ESPN connected')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ESPN' })).toBeInTheDocument();
    const pill = screen.getByText('ESPN connected').closest('.session-pill');
    expect(pill).toHaveAttribute('data-state', 'connected');
    // The logo renders AFTER the blinking status dot in DOM order (2026-09-01 redesign).
    const dot = pill!.querySelector('.top-nav-status-dot');
    expect(dot).not.toBeNull();
    expect(dot!.nextElementSibling).toBe(screen.getByRole('img', { name: 'ESPN' }).closest('.provider-badge'));
  });

  it('labels the pill from the provider brand — "Sleeper connected", not the raw key', () => {
    renderNav({ active: 'draft', statusProvider: 'sleeper' });
    expect(screen.getByText('Sleeper connected')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sleeper' })).toBeInTheDocument();
  });

  it('renders the Yahoo manual pill when statusProvider is yahoo', () => {
    renderNav({ active: 'draft', statusProvider: 'yahoo' });
    expect(screen.getByText('Yahoo manual')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Yahoo' })).toBeInTheDocument();
    const pill = screen.getByText('Yahoo manual').closest('.session-pill');
    expect(pill).toHaveAttribute('data-state', 'connected');
  });

  it('renders the red blinking Disconnected pill when the draft room has no live connection', () => {
    renderNav({ active: 'draft', showDisconnected: true });
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    const pill = screen.getByText('Disconnected').closest('.session-pill');
    expect(pill).toHaveAttribute('data-state', 'disconnected');
    expect(pill!.querySelector('.top-nav-status-dot[data-disconnected="true"]')).not.toBeNull();
    // No provider logo in the disconnected state — nothing is connected to brand.
    expect(screen.queryByRole('img', { name: 'ESPN' })).toBeNull();
  });
});