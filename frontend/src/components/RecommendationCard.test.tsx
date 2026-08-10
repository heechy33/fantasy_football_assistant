import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerMeta } from '../../../shared/types';
import type { Recommendation } from '../engine/recommend';
import { RecommendationCard } from './RecommendationCard';

const player: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

function baseRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    playerId: 'rb1', rank: 1, projectedPoints: 123.4, marginalRosterValue: 20, replacementAdjustedValue: 30.5,
    replacementLevelPoints: 50, vor: 30, vona: null, deprioritized: false, tier: 2, tierGapAfter: 5,
    tierBoundaryGap: 8, tierUrgency: 0.4, availableNextPickProbability: 0.62, availabilityAdp: 12.3,
    availabilityAdpHigh: 8, availabilityAdpLow: 18, availabilityStdev: 3.1, availabilitySampleSize: 400,
    nearTieWithLeader: false, scoringDiagnosticSeverity: 'none', missingScoringKeys: [], confidence: 'high',
    assignedRosterSlot: 'RB', replacementPlayerId: null,
    reasons: ['Provides 30.5 points over the last rosterable RB option.'], warnings: [],
    ...overrides,
  };
}

describe('RecommendationCard', () => {
  it('renders the card face fields', () => {
    render(<RecommendationCard recommendation={baseRecommendation()} player={player} contextSignals={[]} onViewDetails={vi.fn()} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Rush One')).toBeInTheDocument();
    expect(screen.getByText('123.4')).toBeInTheDocument();
    expect(screen.getByText('30.5')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('high confidence')).toBeInTheDocument();
  });

  it('shows the "too early" badge for a deprioritized K/DEF card without hiding it', () => {
    render(<RecommendationCard recommendation={baseRecommendation({ deprioritized: true })} player={player} contextSignals={[]} onViewDetails={vi.fn()} />);
    expect(screen.getByText('Too early')).toBeInTheDocument();
  });

  it('shows the near-tie badge only when flagged', () => {
    const { rerender } = render(<RecommendationCard recommendation={baseRecommendation()} player={player} contextSignals={[]} onViewDetails={vi.fn()} />);
    expect(screen.queryByText('Near tie')).not.toBeInTheDocument();
    rerender(<RecommendationCard recommendation={baseRecommendation({ nearTieWithLeader: true })} player={player} contextSignals={[]} onViewDetails={vi.fn()} />);
    expect(screen.getByText('Near tie')).toBeInTheDocument();
  });

  it('renders context signal chips passed in from the caller', () => {
    render(<RecommendationCard recommendation={baseRecommendation()} player={player} contextSignals={['Limited history']} onViewDetails={vi.fn()} />);
    expect(screen.getByText('Limited history')).toBeInTheDocument();
  });

  it('falls back to the raw playerId when no player metadata is available', () => {
    render(<RecommendationCard recommendation={baseRecommendation()} player={undefined} contextSignals={[]} onViewDetails={vi.fn()} />);
    expect(screen.getByText('rb1')).toBeInTheDocument();
  });

  it('invokes onViewDetails when the details button is clicked', async () => {
    const onViewDetails = vi.fn();
    const user = userEvent.setup();
    render(<RecommendationCard recommendation={baseRecommendation()} player={player} contextSignals={[]} onViewDetails={onViewDetails} />);
    await user.click(screen.getByRole('button', { name: 'View details' }));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });
});
