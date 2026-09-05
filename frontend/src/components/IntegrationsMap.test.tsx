import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntegrationsMap } from './IntegrationsMap';

describe('IntegrationsMap', () => {
  it('renders all five integration provider buttons with no active detail by default', () => {
    render(<IntegrationsMap />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(screen.queryByText(/Direct WebSocket feed/i)).not.toBeInTheDocument();
  });

  it('toggles detail pill and aria-pressed on button click', () => {
    render(<IntegrationsMap />);
    const sleeperBtn = screen.getByRole('button', { name: /Show Sleeper data integration/i });
    expect(sleeperBtn).toHaveAttribute('aria-pressed', 'false');

    // Click to select
    fireEvent.click(sleeperBtn);
    expect(sleeperBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Direct WebSocket feed & real-time draft board sync')).toBeInTheDocument();

    // Click again to deselect
    fireEvent.click(sleeperBtn);
    expect(sleeperBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Direct WebSocket feed & real-time draft board sync')).not.toBeInTheDocument();
  });

  it('switches active provider when clicking a different button', () => {
    render(<IntegrationsMap />);
    const underdogBtn = screen.getByRole('button', { name: /Show Underdog data integration/i });
    fireEvent.click(underdogBtn);
    expect(underdogBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Best ball ADP & tournament market consensus')).toBeInTheDocument();

    const espnBtn = screen.getByRole('button', { name: /Show ESPN data integration/i });
    fireEvent.click(espnBtn);
    expect(underdogBtn).toHaveAttribute('aria-pressed', 'false');
    expect(espnBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Chrome extension live pick capture & custom league scoring')).toBeInTheDocument();
  });
});
