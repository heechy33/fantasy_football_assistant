import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NextPickSurvivalMeter, survivalBand } from './NextPickSurvivalMeter';

describe('survivalBand', () => {
  it('uses half-open 20% buckets, with 1.0 in fs', () => {
    expect(survivalBand(0).id).toBe('next-year');
    expect(survivalBand(0.199).id).toBe('next-year');
    expect(survivalBand(0.2).id).toBe('nah');
    expect(survivalBand(0.399).id).toBe('nah');
    expect(survivalBand(0.4).id).toBe('maybe');
    expect(survivalBand(0.6).id).toBe('yee');
    expect(survivalBand(0.8).id).toBe('fs');
    expect(survivalBand(1).id).toBe('fs');
  });
});

describe('NextPickSurvivalMeter', () => {
  it('renders the percent, meme labels, and meter semantics', () => {
    render(<NextPickSurvivalMeter probability={0.42} />);
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('next year')).toBeInTheDocument();
    expect(screen.getByText('nah')).toBeInTheDocument();
    expect(screen.getByText('maybe')).toBeInTheDocument();
    expect(screen.getByText('yee')).toBeInTheDocument();
    expect(screen.getByText('fs')).toBeInTheDocument();
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '42');
    expect(meter).toHaveAttribute('aria-valuetext', '42 percent, maybe');
    expect(meter).toHaveAttribute('data-band', 'maybe');
  });

  it('omits the meter when probability is null', () => {
    const { container } = render(<NextPickSurvivalMeter probability={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});
