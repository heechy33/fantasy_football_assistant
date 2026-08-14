import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProviderBadge } from './ProviderBadge';

describe('ProviderBadge', () => {
  it('falls back to a brand-colored monogram chip when no SVG asset exists', () => {
    // RTSports has no committed logo asset yet, unlike the other brands below —
    // this keeps the monogram fallback path under real coverage.
    render(<ProviderBadge brandKey="rtsports" />);
    const badge = screen.getByRole('img', { name: 'RTSports' });
    expect(badge).toHaveClass('provider-badge-monogram');
    expect(badge).toHaveTextContent('RTS');
  });

  it('inlines the committed SVG logo for a brand that has one', () => {
    render(<ProviderBadge brandKey="espn" />);
    const badge = screen.getByRole('img', { name: 'ESPN' });
    expect(badge).toHaveClass('provider-badge-svg');
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('renders a neutral chip for an unknown brand key instead of nothing', () => {
    render(<ProviderBadge brandKey="nfl" />);
    expect(screen.getByRole('img', { name: 'nfl' })).toHaveClass('provider-badge-fallback');
  });

  it('applies the small size marker', () => {
    const { container } = render(<ProviderBadge brandKey="sleeper" size="sm" />);
    expect(container.querySelector('.provider-badge')).toHaveAttribute('data-size', 'sm');
  });
});
