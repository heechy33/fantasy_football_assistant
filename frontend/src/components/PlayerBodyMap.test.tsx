import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InjuryBodyPartHistory } from '../../../shared/types';
import { PlayerBodyMap } from './PlayerBodyMap';

function report(season: number, week: number, label: string) {
  return { season, week, labels: [label] };
}

const HISTORY: InjuryBodyPartHistory[] = [
  { normalizedBodyPart: 'left knee', episodes: 2, recurring: true, reports: [report(2023, 4, 'Knee'), report(2024, 7, 'Knee')] },
  { normalizedBodyPart: 'right shoulder', episodes: 1, recurring: false, reports: [report(2025, 2, 'Shoulder')] },
];

describe('PlayerBodyMap', () => {
  it('renders "unavailable" copy and no figure when the feed is not ready', () => {
    const { container } = render(
      <PlayerBodyMap injuryHistory={HISTORY} feedStatus="unavailable" playerName="Rush One" />,
    );
    expect(screen.getByText('Injury history is unavailable.')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders loading copy and no figure while loading', () => {
    const { container } = render(
      <PlayerBodyMap injuryHistory={undefined} feedStatus="loading" playerName="Rush One" />,
    );
    expect(screen.getByText('Loading injury history…')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('only history-bearing regions are focusable', () => {
    render(<PlayerBodyMap injuryHistory={HISTORY} feedStatus="ready" playerName="Rush One" />);
    // Two entries -> two interactive regions (left knee, right shoulder).
    const interactive = screen.getAllByRole('button');
    expect(interactive).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Left Knee/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Right Shoulder/ })).toBeInTheDocument();
  });

  it('focusing a region writes its history into the live status region (keyboard parity with hover)', () => {
    render(<PlayerBodyMap injuryHistory={HISTORY} feedStatus="ready" playerName="Rush One" />);
    const kneeRegion = screen.getByRole('button', { name: /Left Knee/ });
    fireEvent.focus(kneeRegion);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('2 episodes, recurring');
    expect(status).toHaveTextContent('2023 W4: Knee');
    expect(status).toHaveTextContent('2024 W7: Knee');
  });

  it('hovering a region also writes into the live status region', () => {
    render(<PlayerBodyMap injuryHistory={HISTORY} feedStatus="ready" playerName="Rush One" />);
    const shoulderRegion = screen.getByRole('button', { name: /Right Shoulder/ });
    fireEvent.mouseEnter(shoulderRegion);
    expect(screen.getByRole('status')).toHaveTextContent('1 episode.');
    expect(screen.getByRole('status')).toHaveTextContent('2025 W2: Shoulder');
  });

  it('renders unlocalized entries as text with no tinted region', () => {
    const history: InjuryBodyPartHistory[] = [
      { normalizedBodyPart: 'illness', episodes: 1, recurring: false, reports: [] },
    ];
    render(<PlayerBodyMap injuryHistory={history} feedStatus="ready" playerName="Rush One" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/illness · 1 episode/)).toBeInTheDocument();
  });

  it('renders the figure with no interactive regions when there is no injury history', () => {
    render(<PlayerBodyMap injuryHistory={[]} feedStatus="ready" playerName="Rush One" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Hover or focus a highlighted region for its reported injury history.')).toBeInTheDocument();
  });
});
