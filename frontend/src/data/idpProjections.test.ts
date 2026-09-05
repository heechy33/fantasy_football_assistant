import { describe, expect, it } from 'vitest';
import type { Pick } from '../../../shared/types';
import {
  getDraftedIdpNames,
  getIdpPlayerById,
  loadAllIdpPlayers,
  loadIdpPlayers,
  searchIdpPlayers,
} from './idpProjections';

describe('idpProjections', () => {
  it('loads D players with correct sorting and fields', () => {
    const dPlayers = loadIdpPlayers('D');
    expect(dPlayers.length).toBeGreaterThanOrEqual(100);

    const first = dPlayers[0]!;
    expect(first.slot).toBe('D');
    expect(first.rank).toBe(1);
    expect(first.projectedPoints).toBeGreaterThan(100);
    expect(first.name).toBe('Jordyn Brooks');
    expect(first.pos).toBe('LB');
    expect(first.team).toBe('MIA');
  });

  it('loads S players with correct sorting and fields', () => {
    const sPlayers = loadIdpPlayers('S');
    expect(sPlayers.length).toBeGreaterThanOrEqual(80);

    const first = sPlayers[0]!;
    expect(first.slot).toBe('S');
    expect(first.rank).toBe(1);
    expect(first.name).toBe('Budda Baker');
    expect(first.pos).toBe('DB');
  });

  it('correctly identifies drafted IDP players from effective picks', () => {
    const picks: Pick[] = [
      { overall: 1, round: 1, slot: 1, teamId: '1', playerId: null, providerPlayerId: '', providerPlayerName: 'Jordyn Brooks' },
      { overall: 2, round: 1, slot: 2, teamId: '2', playerId: '9221', providerPlayerId: '9221', providerPlayerName: 'Jahmyr Gibbs' },
      { overall: 3, round: 1, slot: 3, teamId: '3', playerId: null, providerPlayerId: '', providerPlayerName: 'budda baker' },
    ];

    const drafted = getDraftedIdpNames(picks);
    expect(drafted.has('jordynbrooks')).toBe(true);
    expect(drafted.has('buddabaker')).toBe(true);
    expect(drafted.has('jackcampbell')).toBe(false);
  });

  it('searches IDP players by query', () => {
    const all = loadAllIdpPlayers();
    const warner = searchIdpPlayers(all, 'Warner');
    expect(warner.length).toBeGreaterThanOrEqual(1);
    expect(warner[0]?.name).toContain('Warner');

    const bal = searchIdpPlayers(all, 'BAL');
    expect(bal.length).toBeGreaterThanOrEqual(1);
  });

  it('loads player bio, role, and weekly stats for enriched players', () => {
    const first = loadIdpPlayers('D')[0]!;
    expect(first.sleeperId).toBeDefined();
    expect(first.bio).toBeDefined();
    expect(first.bio?.age).toBeGreaterThan(20);
    expect(first.bio?.height).toBeDefined();
    expect(first.bio?.college).toBe('Texas Tech');

    // Role
    expect(first.role).toBeDefined();
    expect(first.role?.gamesPlayed).toBe(17);
    expect(first.role?.snapPct).toBeGreaterThan(80);
    expect(first.role?.tacklesPerGame).toBeGreaterThan(5);
    expect(first.role?.formRating).toBeDefined();

    // Weekly
    expect(first.weekly).toBeDefined();
    expect(first.weekly?.length).toBe(18);
    const w1 = first.weekly?.[0];
    expect(w1?.week).toBe(1);
    expect(w1?.kind).toBe('played');
    expect(w1?.opponent).toBe('@IND');
    expect(w1?.pts).toBeGreaterThan(0);
    expect(w1?.tkl).toBeGreaterThan(0);
  });

  it('finds IDP player by id or sleeperId', () => {
    const byId = getIdpPlayerById('idp-d-1');
    expect(byId).toBeDefined();
    expect(byId?.name).toBe('Jordyn Brooks');

    const bySleeper = getIdpPlayerById(byId?.sleeperId ?? '');
    expect(bySleeper).toBeDefined();
    expect(bySleeper?.id).toBe('idp-d-1');
  });
});
