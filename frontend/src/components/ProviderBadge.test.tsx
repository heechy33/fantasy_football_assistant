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

  it('renders the committed raster ESPN logo via the image branch', () => {
    // ESPN's committed asset is the official bitmap mark (espn-logo.png) rather than an
    // inline-able SVG, so it must resolve through the raster branch, not the monogram.
    render(<ProviderBadge brandKey="espn" />);
    const img = screen.getByRole('img', { name: 'ESPN' });
    expect(img.tagName).toBe('IMG');
    expect(img.closest('.provider-badge-img')).not.toBeNull();
    expect(img.getAttribute('src')).toMatch(/espn-logo\.png$/);
  });

  it('inlines the committed FFC football SVG instead of the monogram chip', () => {
    // FFC's lane appears in the guide table header and the drawer's market comparison —
    // both resolve through ProviderBadge, so the committed asset must win over the monogram.
    render(<ProviderBadge brandKey="ffc" />);
    const badge = screen.getByRole('img', { name: 'FFC' });
    expect(badge).toHaveClass('provider-badge-svg');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('.provider-badge-monogram')).toBeNull();
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

  it('inlines the committed Yahoo SVG instead of the monogram chip', () => {
    // Yahoo joined the landing's data-sources map — its committed asset must win over the
    // "Y!" monogram fallback the same way ESPN/FFC's do.
    render(<ProviderBadge brandKey="yahoo" />);
    const badge = screen.getByRole('img', { name: 'Yahoo' });
    expect(badge).toHaveClass('provider-badge-svg');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('.provider-badge-monogram')).toBeNull();
  });
});
