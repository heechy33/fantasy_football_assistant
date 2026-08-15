import { describe, expect, it } from 'vitest';
import type { EspnLiveSnapshot, PlayerMeta, Position } from '../../../shared/types';
import { buildManualDraftInit } from '../components/ManualDraftSetup';
import { bridgePicksToNormalized, buildEspnPlayerIndex, mergeBridgeInit, resolveEspnPlayer } from './espn';
import { canonicalTeam, teamFromFranchiseName, teamFromProTeamId } from './espnTeams';

function player(playerId: string, name: string, position: Position | null, team: string | null, espnId?: string): PlayerMeta {
  return {
    playerId, name, position, eligiblePositions: position ? [position] : [], team,
    byeWeek: null, age: null, yearsExp: null, injuryStatus: null,
    ids: espnId ? { espn: espnId } : {},
  };
}

const PLAYERS = [
  player('1', 'Christian McCaffrey', 'RB', 'SF', '3139477'),
  player('2', 'James Cook', 'RB', 'BUF', '15847'),
  player('3', 'James Cook', 'RB', 'CHI'), // ambiguous with #2 on name+position alone
  player('WAS', 'Washington Commanders', 'DEF', 'WAS'),
  player('SF', 'San Francisco 49ers', 'DEF', 'SF'),
];

describe('espnTeams', () => {
  it('canonicalizes team aliases onto players.json keys (WSH -> WAS, JAC -> JAX)', () => {
    expect(canonicalTeam('WSH')).toBe('WAS');
    expect(canonicalTeam('JAC')).toBe('JAX');
    expect(canonicalTeam('BUF')).toBe('BUF');
    expect(canonicalTeam(null)).toBeNull();
  });

  it('maps every ESPN proTeamId to the canonical team (28 -> WAS, 25 -> SF)', () => {
    expect(teamFromProTeamId(28)).toBe('WAS');
    expect(teamFromProTeamId(25)).toBe('SF');
    expect(teamFromProTeamId(1)).toBe('ATL');
    expect(teamFromProTeamId(0)).toBeNull();
    expect(teamFromProTeamId(999)).toBeNull();
    expect(teamFromProTeamId(null)).toBeNull();
  });

  it('resolves full franchise names and short forms for the DOM cross-check', () => {
    expect(teamFromFranchiseName('Washington Commanders')).toBe('WAS');
    expect(teamFromFranchiseName('Commanders')).toBe('WAS');
    expect(teamFromFranchiseName('San Francisco 49ers')).toBe('SF');
    expect(teamFromFranchiseName('Bills')).toBe('BUF');
    expect(teamFromFranchiseName('Not a Team')).toBeNull();
    expect(teamFromFranchiseName(null)).toBeNull();
  });
});

describe('resolveEspnPlayer', () => {
  const index = buildEspnPlayerIndex(PLAYERS);

  it('resolves an ESPN player id via ids.espn', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: '3139477' })).toEqual({ playerId: '1', providerPlayerName: 'Christian McCaffrey' });
  });

  it('resolves a D/ST pick by proTeamId, never by its negative synthetic id', () => {
    const result = resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 16, proTeamId: 28 });
    expect(result.playerId).toBe('WAS');
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 16, proTeamId: 25 }).playerId).toBe('SF');
  });

  it('resolves a D/ST pick from the DOM team text (full name, short form, or alias abbreviation)', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 'DEF', teamText: 'Commanders' }).playerId).toBe('WAS');
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 'D/ST', teamText: 'WSH' }).playerId).toBe('WAS');
    expect(resolveEspnPlayer(index, { providerPlayerId: '-5000', position: 'DST', teamText: '49ers' }).playerId).toBe('SF');
  });

  it('keeps an unresolved non-DEF pick visible with its DOM name instead of dropping it', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: '-999' })).toEqual({ playerId: null, providerPlayerName: null });
    expect(resolveEspnPlayer(index, { providerPlayerId: '-999', name: 'Hollywood Brown', position: 'WR', teamText: 'PHI' }))
      .toEqual({ playerId: null, providerPlayerName: 'Hollywood Brown' });
  });

  it('resolves a unique name + position + team when the id is unknown', () => {
    expect(resolveEspnPlayer(index, { providerPlayerId: 'unknown-id', name: 'James Cook', position: 'RB', teamText: 'BUF' }).playerId).toBe('2');
  });

  it('refuses to guess when name + position is ambiguous', () => {
    // Two "James Cook" RBs on different teams, and no team signal -> null (never guess).
    expect(resolveEspnPlayer(index, { providerPlayerId: 'unknown-id', name: 'James Cook', position: 'RB' }).playerId).toBeNull();
  });
});

describe('mergeBridgeInit', () => {
  const base = buildManualDraftInit({ leagueName: 'LeAgUe', teams: 10, rounds: 14, mySlot: 2 });

  it('stamps the ESPN provider and honors JOINED/TOKEN mySlot over the form guess', () => {
    const live: EspnLiveSnapshot = { schemaVersion: 1, streamPicks: [], mySlot: 5, leagueId: '996408758', lastHeartbeatAt: 123 };
    const merged = mergeBridgeInit(base, live);
    expect(merged.provider).toBe('espn');
    expect(merged.leagueId).toBe('996408758');
    expect(merged.mySlot).toBe(5);
    expect(merged.myTeamId).toBe('5');
    expect(merged.teams).toBe(10); // settings come from the manual form, unchanged
    expect(merged.settings.scoring).toBe(base.settings.scoring);
  });

  it('keeps the form slot when the snapshot has not yet observed JOINED/TOKEN', () => {
    const merged = mergeBridgeInit(base, null);
    expect(merged.mySlot).toBe(2);
    expect(merged.myTeamId).toBe('2');
  });
});

describe('bridgePicksToNormalized', () => {
  const init = mergeBridgeInit(buildManualDraftInit({ leagueName: 'LeAgUe', teams: 10, rounds: 14, mySlot: 2 }), null);
  const index = buildEspnPlayerIndex(PLAYERS);

  it('maps streamed ESPN ids to canonical players with identity team slots', () => {
    const live: EspnLiveSnapshot = {
      schemaVersion: 1,
      streamPicks: [
        { overall: 1, slot: 1, playerId: '3139477' }, // CMC
        { overall: 2, slot: 2, playerId: '15847' }, // James Cook (BUF)
        { overall: 3, slot: 3, playerId: 'not-in-index' }, // unresolved
      ],
      mySlot: 2,
      leagueId: '996408758',
      lastHeartbeatAt: 456,
    };
    const picks = bridgePicksToNormalized(init, index, live);
    expect(picks).toHaveLength(3);
    expect(picks[0]).toMatchObject({ overall: 1, round: 1, slot: 1, teamId: '1', playerId: '1', providerPlayerId: '3139477', providerPlayerName: 'Christian McCaffrey' });
    expect(picks[1]).toMatchObject({ overall: 2, round: 1, slot: 2, teamId: '2', playerId: '2', providerPlayerName: 'James Cook' });
    // Never dropped: an unresolved id stays visible with a null canonical id.
    expect(picks[2]).toMatchObject({ overall: 3, round: 1, slot: 3, teamId: '3', playerId: null });
    expect(picks[2]?.providerPlayerName).toBeUndefined();
  });

  it('returns no picks without a live snapshot (extension missing)', () => {
    expect(bridgePicksToNormalized(init, index, null)).toEqual([]);
  });
});
