import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerMeta, SavedDraft } from '../../../shared/types';
import type { RankedPlayer } from '../data/loadPlayerPool';
import { LeagueDetailRoute } from './LeagueDetailRoute';

// League detail reads three seams: the saved-league hub hook, the saved-drafts hook, and the
// player pool. All are module mocks so the route itself runs for real — the assertions are about
// what the page renders per provider, not about the data layer.
const savedLeaguesStub = vi.hoisted(() => ({ value: { leagues: [] as never[], loading: false, error: null as Error | null } }));
const savedDraftsStub = vi.hoisted(() => ({ drafts: [] as SavedDraft[] }));

vi.mock('../data/useSavedLeagues', () => ({
  useSavedLeagues: () => savedLeaguesStub.value,
}));

vi.mock('../data/useSavedDrafts', () => ({
  draftToDisplay: (drafts: SavedDraft[]) => drafts[drafts.length - 1] ?? null,
  useSavedDrafts: () => ({ drafts: savedDraftsStub.drafts, loading: false, error: null, refresh: async () => {} }),
}));

vi.mock('../data/loadPlayerPool', () => ({
  loadPlayerPool: async (): Promise<RankedPlayer[]> => [playerFixture()],
}));

const playerFixture = (): PlayerMeta & { rank: number } & { adp: number; stdev: number; high: number; low: number; timesDrafted: number; adpSource: string; stdevSource: string } => ({
  playerId: 'rb-1',
  name: 'Test Backfield',
  position: 'RB',
  eligiblePositions: ['RB'],
  team: 'SF',
  byeWeek: 9,
  age: null,
  yearsExp: null,
  injuryStatus: null,
  ids: {},
  rank: 1,
  adp: 1,
  stdev: 0,
  high: 1,
  low: 1,
  timesDrafted: 1,
  adpSource: 'ffc',
  stdevSource: 'observed',
});

const leagueFixture = {
  id: 'league-doc-1',
  userId: 'user-1',
  provider: 'espn',
  providerLeagueId: '983371779',
  name: 'Work League',
  season: '2026',
  teams: 10,
  rounds: 14,
  mySlot: null,
  settings: { provider: 'espn', leagueId: '983371779' },
  providerUserId: null,
  latestDraftId: null,
  createdAt: '',
  updatedAt: '',
} as never;

const espnDraftFixture = (): SavedDraft => ({
  id: 'draft-doc-1',
  userId: 'user-1',
  leagueId: 'league-doc-1',
  provider: 'espn',
  providerDraftId: null,
  mode: 'espn',
  frozenInit: {
    provider: 'espn',
    draftId: 'manual-session',
    leagueId: '983371779',
    draftType: 'snake',
    teams: 10,
    rounds: 14,
    slotToTeam: { 1: '1' },
    myTeamId: '1',
    mySlot: 1,
    settings: {
      provider: 'espn',
      leagueId: '983371779',
      name: 'Work League',
      season: '2026',
      teams: 10,
      startingSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DEF', 'K'],
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, BN: 5 },
      scoring: { rec: 1 },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    },
  },
  overrides: [],
  picks: [
    { overall: 1, round: 1, slot: 1, teamId: '1', playerId: 'rb-1', providerPlayerId: 'espn-1', providerPlayerName: 'Test Backfield' },
  ],
  status: 'complete',
  createdAt: '',
  updatedAt: '2026-08-27T00:00:00Z',
});

function renderDetail() {
  // The route reads :leagueId via useParams, which needs real Route context.
  return render(
    <MemoryRouter initialEntries={['/leagues/league-doc-1']}>
      <Routes>
        <Route path="leagues/:leagueId" element={<LeagueDetailRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LeagueDetailRoute', () => {
  it('reconstructs the ESPN drafted team from the saved draft (frozenInit + picks)', async () => {
    savedLeaguesStub.value = { leagues: [leagueFixture], loading: false, error: null };
    savedDraftsStub.drafts = [espnDraftFixture()];
    renderDetail();

    expect(await screen.findByText('Work League')).toBeInTheDocument();
    expect(await screen.findByText('Test Backfield')).toBeInTheDocument();
  });

  it('shows the honest empty state before any draft exists', async () => {
    savedLeaguesStub.value = { leagues: [leagueFixture], loading: false, error: null };
    savedDraftsStub.drafts = [];
    renderDetail();

    expect(await screen.findByText('Work League')).toBeInTheDocument();
    expect(await screen.findByText(/No draft tracked for this league yet/)).toBeInTheDocument();
  });

  it('does not invent a roster for an ESPN league whose saved draft has no picks', async () => {
    savedLeaguesStub.value = { leagues: [leagueFixture], loading: false, error: null };
    savedDraftsStub.drafts = [{ ...espnDraftFixture(), picks: [] }];
    renderDetail();

    expect(await screen.findByText(/No draft tracked for this league yet/)).toBeInTheDocument();
    expect(screen.queryByText('Test Backfield')).not.toBeInTheDocument();
  });
});