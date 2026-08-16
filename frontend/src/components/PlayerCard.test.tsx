import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdpEntry, PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import type { Recommendation } from '../engine/recommend';
import { PlayerCard } from './PlayerCard';

const player: PlayerMeta = {
  playerId: 'rb2', name: 'Rush Two', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

function baseRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    playerId: 'rb2', rank: 2, projectedPoints: 100, marginalRosterValue: 15,
    marginalRosterUtility: 22, expectedFollowUpValue: 0, planValue: 22, planningHorizon: 0,
    replacementAdjustedValue: 22, replacementLevelPoints: 50, vor: 20, vona: null,
    vonaSource: 'unavailable', lookaheadValue: null, downside: null,
    simulatedSurvivalProbability: null, benchDepthValue: 0, recommendationMode: 'starter', rankingBasis: 'rosterUtility',
    deprioritized: false, tier: 2, tierGapAfter: 3, tierBoundaryGap: 4, tierUrgency: 0.2,
    availableNextPickProbability: 0.4, availabilityAdp: 20, availabilityAdpHigh: null,
    availabilityAdpLow: null, availabilityStdev: 4, availabilitySampleSize: null,
    nearTie: false, scoringDiagnosticSeverity: 'none', missingScoringKeys: [], confidence: 'high',
    assignedRosterSlot: 'BN', replacementPlayerId: null,
    pickAction: 'take-now',
    reasons: ['Adds 22.0 total roster utility.'], warnings: [],
    ...overrides,
  };
}

function adpEntry(playerId: string, adp: number): AdpEntry {
  return {
    playerId, name: playerId, position: 'RB', team: 'BUF', adp, stdev: 4,
    high: null, low: null, timesDrafted: null, byeWeek: 7,
    adpSource: 'sleeper', stdevSource: 'fitted',
  };
}

describe('PlayerCard with a recommendation', () => {
  it('renders board rank, identity, overall, and omits take-now / utility prose', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />);
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('Rush')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.queryByText('Take now')).not.toBeInTheDocument();
    expect(screen.queryByText('Adds 22.0 total roster utility.')).not.toBeInTheDocument();
  });

  it('renders Projection and ADP on the face from the recommendation', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />);
    expect(screen.getByText('Proj')).toBeInTheDocument();
    expect(screen.getByText('100.0')).toBeInTheDocument();
    expect(screen.getByText('ADP')).toBeInTheDocument();
    expect(screen.getByText('20.0')).toBeInTheDocument();
  });

  it('labels the ADP face value with the player\'s own board source when known', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        rank={2}
        adpSource="espn"
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('20.0')).toBeInTheDocument();
    expect(screen.getByText('ESPN')).toBeInTheDocument();
  });

  it('omits the ADP source label when provenance is unknown', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />);
    expect(screen.queryByText('ESPN')).not.toBeInTheDocument();
    expect(screen.queryByText('Sleeper')).not.toBeInTheDocument();
  });

  it('prefers FantasyPros positional rank and falls back to ADP rank', () => {
    const { rerender } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        rank={2}
        fantasyPros={{ rank: 2, tier: 1, upside: 3, bust: null, sos: 0, ecrVsAdp: null, positionRank: 'RB2' }}
        adpBoard={[adpEntry('rb1', 10), adpEntry('rb2', 20)]}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('RB2')).toBeInTheDocument();
    rerender(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        rank={2}
        adpBoard={[adpEntry('rb1', 10), adpEntry('rb2', 20)]}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('ADP RB2')).toBeInTheDocument();
  });

  it('shows an injury badge when the player has a status', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={{ ...player, injuryStatus: 'Questionable' }}
        rank={2}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('Q')).toBeInTheDocument();
    expect(screen.queryByText('Questionable')).not.toBeInTheDocument();
  });

  it('shows Rookie instead of New team when both would apply', () => {
    const usage: PlayerUsage = {
      season: 2025, usageSeasonObserved: true, snapPct: null, targetShare: null, carryShare: null,
      gamesWithAnySnap: 0, recentTeam: 'BUF', teamChanged: true, knownAbsent: false,
      availabilityRate: null, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
    };
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={{ ...player, yearsExp: 0 }}
        usage={usage}
        rank={2}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('Rookie')).toBeInTheDocument();
    expect(screen.queryByText('New team')).not.toBeInTheDocument();
  });

  it('shows New team when healthy and not a rookie', () => {
    const usage: PlayerUsage = {
      season: 2025, usageSeasonObserved: true, snapPct: 0.5, targetShare: null, carryShare: 0.3,
      gamesWithAnySnap: 12, recentTeam: 'KC', teamChanged: true, knownAbsent: false,
      availabilityRate: 0.8, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
    };
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        usage={usage}
        rank={2}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('New team')).toBeInTheDocument();
  });

  it('shows one role-volume stat for RBs and omits it when missing', () => {
    const usage: PlayerUsage = {
      season: 2025, usageSeasonObserved: true, snapPct: 0.6, targetShare: 0.1, carryShare: 0.42,
      gamesWithAnySnap: 14, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
      availabilityRate: 0.9, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
    };
    const { rerender } = render(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} usage={usage} onViewDetails={vi.fn()} />,
    );
    expect(screen.getByText('Carry')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    rerender(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />,
    );
    expect(screen.queryByText('Carry')).not.toBeInTheDocument();
  });

  it('shows completion percentage for QBs instead of snap percentage', () => {
    const qb: PlayerMeta = { ...player, playerId: 'qb1', name: 'Quarter One', position: 'QB', eligiblePositions: ['QB'] };
    const usage: PlayerUsage = {
      season: 2025, usageSeasonObserved: true, snapPct: 0.99, completionPct: 22 / 30, targetShare: null, carryShare: 0.1,
      gamesWithAnySnap: 16, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
      availabilityRate: 0.9, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
    };
    render(
      <PlayerCard playerId="qb1" recommendation={baseRecommendation({ playerId: 'qb1' })} player={qb} rank={1} usage={usage} onViewDetails={vi.fn()} />
    );
    expect(screen.getByText('Cmp%')).toBeInTheDocument();
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.queryByText('Snap')).not.toBeInTheDocument();
  });
  it('shows target share for WRs', () => {
    const wr: PlayerMeta = { ...player, playerId: 'wr1', name: 'Wide One', position: 'WR', eligiblePositions: ['WR'] };
    const usage: PlayerUsage = {
      season: 2025, usageSeasonObserved: true, snapPct: 0.8, targetShare: 0.18, carryShare: 0.01,
      gamesWithAnySnap: 16, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
      availabilityRate: 0.9, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
    };
    render(
      <PlayerCard playerId="wr1" recommendation={baseRecommendation({ playerId: 'wr1' })} player={wr} rank={3} usage={usage} onViewDetails={vi.fn()} />,
    );
    expect(screen.getByText('Tgt')).toBeInTheDocument();
    expect(screen.getByText('18%')).toBeInTheDocument();
    expect(screen.queryByText('Carry')).not.toBeInTheDocument();
  });


  it('renders the Role tile from depthRole with the headline in the title', () => {
    const depthRole: TeamDepthRole = {
      playerId: 'rb2', label: 'RB1', headline: 'RB1 Â· BUF RB',
      provenance: 'Slot from 2025 BUF carry share; Sleeper lists him RB1.',
      slot: 1, basis: 'volume', shape: 'clear', room: null,
    };
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        rank={2}
        depthRole={depthRole}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('RB1')).toBeInTheDocument();
    expect(screen.getByText('RB1').closest('[data-role-basis]')).toHaveAttribute('data-role-basis', 'volume');
    expect(screen.getByTitle('RB1 Â· BUF RB')).toBeInTheDocument();
  });

  it('renders an em dash with data-role-basis unknown when depthRole is absent (never a guess)', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />);
    expect(screen.getByText('Role')).toBeInTheDocument();
    const dd = screen.getByText('\u2014');
    expect(dd.closest('[data-role-basis]')).toHaveAttribute('data-role-basis', 'unknown');
  });

  it('shows Avg fpts instead of Role for K and DEF, which never get a depth room', () => {
    const kicker: PlayerMeta = { ...player, playerId: 'k1', name: 'Kick One', position: 'K', eligiblePositions: ['K'] };
    render(
      <PlayerCard
        playerId="k1"
        recommendation={baseRecommendation({ playerId: 'k1' })}
        player={kicker}
        rank={2}
        avgPointsPerGame={9.4}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
    expect(screen.getByText('Avg fpts')).toBeInTheDocument();
    expect(screen.getByText('9.4')).toBeInTheDocument();
  });

  it('renders an em dash for Avg fpts when a K/DEF has no weekly-stats data yet', () => {
    const dst: PlayerMeta = { ...player, playerId: 'd1', name: 'Buffalo Bills', position: 'DEF', eligiblePositions: ['DEF'] };
    render(
      <PlayerCard playerId="d1" recommendation={baseRecommendation({ playerId: 'd1' })} player={dst} rank={2} onViewDetails={vi.fn()} />,
    );
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
    expect(screen.getByText('Avg fpts')).toBeInTheDocument();
    expect(screen.getByText('\u2014')).toBeInTheDocument();
  });


  it('opens details from a click anywhere on the card face', async () => {
    const onViewDetails = vi.fn();
    const user = userEvent.setup();
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={onViewDetails} />);
    await user.click(screen.getByText('Two'));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('paints a contained team-logo watermark from the Sleeper CDN', () => {
    const { container } = render(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />,
    );
    const watermark = container.querySelector('.player-card-watermark');
    expect(watermark).toHaveAttribute('src', 'https://sleepercdn.com/images/team_logos/nfl/buf.png');
    expect(watermark).toHaveAttribute('alt', '');
  });

  it('omits the team-logo watermark when the player has no team', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={{ ...player, team: null }}
        rank={2}
        onViewDetails={vi.fn()}
      />,
    );
    expect(container.querySelector('.player-card-watermark')).toBeNull();
  });

  it('omits the team-logo watermark when player meta is missing', () => {
    const { container } = render(
      <PlayerCard playerId="unknown-id" recommendation={null} player={undefined} rank={5} onViewDetails={vi.fn()} />,
    );
    expect(container.querySelector('.player-card-watermark')).toBeNull();
  });

  it('uses the Sleeper headshot as a small identity portrait and falls back to initials on load failure', () => {
    const { container } = render(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />,
    );
    const portrait = container.querySelector('.player-card-portrait');
    expect(portrait).toHaveAttribute('src', 'https://sleepercdn.com/content/nfl/players/rb2.jpg');
    fireEvent.error(portrait!);
    expect(portrait!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });
});

describe('PlayerCard with recommendation: null (market-only row)', () => {
  it('renders a null-safe data state instead of score/action/meter, with no "No projection" text', () => {
    render(<PlayerCard playerId="rb2" recommendation={null} player={player} rank={4} onViewDetails={vi.fn()} />);
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.getAllByText('\u2014')).toHaveLength(3);
    expect(screen.queryByText(/No projection/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Value:/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Take now')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('shows the projected points fallback for a market-only row with a known projection', () => {
    render(
      <PlayerCard playerId="rb2" recommendation={null} player={player} rank={4} adp={45.2} projectedPoints={88.5} onViewDetails={vi.fn()} />,
    );
    expect(screen.getByText('88.5')).toBeInTheDocument();
    expect(screen.queryByText(/No projection/)).not.toBeInTheDocument();
  });

  it('renders the next-pick availability meter from the fallback prop when recommendation is null', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={null}
        player={player}
        rank={4}
        adp={45.2}
        availableNextPickProbability={0.42}
        onViewDetails={vi.fn()}
      />,
    );
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '42');
  });

  it('still opens details when a market-only card is clicked', async () => {
    const onViewDetails = vi.fn();
    const user = userEvent.setup();
    render(<PlayerCard playerId="rb2" recommendation={null} player={player} rank={4} onViewDetails={onViewDetails} />);
    await user.click(screen.getByText('Two'));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('falls back to the playerId when player is undefined', () => {
    render(<PlayerCard playerId="unknown-id" recommendation={null} player={undefined} rank={5} onViewDetails={vi.fn()} />);
    expect(screen.getByText('unknown-id')).toBeInTheDocument();
  });

  it('uses the market adp prop for ADP when there is no recommendation', () => {
    render(<PlayerCard playerId="rb2" recommendation={null} player={player} rank={4} adp={45.2} onViewDetails={vi.fn()} />);
    expect(screen.getByText('45.2')).toBeInTheDocument();
    const proj = screen.getByText('Proj').closest('div');
    expect(proj).toHaveTextContent('\u2014');
  });

  it("prefers the recommendation's own availabilityAdp over a stale market adp prop", () => {
    render(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} adp={999} onViewDetails={vi.fn()} />,
    );
    expect(screen.getByText('20.0')).toBeInTheDocument();
    expect(screen.queryByText('999.0')).not.toBeInTheDocument();
  });

  it('omits stars when fantasyPros is absent', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} rank={2} onViewDetails={vi.fn()} />);
    expect(screen.queryByRole('img', { name: /Upside:/ })).not.toBeInTheDocument();
  });

  it('renders stars only as display decoration, including a hollow unpublished field', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        rank={2}
        fantasyPros={{ rank: 2, tier: 1, upside: 3, bust: null, sos: 0, ecrVsAdp: null, positionRank: 'RB2' }}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByRole('img', { name: 'Upside: 3 out of 5' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bust: not published' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'SOS: 0 out of 5' })).toBeInTheDocument();
  });
});
