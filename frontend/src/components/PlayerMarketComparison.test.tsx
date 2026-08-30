import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlayerMeta, ProviderProjectionsArtifact } from '../../../shared/types';
import type { BoardAdpAnchor } from './PlayerMarketComparison';
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

function boardAdp(overrides: Partial<BoardAdpAnchor> = {}): BoardAdpAnchor {
  return {
    adp: 24, source: 'Sleeper', brandKey: 'sleeper',
    ...overrides,
  };
}

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

  it('shows the engine ADP tile with its source and no spread caption', () => {
    render(
      <PlayerMarketComparison
        boardAdp={boardAdp({ adp: 24, source: 'Sleeper' })}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Market ADP' })).toBeInTheDocument();
    expect(screen.getByText('Sleeper')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    // The current-pick/range/stdev/sample caption is gone entirely.
    expect(screen.queryByText(/Current pick/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Range /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Std\. dev/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sample /)).not.toBeInTheDocument();
    // The five-stage steal/reach tag and "N picks early/past ADP" prose are gone.
    expect(screen.queryByText('Mad steal')).not.toBeInTheDocument();
    expect(screen.queryByText('Steal')).not.toBeInTheDocument();
    expect(screen.queryByText('Reach')).not.toBeInTheDocument();
    expect(screen.queryByText(/picks early/)).not.toBeInTheDocument();
    expect(screen.queryByText(/picks past ADP/)).not.toBeInTheDocument();
  });

  it('shows no positional rank, even when the board publishes spread fields', () => {
    render(
      <PlayerMarketComparison
        boardAdp={boardAdp({ adp: 12, source: 'FFC fallback' })}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getByText('FFC fallback')).toBeInTheDocument();
    expect(screen.queryByText('RB6')).not.toBeInTheDocument();
    expect(screen.queryByText(/Range/)).not.toBeInTheDocument();
  });

  it('shows an Underdog tile with the attribution in its accessible title when that board has the player', () => {
    render(
      <PlayerMarketComparison
        boardAdp={boardAdp({ adp: 24, source: 'Sleeper' })}
        underdogAdp={{ adp: 41.2 }}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getByText('Underdog')).toBeInTheDocument();
    expect(screen.getByText('41.2')).toBeInTheDocument();
    // The third-party attribution moved off the visible note into the tile's title.
    const tile = screen.getByText('Underdog').closest('.market-tile') as HTMLElement;
    expect(tile).toHaveAttribute('title');
    expect(tile.getAttribute('title')).toMatch(/Sharp Football Analysis/);
    expect(tile.getAttribute('title')).toMatch(/never blended into this board/);
    expect(screen.queryByText(/republished by Sharp Football Analysis/)).not.toBeInTheDocument();
  });

  it('omits the Underdog tile when that board has no row for this player', () => {
    render(
      <PlayerMarketComparison
        boardAdp={boardAdp()}
        underdogAdp={null}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.queryByText(/Underdog/)).not.toBeInTheDocument();
  });

  it('renders a tile per comparison ADP lane: the player\u2019s value, or an em dash when that board has no row', () => {
    const espnEntries = [
      { playerId: 'rb1', name: 'Rush One', position: 'RB', team: 'BUF', adp: 19.5, stdev: 4, high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'espn' as const, stdevSource: 'fitted' as const },
    ];
    const ffcEntries = [
      // A different player entirely — rb1 has no FFC row in this lane.
      { playerId: 'rb9', name: 'Rush Nine', position: 'RB', team: 'DAL', adp: 12.0, stdev: 3, high: null, low: null, timesDrafted: null, byeWeek: null, adpSource: 'ffc' as const, stdevSource: 'fitted' as const },
    ];
    render(
      <PlayerMarketComparison
        boardAdp={boardAdp({ adp: 24, source: 'Sleeper' })}
        providerAdpLanes={[
          { key: 'espn-ppr', label: 'ESPN (PPR)', brandKey: 'espn', entries: espnEntries },
          { key: 'ffc-ppr', label: 'FFC', brandKey: 'ffc', entries: ffcEntries },
        ]}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getByText('ESPN (PPR)')).toBeInTheDocument();
    expect(screen.getByText('19.5')).toBeInTheDocument();
    // Sparse coverage (FFC is ~267 rows vs Sleeper's ~1500) shows an honest em dash tile
    // instead of dropping the provider. ("FFC" also renders inside the badge monogram, so
    // match the tile-name span specifically.)
    const ffcName = screen.getAllByText('FFC').find((el) => el.classList.contains('market-tile-name'))!;
    expect(ffcName).toBeInTheDocument();
    const ffcTile = ffcName.closest('.market-tile') as HTMLElement;
    expect(ffcTile).toHaveAttribute('data-missing');
    expect(within(ffcTile).getByText('\u2014')).toBeInTheDocument();
  });

  it('lists the engine FFToday projection first, then each provider as a plain number, including CBS', () => {
    render(
      <PlayerMarketComparison
        projectionsArtifact={projectionsArtifact}
        player={player}
        scoring={scoring}
        fftoday={{ points: 190, source: 'FFToday' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Projections' })).toBeInTheDocument();
    const tiles = screen.getAllByText(/^(FFToday|Sleeper|ESPN|CBS)$/);
    expect(tiles[0]).toHaveTextContent('FFToday');
    expect(screen.getByText('190')).toBeInTheDocument();
    expect(screen.getByText('190').closest('.market-tile')).toHaveAttribute('data-role', 'engine');
    expect(screen.getByText('Sleeper')).toBeInTheDocument();
    expect(screen.getByText('186')).toBeInTheDocument();
    expect(screen.getAllByText('ESPN').length).toBeGreaterThan(0);
    expect(screen.getByText('202')).toBeInTheDocument();
    expect(screen.getAllByText('CBS').length).toBeGreaterThan(0);
    expect(screen.getByText('213')).toBeInTheDocument();
    // No dot-plot markers (buttons) and no hover detail pin.
    expect(screen.queryByRole('button', { name: /ESPN/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/pts$/)).not.toBeInTheDocument();
  });

  it('renders the FFToday tile even with no provider artifact loaded', () => {
    render(
      <PlayerMarketComparison
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={{ points: 190, source: 'FFToday' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Projections' })).toBeInTheDocument();
    expect(screen.getByText('FFToday')).toBeInTheDocument();
    expect(screen.getByText('190')).toBeInTheDocument();
  });

  it('omits the FFToday tile when the engine has no projection for this player', () => {
    render(
      <PlayerMarketComparison
        projectionsArtifact={projectionsArtifact}
        player={player}
        scoring={scoring}
        fftoday={{ points: null, source: 'FFToday' }}
      />,
    );
    expect(screen.queryByText('FFToday')).not.toBeInTheDocument();
  });

  it('does not duplicate the engine ADP tile as a provider tile when boardAdp is set', () => {
    render(
      <PlayerMarketComparison
        boardAdp={boardAdp({ adp: 24, source: 'Sleeper' })}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getAllByText('Sleeper')).toHaveLength(1);
    expect(screen.getAllByText('24')).toHaveLength(1);
  });

  it('drops the comparison lane whose brand IS the active board and keeps the others', () => {
    // ESPN-session bug (2026-08-28): the board was ESPN AND an espn-ppr lane rendered — ESPN
    // twice, Sleeper nowhere. The lane matching the board's brand is dropped; Sleeper stays.
    render(
      <PlayerMarketComparison
        boardAdp={boardAdp({ adp: 18, source: 'ESPN (PPR)', brandKey: 'espn' })}
        providerAdpLanes={[
          { key: 'sleeper-ppr', label: 'Sleeper', brandKey: 'sleeper', entries: [{ playerId: 'rb1', name: 'Rush One', position: 'RB', team: 'BUF', adp: 24, stdev: 1, high: 1, low: 1, timesDrafted: 10, byeWeek: 7, adpSource: 'sleeper', stdevSource: 'observed' }] },
          { key: 'espn-ppr', label: 'ESPN (PPR)', brandKey: 'espn', entries: [] },
        ]}
        projectionsArtifact={null}
        player={player}
        scoring={scoring}
        fftoday={null}
      />,
    );
    expect(screen.getAllByText('ESPN (PPR)')).toHaveLength(1); // engine tile only
    expect(screen.getByText('Sleeper')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
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
