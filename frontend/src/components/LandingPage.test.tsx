import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

// jsdom can't run the three.js canvas (no WebGL/getContext); mock it so test output isn't
// drowned in "HTMLCanvasElement.prototype.getContext" stderr noise. The canvas has its own
// concerns — this file is about the landing's content contracts.
vi.mock('./LandingHeroCanvas', () => ({
  LandingHeroCanvas: () => <div data-testid="hero-canvas-mock" />,
}));

// Since Phase 3 the landing is ILLUSTRATION-ONLY: the connect cards look like the real flow but
// are deliberately inert — no <form>, every control disabled, nothing fetched on interaction.
// The real connect flow lives at /onboarding/league (see routes/onboarding/onboarding.test.tsx,
// which carries the ESPN sync-regression assertions this file used to guard).

function renderLanding(props: Partial<Parameters<typeof LandingPage>[0]> = {}) {
  return render(
    <MemoryRouter>
      <LandingPage
        active="none"
        leagueName={null}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('LandingPage', () => {
  it('stages the live-board showcase with real demo cards and a staged draft feed', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: 'The board, mid-draft' })).toBeInTheDocument();
    expect(screen.getByText("De'Von")).toBeInTheDocument();
    expect(screen.getByText('Achane')).toBeInTheDocument();
    expect(screen.getByText('Smith-Njigba')).toBeInTheDocument();
    expect(screen.getAllByText(/on the clock/i).length).toBeGreaterThan(0);
  });

  it('renders the data-sources map', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: 'Every source. One board.' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'ESPN' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Sleeper' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Underdog' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Yahoo' }).length).toBeGreaterThan(0);
  });

  it('renders no hero CTAs — TopNav already carries Draft Guide and Sign up', () => {
    renderLanding();
    expect(screen.queryByRole('link', { name: /Draft Guide/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Create free account|Sign up/i })).not.toBeInTheDocument();
  });

  it('renders NO connect rows at the bottom — no forms, no Resume, no provider CTAs', () => {
    renderLanding({ active: 'espn', leagueName: 'Chip Life' });

    // The illustrations are long gone...
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByPlaceholderText('Sleeper username')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up ESPN draft' })).not.toBeInTheDocument();
    // ...and so are the compact connect rows / Resume panel.
    expect(screen.queryByRole('link', { name: 'Resume draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /connect league|sign up to connect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sleeper' })).not.toBeInTheDocument();
  });

  it('stages the demo feed at the headline pick — Round 2 · Pick 19 overall (2.07 in a 12-teamer)', () => {
    renderLanding();
    expect(screen.getByText('Round 2 · Pick 19 · You’re on the clock')).toBeInTheDocument();
    expect(screen.getByText('2.07')).toBeInTheDocument();
  });

  it('renders the new cinematic hero title', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: /the chip is yours/i })).toBeInTheDocument();
  });
});


