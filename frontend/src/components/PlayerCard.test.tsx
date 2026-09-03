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

// Card-bottom slot stats (cardRoleStats.ts shape) — four entries so every slot-rule count
// (2 or 4) is observable. One carries a percentile (bar renders a fill/badge) and three don't
// (bar renders the hatched empty rail) so both PercentileBar states are covered.
const roleStats = [
  { label: 'Fantasy Pts/g', display: '15.4', percentile: 62, title: 't1' },
  { label: 'Touches/g', display: '10.4', percentile: null, title: 't2' },
  { label: 'YPC', display: '6.3', percentile: null, title: 't3' },
  { label: 'Snap %', display: '78%', percentile: null, title: 't4' },
];


describe('PlayerCard with a recommendation', () => {
  it('renders identity and omits the board-rank badge, take-now copy, and utility prose', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />);
    // The mode-dependent `#N` board rank is gone: the same player shows different numbers per
    // tab/mode (and gapped numbers after the All-view filters), so ordering is carried by card
    // position alone. The stable positional ADP chip is the only rank-like face element.
    expect(screen.queryByText('#2')).not.toBeInTheDocument();
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
    expect(screen.getByText('Rush')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.queryByText('Take now')).not.toBeInTheDocument();
    expect(screen.queryByText('Adds 22.0 total roster utility.')).not.toBeInTheDocument();
  });

  it('renders Projection and ADP on the face from the recommendation', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />);
    expect(screen.getByText('Proj')).toBeInTheDocument();
    expect(screen.getByText('100.0')).toBeInTheDocument();
    expect(screen.getByText('ADP')).toBeInTheDocument();
    expect(screen.getByText('20.0')).toBeInTheDocument();
  });

  it('carries the player\'s own board source in the ADP tooltip, with no visible badge on the face', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        adpSource="espn"
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('20.0')).toBeInTheDocument();
    // The provider tag next to ADP was removed from the card face (2026-08-25 user call) — the
    // provenance still lives in the tooltip, just not as a visible chip cluttering the face.
    expect(screen.queryByText('ESPN')).not.toBeInTheDocument();
    expect(screen.getByTitle(/Average Draft Position \(ESPN\)/)).toBeInTheDocument();
  });

  it('falls back to a generic ADP tooltip when provenance is unknown', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />);
    expect(screen.queryByText('ESPN')).not.toBeInTheDocument();
    expect(screen.queryByText('Sleeper')).not.toBeInTheDocument();
    expect(screen.getByTitle('Average Draft Position — the pick where this player is typically taken. Lower is earlier.')).toBeInTheDocument();
  });

  it('falls back to the ADP positional rank', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        adpBoard={[adpEntry('rb1', 10), adpEntry('rb2', 20)]}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('RB2')).toBeInTheDocument();
  });

  it('shows an injury badge when the player has a status', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={{ ...player, injuryStatus: 'Questionable' }}
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
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} usage={usage} onViewDetails={vi.fn()} />,
    );
    expect(screen.getByText('Carry')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    rerender(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />,
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
      <PlayerCard playerId="qb1" recommendation={baseRecommendation({ playerId: 'qb1' })} player={qb} usage={usage} onViewDetails={vi.fn()} />
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
      <PlayerCard playerId="wr1" recommendation={baseRecommendation({ playerId: 'wr1' })} player={wr} usage={usage} onViewDetails={vi.fn()} />,
    );
    expect(screen.getByText('Tgt')).toBeInTheDocument();
    expect(screen.getByText('18%')).toBeInTheDocument();
    expect(screen.queryByText('Carry')).not.toBeInTheDocument();
  });


  it('renders the Role tile from depthRole with the headline in the title', () => {
    const depthRole: TeamDepthRole = {
      playerId: 'rb2', label: 'RB1', headline: 'RB1 \u00b7 BUF RB',
      provenance: 'Slot from 2025 BUF carry share; Sleeper lists him RB1.',
      slot: 1, basis: 'volume', shape: 'clear', room: null,
    };
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        depthRole={depthRole}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('RB1')).toBeInTheDocument();
    expect(screen.getByText('RB1').closest('[data-role-basis]')).toHaveAttribute('data-role-basis', 'volume');
    expect(screen.getByTitle('RB1 \u00b7 BUF RB')).toBeInTheDocument();
  });

  it('renders an em dash with data-role-basis unknown when depthRole is absent (never a guess)', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />);
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
      <PlayerCard playerId="d1" recommendation={baseRecommendation({ playerId: 'd1' })} player={dst} onViewDetails={vi.fn()} />,
    );
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
    expect(screen.getByText('Avg fpts')).toBeInTheDocument();
    expect(screen.getByText('\u2014')).toBeInTheDocument();
  });


  it('opens details from a click anywhere on the card face', async () => {
    const onViewDetails = vi.fn();
    const user = userEvent.setup();
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={onViewDetails} />);
    await user.click(screen.getByText('Two'));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('paints a contained team-logo watermark from the Sleeper CDN', () => {
    const { container } = render(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />,
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
        onViewDetails={vi.fn()}
      />,
    );
    expect(container.querySelector('.player-card-watermark')).toBeNull();
  });

  it('omits the team-logo watermark when player meta is missing', () => {
    const { container } = render(
      <PlayerCard playerId="unknown-id" recommendation={null} player={undefined} onViewDetails={vi.fn()} />,
    );
    expect(container.querySelector('.player-card-watermark')).toBeNull();
  });

  it('uses the Sleeper headshot as a small identity portrait and falls back to initials on load failure', () => {
    const { container } = render(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />,
    );
    const portrait = container.querySelector('.player-card-portrait');
    expect(portrait).toHaveAttribute('src', 'https://sleepercdn.com/content/nfl/players/rb2.jpg');
    fireEvent.error(portrait!);
    expect(portrait!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });
});

describe('PlayerCard with recommendation: null (market-only row)', () => {
  it('renders a null-safe data state instead of score/action/meter, with no "No projection" text', () => {
    render(<PlayerCard playerId="rb2" recommendation={null} player={player} onViewDetails={vi.fn()} />);
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.getAllByText('\u2014')).toHaveLength(3);
    expect(screen.queryByText(/No projection/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Value:/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Take now')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('shows the projected points fallback for a market-only row with a known projection', () => {
    render(
      <PlayerCard playerId="rb2" recommendation={null} player={player} adp={45.2} projectedPoints={88.5} onViewDetails={vi.fn()} />,
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
    render(<PlayerCard playerId="rb2" recommendation={null} player={player} onViewDetails={onViewDetails} />);
    await user.click(screen.getByText('Two'));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('falls back to the playerId when player is undefined', () => {
    render(<PlayerCard playerId="unknown-id" recommendation={null} player={undefined} onViewDetails={vi.fn()} />);
    expect(screen.getByText('unknown-id')).toBeInTheDocument();
  });

  it('uses the market adp prop for ADP when there is no recommendation', () => {
    render(<PlayerCard playerId="rb2" recommendation={null} player={player} adp={45.2} onViewDetails={vi.fn()} />);
    expect(screen.getByText('45.2')).toBeInTheDocument();
    const proj = screen.getByText('Proj').closest('div');
    expect(proj).toHaveTextContent('\u2014');
  });

  it("prefers the recommendation's own availabilityAdp over a stale market adp prop", () => {
    render(
      <PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} adp={999} onViewDetails={vi.fn()} />,
    );
    expect(screen.getByText('20.0')).toBeInTheDocument();
    expect(screen.queryByText('999.0')).not.toBeInTheDocument();
  });

  it('omits the next-up chip when there is no next player', () => {
    render(<PlayerCard playerId="rb2" recommendation={baseRecommendation()} player={player} onViewDetails={vi.fn()} />);
    expect(screen.queryByText('Next up at RB')).not.toBeInTheDocument();
  });

  it('renders the next-up chip with the position, next player name, and no numeric headline', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        nextUp={{ name: 'Kyren Williams', position: 'RB', gap: 10.6, tierBoundaryGap: 10.6, nearTie: false }}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('Next up at RB')).toBeInTheDocument();
    expect(screen.getByText('Kyren Williams')).toBeInTheDocument();
    expect(screen.getByText('big drop-off after him')).toBeInTheDocument();
    // The numeric gap is tooltip-only, never rendered as card text.
    expect(screen.queryByText(/10\.6/)).not.toBeInTheDocument();
    expect(screen.getByTitle(/projects 10\.6 points lower/)).toBeInTheDocument();
  });

  it('shows the near-tie qualifier instead of the drop-off when the engine flags a near tie', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        nextUp={{ name: 'De\u2019Von Achane', position: 'RB', gap: 0.4, tierBoundaryGap: 0, nearTie: true }}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('similar value')).toBeInTheDocument();
    expect(screen.queryByText(/drop-off/)).not.toBeInTheDocument();
  });

  it('falls back to a plain "clear step down" qualifier when neither near-tie nor a tier cliff applies', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        nextUp={{ name: 'Zach Charbonnet', position: 'RB', gap: 3.2, tierBoundaryGap: 0, nearTie: false }}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('clear step down')).toBeInTheDocument();
  });

  it('omits the qualifier entirely when the gap is unknown', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        nextUp={{ name: 'Zach Charbonnet', position: 'RB', gap: null, tierBoundaryGap: 0, nearTie: false }}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByText('Zach Charbonnet')).toBeInTheDocument();
    expect(screen.queryByText('clear step down')).not.toBeInTheDocument();
    expect(screen.queryByText('similar value')).not.toBeInTheDocument();
    expect(screen.queryByText(/drop-off/)).not.toBeInTheDocument();
  });

  it('closes the card with the next-up chip: the survival-meter slot renders before it', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        nextUp={{ name: 'Kyren Williams', position: 'RB', gap: 10.6, tierBoundaryGap: 10.6, nearTie: false }}
        onViewDetails={vi.fn()}
      />,
    );
    const slot = container.querySelector('.survival-meter')!;
    const chip = container.querySelector('.next-up-chip')!;
    // From the chip's perspective PRECEDING means the slot node comes first in document order.
    expect(chip.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('orders the role-stat slot above the next-up chip when there is no availability estimate', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation({ availableNextPickProbability: null })}
        player={player}
        nextUp={{ name: 'Kyren Williams', position: 'RB', gap: 10.6, tierBoundaryGap: 10.6, nearTie: false }}
        roleStats={roleStats}
        onViewDetails={vi.fn()}
      />,
    );
    const stats = container.querySelector('.player-card-role-stats')!;
    const chip = container.querySelector('.next-up-chip')!;
    expect(chip.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});

describe('PlayerCard card-bottom slot (survival meter vs. role stats)', () => {
  it('shows the survival meter when next-pick availability is known', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        roleStats={roleStats}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.getByRole('meter')).toBeInTheDocument();
  });

  it('off the clock with a next-up player: exactly 2 role stats, chip still last', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation({ availableNextPickProbability: null })}
        player={player}
        nextUp={{ name: 'Kyren Williams', position: 'RB', gap: 10.6, tierBoundaryGap: 10.6, nearTie: false }}
        roleStats={roleStats}
        onViewDetails={vi.fn()}
      />,
    );
    expect(container.querySelector('.survival-meter')).toBeNull();
    expect(container.querySelectorAll('.player-card-role-stat')).toHaveLength(2);
    expect(container.querySelector('.next-up-chip')).not.toBeNull();
  });

  it('off the clock with no next-up player: 4 role stats with their provenance tooltips', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation({ availableNextPickProbability: null })}
        player={player}
        roleStats={roleStats}
        onViewDetails={vi.fn()}
      />,
    );
    expect(container.querySelector('.survival-meter')).toBeNull();
    expect(container.querySelectorAll('.player-card-role-stat')).toHaveLength(4);
    expect(container.querySelector('.player-card-role-stats')).toHaveAttribute('data-count', '4');
    expect(screen.getByText('Fantasy Pts/g')).toBeInTheDocument();
    expect(screen.getByTitle('t1')).toBeInTheDocument();
    // The stat with a percentile renders a filled bar + badge; the rest render the
    // hatched empty-rail state (data-missing on the row, no fill/badge).
    const rows = container.querySelectorAll('.player-card-role-stat');
    expect(rows[0]!.querySelector('.percentile-fill')).not.toBeNull();
    expect(rows[0]!.querySelector('.percentile-badge')!.textContent).toBe('62');
    expect(rows[0]!).not.toHaveAttribute('data-missing');
    expect(rows[1]!).toHaveAttribute('data-missing');
    expect(rows[1]!.querySelector('.percentile-fill')).toBeNull();
  });

  it('on the clock with no next-up player: the meter, then 2 role stats below it', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        roleStats={roleStats}
        onViewDetails={vi.fn()}
      />,
    );
    const meter = container.querySelector('.survival-meter')!;
    const stats = container.querySelector('.player-card-role-stats')!;
    expect(meter).not.toBeNull();
    expect(stats).toHaveAttribute('data-count', '2');
    expect(container.querySelectorAll('.player-card-role-stat')).toHaveLength(2);
    // The stats row renders AFTER the meter (below the next-up percentage).
    expect(stats.compareDocumentPosition(meter) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('on the clock with a next-up player: meter only — no role stats, no room', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        nextUp={{ name: 'Kyren Williams', position: 'RB', gap: 10.6, tierBoundaryGap: 10.6, nearTie: false }}
        roleStats={roleStats}
        onViewDetails={vi.fn()}
      />,
    );
    expect(container.querySelector('.survival-meter')).not.toBeNull();
    expect(container.querySelector('.player-card-role-stats')).toBeNull();
    expect(container.querySelector('.next-up-chip')).not.toBeNull();
  });

  it('renders the QB cohort-percentile badge on a role stat that carries one', () => {
    const { container } = render(
      <PlayerCard
        playerId="qb1"
        recommendation={baseRecommendation({ playerId: 'qb1' })}
        player={{ ...player, playerId: 'qb1', position: 'QB', eligiblePositions: ['QB'] }}
        roleStats={[{ label: 'Pass Yd/g', display: '258.47', percentile: 96, title: 'q' }]}
        onViewDetails={vi.fn()}
      />,
    );
    expect(container.querySelector('.percentile-badge')).toHaveAttribute('data-band');
    expect(container.querySelector('.percentile-badge')!.textContent).toBe('96');
  });

  it('leaves the slot blank rather than fabricating stats when none resolve', () => {
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation({ availableNextPickProbability: null })}
        player={player}
        onViewDetails={vi.fn()}
      />,
    );
    expect(container.querySelector('.player-card-role-stats')).toBeNull();
    expect(container.querySelector('.survival-meter')).toBeNull();
  });

  it('never fabricates a 0.0 PPR/g for K/DEF — their slot stats come from the weekly game log or nothing', () => {
    const kicker: PlayerMeta = { ...player, position: 'K', eligiblePositions: ['K'] };
    const kUsage: PlayerUsage = {
      season: 2025, usageSeasonObserved: true, snapPct: null, targetShare: null, carryShare: null,
      gamesWithAnySnap: 17, recentTeam: 'KC', teamChanged: false, knownAbsent: false,
      availabilityRate: 1, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
      production: {
        games: 17, pointsPpr: 0, pointsPprPerGame: 0, receptions: 0, receivingYards: 0,
        receivingTds: 0, rushingYards: 0, rushingTds: 0,
      },
    };
    const { container } = render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation({ availableNextPickProbability: null })}
        player={kicker}
        usage={kUsage}
        avgPointsPerGame={8.44}
        onViewDetails={vi.fn()}
      />,
    );
    // No roleStats passed (the board computes them from the weekly artifact; none here) — the
    // slot stays blank, and the retired profile line's fabricated-0.0 hazard stays dead.
    expect(container.querySelector('.player-card-role-stats')).toBeNull();
    expect(screen.queryByText(/PPR\/g/)).not.toBeInTheDocument();
  });
});

describe('PlayerCard reach bookmark', () => {
  it('shows only "Reach" on the face, reveals the pick-gap detail via an interactive bubble, and never opens details on its own', async () => {
    const onViewDetails = vi.fn();
    const user = userEvent.setup();
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation({ availabilityAdp: 95 })}
        player={player}
        currentPick={71}
        onViewDetails={onViewDetails}
      />,
    );

    // No bare number on the face (2026-08-28 redesign, take 2).
    const trigger = screen.getByRole('button', { name: 'Reach' });
    expect(trigger).toHaveTextContent('Reach');
    expect(screen.queryByText('+24')).not.toBeInTheDocument();
    expect(screen.queryByText('24')).not.toBeInTheDocument();

    // The detail lives in an aria-describedby-linked tooltip, not lost. The card also renders the
    // (unrelated) next-pick survival meter's own InfoTooltip bubble, so disambiguate by the
    // trigger's own aria-describedby id rather than assuming there's only one role="tooltip".
    const bubbleId = trigger.getAttribute('aria-describedby');
    expect(bubbleId).not.toBeNull();
    const bubble = document.getElementById(bubbleId!);
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveAttribute('role', 'tooltip');
    expect(bubble).toHaveTextContent('24 picks later');
    expect(bubble).toHaveTextContent('ADP 95.0');

    // Activating the bookmark itself must not also open the card's own detail view.
    await user.click(trigger);
    expect(onViewDetails).not.toHaveBeenCalled();

    // But the rest of the card still does (stopPropagation is scoped to the trigger).
    await user.click(screen.getByText('Two'));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('omits the bookmark entirely below the reach threshold', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation({ availabilityAdp: 80 })}
        player={player}
        currentPick={71}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reach' })).not.toBeInTheDocument();
    expect(document.querySelector('.player-card-reach')).toBeNull();
  });
});

describe('PlayerCard with onDraftPlayer (2026-09-01 click-to-log)', () => {
  it('renders the "Draft" affordance when the handler is provided', () => {
    const onDraftPlayer = vi.fn();
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        onViewDetails={vi.fn()}
        onDraftPlayer={onDraftPlayer}
      />,
    );
    expect(screen.getByRole('button', { name: 'Draft Rush Two' })).toBeInTheDocument();
  });

  it('omits the "Draft" affordance when no handler is passed (live sessions, landing demo)', () => {
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        onViewDetails={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Draft / })).not.toBeInTheDocument();
  });

  it('clicking "Draft" calls the handler and does NOT also open the drawer', async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    const onDraftPlayer = vi.fn();
    render(
      <PlayerCard
        playerId="rb2"
        recommendation={baseRecommendation()}
        player={player}
        onViewDetails={onViewDetails}
        onDraftPlayer={onDraftPlayer}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Draft Rush Two' }));
    expect(onDraftPlayer).toHaveBeenCalledTimes(1);
    expect(onViewDetails).not.toHaveBeenCalled();
  });
});
