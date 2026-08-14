import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StarRating } from './StarRating';

describe('StarRating', () => {
  it('exposes Upside: 4 out of 5 and fills four stars', () => {
    const { container } = render(<StarRating label="Upside" value={4} />);
    expect(screen.getByRole('img', { name: 'Upside: 4 out of 5' })).toBeInTheDocument();
    expect(container.querySelectorAll('.star-filled')).toHaveLength(4);
    expect(container.querySelectorAll('.star-hollow')).toHaveLength(1);
  });

  it('treats null as not published and renders five hollow stars', () => {
    const { container } = render(<StarRating label="Bust" value={null} />);
    expect(screen.getByRole('img', { name: 'Bust: not published' })).toBeInTheDocument();
    expect(container.querySelectorAll('.star-filled')).toHaveLength(0);
    expect(container.querySelectorAll('.star-hollow')).toHaveLength(5);
  });

  it('treats 0 as a published SOS value with zero filled stars', () => {
    const { container } = render(<StarRating label="SOS" value={0} />);
    expect(screen.getByRole('img', { name: 'SOS: 0 out of 5' })).toBeInTheDocument();
    expect(container.querySelectorAll('.star-filled')).toHaveLength(0);
    expect(container.querySelectorAll('.star-hollow')).toHaveLength(5);
  });

  it('marks SVG shapes decorative with aria-hidden', () => {
    const { container } = render(<StarRating label="Upside" value={5} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(5);
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
