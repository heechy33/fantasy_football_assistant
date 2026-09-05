import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Pick } from '../../../shared/types';
import { IdpBoard } from './IdpBoard';

const SAMPLE_EFFECTIVE_PICKS: Pick[] = [
  {
    overall: 1,
    round: 1,
    slot: 1,
    teamId: 'team-1',
    playerId: null,
    providerPlayerId: 'roquan-smith',
    providerPlayerName: 'Roquan Smith',
  },
];

describe('IdpBoard', () => {
  it('renders D (DE/LB) tab by default with rank #1 player', () => {
    render(<IdpBoard />);
    expect(screen.getByRole('tab', { name: /D \(DE \/ LB\)/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /S \(DB \/ Safety\)/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('switches to S tab when S tab is clicked', async () => {
    const user = userEvent.setup();
    render(<IdpBoard />);

    const sTab = screen.getByRole('tab', { name: /S \(DB \/ Safety\)/i });
    await user.click(sTab);

    expect(sTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /D \(DE \/ LB\)/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('filters players by search query', async () => {
    const user = userEvent.setup();
    render(<IdpBoard />);

    const searchInput = screen.getByPlaceholderText(/Search defender by name/i);
    await user.type(searchInput, 'Crosby');

    expect(screen.getByText(/Maxx Crosby/i)).toBeInTheDocument();
  });

  it('does not render Draft buttons for defensive players', () => {
    render(<IdpBoard />);
    expect(screen.queryByRole('button', { name: 'Draft' })).toBeNull();
  });

  it('shows Drafted badge for players already in effectivePicks and does not have Status column', () => {
    render(
      <IdpBoard
        effectivePicks={SAMPLE_EFFECTIVE_PICKS}
        onDraftPlayer={vi.fn()}
      />,
    );

    // Roquan Smith should be rendered as Drafted
    const draftedChips = screen.getAllByText('Drafted');
    expect(draftedChips.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('columnheader', { name: /Status/i })).toBeNull();
  });

  it('opens IdpDetailDrawer when a player row is clicked', async () => {
    const user = userEvent.setup();
    render(<IdpBoard />);

    const row = screen.getByRole('button', { name: /View details for Jordyn Brooks/i });
    await user.click(row);

    // Detail drawer should open with 2026 projection and bio
    expect(screen.getByText('2026 Yahoo Projection')).toBeInTheDocument();
    expect(screen.getByText('Texas Tech')).toBeInTheDocument();
  });
});
