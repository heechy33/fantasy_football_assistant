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

  it('renders the committed PNG logo for a brand that only has one', () => {
    render(<ProviderBadge brandKey="sleeper" />);
    const img = screen.getByRole('img', { name: 'Sleeper' });
    expect(img.tagName).toBe('IMG');
    expect(img.closest('.provider-badge-img')).not.toBeNull();
  });

  it('renders the official Underdog AVIF mark instead of a placeholder or monogram', () => {
    // The hand-drawn placeholder SVG was removed when the official asset landed —
    // Underdog must resolve to the committed raster image, never the monogram chip.
    render(<ProviderBadge brandKey="underdog" />);
    const img = screen.getByRole('img', { name: 'Underdog' });
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/underdog.*\.avif$/);
    expect(img.closest('.provider-badge-img')).not.toBeNull();
    expect(document.querySelector('.provider-badge-monogram')).toBeNull();
  });
});
