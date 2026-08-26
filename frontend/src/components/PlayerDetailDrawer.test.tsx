import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerMeta, PlayerWeeklyStatsArtifact } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import type { Recommendation } from '../engine/recommend';
import { PlayerDetailDrawer } from './PlayerDetailDrawer';

const player: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

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

function baseAdpEntry(): AdpEntry {
  return {
    playerId: 'rb1', name: 'Rush One', position: 'RB', team: 'BUF', adp: 73,
    stdev: 8, high: null, low: null, timesDrafted: null, byeWeek: 7,
    adpSource: 'sleeper', stdevSource: 'fitted',
  };
}

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'l1', name: 'Fixture', season: '2026', teams: 12,
  startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  scoring: { rush_yd: 0.1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open && (
        <PlayerDetailDrawer player={player} usage={undefined} feedStatus="ready" onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

describe('PlayerDetailDrawer accessibility', () => {
  it('moves focus into the dialog on open and restores it to the invoking control on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const openButton = screen.getByRole('button', { name: 'Open' });
    openButton.focus();

    await user.click(openButton);
    expect(screen.getByRole('dialog', { name: 'Rush One' })).toBeInTheDocument();
    expect(document.activeElement).not.toBe(openButton);
    expect(document.activeElement?.closest('[role="dialog"]')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(openButton);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PlayerDetailDrawer player={player} usage={undefined} feedStatus="ready" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked, not the panel', () => {
    const onClose = vi.fn();
    render(
      <PlayerDetailDrawer player={player} usage={undefined} feedStatus="ready" onClose={onClose} />,
    );
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    // The Drawer portals its backdrop to document.body, so it is not in the render container.
    fireEvent.mouseDown(document.body.querySelector('.drawer-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerDetailDrawer content', () => {
  it('renders the overview hero with market comparison following it', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        adpDisclosure={{ source: 'sleeper', format: 'ppr' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // Portaled to document.body by Drawer — queried there, not from the render container.
    const hero = document.body.querySelector('.player-detail-hero')!;
    expect(hero.querySelector('.player-portrait')).toBeNull();
    expect(screen.queryByText('Full context')).not.toBeInTheDocument();
    const market = document.body.querySelector('.market-comparison')!;
    expect(hero.compareDocumentPosition(market) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByText('Engine explanation')).not.toBeInTheDocument();
  });

  it('switches to Role / Weekly / Injury panels and hides Overview content', async () => {
    const user = userEvent.setup();
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Rush One' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Role' }));
    expect(screen.queryByRole('heading', { name: 'Rush One' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Role' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Weekly' }));
    expect(screen.getByText('Weekly stats')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Role' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Injury' }));
    expect(screen.getByText('Injury history')).toBeInTheDocument();
    expect(screen.queryByText('Weekly stats')).not.toBeInTheDocument();
  });

  it('hides the Injury tab for Defense players', () => {
    const defense: PlayerMeta = { ...player, playerId: 'BUF', name: 'Buffalo Defense', position: 'DEF', eligiblePositions: ['DEF'] };
    render(<PlayerDetailDrawer player={defense} usage={undefined} feedStatus="ready" onClose={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByRole('tab', { name: 'Injury' })).not.toBeInTheDocument();
  });
  it('resets to Overview when the player identity changes', async () => {
    const user = userEvent.setup();
    const other: PlayerMeta = { ...player, playerId: 'rb2', name: 'Rush Two' };
    const { rerender } = render(
      <PlayerDetailDrawer player={player} usage={undefined} feedStatus="ready" onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('tab', { name: 'Role' }));
    expect(screen.getByRole('tab', { name: 'Role' })).toHaveAttribute('aria-selected', 'true');

    rerender(<PlayerDetailDrawer player={other} usage={undefined} feedStatus="ready" onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Rush Two' })).toBeInTheDocument();
  });

  it('omits the Draft Score section when no recommendation is supplied', () => {
    render(<PlayerDetailDrawer player={player} usage={undefined} feedStatus="ready" onClose={vi.fn()} />);
    expect(screen.queryByText('Draft Score')).not.toBeInTheDocument();
  });


  it('renders the TeamDepthRoleRow from depthRole as the hero right column', () => {
    const depthRole: TeamDepthRole = {
      playerId: 'rb1', label: 'RB1', headline: 'RB1 · BUF RB',
      provenance: "Slot from Sleeper's depth chart only — no measured 2025 NFL volume.",
      slot: 1, basis: 'depth-chart', shape: 'unassessable',
      room: {
        team: 'BUF', position: 'RB', shape: 'unassessable',
        members: [
          { playerId: 'rb1', name: 'Rush One', slot: 1, share: null, secondary: null, measuredTeam: null, depthChartOrder: 1, depthChartPosition: null, basis: 'depth-chart' },
        ],
        topGap: null, crossTeamTop: false, contested: false, nearTie: false, season: 2025,
      },
    };
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        depthRole={depthRole}
        onClose={vi.fn()}
      />,
    );
    // Portaled to document.body by Drawer — queried there, not from the render container.
    const hero = document.body.querySelector('.player-detail-hero')!;
    const depth = document.body.querySelector('.team-depth-role-row')!;
    expect(hero.contains(depth)).toBe(true);
    expect(depth.parentElement).toBe(hero);
    expect(screen.getByText('Depth chart')).toBeInTheDocument();
    expect(screen.queryByText(/no measured 2025 NFL volume/)).not.toBeInTheDocument();
    expect(screen.getByText('Rush One', { selector: 'td' })).toBeInTheDocument();
  });

  it('renders a single compact status tag next to team and slot without mojibake', () => {
    render(
      <PlayerDetailDrawer
        player={{
          ...player,
          team: 'DEN',
          injuryStatus: 'Questionable',
          yearsExp: 0,
          depthChartPosition: 'LWR',
          depthChartOrder: 2,
        }}
        usage={{
          season: 2025, usageSeasonObserved: true, snapPct: 0.4, targetShare: 0.2, carryShare: null,
          gamesWithAnySnap: 10, recentTeam: 'KC', teamChanged: true, knownAbsent: false,
          availabilityRate: 0.7, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
        }}
        feedStatus="ready"
        onClose={vi.fn()}
      />,
    );
    const meta = document.body.querySelector('.player-context-meta')!;
    expect(meta.textContent).toContain('DEN');
    expect(meta.textContent).toContain('LWR');
    expect(meta.textContent).toContain('#2');
    expect(meta.textContent).not.toContain('\u00c2');
    expect(within(meta as HTMLElement).getByText('Q')).toBeInTheDocument();
    expect(within(meta as HTMLElement).queryByText('Rookie')).not.toBeInTheDocument();
    expect(within(meta as HTMLElement).queryByText('New team')).not.toBeInTheDocument();
  });


  it('shows age/exp/bye on Overview', () => {
    render(<PlayerDetailDrawer player={player} usage={undefined} feedStatus="ready" onClose={vi.fn()} />);
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('3 yrs')).toBeInTheDocument();
  });

  it('renders height, weight, college, and NFL draft on Overview when present', () => {
    render(
      <PlayerDetailDrawer
        player={{
          ...player,
          heightInches: 77,
          weightLbs: 237,
          college: 'Wyoming',
          jerseyNumber: 17,
          draftYear: 2018,
          draftRound: 1,
          draftPick: 7,
        }}
        usage={undefined}
        feedStatus="ready"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('6\'5"')).toBeInTheDocument();
    expect(screen.getByText('237 lbs')).toBeInTheDocument();
    expect(screen.getByText('Wyoming')).toBeInTheDocument();
    // The hero uses the compact draft-pick chip.
    expect(screen.getByText('1.07 (2018)')).toBeInTheDocument();
  });

  it('reflects weekly stats load state in the chart placeholder', () => {
    const readyArtifact: PlayerWeeklyStatsArtifact = {
      schemaVersion: 1, season: 2025, weeksFetched: [1],
      columns: {
        RB: ['pts', 'opp', 'snp', 'fin', 'rush_att', 'rush_yd', 'rush_ypa', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'fum_lost'],
      },
      players: { rb1: { p: 'RB', bye: 7, w: [[1, 12.3, 'KC', 55, 5, 12, 60, 5.0, 0, 2, 1, 8, 0, 0]] } },
      heat: {},
    };

    const { rerender } = render(
      <PlayerDetailDrawer player={player} usage={undefined} feedStatus="ready" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    expect(screen.getByText('Weekly stats')).toBeInTheDocument();

    rerender(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        weeklyStats={{ artifact: null, status: 'loading' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading weekly stats\u2026')).toBeInTheDocument();

    rerender(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        weeklyStats={{ artifact: readyArtifact, status: 'ready' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('2025 weekly FPTS')).toBeInTheDocument();
  });

  it('toggles the Weekly tab between graph and table', () => {
    const readyArtifact: PlayerWeeklyStatsArtifact = {
      schemaVersion: 1, season: 2025, weeksFetched: [1],
      columns: {
        RB: ['pts', 'opp', 'snp', 'fin', 'rush_att', 'rush_yd', 'rush_ypa', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'fum_lost'],
      },
      players: { rb1: { p: 'RB', bye: 7, w: [[1, 12.3, 'KC', 55, 5, 12, 60, 5.0, 0, 2, 1, 8, 0, 0]] } },
      heat: {},
    };

    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        weeklyStats={{ artifact: readyArtifact, status: 'ready' }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }));

    // Defaults to the graph view.
    expect(screen.getByRole('tab', { name: 'Graph' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows a coming-soon placeholder on the Injury tab', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={{
          season: 2025, usageSeasonObserved: true, snapPct: null, targetShare: null, carryShare: null,
          gamesWithAnySnap: 10, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
          availabilityRate: null, seasons: [], durabilityScore: null, opportunity: null,
          injuryHistory: [{ normalizedBodyPart: 'left knee', episodes: 2, recurring: true, reports: [] }],
        }}
        feedStatus="ready"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Injury' }));
    expect(screen.getByText('Injury history')).toBeInTheDocument();
    expect(screen.getByText('Coming soon.')).toBeInTheDocument();
  });

  it('labels the engine ADP with the player\'s own board source (native ESPN head)', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        adpDisclosure={{ source: 'espn', format: 'ppr' }}
        adpBoard={[{ ...baseAdpEntry(), adpSource: 'espn' }]}
        onClose={vi.fn()}
      />,
    );
    // The engine tile now also carries a ProviderBadge, and espn.svg renders its own "ESPN"
    // text node — so 'ESPN' matches twice; assert against the tile-name span specifically.
    expect(screen.getByText('ESPN', { selector: '.market-tile-name' })).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('labels a spliced Sleeper-tail player honestly instead of a board-wide ESPN', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation()}
        adpDisclosure={{ source: 'espn', format: 'ppr' }}
        adpBoard={[{ ...baseAdpEntry(), adpSource: 'sleeper', adp: 699.6 }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Sleeper (ESPN board tail)')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('keeps the engine ADP anchor visible in market mode from the board entry', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        adpBoard={[{ ...baseAdpEntry(), adp: 73, adpSource: 'sleeper' }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Sleeper')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();
  });

  it('shows no positional-rank/spread caption in the Market ADP section', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        adpBoard={[{ ...baseAdpEntry(), adp: 73, adpSource: 'sleeper' }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Std\. dev/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Range/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sample/)).not.toBeInTheDocument();
    expect(screen.queryByText('RB1')).not.toBeInTheDocument();
  });

  it('shows the Underdog tile (attribution in its title) when the Underdog board has this player', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        adpBoard={[{ ...baseAdpEntry(), adp: 73, adpSource: 'sleeper' }]}
        underdogAdp={[{ ...baseAdpEntry(), adpSource: 'underdog', adp: 41.2, stdev: 6 }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Underdog')).toBeInTheDocument();
    expect(screen.getByText('41.2')).toBeInTheDocument();
  });

  it('shows the FFToday tile from fallbackProjectedPoints when there is no recommendation (deep market-only row)', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        settings={settings}
        providerProjectionsArtifact={null}
        fallbackProjectedPoints={110.2}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Projections' })).toBeInTheDocument();
    expect(screen.getByText('FFToday')).toBeInTheDocument();
    expect(screen.getByText('110.2')).toBeInTheDocument();
  });

  it('prefers the recommendation\'s own projectedPoints over the fallback when both are present', () => {
    render(
      <PlayerDetailDrawer
        player={player}
        usage={undefined}
        feedStatus="ready"
        recommendation={baseRecommendation({ projectedPoints: 200 })}
        settings={settings}
        providerProjectionsArtifact={null}
        fallbackProjectedPoints={110.2}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.queryByText('110.2')).not.toBeInTheDocument();
  });
});
