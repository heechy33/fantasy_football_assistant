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

  it('renders the integrations hub-and-spokes map', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: 'One hub for all your leagues.' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'ESPN' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Sleeper' }).length).toBeGreaterThan(0);
    // Spokes beyond the two live providers render as monogram chips.
    expect(screen.getAllByRole('img', { name: 'Fantrax' }).length).toBeGreaterThan(0);
  });

  it('renders the public hero CTAs — Draft Guide needs no account', () => {
    renderLanding();
    const guide = screen.getByRole('link', { name: /Browse the Draft Guide/i });
    expect(guide).toHaveAttribute('href', '/draft-guide');
    expect(screen.getByRole('link', { name: 'Create free account' })).toHaveAttribute('href', '/sign-up');
  });

  it('shows INERT connect-card illustrations — disabled controls, no form, nothing interactive', () => {
    renderLanding();

    // No form anywhere on the landing (the old ConnectSleeper submitted one).
    expect(document.querySelector('form')).toBeNull();
    // The Sleeper username field is present but disabled — visual promise only.
    expect(screen.getByPlaceholderText('Sleeper username')).toBeDisabled();
    // Every button on both illustration cards is disabled.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show my 2026 leagues and drafts' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set up ESPN draft' })).toBeDisabled();
    // And there are zero enabled buttons inside ANY connect panel (order-independent: an active
    // session renders a Resume panel before the illustrations).
    for (const panel of document.querySelectorAll('.provider-panel')) {
      for (const button of panel.querySelectorAll('button')) {
        expect(button).toBeDisabled();
      }
    }
  });

  it('skips the connect cards when a session is already active, showing Resume instead', () => {
    renderLanding({ active: 'espn', leagueName: 'Chip Life' });
    // ESPN card resumes instead of offering setup.
    const resume = screen.getByRole('link', { name: 'Resume draft' });
    expect(resume).toHaveAttribute('href', '/draft');
    expect(screen.getByText(/Chip Life/)).toBeInTheDocument();
    // The Sleeper illustration card still renders (inert), but no second ESPN setup card.
    expect(screen.getByPlaceholderText('Sleeper username')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up ESPN draft' })).not.toBeInTheDocument();
  });
});


