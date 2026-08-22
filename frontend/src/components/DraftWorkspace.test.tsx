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
import { estimateAvailability } from '../engine/availability';
import { DraftWorkspace } from './DraftWorkspace';

// DraftWorkspace's own job is orchestration â€” banners, tabs, cards, drawers â€” not engine math,
// which already has extensive coverage in engine/*.test.ts (including the position-tab override and
// near-tie computation this test exercises the *rendering* of). Mocking the engine call and the data
// hook isolates that orchestration from needing real scoring/ADP inputs to hit exact thresholds.
const buildRecommendationBoard = vi.fn();
vi.mock('../engine/recommend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/recommend')>();
  return { ...actual, buildRecommendationBoard: (input: unknown) => buildRecommendationBoard(input) };
});

let cachedWorkerKey: string | null = null;
let cachedWorkerResult: ReturnType<typeof buildRecommendationBoard> | null = null;
// Lets the "log advances while refinement is still in flight" test hold the worker result open;
// every other test keeps the default 'refined' board.
let mockRefinementStatus: 'refining' | 'refined' | 'idle' = 'refined';
vi.mock('../hooks/useRecommendationRefinement', () => ({
  useRecommendationRefinement: ({
    enabled, requestKey, input,
  }: {
    enabled: boolean;
    requestKey: string;
    input: ({ availabilityEntries: Array<[string, number]> } & Record<string, unknown>) | null;
  }) => {
    if (!enabled || input == null) return { status: 'idle', result: null, error: null, timings: null, workerReady: true };
    if (cachedWorkerKey !== requestKey) {
      cachedWorkerKey = requestKey;
      cachedWorkerResult = buildRecommendationBoard({
        ...input,
        players: mockPlayers,
        projections: mockProjections,
        adp: mockAdp,
        availabilityByPlayer: new Map(input.availabilityEntries),
      });
    }
    return {
      status: mockRefinementStatus,
      result: mockRefinementStatus === 'refining' ? null : cachedWorkerResult,
      error: null,
      timings: null,
      workerReady: true,
    };
  },
}));

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
// usageLoadStatus 'ready') before it calls the feed "ready" â€” see data/playerContext.ts. `manifest`
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
  makePlayer('qbx1', 'Quarter Brady', 'QB'),
  makePlayer('qbx2', 'Quarter Mahomes', 'QB'),
  makePlayer('qbx3', 'Quarter Rodgers', 'QB'),
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
    resolvedAdpKey: 'ppr' as const,
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
    manifest,
    adpFormat: 'ppr' as const,
    activeProvider: 'sleeper' as const,
    ...overrides,
  };
  // Clock memos are owned by App in production and passed in â€” reproduce them here so every test's
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
  cachedWorkerKey = null;
  cachedWorkerResult = null;
  mockRefinementStatus = 'refined';
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

  it('advances drafted log rows and the on-clock row while Stage C refinement is still in flight', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    mockRefinementStatus = 'refining';
    // 3 teams so bot picks can land between two of my on-clock turns (slot 1: overall 1, then 6).
    const threeTeamsSettings: LeagueSettings = { ...settings, teams: 3 };
    const threeTeamDraft: DraftInit = {
      provider: 'sleeper', draftId: 'd3', leagueId: 'l1', draftType: 'snake', teams: 3, rounds: 2,
      slotToTeam: { 1: 'me', 2: 'them-a', 3: 'them-b' }, myTeamId: 'me', mySlot: 1, settings: threeTeamsSettings,
    };
    const { rerender } = render(<DraftWorkspace {...defaultProps({ draftInit: threeTeamDraft })} />);

    // On the clock at overall 1 with the worker still refining â€” the log is already painted.
    expect(screen.getAllByText("You're on the clock").length).toBeGreaterThan(0);

    // The poll delivers 4 bot picks (overalls 2-5) while my decision refinement stays open; the
    // same poll feed then lands me on the clock at overall 6 again.
    const advancedPicks: Pick[] = [
      { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb1', providerPlayerId: 'rb1', providerPlayerName: 'Rush One' },
      { overall: 2, round: 1, slot: 2, teamId: 'them-a', playerId: 'wr1', providerPlayerId: 'wr1', providerPlayerName: 'Bot Pick Two' },
      { overall: 3, round: 1, slot: 3, teamId: 'them-b', playerId: 'te1', providerPlayerId: 'te1', providerPlayerName: 'Bot Pick Three' },
      { overall: 4, round: 2, slot: 3, teamId: 'them-b', playerId: 'wr2', providerPlayerId: 'wr2', providerPlayerName: 'Bot Pick Four' },
      { overall: 5, round: 2, slot: 2, teamId: 'them-a', playerId: 'qb1', providerPlayerId: 'qb1', providerPlayerName: 'Bot Pick Five' },
    ];
    rerender(<DraftWorkspace {...defaultProps({ draftInit: threeTeamDraft, effectivePicks: advancedPicks })} />);

    // Every newly drafted row renders immediately â€” the log never waits on refinement.
    expect(screen.getByText('Bot Pick Two')).toBeInTheDocument();
    expect(screen.getByText('Bot Pick Five')).toBeInTheDocument();
    // And the on-clock chip advanced to my next decision (overall 6) while refinement stayed open.
    expect(screen.getAllByText("You're on the clock").length).toBeGreaterThan(0);
    expect(mockRefinementStatus).toBe('refining');
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

  it('switches to the precomputed position view without re-running the engine', async () => {
    buildRecommendationBoard.mockReturnValue({
      ...allBoard,
      recommendationViews: {
        ALL: allBoard.recommendations,
        QB: [], RB: allBoard.recommendations, WR: [], TE: [],
        K: kBoard.recommendations, DEF: [],
      },
    });
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('tab', { name: 'K' }));

    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Kick')).toBeInTheDocument();
    expect(screen.queryByText('K/DEF are held back until your core starting slots are filled.')).not.toBeInTheDocument();
    await user.click(screen.getByText('Kick'));
    const dialog = screen.getByRole('dialog', { name: 'Kick One' });
    expect(within(dialog).getByRole('heading', { name: 'Kick One' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Engine ADP/)).toBeInTheDocument();
  });

  it('opens the player context drawer with the market comparison for the selected card', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByText('One'));

    const dialog = screen.getByRole('dialog', { name: 'Rush One' });
    expect(dialog).toHaveAttribute('data-size', 'wide');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByRole('heading', { name: 'Rush One' })).toBeInTheDocument();
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
    // Four picks done â†’ on the clock for overall 5, me's last selection (decisionPick=5,
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
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).toHaveProperty('simulation.followUpPick', null);
    expect(screen.queryByText('No remaining picks for your team.')).not.toBeInTheDocument();
    expect(screen.queryByText('The draft is complete.')).not.toBeInTheDocument();

    // ADP/next-pick stat tiles were dropped from the card face in the card-face rebuild (they now
    // live in Details); missing availability omits the survival meter rather than rendering "n/a".
    const card = screen.getByRole('article');
    expect(within(card).getByText('One')).toBeInTheDocument();
    expect(within(card).queryByRole('meter')).not.toBeInTheDocument();
  });

  // The real hook inits the worker off-clock (at pool load) and computes only on the user clock;
  // this mock models the compute gate, so the worker-init half lives in
  // useRecommendationRefinement.test.ts and here we pin compute + Stage C to the clock.
  it('computes only while on the user clock (Stage C stays on-clock) and distinguishes a missing seat', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps()} />);
    expect(buildRecommendationBoard).toHaveBeenCalledWith(expect.objectContaining({
      currentPick: 1,
      nextPick: 4,
    }));
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).toHaveProperty('includeRecommendationViews', false);
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).toHaveProperty('includeMarketRecommendations', false);
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).toHaveProperty('includeExpansion', false);
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).toHaveProperty('simulation.decisionPick', 1);
    // Availability rides on the on-clock compute input, never on the static pool.
    expect(buildRecommendationBoard.mock.calls[0]?.[0]).toHaveProperty('availabilityEntries', expect.any(Array));

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

  it('shows the ADP card board between turns without running the recommendation engine', async () => {
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

    // "All" excludes K/D-ST — Kick only shows up once the K tab is selected (below).
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('Two')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Three')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Engine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'ADP' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'K' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Kick')).toBeInTheDocument();
    expect(buildRecommendationBoard).not.toHaveBeenCalled();
  });

  it('shows real Proj and next-pick Avail numbers off-clock, not the removed banner', () => {
    // rb2 gets real stats (not the file-level fixture's empty {}) so Proj is a distinctive,
    // non-zero number rather than a coincidental 0.0 that would look like a missing value.
    mockProjections = [{ playerId: 'rb2', source: 'fftoday', stats: { rec: 50, rush_yd: 200 } }];
    mockAdp = [{
      playerId: 'rb2', name: 'Rush Two', position: 'RB', team: null, adp: 3.5, stdev: 2,
      high: null, low: null, timesDrafted: null, byeWeek: null,
      adpSource: 'ffc' as const, stdevSource: 'observed' as const,
    }];
    render(<DraftWorkspace {...defaultProps({ effectivePicks: afterMyFirstPick })} />);

    // 1 pick made: currentOverall=2 (them on the clock), isMyTurn=false, decisionPick=4 â€” the
    // off-clock rule from App.tsx's boundaries doc ("the very next turn").
    const expected = estimateAvailability(mockAdp[0]!, { currentPick: 2, nextPick: 4 });
    const card = screen.getByText('Two').closest('.player-card') as HTMLElement;
    expect(within(card).getByText('70.0')).toBeInTheDocument();
    expect(within(card).queryByText(/No projection/)).not.toBeInTheDocument();
    const meter = within(card).getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', String(Math.round(expected!.probability * 100)));
  });

  it('passes decisionPick through to DraftLog without recomputing in the log', () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    render(<DraftWorkspace {...defaultProps({ effectivePicks: afterMyFirstPick })} />);

    // CommandBar is gone â€” the "N until your turn" countdown now lives in the top bar (TopNav).
    // DraftLog still gets the you-up chip from the same boundaries.decisionPick, never recomputing.
    expect(screen.getByText("You're up in 2 picks")).toBeInTheDocument();
    expect(screen.getByText('#4').closest('li')).toHaveAttribute('data-you-up', 'true');
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

  it('opens player details in the unified drawer and closes the log drawer', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    isNarrow = true;
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: 'Draft log' }));
    expect(screen.getByRole('dialog', { name: 'Draft log' })).toBeInTheDocument();

    await user.click(screen.getByText('One'));
    expect(screen.queryByRole('dialog', { name: 'Draft log' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Rush One' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Rush One' })).toHaveAttribute('data-size', 'wide');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('opens the player drawer on desktop as well, replacing rather than stacking dialogs', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    isNarrow = false;
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByText('One'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Rush One' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByText('One'));
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

    await user.click(screen.getByText('One'));
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

    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 24, rolloutDisplayLimit: 5 }));
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('article')).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(screen.getAllByRole('article')).toHaveLength(18);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(screen.getAllByRole('article')).toHaveLength(24);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /View \d+ more/ })).not.toBeInTheDocument();
  });

  it('resets pagination to 6 when switching position tabs', async () => {
    buildRecommendationBoard.mockImplementation((input: { limit: number }) => ({
      recommendations: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
      recommendationViews: {
        ALL: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
        QB: [], RB: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
        WR: [], TE: [], K: [], DEF: [],
      },
      diagnostics: baseDiagnostics,
      hasMoreRecommendations: input.limit < 24,
      marketRecommendations: [],
    }));
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: 'Next players' }));
    await user.click(screen.getByRole('button', { name: 'Next players' }));
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('tab', { name: 'RB' }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);
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
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);

    rerender(<DraftWorkspace {...defaultProps({ draftInit: { ...draftInit, draftId: 'd2' } })} />);
    expect(buildRecommendationBoard).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 24 }));
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('switches to ADP mode: card numbers become market-board rank, and a projection-less player never shows the removed No-projection banner', async () => {
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
    // rb2 has no engine recommendation, but still gets the main-thread projected-points fallback
    // (its mocked SeasonProjection carries empty stats, so it scores to 0 rather than being
    // absent) \u2014 the banner explaining an absent Proj number is gone entirely, not re-gated.
    expect(screen.queryByText(/No projection/)).not.toBeInTheDocument();
  });

  it('uses followUpPick (not decisionPick) for the ADP-mode availability meter while on the clock', async () => {
    // On the clock at pick 1 with no picks made: decisionPick === currentPick === 1. If the
    // fallback wrongly used decisionPick here, estimateAvailability's nextPick<=currentPick guard
    // would trivially return 100% for every player \u2014 the followUpPick branch (pick 4 in this
    // 2-team/3-round snake fixture) is what makes the number mean anything.
    mockProjections = [{ playerId: 'rb2', source: 'fftoday', stats: { rec: 50, rush_yd: 200 } }];
    mockAdp = [{
      playerId: 'rb2', name: 'Rush Two', position: 'RB', team: null, adp: 3.5, stdev: 2,
      high: null, low: null, timesDrafted: null, byeWeek: null,
      adpSource: 'ffc' as const, stdevSource: 'observed' as const,
    }];
    buildRecommendationBoard.mockReturnValue({
      recommendations: [], diagnostics: baseDiagnostics, marketRecommendations: [],
    });
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('tab', { name: 'ADP' }));

    const expected = estimateAvailability(mockAdp[0]!, { currentPick: 1, nextPick: 4 });
    const card = screen.getByText('Two').closest('.player-card') as HTMLElement;
    const meter = within(card).getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', String(Math.round(expected!.probability * 100)));
    expect(meter).not.toHaveAttribute('aria-valuenow', '100');
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
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('tab', { name: 'ADP' }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(buildRecommendationBoard).toHaveBeenCalledTimes(1);
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
    // The feed never resolved, so the derivation was fed `{}` â€” a measured label must not appear.
    expect(screen.queryByText('RB1')).not.toBeInTheDocument();
    expect(roleTiles.every((tile) => tile?.querySelector('dd')?.textContent === '\u2014')).toBe(true);
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

describe('DraftWorkspace board presentation', () => {
  it('shows the full capped board in Rows without a load-more action', async () => {
    buildRecommendationBoard.mockImplementation((input: { limit: number }) => ({
      recommendations: Array.from({ length: input.limit }, (_, i) => makeRecommendation({ playerId: `p${i + 1}`, rank: i + 1 })),
      diagnostics: baseDiagnostics,
      marketRecommendations: [],
    }));
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('radio', { name: 'Rows' }));
    expect(screen.getAllByRole('button', { name: /View details for/ })).toHaveLength(24);
    expect(screen.queryByRole('button', { name: 'Load more players' })).not.toBeInTheDocument();
  });

  it('switches between cards and rows, forcing cards only on narrow screens', async () => {
    buildRecommendationBoard.mockReturnValue(allBoard);
    const user = userEvent.setup();
    const { rerender } = render(<DraftWorkspace {...defaultProps()} />);

    await user.click(screen.getByRole('radio', { name: 'Rows' }));
    expect(screen.getAllByRole('button', { name: /View details for/ })).toHaveLength(3);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    isNarrow = true;
    rerender(<DraftWorkspace {...defaultProps()} />);
    expect(screen.queryByRole('radiogroup', { name: 'Board layout' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);

    isNarrow = false;
    rerender(<DraftWorkspace {...defaultProps()} />);
    expect(screen.getAllByRole('button', { name: /View details for/ })).toHaveLength(3);
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

describe('DraftWorkspace QB gating (1-QB leagues, display-only)', () => {
  // 2-team / 3-round snake, slot 1 = me: 1-me, 2-them, 3-them, 4-me, 5-me, 6-them (same grid as
  // the draft-log clock-wiring describe block above). Drafting qbx1 at overall 1 fills the
  // league's single starting QB slot; picks 2-3 (them) advance the clock back to me at overall 4.
  const iHaveAStartingQb: Pick[] = [
    { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'qbx1', providerPlayerId: 'qbx1' },
    { overall: 2, round: 1, slot: 2, teamId: 'them', playerId: 'rb1', providerPlayerId: 'rb1' },
    { overall: 3, round: 2, slot: 2, teamId: 'them', playerId: 'rb3', providerPlayerId: 'rb3' },
  ];

  it('hides a redundant QB from the Engine All board once the starting QB slot is filled, but keeps it on the QB tab', async () => {
    buildRecommendationBoard.mockImplementation((input: { displayPosition: string | null }) => {
      if (input.displayPosition == null) {
        return {
          recommendations: [
            makeRecommendation({ playerId: 'rb2', rank: 1 }),
            makeRecommendation({ playerId: 'qbx2', rank: 2 }),
          ],
          diagnostics: baseDiagnostics,
        };
      }
      if (input.displayPosition === 'QB') {
        return { recommendations: [makeRecommendation({ playerId: 'qbx2', rank: 1 })], diagnostics: baseDiagnostics };
      }
      return { recommendations: [], diagnostics: baseDiagnostics };
    });
    const user = userEvent.setup();
    render(<DraftWorkspace {...defaultProps({ effectivePicks: iHaveAStartingQb })} />);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByText('Two')).toBeInTheDocument();
    expect(screen.queryByText('Mahomes')).not.toBeInTheDocument();
    expect(screen.getByText(/backup QBs aren't recommended in 1-QB leagues/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'QB' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Mahomes')).toBeInTheDocument();
  });

  it('still shows a QB on the All board, with no advisory, when no QB is rostered yet', () => {
    buildRecommendationBoard.mockReturnValue({
      recommendations: [
        makeRecommendation({ playerId: 'rb2', rank: 1 }),
        makeRecommendation({ playerId: 'qbx2', rank: 2 }),
      ],
      diagnostics: baseDiagnostics,
    });
    render(<DraftWorkspace {...defaultProps()} />);

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Mahomes')).toBeInTheDocument();
    expect(screen.queryByText(/backup QBs aren't recommended/)).not.toBeInTheDocument();
  });

  it('does not gate a two-QB league even with both starting QB slots filled', async () => {
    const twoQbSettings: LeagueSettings = {
      ...settings,
      startingSlots: ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 2, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
      format: { reception: 'ppr', qb: 'two-qb', draft: 'snake' },
    };
    const twoQbDraftInit: DraftInit = { ...draftInit, settings: twoQbSettings };
    const bothQbSlotsFilled: Pick[] = [
      { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'qbx1', providerPlayerId: 'qbx1' },
      { overall: 2, round: 1, slot: 2, teamId: 'them', playerId: 'rb1', providerPlayerId: 'rb1' },
      { overall: 3, round: 2, slot: 2, teamId: 'them', playerId: 'rb3', providerPlayerId: 'rb3' },
      { overall: 4, round: 2, slot: 1, teamId: 'me', playerId: 'qbx2', providerPlayerId: 'qbx2' },
    ];
    buildRecommendationBoard.mockReturnValue({
      recommendations: [
        makeRecommendation({ playerId: 'rb2', rank: 1 }),
        makeRecommendation({ playerId: 'qbx3', rank: 2 }),
      ],
      diagnostics: baseDiagnostics,
    });
    render(<DraftWorkspace {...defaultProps({ draftInit: twoQbDraftInit, effectivePicks: bothQbSlotsFilled })} />);

    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Rodgers')).toBeInTheDocument();
    expect(screen.queryByText(/backup QBs aren't recommended/)).not.toBeInTheDocument();
  });
});
