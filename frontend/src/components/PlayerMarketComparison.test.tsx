import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerMeta, ProviderProjectionsArtifact } from '../../../shared/types';
import { PlayerMarketComparison } from './PlayerMarketComparison';

const player: PlayerMeta = {
  playerId: 'rb1', name: 'Rush One', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: 7, age: 24, yearsExp: 3, injuryStatus: null, ids: {},
};

const projectionsArtifact: ProviderProjectionsArtifact = {
  schemaVersion: 1,
  generatedAt: '2026-08-13T00:00:00Z',
  season: 2026,
  displayOnly: true,
  providers: [
    { key: 'sleeper', label: 'Sleeper (Rotowire)', attribution: 'x', status: 'ok', fetchedAt: 'x', upstreamUpdatedAt: null, rows: 2, positionRows: { RB: 2 }, positionsExcluded: [], staleSinceDays: 0, diagnostic: null },
    { key: 'espn', label: 'ESPN', attribution: 'x', status: 'ok', fetchedAt: 'x', upstreamUpdatedAt: null, rows: 2, positionRows: { RB: 2 }, positionsExcluded: [], staleSinceDays: 0, diagnostic: null },
    { key: 'cbs', label: 'CBS', attribution: 'x', status: 'ok', fetchedAt: 'x', upstreamUpdatedAt: null, rows: 2, positionRows: { RB: 2 }, positionsExcluded: [], staleSinceDays: 0, diagnostic: null },
  ],
  players: {
    rb1: {
      sleeper: { rush_yd: 1200, rush_td: 11 },
      espn: { rush_yd: 1300, rush_td: 12 },
      cbs: { rush_yd: 1350, rush_td: 13 },
    },
  },
};

const scoring = { rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1 };

describe('PlayerMarketComparison', () => {
  it('renders nothing at all when both artifacts are unavailable', () => {
    const { container } = render(
      <PlayerMarketComparison
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(container.querySelector('.market-comparison')).toBeNull();
  });

  it('renders nothing when the artifacts have no row for this player', () => {
    const { container } = render(
      <PlayerMarketComparison
        projectionsArtifact={projectionsArtifact}
        player={{ ...player, playerId: 'nope' }}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(container.querySelector('.market-comparison')).toBeNull();
  });

  it('shows the engine ADP and current pick as plain numbers, with no steal/reach badge', () => {
    render(
      <PlayerMarketComparison
        boardAdp={{ adp: 24, source: 'Sleeper' }}
        currentPick={18}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Market ADP' })).toBeInTheDocument();
    expect(screen.getByText(/Engine ADP 24 · Sleeper · current pick 18/)).toBeInTheDocument();
    // The five-stage tag ("Mad steal" / "Steal" / "Fair" / "Reach" / "Mad reach")
    // and the "N picks early/past ADP" prose are gone — just the numbers.
    expect(screen.queryByText('Mad steal')).not.toBeInTheDocument();
    expect(screen.queryByText('Steal')).not.toBeInTheDocument();
    expect(screen.queryByText('Reach')).not.toBeInTheDocument();
    expect(screen.queryByText(/picks early/)).not.toBeInTheDocument();
    expect(screen.queryByText(/picks past ADP/)).not.toBeInTheDocument();
  });

  it('lists each provider projection as a plain number (no dot plot), including CBS', () => {
    render(
      <PlayerMarketComparison
        projectionsArtifact={projectionsArtifact}
        player={player}
        scoring={scoring}
        fftoday={{ points: 190, source: 'FFToday' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Projections' })).toBeInTheDocument();
    expect(screen.getByText('Sleeper')).toBeInTheDocument();
    expect(screen.getByText('186')).toBeInTheDocument();
    expect(screen.getAllByText('ESPN').length).toBeGreaterThan(0);
    expect(screen.getByText('202')).toBeInTheDocument();
    expect(screen.getAllByText('CBS').length).toBeGreaterThan(0);
    expect(screen.getByText('213')).toBeInTheDocument();
    expect(screen.queryByText('FFToday')).not.toBeInTheDocument();
    expect(screen.queryByText('190')).not.toBeInTheDocument();
    // No dot-plot markers (buttons) and no hover detail pin.
    expect(screen.queryByRole('button', { name: /ESPN/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/pts$/)).not.toBeInTheDocument();
  });

  it('does not duplicate engine ADP as a provider tile when boardAdp is set', () => {
    render(
      <PlayerMarketComparison
        boardAdp={{ adp: 24, source: 'Sleeper' }}
        currentPick={18}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getByText(/Engine ADP 24 · Sleeper · current pick 18/)).toBeInTheDocument();
    expect(screen.queryByText(/Engine · Sleeper/)).not.toBeInTheDocument();
  });

  it('marks stale providers inline and skips error providers', () => {
    const withStale: ProviderProjectionsArtifact = {
      ...projectionsArtifact,
      providers: [
        { ...projectionsArtifact.providers[0]!, status: 'stale', staleSinceDays: 4, diagnostic: 'boom' },
        { ...projectionsArtifact.providers[1]!, status: 'error', rows: 0, diagnostic: 'down' },
        projectionsArtifact.providers[2]!,
      ],
    };
    render(
      <PlayerMarketComparison
        projectionsArtifact={withStale}
        player={player}
        scoring={scoring}
        fftoday={{ points: 190, source: 'FFToday' }}
      />,
    );
    const staleTile = screen.getByText('Sleeper').closest('.market-tile')!;
    expect(staleTile.querySelector('.provider-note')?.textContent).toBe('stale');
    expect(screen.queryByText('ESPN')).not.toBeInTheDocument();
  });

  it('notes when league scoring is unavailable instead of showing fabricated points', () => {
    render(
      <PlayerMarketComparison
        projectionsArtifact={projectionsArtifact}
        player={player}
        scoring={{}}
        fftoday={{ points: null, source: 'FFToday' }}
      />,
    );
    expect(screen.getByText(/league's scoring settings aren't available/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Projections' })).not.toBeInTheDocument();
  });
});
