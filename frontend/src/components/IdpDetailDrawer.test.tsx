import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IdpPlayer } from '../data/idpProjections';
import { IdpDetailDrawer } from './IdpDetailDrawer';

const mockPlayer: IdpPlayer = {
  id: 'idp-d-1',
  sleeperId: '6949',
  name: 'Jordyn Brooks',
  team: 'MIA',
  bye: 6,
  pos: 'LB',
  slot: 'D',
  rank: 1,
  projectedPoints: 144.5,
  fptsRaw: 151.5,
  tackles: 91,
  assists: 79,
  sacks: 3,
  pd: 4,
  int: 0,
  ff: 1,
  fr: 1,
  bio: {
    age: 28,
    height: "6'0\"",
    heightInches: 72,
    weight: 240,
    yearsExp: 6,
    college: 'Texas Tech',
    jerseyNumber: 20,
    draftPick: 'Rd 1 · Pk 27 (2020)',
    draftYear: 2020,
    draftRound: 1,
    status: 'Active',
  },
  role: {
    gamesPlayed: 17,
    gamesStarted: 17,
    snapPct: 93,
    snapsPerGame: 55.6,
    tacklesPerGame: 10.8,
    soloPerGame: 5.8,
    astPerGame: 4.9,
    sacksPerGame: 0.21,
    totalSacks: 3.5,
    tflPerGame: 0.8,
    qbHitsPerGame: 0.2,
    pdPerGame: 0.2,
    intPerGame: 0,
    totalInt: 0,
    forcedFumbles: 1,
    fumbleRecoveries: 1,
    fptsPerGame: 9.1,
    last5FptsPerGame: 7.8,
    formRating: 'Steady',
    ceiling: 16.5,
    floor: 4.0,
  },
  weekly: [
    {
      week: 1,
      kind: 'played',
      opponent: '@IND',
      pts: 9.5,
      defSnaps: 73,
      teamDefSnaps: 73,
      snapPct: 100,
      solo: 5,
      ast: 9,
      tkl: 14,
      sack: 0,
      tfl: 1,
      qbHit: 0,
      int: 0,
      pd: 0,
      ff: 0,
      fr: 0,
    },
    {
      week: 6,
      kind: 'bye',
      opponent: null,
      pts: null,
      solo: 0,
      ast: 0,
      tkl: 0,
      sack: 0,
      tfl: 0,
      qbHit: 0,
      int: 0,
      pd: 0,
      ff: 0,
      fr: 0,
    },
  ],
};

const mockRookie: IdpPlayer = {
  id: 'idp-d-99',
  sleeperId: '12999',
  name: 'Rookie Defender',
  team: 'DET',
  bye: 9,
  pos: 'DE',
  slot: 'D',
  rank: 50,
  projectedPoints: 75.0,
  fptsRaw: 75.0,
  tackles: 30,
  assists: 15,
  sacks: 5,
  pd: 2,
  int: 0,
  ff: 1,
  fr: 0,
  bio: {
    age: 21,
    yearsExp: 0,
    college: 'Michigan',
  },
  role: {
    gamesPlayed: 0,
    gamesStarted: 0,
    snapPct: null,
    snapsPerGame: null,
    tacklesPerGame: null,
    soloPerGame: null,
    astPerGame: null,
    sacksPerGame: null,
    totalSacks: 0,
    tflPerGame: null,
    qbHitsPerGame: null,
    pdPerGame: null,
    intPerGame: null,
    totalInt: 0,
    forcedFumbles: 0,
    fumbleRecoveries: 0,
    fptsPerGame: null,
    last5FptsPerGame: null,
    formRating: 'Unavailable',
    ceiling: null,
    floor: null,
  },
  weekly: [],
};

describe('IdpDetailDrawer', () => {
  it('renders hero bio, position badge, team logo watermarks, and overview tab by default', () => {
    const onClose = vi.fn();
    render(<IdpDetailDrawer player={mockPlayer} onClose={onClose} />);

    expect(screen.getAllByText('Jordyn Brooks').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('LB')).toBeInTheDocument();
    expect(screen.getByText('Yahoo Slot D')).toBeInTheDocument();
    expect(screen.getByText('Texas Tech')).toBeInTheDocument();
    expect(screen.getByText('240 lbs')).toBeInTheDocument();
    expect(screen.getByText('144.5')).toBeInTheDocument();
    expect(screen.getByText('2026 Yahoo Projection')).toBeInTheDocument();
    expect(screen.getByText('2025 Season Summary')).toBeInTheDocument();

    // Immersive hero with team theming & background watermark
    const hero = document.body.querySelector('.idp-detail-hero');
    expect(hero).toBeInTheDocument();
    expect(hero).toHaveAttribute('data-team', 'MIA');

    const heroWatermark = document.body.querySelector('.idp-hero-watermark');
    expect(heroWatermark).toBeInTheDocument();

    const cardWatermark = document.body.querySelector('.idp-card-watermark');
    expect(cardWatermark).toBeInTheDocument();

    const portraitFrame = document.body.querySelector('.idp-hero-portrait-frame');
    expect(portraitFrame).toBeInTheDocument();

    // No draft button
    expect(screen.queryByRole('button', { name: /Draft/i })).toBeNull();
  });

  it('switches to Role tab and renders shortened category titles with both score and raw stats', () => {
    render(<IdpDetailDrawer player={mockPlayer} onClose={vi.fn()} />);

    const roleTab = screen.getByRole('tab', { name: 'Role' });
    fireEvent.click(roleTab);

    // Shortened category titles
    expect(screen.getByText('Snaps')).toBeInTheDocument();
    expect(screen.getByText('Tackles')).toBeInTheDocument();
    expect(screen.getByText('Pass Rush')).toBeInTheDocument();
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('Form')).toBeInTheDocument();

    // Percentile rows with labels and raw values
    expect(screen.getByText('Def Snap Share')).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
    expect(screen.getByText('Total Tackles / G')).toBeInTheDocument();
    expect(screen.getByText('10.8')).toBeInTheDocument();
    expect(screen.getByText('Season Yahoo FPTS / G')).toBeInTheDocument();
    expect(screen.getByText('9.1')).toBeInTheDocument();

    // Score badges and filled bars (Drawer portals to document.body)
    const badges = document.body.querySelectorAll('.percentile-badge');
    expect(badges.length).toBeGreaterThanOrEqual(5);
  });

  it('switches to Weekly tab and renders previous interactive chart and totals table', () => {
    render(<IdpDetailDrawer player={mockPlayer} onClose={vi.fn()} />);

    const weeklyTab = screen.getByRole('tab', { name: 'Weekly' });
    fireEvent.click(weeklyTab);

    // Interactive chart with SVG
    expect(document.body.querySelector('.idp-weekly-chart-svg')).toBeInTheDocument();
    expect(document.body.querySelector('.idp-chart-tooltip-placeholder')).toBeInTheDocument();

    // Switch to Game Log Table
    const tableToggle = screen.getByRole('button', { name: 'Game Log Table' });
    fireEvent.click(tableToggle);

    // Rich table with columns and totals
    const table = document.body.querySelector('.idp-game-log-table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('@IND')).toBeInTheDocument();
    expect(screen.getByText('BYE WEEK')).toBeInTheDocument();
    expect(document.body.querySelector('.idp-table-totals')).toBeInTheDocument();
    expect(screen.getByText(/Season Total/i)).toBeInTheDocument();
  });

  it('handles rookie defender with friendly notice instead of empty stats', () => {
    render(<IdpDetailDrawer player={mockRookie} onClose={vi.fn()} />);

    expect(screen.getByText('2026 Rookie')).toBeInTheDocument();

    const roleTab = screen.getByRole('tab', { name: 'Role' });
    fireEvent.click(roleTab);
    expect(screen.getByText(/Prior-season NFL defensive role metrics/i)).toBeInTheDocument();

    const weeklyTab = screen.getByRole('tab', { name: 'Weekly' });
    fireEvent.click(weeklyTab);
    expect(screen.getByText(/No 2025 NFL regular season game logs/i)).toBeInTheDocument();
  });
});
