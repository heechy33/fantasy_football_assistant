import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { APP_NAME, TopNav, type AppPage } from './TopNav';

describe('TopNav', () => {
  it('renders the Fantasy Assistant Bob brand and all three page destinations', () => {
    render(<TopNav active="home" onNavigate={() => undefined} />);
    expect(screen.getByRole('button', { name: `${APP_NAME} — go to Home` })).toBeInTheDocument();
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft Room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Teams' })).toBeInTheDocument();
  });

  it('marks the active page with aria-current and calls onNavigate on click', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn<(page: AppPage) => void>();
    const { rerender } = render(<TopNav active="draft" onNavigate={onNavigate} />);

    expect(screen.getByRole('button', { name: 'Draft Room' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Teams' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: 'Teams' }));
    expect(onNavigate).toHaveBeenCalledWith('teams');

    await user.click(screen.getByRole('button', { name: `${APP_NAME} — go to Home` }));
    expect(onNavigate).toHaveBeenCalledWith('home');

    rerender(<TopNav active="home" onNavigate={onNavigate} />);
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders no draft chrome when no draft is loaded', () => {
    render(<TopNav active="home" onNavigate={() => undefined} />);
    expect(screen.queryByText('Round')).not.toBeInTheDocument();
    expect(screen.queryByText(/until your turn/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Synced with/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose another draft' })).not.toBeInTheDocument();
  });

  it('renders the round.pick hero with the countdown when a draft is loaded', () => {
    render(
      <TopNav
        active="draft"
        onNavigate={() => undefined}
        roundPick="4.09"
        picksUntilUserTurn={2}
        onChooseAnotherDraft={() => undefined}
      />,
    );
    expect(screen.getByText('Round')).toBeInTheDocument();
    expect(screen.getByText('4.09')).toBeInTheDocument();
    expect(screen.getByText('2 until your turn')).toBeInTheDocument();
  });

  it('renders the status subline with the league name and ADP format', () => {
    render(
      <TopNav
        active="draft"
        onNavigate={() => undefined}
        roundPick="4.09"
        leagueName="Chip Life"
        adpFormat="ppr"
      />,
    );
    expect(screen.getByText(/Synced with Chip Life · ADP ppr/)).toBeInTheDocument();
  });

  it('calls the session callback from Choose another draft', async () => {
    const onChooseAnotherDraft = vi.fn();
    const user = userEvent.setup();
    render(
      <TopNav
        active="draft"
        onNavigate={() => undefined}
        roundPick="4.09"
        onChooseAnotherDraft={onChooseAnotherDraft}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Choose another draft' }));
    expect(onChooseAnotherDraft).toHaveBeenCalledTimes(1);
  });
});
