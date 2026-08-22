import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { APP_NAME, TopNav, type AppPage } from './TopNav';

describe('TopNav', () => {
  it('renders the Fantasy Bob brand and all three page destinations when authenticated', () => {
    render(<TopNav active="home" onNavigate={() => undefined} authenticated />);
    expect(screen.getByRole('button', { name: `${APP_NAME} — go to Home` })).toBeInTheDocument();
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft Room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Teams' })).toBeInTheDocument();
  });

  it('hides page tabs and shows placeholder auth CTAs while signed out', () => {
    render(<TopNav active="home" onNavigate={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Draft Room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Teams' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('marks the active page with aria-current and calls onNavigate on click', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn<(page: AppPage) => void>();
    const { rerender } = render(<TopNav active="draft" onNavigate={onNavigate} authenticated />);

    expect(screen.getByRole('button', { name: 'Draft Room' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Teams' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: 'Teams' }));
    expect(onNavigate).toHaveBeenCalledWith('teams');

    await user.click(screen.getByRole('button', { name: `${APP_NAME} — go to Home` }));
    expect(onNavigate).toHaveBeenCalledWith('home');

    rerender(<TopNav active="home" onNavigate={onNavigate} authenticated />);
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders no status row when no draft is loaded', () => {
    render(<TopNav active="home" onNavigate={() => undefined} />);
    expect(screen.queryByText(/ADP/)).not.toBeInTheDocument();
  });

  it('renders the status pill with the league name, ADP format, and pick count', () => {
    render(
      <TopNav
        active="draft"
        onNavigate={() => undefined}
        leagueName="Chip Life"
        adpFormat="ppr"
        statusProvider="espn"
        pickCount={29}
      />,
    );
    expect(screen.getByText(/Chip Life · ADP ppr · 29 picks/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ESPN' })).toBeInTheDocument();
  });
});
