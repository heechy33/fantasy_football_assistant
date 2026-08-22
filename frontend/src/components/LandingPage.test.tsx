import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('stages the live-board showcase with real demo cards and a staged draft feed', () => {
    render(
      <LandingPage
        active="none"
        leagueName={null}
        onConnect={() => undefined}
        onStartEspn={() => undefined}
        onResume={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'The board, mid-draft' })).toBeInTheDocument();
    expect(screen.getByText("De'Von")).toBeInTheDocument();
    expect(screen.getByText('Achane')).toBeInTheDocument();
    expect(screen.getByText('Smith-Njigba')).toBeInTheDocument();
    expect(screen.getAllByText(/on the clock/i).length).toBeGreaterThan(0);
  });

  it('renders the integrations hub-and-spokes map', () => {
    render(
      <LandingPage
        active="none"
        leagueName={null}
        onConnect={() => undefined}
        onStartEspn={() => undefined}
        onResume={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'One hub for all your leagues.' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'ESPN' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: 'Sleeper' }).length).toBeGreaterThan(0);
    // Spokes beyond the two live providers render as monogram chips.
    expect(screen.getAllByRole('img', { name: 'Fantrax' }).length).toBeGreaterThan(0);
  });

  it('collapses the provider setup forms behind a Connect CTA while no session is active', async () => {
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
    expect(screen.queryByRole('heading', { name: 'Sleeper' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up ESPN draft' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sleeper username or user ID')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connect your league' }));

    expect(screen.getByRole('heading', { name: 'Sleeper' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ESPN' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sleeper username or user ID')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up ESPN draft' }));
    expect(onStartEspn).toHaveBeenCalledTimes(1);
  });

  it('skips the connect gate when a session is already active, showing Resume only there', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(
      <LandingPage
        active="espn"
        leagueName="Chip Life"
        onConnect={() => undefined}
        onStartEspn={() => undefined}
        onResume={onResume}
      />,
    );
    // ESPN card resumes instead of offering setup; the connect CTA never appears.
    expect(screen.queryByRole('button', { name: 'Connect your league' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up ESPN draft' })).not.toBeInTheDocument();
    expect(screen.getByText(/Chip Life/)).toBeInTheDocument();
    // Sleeper card still offers its connect flow, with a replace warning.
    expect(screen.getByLabelText('Sleeper username or user ID')).toBeInTheDocument();
    expect(screen.getByText(/replaces your active ESPN draft/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume draft' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
