import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cred, EspnCred, PlayerMeta, SleeperCred } from '../../../shared/types';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';
import { listSleeperDrafts, resolveUser, sleeperAdapter } from './sleeper';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'sleeper');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, fileName), 'utf-8')) as T;
}

interface RawLeagueFixture {
  league_id: string;
  [key: string]: unknown;
}

const rawUser = loadJson<{ user_id: string; username: string; display_name: string }>('raw-user.json');
const rawLeagues = loadJson<RawLeagueFixture[]>('raw-leagues.json');
const rawDraft = loadJson<Record<string, unknown>>('raw-draft.json');
const rawDraftPicks = loadJson<unknown[]>('raw-draft-picks.json');
const knownPlayerPool = loadJson<PlayerMeta[]>('known-player-pool-sample.json');
const rawLeagueRosters = loadJson<unknown[]>('raw-league-rosters.json');
const rawLeagueUsers = loadJson<unknown[]>('raw-league-users.json');

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}

function installFetchMock() {
  const mock = vi.fn((input: string) => {
    const url = String(input);
    if (url === '/data/players.json') return jsonResponse(knownPlayerPool);
    if (/\/user\/(u-3|coach_hodgetwins)$/.test(url)) return jsonResponse(rawUser);
    if (/\/leagues\/nfl\//.test(url)) return jsonResponse(rawLeagues);
    if (/\/drafts\/nfl\//.test(url)) return jsonResponse([rawDraft]);
    if (/\/draft\/raw-draft-ppr\/picks$/.test(url)) return jsonResponse(rawDraftPicks);
    if (/\/draft\/raw-draft-ppr$/.test(url)) return jsonResponse(rawDraft);
    if (/\/league\/raw-league-ppr\/rosters$/.test(url)) return jsonResponse(rawLeagueRosters);
    if (/\/league\/raw-league-ppr\/users$/.test(url)) return jsonResponse(rawLeagueUsers);
    for (const league of rawLeagues) {
      if (url.endsWith(`/league/${league.league_id}`)) return jsonResponse(league);
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const CRED: SleeperCred = { provider: 'sleeper', userId: 'u-3' };
const WRONG_PROVIDER_CRED: EspnCred = { provider: 'espn', swid: '{ABC}', espnS2: 'x' };

beforeEach(() => {
  __resetPlayerPoolCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveUser', () => {
  it('resolves a username/id to Sleeper identity fields', async () => {
    installFetchMock();
    await expect(resolveUser('u-3')).resolves.toEqual({
      userId: 'u-3',
      username: 'coach_hodgetwins',
      displayName: 'CoachH',
    });
  });
});

describe('sleeperAdapter.listLeagues', () => {
  it('maps raw leagues to LeagueRef, status passed through verbatim', async () => {
    installFetchMock();
    const leagues = await sleeperAdapter.listLeagues(CRED, '2026');

    expect(leagues).toHaveLength(3);
    expect(leagues[0]).toEqual({
      provider: 'sleeper',
      leagueId: 'raw-league-ppr',
      name: 'Raw Fixture League PPR',
      season: '2026',
      totalTeams: 12,
      draftId: 'raw-draft-ppr',
      status: 'drafting',
    });
    expect(leagues.map((l) => l.status)).toEqual(['drafting', 'pre_draft', 'complete']);
  });

  it('rejects a non-Sleeper credential', async () => {
    installFetchMock();
    await expect(sleeperAdapter.listLeagues(WRONG_PROVIDER_CRED as Cred, '2026')).rejects.toThrow(/espn/);
  });
});

describe('listSleeperDrafts', () => {
  it('lists a user’s drafts so mock drafts can be selected without copying an ID', async () => {
    installFetchMock();
    await expect(listSleeperDrafts(CRED, '2026')).resolves.toEqual([
      {
        draftId: 'raw-draft-ppr',
        name: 'Raw Fixture League PPR',
        season: '2026',
        totalTeams: 12,
        status: 'drafting',
        type: 'snake',
      },
    ]);
  });
});

describe('sleeperAdapter.init', () => {
  it('derives slotToTeam, myTeamId/mySlot, and league format for a PPR one-QB league', async () => {
    installFetchMock();
    const draftInit = await sleeperAdapter.init(CRED, 'raw-draft-ppr');

    expect(draftInit.teams).toBe(12);
    expect(draftInit.rounds).toBe(15);
    expect(draftInit.draftType).toBe('snake');
    expect(draftInit.slotToTeam[1]).toBe('101');
    expect(draftInit.slotToTeam[12]).toBe('112');
    expect(draftInit.mySlot).toBe(3);
    expect(draftInit.myTeamId).toBe('103');

    expect(draftInit.settings.startingSlots).toEqual([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
    ]);
    expect(draftInit.settings.rosterSlots.BN).toBe(6);
    expect(draftInit.settings.rosterSlots.RB).toBe(2);
    expect(draftInit.settings.scoring.rec).toBe(1);
    expect(draftInit.settings.format).toEqual({ reception: 'ppr', qb: 'one-qb', draft: 'snake' });
  });
});

describe('sleeperAdapter.init — standalone mock draft', () => {
  it('initializes a valid mock with league_id null without requesting /league/null', async () => {
    const mockDraft = {
      draft_id: 'mock-draft-1',
      league_id: null,
      type: 'snake',
      status: 'paused',
      season: '2026',
      metadata: { name: 'My mock', scoring_type: 'ppr' },
      settings: { teams: 10, rounds: 15, slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1, slots_flex: 2, slots_k: 1, slots_def: 1 },
      draft_order: { 'u-3': 4 },
      slot_to_roster_id: { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10 },
    };
    const fetchMock = vi.fn((input: string) => {
      const url = String(input);
      if (url === '/data/players.json') return jsonResponse(knownPlayerPool);
      if (url.endsWith('/draft/mock-draft-1')) return jsonResponse(mockDraft);
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sleeperAdapter.init(CRED, 'mock-draft-1');

    expect(result).toMatchObject({
      draftId: 'mock-draft-1',
      leagueId: 'mock:mock-draft-1',
      teams: 10,
      rounds: 15,
      mySlot: 4,
      myTeamId: '4',
      settings: {
        name: 'My mock',
        teams: 10,
        format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
      },
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(expect.stringContaining('/league/null'));
  });
});

describe('sleeperAdapter.settings — LeagueFormat derivation branches', () => {
  it('derives half-ppr / two-qb from a league with two QB starting slots', async () => {
    installFetchMock();
    const settings = await sleeperAdapter.settings(CRED, 'raw-league-half');
    expect(settings.format).toEqual({ reception: 'half-ppr', qb: 'two-qb', draft: 'snake' });
  });

  it('derives standard / superflex from a league with no rec scoring and a SUPER_FLEX slot', async () => {
    installFetchMock();
    const settings = await sleeperAdapter.settings(CRED, 'raw-league-sf');
    expect(settings.format).toEqual({ reception: 'standard', qb: 'superflex', draft: 'snake' });
  });
});

describe('sleeperAdapter.picks', () => {
  it('throws if called before init() for that draft', async () => {
    installFetchMock();
    await expect(sleeperAdapter.picks(CRED, 'never-inited-draft-xyz')).rejects.toThrow(/init/);
  });

  it('normalizes picks, computes onTheClock, and resolves to exactly one upstream GET', async () => {
    const fetchMock = installFetchMock();
    await sleeperAdapter.init(CRED, 'raw-draft-ppr');
    const callsAfterInit = fetchMock.mock.calls.length;

    const draftPicks = await sleeperAdapter.picks(CRED, 'raw-draft-ppr');

    expect(fetchMock.mock.calls.length - callsAfterInit).toBe(1);
    expect(draftPicks.status).toBe('drafting');
    expect(draftPicks.picks).toHaveLength(15);

    // round 1, pick 1: matched player
    expect(draftPicks.picks[0]).toEqual({
      overall: 1, round: 1, slot: 1, teamId: '101',
      playerId: '1001', providerPlayerId: '1001', providerPlayerName: 'Aaron Rushmore',
    });

    // DEF pick: team-abbreviation id, matched via identity (no crosswalk)
    expect(draftPicks.picks[6]).toEqual({
      overall: 7, round: 1, slot: 7, teamId: '107',
      playerId: 'SF', providerPlayerId: 'SF', providerPlayerName: 'San Francisco 49ers',
    });

    // unmatched pick: absent from known-player-pool-sample.json -> playerId null, never dropped
    expect(draftPicks.picks[11]).toEqual({
      overall: 12, round: 1, slot: 12, teamId: '112',
      playerId: null, providerPlayerId: 'unmatched-2099', providerPlayerName: 'Rookie Notyetpiped',
    });

    // round 1 -> round 2 snake reversal: slot 12 drafts picks 12 and 13 back-to-back
    expect(draftPicks.picks[12]).toMatchObject({ overall: 13, round: 2, slot: 12, teamId: '112' });

    // 15 picks made; next pick (16) is round 2, slot 9 per snake math
    expect(draftPicks.onTheClock).toEqual({ teamId: '109', slot: 9, round: 2, overall: 16 });
  });

  it('rejects a non-Sleeper credential', async () => {
    installFetchMock();
    await sleeperAdapter.init(CRED, 'raw-draft-ppr');
    await expect(sleeperAdapter.picks(WRONG_PROVIDER_CRED as Cred, 'raw-draft-ppr')).rejects.toThrow(/espn/);
  });
});

describe('sleeperAdapter.rosters', () => {
  it('joins rosters with league users for owner names', async () => {
    installFetchMock();
    const rosters = await sleeperAdapter.rosters(CRED, 'raw-league-ppr');

    expect(rosters).toHaveLength(3);
    expect(rosters[0]).toEqual({
      teamId: '101',
      ownerId: 'u-1',
      ownerName: 'Team One',
      starters: [],
      bench: ['1001'],
      ir: [],
    });
  });
});

describe('sleeperAdapter.freeAgents', () => {
  it('excludes rostered players from the known player pool', async () => {
    installFetchMock();
    const freeAgents = await sleeperAdapter.freeAgents(CRED, 'raw-league-ppr');

    expect(freeAgents).not.toContain('1001');
    expect(freeAgents).not.toContain('1002');
    expect(freeAgents).not.toContain('1003');
    expect(freeAgents).toContain('SF');
    expect(freeAgents).toHaveLength(knownPlayerPool.length - 3);
  });
});
