import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AdpEntry,
  DataManifest,
  DraftInit,
  LeagueSettings,
  Pick,
  PlayerMeta,
  PlayerUsage,
  PlayerUsageArtifact,
  SeasonProjection,
} from '../../../shared/types';
import type { Recommendation, RecommendationDiagnostics } from '../engine/recommend';
import { canonicalPicksSignature, computeOnTheClock, userPickBoundaries } from '../adapters/draftOrder';
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

// `resolvePlayerContextFeedStatus` requires all four nflverse context sources 'ok' (in addition to
// usageLoadStatus 'ready') before it calls the feed "ready" — see data/playerContext.ts. `manifest`
// above deliberately lacks these (most tests in this file don't care about the context feed), so
// the team-depth-role tests that need a trustworthy usage feed use this variant instead.
const contextReadyManifest: DataManifest = {
  ...manifest,
  sources: {
    ...manifest.sources,
    nflverse_player_stats: { url: 'x', rows: 1, fetchedAt: 't', schemaVersion: 1, status: 'ok' },
    nflverse_snap_counts: { url: 'x', rows: 1, fetchedAt: 't', schemaVersion: 1, status: 'ok' },
    nflverse_weekly_rosters: { url: 'x', rows: 1, fetchedAt: 't', schemaVersion: 1, status: 'ok' },
    nflverse_injuries: { url: 'x', rows: 1, fetchedAt: 't', schemaVersion: 1, status: 'ok' },
  },
};

function makeUsage(overrides: Partial<PlayerUsage> = {}): PlayerUsage {
  return {
    season: 2025, usageSeasonObserved: true, snapPct: null, targetShare: null, carryShare: null,
    gamesWithAnySnap: 10, recentTeam: 'BUF', teamChanged: false, knownAbsent: false,
    availabilityRate: 0.9, seasons: [], injuryHistory: [], durabilityScore: null, opportunity: null,
    ...overrides,
  };
}

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

// Mutable, like `isNarrow` above, so the risk-seam tests can vary `usage`/`usageLoadStatus` without
// disturbing every other test in this file, which relies on the `{}`/'ready' defaults below.
let mockUsage: PlayerUsageArtifact = {};
let mockUsageLoadStatus: 'loading' | 'ready' | 'error' = 'ready';
let mockPlayers = players;
let mockPlayersById = playersById;
let mockProjections = projections;
let mockAdp: AdpEntry[] = [];
vi.mock('../hooks/usePlayerBoardData', () => ({
  usePlayerBoardData: () => ({
    players: mockPlayers, playersById: mockPlayersById, projections: mockProjections, adp: mockAdp, usage: mockUsage, usageLoadStatus: mockUsageLoadStatus, loadError: null,
  }),
}));

const baseDiagnostics: RecommendationDiagnostics = {
  unmatchedPickCount: 0,
  unmatchedPickOveralls: [],
  candidatesEvaluated: 3,
  replacementLevels: [],
  positionalDemand: { byPosition: new Map(), source: 'adp', rosterSpots: 1, usableRows: 1 },
  coreStartingSlotsFilled: true,
  simulation: null,
  specialTeamsDraft: {
    draftRounds: 3, teamPicksMade: 0, remainingPicks: 3,
    configured: { K: 1, DEF: 1 }, rostered: { K: 0, DEF: 0 }, remaining: { K: 1, DEF: 1 },
    due: [], overdue: [], impossibleToFill: false,
  },
};

function makeRecommendation(overrides: Partial<Recommendation> & { playerId: string; rank: number }): Recommendation {
  return {
    projectedPoints: 100, marginalRosterValue: 10, marginalRosterUtility: 10,
    expectedFollowUpValue: 0, planValue: 10, planningHorizon: 0,
    replacementAdjustedValue: 10, replacementLevelPoints: 50,
    vor: 10, vona: null, vonaSource: 'unavailable', lookaheadValue: null, downside: null,
    simulatedSurvivalProbability: null, benchDepthValue: 0, recommendationMode: 'starter', rankingBasis: 'rosterUtility',
    deprioritized: false, tier: 1, tierGapAfter: 0, tierBoundaryGap: 0, tierUrgency: 0,
    availableNextPickProbability: 0.5, availabilityAdp: 5, availabilityAdpHigh: 3, availabilityAdpLow: 8,
    availabilityStdev: 1, availabilitySampleSize: 100, nearTie: false, scoringDiagnosticSeverity: 'none',
    missingScoringKeys: [], confidence: 'high', assignedRosterSlot: 'RB', replacementPlayerId: null,
    pickAction: 'take-now',
    reasons: ['Provides 10.0 points over the last rosterable RB option.'], warnings: [],
    ...overrides,
  };
}

const allBoard = {
  recommendations: [
    makeRecommendation({ playerId: 'rb1', rank: 1, nearTie: true, replacementAdjustedValue: 20.0 }),
    makeRecommendation({ playerId: 'rb2', rank: 2, nearTie: true, replacementAdjustedValue: 19.8 }),
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

function defaultProps(overrides: Partial<Parameters<typeof DraftWorkspace>[0]> = {}) {
  const merged = {
    draftInit,
    effectivePicks: [] as Pick[],
    onCorrectPick: vi.fn(),
    manifest,
    adpFormat: 'ppr' as const,
    ...overrides,
  };
  // Clock memos are owned by App in production and passed in — reproduce them here so every test's
  // onTheClock/boundaries stay consistent with the effectivePicks/draftInit it actually renders.
  return {
    ...merged,
    picksSignature: canonicalPicksSignature(merged.effectivePicks),
    onTheClock: merged.draftInit
      ? computeOnTheClock(merged.draftInit.draftType, merged.draftInit.teams, merged.draftInit.rounds, merged.effectivePicks.length, merged.draftInit.slotToTeam)
      : null,
    boundaries: merged.draftInit && merged.draftInit.myTeamId != null
      ? userPickBoundaries(merged.draftInit.draftType, merged.draftInit.teams, merged.draftInit.rounds, merged.effectivePicks.length, merged.draftInit.slotToTeam, merged.draftInit.myTeamId)
      : null,
  };
}

afterEach(() => {
  cleanup();
  isNarrow = false;
  mockUsage = {};
  mockUsageLoadStatus = 'ready';
  mockPlayers = players;
  mockPlayersById = playersById;
  mockProjections = projections;
  mockAdp = [];
  buildRecommendationBoard.mockReset();
});

describe('DraftWorkspace recommendation cards and tabs', () => {
  it('renders one equal-size card per recommendation without reordering', () => {
    buildRecommendationBoard.mockImplementation((input: { displayPosition: string | null }) =>
      input.displayPosition == null ? allBoard : kBoard,
    );
    render(<DraftWorkspace {...defaultProps()} />);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveClass('player-card');
    expect(cards[1]).toHaveClass('player-card');
    expect(cards[2]).toHaveClass('player-card');
    expect(within(cards[0]!).getByText('One')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Two')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Three')).toBeInTheDocument();
  });

  it('keeps engine order when a higher-ranked wait target sits above take-now rows', () => {
    buildRecommendationBoard.mockReturnValue({
      recommendations: [
        makeRecommendation({ playerId: 'rb1', rank: 1, pickAction: 'wait-target' }),
        makeRecommendation({ playerId: 'rb2', rank: 2, pickAction: 'take-now' }),
        makeRecommendation({ playerId: 'rb3', rank: 3, pickAction: 'take-now' }),
      ],
      diagnostics: baseDiagnostics,
    });
    render(<DraftWorkspace {...defaultProps()} />);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.classList.contains('player-card'))).toBe(true);
    expect(within(cards[0]!).getByText('One')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Two')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Three')).toBeInTheDocument();
  });

  it('does not show near-tie advisory copy on the board', () => {
    buildRecommendationBoard.mockReturnValue({
      recommendations: [makeRecommendation({ playerId: 'rb1', rank: 1 }), makeRecommendation({ playerId: 'rb2', rank: 2 })],
      diagnostics: baseDiagnostics,
    });
    render(<DraftWorkspace {...defaultProps()} />);
    expect(screen.queryByText(/cannot justify a confident order/)).not.toBeInTheDocument();
  });

  it('keeps board filters when Stage C simulation is active', () => {
    buildRecommendationBoard.mockReturnValue({
      ...allBoard,
      diagnostics: {
        ...baseDiagnostics,
        simulation: {
          scenariosRun: 1,
          timedOut: false,
          elapsedMs: 1,
          syntheticAdpCount: 0,
          unscoredPositionCount: 0,
        },
      },
    });

    render(<DraftWorkspace {...defaultProps()} />);

    expect(screen.getByRole('tab', { name: 'Engine' })).toBeInTheDocument();
  });

  it('re-requests the board with the tapped tab position and renders that tab\'s board, including a deprioritized K', async () => {
    buildRecommendationBoard.mockImplementation((input: { displayPosition: string | null }) =>
      input.displayPosition == null ? allBoard : kBoard,
    );
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('tab', { name: 'K' }));

    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ displayPosition: 'K' }));
    expect(screen.getByText('Kick')).toBeInTheDocument();
    expect(screen.queryByText('K/DEF are held back until your core starting slots are filled.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View details' }));
    const dialog = screen.getByRole('dialog', { name: 'Kick One context' });
    expect(within(dialog).getByText('Kick One')).toBeInTheDocument();
    expect(within(dialog).getByText(/Engine ADP/)).toBeInTheDocument();
  });

  it('opens the player context drawer with the market comparison for the selected card', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);

    const dialog = screen.getByRole('dialog', { name: 'Rush One context' });
    expect(dialog).toHaveAttribute('data-size', 'wide');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByText('Rush One')).toBeInTheDocument();
    expect(within(dialog).getByText(/Engine ADP/)).toBeInTheDocument();
    expect(within(dialog).getByText(/current pick 1/)).toBeInTheDocument();
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
    render(<DraftWorkspace {...defaultProps({ effectivePicks: fullPicks })} />);

    expect(screen.getByText('The draft is complete.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for a validated projection snapshot.')).not.toBeInTheDocument();
    expect(buildRecommendationBoard).not.toHaveBeenCalled();
  });

  it('keeps the board visible on my final pick with availability shown as n/a', () => {
    // 2-team / 3-round snake, slot 1 = me: picks land 1-me, 2-them, 3-them, 4-me, 5-me, 6-them.
    // Four picks done → on the clock for overall 5, me's last selection (decisionPick=5,
    // followUpPick=null). Pre-fix this gated on derived nextPick and returned no-user-picks.
    buildRecommendationBoard.mockReturnValue({
      ...allBoard,
      recommendations: [makeRecommendation({
        playerId: 'rb1', rank: 1,
        availableNextPickProbability: null,
        availabilityAdp: null, availabilityAdpHigh: null, availabilityAdpLow: null,
        availabilityStdev: null, availabilitySampleSize: null,
      })],
    });
    const finalPickState = [
      { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
      { overall: 2, round: 1, slot: 2, teamId: 'them', playerId: 'rb2', providerPlayerId: 'rb2' },
      { overall: 3, round: 2, slot: 2, teamId: 'them', playerId: 'rb3', providerPlayerId: 'rb3' },
      { overall: 4, round: 2, slot: 1, teamId: 'me', playerId: 'rb2', providerPlayerId: 'rb2' },
    ];

    render(<DraftWorkspace {...defaultProps({ effectivePicks: finalPickState })} />);

    expect(buildRecommendationBoard).toHaveBeenCalledWith(expect.objectContaining({
      nextPick: null,
      currentPick: 5,
    }));
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).not.toHaveProperty('simulation');
    expect(screen.queryByText('No remaining picks for your team.')).not.toBeInTheDocument();
    expect(screen.queryByText('The draft is complete.')).not.toBeInTheDocument();

    // ADP/next-pick stat tiles were dropped from the card face in the card-face rebuild (they now
    // live in Details); missing availability omits the survival meter rather than rendering "n/a".
    const card = screen.getByRole('article');
    expect(within(card).getByText('One')).toBeInTheDocument();
    expect(within(card).queryByRole('meter')).not.toBeInTheDocument();
  });

  it('builds the immediate deterministic board only on the user clock and distinguishes a missing seat', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps()} />);
    expect(buildRecommendationBoard).toHaveBeenCalledWith(expect.objectContaining({
      currentPick: 1,
      nextPick: 4,
    }));
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).not.toHaveProperty('simulation');

    cleanup();
    buildRecommendationBoard.mockReset();
    const opponentTurnPick = { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' };
    render(<DraftWorkspace {...defaultProps({ effectivePicks: [opponentTurnPick] })} />);
    expect(buildRecommendationBoard).not.toHaveBeenCalled();

    cleanup();
    buildRecommendationBoard.mockReset();
    render(<DraftWorkspace {...defaultProps({ draftInit: { ...draftInit, myTeamId: null, mySlot: null } })} />);
    expect(screen.getByText(/Your seat was not found/)).toBeInTheDocument();
    expect(buildRecommendationBoard).not.toHaveBeenCalled();
  });

  it('does not run the recommendation engine for off-clock ownership corrections', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    const firstPick = {
      overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1',
    };
    const correctedPick = { ...firstPick, slot: 2, teamId: 'them' };
    const { rerender } = render(<DraftWorkspace {...defaultProps({ effectivePicks: [firstPick] })} />);

    expect(buildRecommendationBoard).not.toHaveBeenCalled();
    rerender(<DraftWorkspace {...defaultProps({ effectivePicks: [correctedPick] })} />);

    expect(buildRecommendationBoard).not.toHaveBeenCalled();
  });
});

describe('DraftWorkspace draft-log clock wiring', () => {
  // 2-team / 3-round snake, slot 1 = me: 1-me, 2-them, 3-them, 4-me, 5-me, 6-them.
  const afterMyFirstPick = [
    { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' },
  ];

  it('shows an ADP neighborhood between turns without running the recommendation engine', () => {
    mockAdp = ['rb2', 'rb3', 'k1'].map((playerId, index) => ({
      playerId,
      name: mockPlayersById.get(playerId)?.name ?? playerId,
      position: mockPlayersById.get(playerId)?.position ?? '',
      team: null,
      adp: 3 + index,
      stdev: 2,
      high: 1,
      low: 8,
      timesDrafted: 100,
      byeWeek: null,
      adpSource: 'ffc' as const,
      stdevSource: 'observed' as const,
    }));

    render(<DraftWorkspace {...defaultProps({ effectivePicks: afterMyFirstPick })} />);

    expect(screen.getByRole('region', { name: 'Likely available around pick 4' })).toBeInTheDocument();
    expect(screen.getByText('Rush Two')).toBeInTheDocument();
    expect(screen.getByText('ADP neighborhood, not recommendation order.')).toBeInTheDocument();
    expect(buildRecommendationBoard).not.toHaveBeenCalled();
  });

  it('passes decisionPick through to DraftLog without recomputing in the log', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps({ effectivePicks: afterMyFirstPick })} />);

    // CommandBar is gone — the "N until your turn" countdown now lives in the top bar (TopNav).
    // DraftLog still gets the you-up chip from the same boundaries.decisionPick, never recomputing.
    expect(screen.getByText("You're up in 2 picks")).toBeInTheDocument();
    expect(screen.getByText('2.02').closest('li')).toHaveAttribute('data-you-up', 'true');
  });

  it('keeps the DraftLog you-up chip while the recommendation board is loading', () => {
    mockPlayers = [];
    mockPlayersById = new Map();
    mockProjections = [];
    render(<DraftWorkspace {...defaultProps({ effectivePicks: afterMyFirstPick })} />);

    expect(screen.getByText("You're up in 2 picks")).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'My Team' })).toBeInTheDocument();
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

  it('closes the mobile draft-log drawer before handing off Fix/Edit', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    isNarrow = true;
    const onCorrectPick = vi.fn();
    const user = userEvent.setup();
    const pick = { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1' };
    render(<DraftWorkspace {...defaultProps({ effectivePicks: [pick], onCorrectPick })} />);

    await user.click(screen.getByRole('button', { name: 'Draft log' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onCorrectPick).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog', { name: 'Draft log' })).not.toBeInTheDocument();
  });

  it('opens player details in the unified drawer and closes the log drawer', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    isNarrow = true;
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: 'Draft log' }));
    expect(screen.getByRole('dialog', { name: 'Draft log' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);
    expect(screen.queryByRole('dialog', { name: 'Draft log' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Rush One context' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Rush One context' })).toHaveAttribute('data-size', 'wide');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('opens the player drawer on desktop as well, replacing rather than stacking dialogs', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    isNarrow = false;
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Rush One context' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('DraftWorkspace weekly stats loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Board-wide (useBoardWeeklyStats): fetched as soon as the draft season is known, not gated
  // on a player drawer opening, because K/DEF's card-face "Avg fpts" tile needs it for every
  // card on the board, not just whichever player is currently selected.
  it('fetches weekly-stats.json once a draft season is known, without waiting for a player drawer', () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaVersion: 1, season: 2025, weeksFetched: [], columns: {}, players: {}, heat: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps()} />);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('weekly-stats'))).toBe(true);
  });

  it('reuses the same session-memoized fetch once the player drawer opens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaVersion: 1, season: 2025, weeksFetched: [], columns: {}, players: {}, heat: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);
    buildRecommendationBoard.mockReturnValue(allBoard);
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/data/weekly-stats.json');
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('weekly-stats'))).toHaveLength(1);
  });
});

describe('DraftWorkspace board mode and pagination', () => {
  it('starts at 6 rows and expands through 12/18/24 via Next players', async () => {
    buildRecommendationBoard.mockImplementation((input: { limit: number }) => ({
      recommendations: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
      diagnostics: baseDiagnostics,
      hasMoreRecommendations: input.limit < 24,
      marketRecommendations: [],
    }));
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 6, rolloutDisplayLimit: 5 }));
    expect(screen.getAllByRole('article')).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 12, rolloutDisplayLimit: 5 }));

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 18 }));

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 24 }));
    expect(screen.queryByRole('button', { name: /View \d+ more/ })).not.toBeInTheDocument();
  });

  it('resets pagination to 6 when switching position tabs', async () => {
    buildRecommendationBoard.mockImplementation((input: { limit: number; displayPosition: string | null }) => ({
      recommendations: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
      diagnostics: baseDiagnostics,
      hasMoreRecommendations: input.limit < 24,
      marketRecommendations: [],
    }));
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 12 }));

    await user.click(screen.getByRole('tab', { name: 'RB' }));
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 6, displayPosition: 'RB' }));
  });

  it('resets pagination when the connected draft changes', async () => {
    buildRecommendationBoard.mockImplementation((input: { limit: number }) => ({
      recommendations: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
      diagnostics: baseDiagnostics,
      hasMoreRecommendations: input.limit < 24,
      marketRecommendations: [],
    }));
    const user = userEvent.setup();
    const { rerender } = render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 12 }));

    rerender(<DraftWorkspace {...defaultProps({ draftInit: { ...draftInit, draftId: 'd2' } })} />);
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 6 }));
  });

  it('switches to ADP mode: card numbers become market-board rank, and a projection-less player renders a No-projection card', async () => {
    buildRecommendationBoard.mockReturnValue({
      recommendations: [makeRecommendation({ playerId: 'rb1', rank: 1 })],
      diagnostics: baseDiagnostics,
      marketRecommendations: [
        { playerId: 'rb1', rank: 3, adp: 5, pickDelta: -10, recommendation: makeRecommendation({ playerId: 'rb1', rank: 1 }) },
        { playerId: 'rb2', rank: 4, adp: 8, pickDelta: -7, recommendation: null },
      ],
    });
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    // Engine mode with a single recommendation: same-size PlayerCard carrying the engine rank.
    expect(within(screen.getAllByRole('article')[0]!).getByText('One')).toBeInTheDocument();
    expect(within(screen.getAllByRole('article')[0]!).getByText('#1')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'ADP' }));

    // ADP mode uses the same card component; ranks are league-wide market rank, not engine rank.
    const adpCards = screen.getAllByRole('article');
    expect(within(adpCards[0]!).getByText('#3')).toBeInTheDocument();
    expect(within(adpCards[1]!).getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('No projection — ADP only.')).toBeInTheDocument();
  });

  it('resets pagination to 6 when switching board mode', async () => {
    buildRecommendationBoard.mockImplementation((input: { limit: number }) => ({
      recommendations: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
      diagnostics: baseDiagnostics,
      hasMoreRecommendations: true,
      marketRecommendations: Array.from({ length: 24 }, (_, i) => ({
        playerId: `m${i + 1}`, rank: i + 1, adp: i + 1, pickDelta: 0, recommendation: null,
      })),
    }));
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 12 }));

    await user.click(screen.getByRole('tab', { name: 'ADP' }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('does not show View more when the Engine board reports no additional rows', () => {
    buildRecommendationBoard.mockReturnValue({
      recommendations: Array.from({ length: 5 }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
      diagnostics: baseDiagnostics,
      hasMoreRecommendations: false,
      marketRecommendations: [],
    });
    render(<DraftWorkspace {...defaultProps()} />);

    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /View \d+ more/ })).not.toBeInTheDocument();
  });
});

describe('DraftWorkspace team-depth role (Part B)', () => {
  it('renders em-dash Role tiles when the usage feed never resolved (no throw, never a guess)', () => {
    // `manifest` (this file's default fixture) lacks the four nflverse context sources, so
    // `resolvePlayerContextFeedStatus` reports 'unavailable' even though usageLoadStatus is 'ready'.
    mockUsage = { rb1: makeUsage({ carryShare: 0.5 }) };
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps()} />);

    const cards = screen.getAllByRole('article');
    expect(cards.length).toBeGreaterThan(0);
    const roleTiles = screen.getAllByText('Role').map((el) => el.closest('[data-role-basis]'));
    expect(roleTiles.length).toBe(cards.length);
    // The feed never resolved, so the derivation was fed `{}` — a measured label must not appear.
    expect(screen.queryByText('RB1')).not.toBeInTheDocument();
    expect(roleTiles.every((tile) => tile?.querySelector('dd')?.textContent === '—')).toBe(true);
  });

  it('labels a card from usage once the context feed is ready', () => {
    mockUsage = { rb1: makeUsage({ carryShare: 0.5 }) };
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps()} manifest={contextReadyManifest} />);

    // rb1 is the only RB with a measured carry share; rb2/rb3 have no usage row and no depth
    // chart order in this fixture, so they stay unlabeled (never a guess).
    expect(screen.getByText('RB1')).toBeInTheDocument();
  });
});

describe('DraftWorkspace blocking alerts', () => {
  it('does not render Model notes', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps()} />);
    expect(screen.queryByText(/Model notes/)).not.toBeInTheDocument();
  });

  it('keeps an unmatched-picks notice as a visible inline alert', () => {
    buildRecommendationBoard.mockReturnValue({
      ...allBoard,
      diagnostics: { ...baseDiagnostics, unmatchedPickCount: 2, unmatchedPickOveralls: [3, 7] },
    });
    render(<DraftWorkspace {...defaultProps()} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/2 drafted picks.*couldn't be matched/);
  });

  it('keeps an impossible-to-fill K/DEF notice as a visible inline alert', () => {
    buildRecommendationBoard.mockReturnValue({
      ...allBoard,
      diagnostics: {
        ...baseDiagnostics,
        specialTeamsDraft: {
          draftRounds: 3, teamPicksMade: 2, remainingPicks: 1,
          configured: { K: 1, DEF: 1 }, rostered: { K: 0, DEF: 0 }, remaining: { K: 1, DEF: 1 },
          due: [], overdue: [], impossibleToFill: true,
        },
      },
    });
    render(<DraftWorkspace {...defaultProps()} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Only 1 selection remain for 2 unfilled K\/DEF slots/);
  });
});
