import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('renders both provider cards with a connect/setup path and no manual-skip control', () => {
    render(
      <LandingPage
        active="none"
        leagueName={null}
        onConnect={() => undefined}
        onStartEspn={() => undefined}
        onResume={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Sleeper' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ESPN' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sleeper username or user ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up ESPN draft' })).toBeInTheDocument();
    expect(screen.queryByText(/track this draft manually/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
  });

  it('calls onStartEspn from the ESPN card CTA', async () => {
    const user = userEvent.setup();
    const onStartEspn = vi.fn();
    render(
      <LandingPage
        active="none"
        leagueName={null}
        onConnect={() => undefined}
        onStartEspn={onStartEspn}
        onResume={() => undefined}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Set up ESPN draft' }));
    expect(onStartEspn).toHaveBeenCalledTimes(1);
  });

  it('shows Resume only on the active provider card, with a replace-draft warning on the other', () => {
    render(
      <LandingPage
        active="espn"
        leagueName="Chip Life"
        onConnect={() => undefined}
        onStartEspn={() => undefined}
        onResume={() => undefined}
      />,
    );
    // ESPN card resumes instead of offering setup.
    expect(screen.getByRole('button', { name: 'Resume draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up ESPN draft' })).not.toBeInTheDocument();
    expect(screen.getByText(/Chip Life/)).toBeInTheDocument();
    // Sleeper card still offers its connect flow, with a warning that starting it replaces the draft.
    expect(screen.getByLabelText('Sleeper username or user ID')).toBeInTheDocument();
    expect(screen.getByText(/replaces your active ESPN draft/i)).toBeInTheDocument();
  });

  it('calls onResume from the active card', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(
      <LandingPage
        active="sleeper"
        leagueName="Chip Life"
        onConnect={() => undefined}
        onStartEspn={() => undefined}
        onResume={onResume}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Resume draft' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/replaces your active Sleeper draft/i)).toBeInTheDocument();
  });
});
