import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PositionBadge } from './PositionBadge';

describe('PositionBadge', () => {
  it('renders the canonical position label and data-position for styling', () => {
    render(<PositionBadge position="WR" />);
    const badge = screen.getByText('WR');
    expect(badge).toHaveAttribute('data-position', 'WR');
    expect(badge).toHaveClass('position-badge');
  });

  it('displays DST for internal DEF without changing the data-position token', () => {
    render(<PositionBadge position="DEF" />);
    const badge = screen.getByText('DST');
    expect(badge).toHaveAttribute('data-position', 'DEF');
    expect(badge).not.toHaveTextContent('DEF');
    expect(badge).not.toHaveTextContent('D/ST');
  });

  it('renders a consistent unknown state when position is null', () => {
    const { container } = render(<PositionBadge position={null} />);
    const badge = container.querySelector('.position-badge');
    expect(badge).toHaveClass('position-badge-unknown');
    expect(badge).toHaveTextContent('—');
    expect(badge).not.toHaveAttribute('data-position');
  });

  it('appends an optional className', () => {
    render(<PositionBadge position="K" className="draft-log-position-chip" />);
    expect(screen.getByText('K')).toHaveClass('position-badge', 'draft-log-position-chip');
  });
});
