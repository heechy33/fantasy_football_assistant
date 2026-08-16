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

describe('BoardFilters presentation control', () => {
  it('keeps the layout control separate from ranking tabs', async () => {
    const onBoardPresentationChange = vi.fn();
    const user = userEvent.setup();
    render(
      <BoardFilters
        {...defaultProps()}
        boardPresentation="rows"
        onBoardPresentationChange={onBoardPresentationChange}
        presentationToggleVisible
      />,
    );

    expect(screen.getByRole('radio', { name: 'Rows' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('tab', { name: 'Engine' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'All' }).closest('.board-position-layout-row')).toContainElement(
      screen.getByRole('radiogroup', { name: 'Board layout' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Cards' }));
    expect(onBoardPresentationChange).toHaveBeenCalledWith('cards');
  });
});

describe('BoardFilters mode control', () => {
  it('hides Engine/ADP tabs when modeToggleVisible is false', () => {
    render(<BoardFilters {...defaultProps()} modeToggleVisible={false} />);
    expect(screen.queryByRole('tab', { name: 'Engine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'ADP' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
  });
});

describe('BoardFilters session menu', () => {
  it('renders the session `⋯` menu next to the card/row toggle when actions are supplied', () => {
    const actions = [{ id: 'log', label: 'Log next pick', onSelect: () => undefined }];
    render(
      <BoardFilters
        {...defaultProps()}
        presentationToggleVisible
        boardPresentation="cards"
        onBoardPresentationChange={vi.fn()}
        sessionActions={actions}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Session actions' });
    expect(trigger.closest('.board-toolbar-right')).toContainElement(
      screen.getByRole('radiogroup', { name: 'Board layout' }),
    );
  });

  it('omits the session menu trigger when no actions are supplied', () => {
    render(<BoardFilters {...defaultProps()} presentationToggleVisible boardPresentation="cards" onBoardPresentationChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Session actions' })).not.toBeInTheDocument();
  });
});
