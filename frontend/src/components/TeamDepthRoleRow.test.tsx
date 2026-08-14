import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TeamDepthRole, TeamDepthRoom } from '../data/teamDepthRole';
import { UNKNOWN_DEPTH_ROLE } from '../data/teamDepthRole';
import { TeamDepthRoleRow } from './TeamDepthRoleRow';

const room: TeamDepthRoom = {
  team: 'NE', position: 'RB', shape: 'split',
  members: [
    { playerId: 'lead', name: 'Lead Back', slot: 1, share: 0.42, secondary: 15.2, measuredTeam: 'NE', depthChartOrder: 1, depthChartPosition: null, basis: 'volume' },
    { playerId: 'viewed', name: 'Viewed Back', slot: 2, share: 0.3, secondary: 12.1, measuredTeam: 'NE', depthChartOrder: 2, depthChartPosition: null, basis: 'volume' },
  ],
  topGap: 0.12, crossTeamTop: false, contested: false, nearTie: false, season: 2025,
};

const depthRole: TeamDepthRole = {
  playerId: 'viewed', label: 'Split', headline: 'Split · NE RB',
  provenance: 'Slot from 2025 NE carry share; Sleeper lists him RB2.',
  slot: 2, basis: 'volume', shape: 'split', room,
};

describe('TeamDepthRoleRow', () => {
  it('renders the "Depth chart" heading, teammate shares, and highlights the viewed player', () => {
    render(<TeamDepthRoleRow depthRole={depthRole} playerId="viewed" feedStatus="ready" />);
    expect(screen.getByText('Depth chart')).toBeInTheDocument();
    expect(screen.queryByText('Split · NE RB')).not.toBeInTheDocument();
    expect(screen.getByText('Lead Back')).toBeInTheDocument();
    expect(screen.getByText('Viewed Back')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('15.2/g')).toBeInTheDocument();
    expect(screen.getByText('Viewed Back').closest('tr')).toHaveAttribute('data-viewed');
    expect(screen.getByText('Lead Back').closest('tr')).not.toHaveAttribute('data-viewed');
  });

  it('suffixes cross-team rows with their source team and stars the share', () => {
    const crossTeam: TeamDepthRole = {
      ...depthRole,
      basis: 'cross-team',
      provenance: 'Slot from 2025 carry share measured at KC, not NE — shares from different teams use different denominators, so this comparison is approximate.',
      room: {
        ...room,
        crossTeamTop: true,
        members: [
          { ...room.members[0]!, basis: 'cross-team', measuredTeam: 'KC' },
          room.members[1]!,
        ],
      },
    };
    render(<TeamDepthRoleRow depthRole={crossTeam} playerId="viewed" feedStatus="ready" />);
    expect(screen.getByText(/Lead Back \(KC\)/)).toBeInTheDocument();
    expect(screen.getByText('42%*')).toBeInTheDocument();
    expect(screen.queryByText(/measured at KC, not NE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/different denominators/)).not.toBeInTheDocument();
  });

  it('omits provenance and contested footnotes', () => {
    const contested: TeamDepthRole = {
      ...depthRole,
      provenance: "Slot from Sleeper's depth chart only — no measured 2025 NFL volume.",
      room: { ...room, contested: true },
    };
    render(<TeamDepthRoleRow depthRole={contested} playerId="viewed" feedStatus="ready" />);
    expect(screen.queryByText(/Sleeper lists him/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no measured 2025 NFL volume/)).not.toBeInTheDocument();
    expect(screen.queryByText(/volume leader is not the depth-chart #1/)).not.toBeInTheDocument();
  });

  it('caps the table at five ranks and still shows a deeper viewed player', () => {
    const crowded: TeamDepthRole = {
      ...depthRole,
      playerId: 'p8',
      room: {
        ...room,
        members: Array.from({ length: 12 }, (_, index) => ({
          playerId: `p${index + 1}`,
          name: `Back ${index + 1}`,
          slot: index + 1,
          share: 0.4 - index * 0.02,
          secondary: 10,
          measuredTeam: 'NE',
          depthChartOrder: index + 1,
          depthChartPosition: null,
          basis: 'volume' as const,
        })),
      },
    };
    render(<TeamDepthRoleRow depthRole={crowded} playerId="p8" feedStatus="ready" />);
    expect(screen.getByText('Back 8')).toBeInTheDocument();
    expect(screen.queryByText('Back 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Back 12')).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('fabricates no slot when the usage feed is degraded', () => {
    render(<TeamDepthRoleRow depthRole={depthRole} playerId="viewed" feedStatus="loading" />);
    expect(screen.getByText(/Loading prior-season context/)).toBeInTheDocument();
    expect(screen.queryByText('Depth chart')).not.toBeInTheDocument();
    expect(screen.queryByText('Lead Back')).not.toBeInTheDocument();
  });

  it('renders nothing for an unlabeled role (never a guess)', () => {
    render(<TeamDepthRoleRow depthRole={{ ...UNKNOWN_DEPTH_ROLE, playerId: 'k1' }} playerId="k1" feedStatus="ready" />);
    expect(screen.queryByText('Team depth role')).not.toBeInTheDocument();
  });
});
