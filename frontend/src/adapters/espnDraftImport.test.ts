import { describe, expect, it } from 'vitest';
import type { EspnLeagueSnapshot, PlayerMeta } from '../../../shared/types';
import { buildEspnPlayerIndex } from './espn';
import { buildEspnImportedDraft, buildEspnImportedInit } from './espnDraftImport';

/** Synthetic pool with the shapes the crosswalk needs: an ids.espn skill player, a DEF resolvable
 * by proTeamId identity, and a deep player only reachable by name+position. */
const PLAYERS: PlayerMeta[] = [
  { playerId: 'cmac', name: 'Christian McCaffrey', position: 'RB', eligiblePositions: ['RB'], team: 'SF', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: { espn: '3139477' } },
  { playerId: 'BAL', name: 'Ravens D/ST', position: 'DEF', eligiblePositions: ['DEF'], team: 'BAL', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} },
  { playerId: 'deep', name: 'Deep Sleeperback', position: 'WR', eligiblePositions: ['WR'], team: null, byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {} },
];

const INDEX = buildEspnPlayerIndex(PLAYERS);

const SNAPSHOT: EspnLeagueSnapshot = {
  schemaVersion: 1,
  leagueId: '2018058011',
  season: '2026',
  name: 'LeAgUe',
  teams: 2,
  rounds: 3,
  startingSlots: ['QB', 'RB', 'FLEX'],
  rosterSlots: { QB: 1, RB: 1, FLEX: 1 },
  scoring: { rec: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
  myTeamId: null,
  teamNames: [{ id: 1, name: 'Himchan' }, { id: 2, name: 'Rival' }],
  diagnostics: [],
  capturedAt: 0,
  drafted: true,
  draftPicks: [
    { overall: 1, teamId: 2, playerId: '3139477', playerName: 'Christian McCaffrey', position: 'RB', proTeamId: 22 },
    { overall: 2, teamId: 1, playerId: '-16003', playerName: 'Ravens D/ST', position: 'DEF', proTeamId: 3 },
    { overall: 3, teamId: 2, playerId: null, playerName: 'Deep Sleeperback', position: 'WR', proTeamId: null },
    { overall: 4, teamId: 1, playerId: null, playerName: 'Total Mystery', position: null, proTeamId: null },
    { overall: 5, teamId: 2, playerId: null, playerName: 'Deep Sleeperback', position: 'WR', proTeamId: null },
    { overall: 6, teamId: 1, playerId: '999999', playerName: 'Unknown Tailback', position: 'RB', proTeamId: null },
  ],
};

describe('buildEspnImportedDraft', () => {
  it('reconstructs snake slots, rounds, and crosswalk-resolved playerIds from the captured picks', () => {
    const imported = buildEspnImportedDraft(SNAPSHOT, 1, INDEX);
    expect(imported).not.toBeNull();
    expect(imported!.picks).toHaveLength(6);
    // 2-team snake: overall 3 is round 2, slot 2 (even round reverses).
    expect(imported!.picks[2]).toMatchObject({ overall: 3, round: 2, slot: 2, teamId: '2', playerId: 'deep' });
    expect(imported!.picks[0]).toMatchObject({ overall: 1, round: 1, slot: 1, teamId: '2', playerId: 'cmac' });
    // Negative synthetic DEF id resolves through the D/ST identity tier.
    expect(imported!.picks[1]).toMatchObject({ overall: 2, round: 1, slot: 2, teamId: '1', playerId: 'BAL' });
    // Unmatched picks survive with playerId: null and the raw name retained — never dropped.
    expect(imported!.picks[3]).toMatchObject({ overall: 4, playerId: null, providerPlayerName: 'Total Mystery' });
    expect(imported!.picks[5]).toMatchObject({ overall: 6, playerId: null, providerPlayerName: 'Unknown Tailback' });
    expect(imported!.unmatchedPlayers).toBe(2);
    // Round 1 pins slotToTeam from the capture's own draft order.
    expect(imported!.slotToTeam).toEqual({ 1: '2', 2: '1' });
    // The user's team (Himchan, id 1) picked 2nd overall → slot 2.
    expect(imported!.mySlot).toBe(2);
  });

  it('builds a DraftInit whose settings come from the parsed snapshot', () => {
    const imported = buildEspnImportedDraft(SNAPSHOT, 1, INDEX)!;
    const init = buildEspnImportedInit(SNAPSHOT, 1, imported);
    expect(init).toMatchObject({
      provider: 'espn',
      draftId: 'espn-import:2018058011',
      leagueId: '2018058011',
      draftType: 'snake',
      teams: 2,
      rounds: 3,
      myTeamId: '1',
      mySlot: 2,
      slotToTeam: { 1: '2', 2: '1' },
    });
    expect(init.settings.scoring.rec).toBe(1);
  });

  it('returns null when the capture carried no picks (nothing to import, never invented)', () => {
    expect(buildEspnImportedDraft({ ...SNAPSHOT, draftPicks: undefined }, 1, INDEX)).toBeNull();
    expect(buildEspnImportedDraft({ ...SNAPSHOT, teams: 0 }, 1, INDEX)).toBeNull();
  });
});