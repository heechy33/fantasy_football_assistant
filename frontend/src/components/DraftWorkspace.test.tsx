import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DataManifest,
  DraftInit,
  LeagueSettings,
  PlayerMeta,
  SeasonProjection,
} from '../../../shared/types';
import type { Recommendation, RecommendationDiagnostics } from '../engine/recommend';
import { DraftWorkspace } from './DraftWorkspace';

// DraftWorkspace's own job is orchestration — banners, tabs, cards, drawers — not engine math,
// which already has extensive coverage in engine/*.test.ts (including the position-tab override and
// near-tie computation this test exercises the *rendering* of). Mocking the engine call and the data
// hook isolates that orchestration from needing real scoring/ADP inputs to hit exact thresholds.
const buildRecommendationBoard = vi.fn();
vi.mock('../engine/recommend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/recommend')>();
  return { ...actual, buildRecommendationBoard: (input: unknown) => buildRecommendationBoard(input) };
});

let isNarrow = false;
vi.mock('../hooks/useMediaQuery', () => ({ useMediaQuery: () => isNarrow }));

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'l1', name: 'Fixture', season: '2026', teams: 2,
  startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  scoring: { rec: 1, rush_yd: 0.1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

const draftInit: DraftInit = {
  provider: 'sleeper', draftId: 'd1', leagueId: 'l1', draftType: 'snake', teams: 2, rounds: 3,
  slotToTeam: { 1: 'me', 2: 'them' }, myTeamId: 'me', mySlot: 1, settings,
};

const manifest: DataManifest = {
  builtAt: '2026-08-09T00:00:00Z', season: '2026', week: null,
  sources: {
    fftoday_projections: { url: 'x', rows: 1, fetchedAt: 't', schemaVersion: 1, status: 'ok' },
    ffc_adp_ppr: {
      url: 'x', rows: 1, fetchedAt: 't', schemaVersion: 1, status: 'ok',
      population: { mockDrafts: 512, teams: 12, season: 2026, format: 'ppr', rows: 1 },
    },
    adp_active_ppr: {
      url: 'x', rows: 1, fetchedAt: 't', schemaVersion: 1, status: 'ok', activeAdpSource: 'ffc-fallback',
    },
  },
  crosswalk: { totalPlayers: 0, top300MatchRate: 1, unmatchedTop300: [] },
};

function makePlayer(playerId: string, name: string, position: PlayerMeta['position']): PlayerMeta {
  return { playerId, name, position, eligiblePositions: position ? [position] : [], team: 'BUF', byeWeek: 7, age: 25, yearsExp: 3, injuryStatus: null, ids: {} };
}

const players: PlayerMeta[] = [
  makePlayer('rb1', 'Rush One', 'RB'),
  makePlayer('rb2', 'Rush Two', 'RB'),
  makePlayer('rb3', 'Rush Three', 'RB'),
  makePlayer('k1', 'Kick One', 'K'),
];
const playersById = new Map(players.map((p) => [p.playerId, p]));
const projections: SeasonProjection[] = players.map((p) => ({ playerId: p.playerId, source: 'fftoday', stats: {} }));

vi.mock('../hooks/usePlayerBoardData', () => ({
  usePlayerBoardData: () => ({
    players, playersById, projections, adp: [], usage: {}, usageLoadStatus: 'ready', loadError: null,
  }),
}));

const baseDiagnostics: RecommendationDiagnostics = {
  unmatchedPickCount: 0,
  unmatchedPickOveralls: [],
  candidatesEvaluated: 3,
  replacementLevels: [],
  positionalDemand: { byPosition: new Map(), source: 'adp', rosterSpots: 1, usableRows: 1 },
  coreStartingSlotsFilled: true,
  specialTeamsDraft: {
    draftRounds: 3, teamPicksMade: 0, remainingPicks: 3,
    configured: { K: 1, DEF: 1 }, rostered: { K: 0, DEF: 0 }, remaining: { K: 1, DEF: 1 },
    due: [], overdue: [], impossibleToFill: false,
  },
};

function makeRecommendation(overrides: Partial<Recommendation> & { playerId: string; rank: number }): Recommendation {
  return {
    projectedPoints: 100, marginalRosterValue: 10, replacementAdjustedValue: 10, replacementLevelPoints: 50,
    vor: 10, vona: null, deprioritized: false, tier: 1, tierGapAfter: 0, tierBoundaryGap: 0, tierUrgency: 0,
    availableNextPickProbability: 0.5, availabilityAdp: 5, availabilityAdpHigh: 3, availabilityAdpLow: 8,
    availabilityStdev: 1, availabilitySampleSize: 100, nearTieWithLeader: false, scoringDiagnosticSeverity: 'none',
    missingScoringKeys: [], confidence: 'high', assignedRosterSlot: 'RB', replacementPlayerId: null,
    reasons: ['Provides 10.0 points over the last rosterable RB option.'], warnings: [],
    ...overrides,
  };
}

const allBoard = {
  recommendations: [
    makeRecommendation({ playerId: 'rb1', rank: 1, nearTieWithLeader: true, replacementAdjustedValue: 20.0 }),
    makeRecommendation({ playerId: 'rb2', rank: 2, nearTieWithLeader: true, replacementAdjustedValue: 19.8 }),
    makeRecommendation({ playerId: 'rb3', rank: 3, replacementAdjustedValue: 5 }),
  ],
  diagnostics: baseDiagnostics,
};

const kBoard = {
  recommendations: [
    makeRecommendation({ playerId: 'k1', rank: 1, deprioritized: true, assignedRosterSlot: null, warnings: ['K/DEF are held back until your core starting slots are filled.'] }),
  ],
  diagnostics: { ...baseDiagnostics, coreStartingSlotsFilled: false },
};

function defaultProps() {
  return {
    draftInit,
    effectivePicks: [],
    status: 'pre' as const,
    isStale: false,
    dataAgeMs: null,
    onCorrectPick: vi.fn(),
    manifest,
    adpFormat: 'ppr' as const,
  };
}

afterEach(() => {
  cleanup();
  isNarrow = false;
  buildRecommendationBoard.mockReset();
});

describe('DraftWorkspace recommendation cards and tabs', () => {
  it('renders one card per recommendation and flags the near-tie group without touching order', () => {
    buildRecommendationBoard.mockImplementation((input: { displayPosition: string | null }) =>
      input.displayPosition == null ? allBoard : kBoard,
    );
    render(<DraftWorkspace {...defaultProps()} />);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText('Rush One')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Rush Two')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Rush Three')).toBeInTheDocument();

    // Only the two flagged cards carry the near-tie badge, and only they triggered the banner.
    expect(within(cards[0]!).getByText('Near tie')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Near tie')).toBeInTheDocument();
    expect(within(cards[2]!).queryByText('Near tie')).not.toBeInTheDocument();
    expect(screen.getByText(/cannot justify a confident order/)).toBeInTheDocument();
  });

  it('does not show the near-tie banner when no recommendation is flagged', () => {
    buildRecommendationBoard.mockReturnValue({
      recommendations: [makeRecommendation({ playerId: 'rb1', rank: 1 }), makeRecommendation({ playerId: 'rb2', rank: 2 })],
      diagnostics: baseDiagnostics,
    });
    render(<DraftWorkspace {...defaultProps()} />);
    expect(screen.queryByText(/cannot justify a confident order/)).not.toBeInTheDocument();
  });

  it('re-requests the board with the tapped tab position and renders that tab\'s board, including a deprioritized K', async () => {
    buildRecommendationBoard.mockImplementation((input: { displayPosition: string | null }) =>
      input.displayPosition == null ? allBoard : kBoard,
    );
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('tab', { name: 'K' }));

    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ displayPosition: 'K' }));
    expect(screen.getByText('Kick One')).toBeInTheDocument();
    expect(screen.getByText('Too early')).toBeInTheDocument();
  });

  it('opens the player context modal with the engine explanation for the selected card', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);

    const dialog = screen.getByRole('dialog', { name: 'Rush One context' });
    expect(within(dialog).getByText('Engine explanation')).toBeInTheDocument();
    expect(within(dialog).getByText(/512 recorded/)).toBeInTheDocument();
  });

  it('shows draft-complete copy instead of a loading snapshot message when the board is full', () => {
    const fullPicks = Array.from({ length: draftInit.teams * draftInit.rounds }, (_, i) => ({
      overall: i + 1,
      round: Math.ceil((i + 1) / draftInit.teams),
      slot: 1,
      teamId: i % 2 === 0 ? 'me' : 'them',
      playerId: 'rb1',
      providerPlayerId: 'rb1',
    }));
    render(<DraftWorkspace {...defaultProps()} effectivePicks={fullPicks} status="complete" />);

    expect(screen.getByText('The draft is complete.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for a validated projection snapshot.')).not.toBeInTheDocument();
    expect(buildRecommendationBoard).not.toHaveBeenCalled();
  });
});

describe('DraftWorkspace mobile drawers', () => {
  it('shows a desktop three-column grid with no drawer toggles when not narrow', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    isNarrow = false;
    render(<DraftWorkspace {...defaultProps()} />);
    expect(screen.queryByRole('button', { name: 'Draft log' })).not.toBeInTheDocument();
    // Both rails render directly (no drawer chrome) at desktop width.
    expect(screen.getByRole('heading', { name: 'Draft log' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My team' })).toBeInTheDocument();
  });

  it('moves the draft log and my team into accessible drawers when narrow', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    isNarrow = true;
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    expect(screen.queryByRole('heading', { name: 'Draft log' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Draft log' }));
    const dialog = screen.getByRole('dialog', { name: 'Draft log' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Draft log' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Draft log' })).not.toBeInTheDocument();
  });
});
