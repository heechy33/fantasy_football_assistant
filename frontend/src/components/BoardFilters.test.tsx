import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BoardFilters } from './BoardFilters';

function defaultProps() {
  return {
    boardMode: 'engine' as const,
    onBoardModeChange: vi.fn(),
    positionTabs: [{ label: 'All', position: null }, { label: 'RB', position: 'RB' as const }],
    displayPosition: null,
    onDisplayPositionChange: vi.fn(),
  };
}

describe('BoardFilters', () => {
  it('renders Engine/ADP and position tabs with correct aria-selected state', () => {
    render(<BoardFilters {...defaultProps()} displayPosition="RB" />);
    expect(screen.getByRole('tab', { name: 'Engine' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'ADP' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'RB' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onBoardModeChange and onDisplayPositionChange when tabs are clicked', async () => {
    const onBoardModeChange = vi.fn();
    const onDisplayPositionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <BoardFilters
        {...defaultProps()}
        onBoardModeChange={onBoardModeChange}
        onDisplayPositionChange={onDisplayPositionChange}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'ADP' }));
    expect(onBoardModeChange).toHaveBeenCalledWith('adp');

    await user.click(screen.getByRole('tab', { name: 'RB' }));
    expect(onDisplayPositionChange).toHaveBeenCalledWith('RB');
  });
});
