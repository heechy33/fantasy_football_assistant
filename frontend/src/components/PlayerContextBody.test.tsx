import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { Recommendation } from '../engine/recommend';
import { UNKNOWN_DEPTH_ROLE, type TeamDepthRole } from '../data/teamDepthRole';
import { PlayerContextBody } from './PlayerContextBody';

const player: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

function makeUsage(): PlayerUsage {
  return {
    season: 2025, usageSeasonObserved: true, snapPct: 0.5, targetShare: null, carryShare: 0.42,
    gamesWithAnySnap: 15, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
    availabilityRate: 0.9, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
  };
}

function baseRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    playerId: 'rb1', rank: 1, projectedPoints: 100, marginalRosterValue: 10,
    marginalRosterUtility: 15, expectedFollowUpValue: 0, planValue: 15, planningHorizon: 0,
    replacementAdjustedValue: 15, replacementLevelPoints: 50, vor: 15, vona: null,
    vonaSource: 'unavailable', lookaheadValue: null, downside: null,
    simulatedSurvivalProbability: null, benchDepthValue: 0, recommendationMode: 'starter', rankingBasis: 'rosterUtility',
    deprioritized: false, tier: 1, tierGapAfter: 0,
    tierBoundaryGap: 0, tierUrgency: 0, availableNextPickProbability: 0.5, availabilityAdp: 5,
    availabilityAdpHigh: null, availabilityAdpLow: null, availabilityStdev: 1, availabilitySampleSize: null,
    nearTie: false, scoringDiagnosticSeverity: 'none', missingScoringKeys: [], confidence: 'high',
    assignedRosterSlot: 'RB', replacementPlayerId: null,
    pickAction: 'take-now',
    reasons: ['Test reason.'], warnings: [],
    ...overrides,
  };
}

describe('PlayerContextBody', () => {
  it('renders the engine explanation and FFC disclosure when a recommendation is supplied', () => {
    render(
      <PlayerContextBody
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation({
          expectedFollowUpValue: 7, planValue: 22, planningHorizon: 1, vona: 8.5,
          vonaSource: 'analytic', lookaheadValue: 22.0, downside: 10.0,
          simulatedSurvivalProbability: 0.55, rankingBasis: 'planValue',
          availabilityAdpHigh: 3, availabilityAdpLow: 8, availabilitySampleSize: 250,
          reasons: ['Test reason.'],
        })}
        adpDisclosure={{ source: 'ffc-fallback', mockDrafts: 5000, teams: 12, format: 'ppr' }}
      />,
    );
    expect(screen.getByText('Engine explanation')).toBeInTheDocument();
    expect(screen.getByText('Test reason.')).toBeInTheDocument();
    expect(screen.getByText('Plan value')).toBeInTheDocument();
    expect(screen.getByText('Rollout starter value (diagnostic)')).toBeInTheDocument();
    expect(screen.getByText('VONA (wait cost, analytic)')).toBeInTheDocument();
    expect(screen.getByText('Simulated survival')).toBeInTheDocument();
    expect(screen.getByText(/5\D?000 recorded/)).toBeInTheDocument();
  });

  it('discloses Sleeper as the source when Sleeper is canonical', () => {
    render(
      <PlayerContextBody
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        adpDisclosure={{ source: 'sleeper', format: 'ppr' }}
      />,
    );
    expect(screen.getByText('Availability model (Sleeper draft-lobby ADP)')).toBeInTheDocument();
    expect(screen.getByText(/Sourced from Sleeper's own draft-lobby ADP/)).toBeInTheDocument();
    expect(screen.queryByText(/recorded.*Fantasy Football Calculator mock drafts/)).not.toBeInTheDocument();
  });

  it('renders the team-depth-role provenance sentence when a labeled role is supplied', () => {
    const depthRole: TeamDepthRole = {
      playerId: 'rb1', label: 'RB1', headline: 'RB1 · BUF RB',
      provenance: 'Slot from 2025 BUF carry share; Sleeper lists him RB1.',
      slot: 1, basis: 'volume', shape: 'clear',
      room: {
        team: 'BUF', position: 'RB', shape: 'clear',
        members: [
          { playerId: 'rb1', name: 'Rush One', slot: 1, share: 0.5, secondary: 13.8, measuredTeam: 'BUF', depthChartOrder: 1, depthChartPosition: null, basis: 'volume' },
        ],
        topGap: null, crossTeamTop: false, contested: false, nearTie: false, season: 2025,
      },
    };
    render(
      <PlayerContextBody
        player={player}
        usage={makeUsage()}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        adpDisclosure={{ source: 'sleeper', format: 'ppr' }}
        depthRole={depthRole}
      />,
    );
    expect(screen.getByText('Slot from 2025 BUF carry share; Sleeper lists him RB1.')).toBeInTheDocument();
  });

  it('omits the provenance sentence when the role is unlabeled (never a guess)', () => {
    render(
      <PlayerContextBody
        player={player}
        usage={makeUsage()}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        depthRole={UNKNOWN_DEPTH_ROLE}
      />,
    );
    expect(screen.queryByText(/Slot from/)).not.toBeInTheDocument();
  });

  it('does not render engine explanation when no recommendation is supplied', () => {
    render(<PlayerContextBody player={player} usage={undefined} feedStatus="ready" />);
    expect(screen.queryByText('Engine explanation')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Score')).not.toBeInTheDocument();
  });
});
