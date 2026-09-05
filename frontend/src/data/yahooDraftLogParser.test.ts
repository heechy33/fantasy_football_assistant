import { describe, expect, it } from 'vitest';
import type { PlayerMeta, Position } from '../../../shared/types';
import { parseYahooDraftText } from './yahooDraftLogParser';
import { loadAllIdpPlayers } from './idpProjections';

function meta(p: { playerId: string; name: string; position: Position; team: string; eligiblePositions: Position[] }): PlayerMeta {
  return {
    byeWeek: 7,
    age: 24,
    yearsExp: 2,
    injuryStatus: null,
    ids: {},
    ...p,
  };
}

const SAMPLE_PLAYERS: PlayerMeta[] = [
  meta({ playerId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', eligiblePositions: ['RB'] }),
  meta({ playerId: '9509', name: 'Bijan Robinson', position: 'RB', team: 'ATL', eligiblePositions: ['RB'] }),
  meta({ playerId: '8154', name: 'Brian Robinson', position: 'RB', team: 'WAS', eligiblePositions: ['RB'] }),
  meta({ playerId: '7564', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', eligiblePositions: ['WR'] }),
  meta({ playerId: '9493', name: 'Puka Nacua', position: 'WR', team: 'LAR', eligiblePositions: ['WR'] }),
  meta({ playerId: '6813', name: 'Jonathan Taylor', position: 'RB', team: 'IND', eligiblePositions: ['RB'] }),
  meta({ playerId: '7547', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', eligiblePositions: ['WR'] }),
  meta({ playerId: '4034', name: 'Christian McCaffrey', position: 'RB', team: 'SF', eligiblePositions: ['RB'] }),
  meta({ playerId: '9488', name: 'Jaxon Smith-Njigba', position: 'WR', team: 'SEA', eligiblePositions: ['WR'] }),
  meta({ playerId: '8138', name: 'James Cook', position: 'RB', team: 'BUF', eligiblePositions: ['RB'] }),
  meta({ playerId: '4866', name: 'Saquon Barkley', position: 'RB', team: 'PHI', eligiblePositions: ['RB'] }),
  meta({ playerId: '3198', name: 'Derrick Henry', position: 'RB', team: 'BAL', eligiblePositions: ['RB'] }),
  meta({ playerId: '6786', name: 'CeeDee Lamb', position: 'WR', team: 'DAL', eligiblePositions: ['WR'] }),
  meta({ playerId: '9226', name: "De'Von Achane", position: 'RB', team: 'MIA', eligiblePositions: ['RB'] }),
  meta({ playerId: '8151', name: 'Kenneth Walker', position: 'RB', team: 'KC', eligiblePositions: ['RB'] }),
  meta({ playerId: '6794', name: 'Justin Jefferson', position: 'WR', team: 'MIN', eligiblePositions: ['WR'] }),
  meta({ playerId: '9224', name: 'Chase Brown', position: 'RB', team: 'CIN', eligiblePositions: ['RB'] }),
];

const RAW_YAHOO_SAMPLE = `Nikolas LeBlanc
J. Gibbs

RB
Det
Bye 6
Scottie MackScottie Mack left
2
Gabe
B. Robinson

RB
Atl
Bye 11
3
matteo
J. Chase
Q

WR
Cin
Bye 6
4
Scottie Mack
P. Nacua
Q

WR
LAR
Bye 11
ScottScott joined
Scottie MackScottie Mack joined
5
Chris
J. Taylor

RB
Ind
Bye 13
6
Garcia-Mar
A. St. Brown

WR
Det
Bye 6
7
Tyler
C. McCaffrey
Q

RB
SF
Bye 8
8
You
J. Smith-Njigba

WR
Sea
Bye 11
9
Mark
J. Cook III

RB
Buf
Bye 7
10
Scott
S. Barkley

RB
Phi
Bye 10
11
Scott
D. Henry

RB
Bal
Bye 13
12
Mark
C. Lamb

WR
Dal
Bye 14
13
You
D. Achane

RB
Mia
Bye 6
14
Tyler
K. Walker III

RB
KC
Bye 5
15
Garcia-Mar
J. Jefferson

WR
Min
Bye 6
16
Chris
C. Brown

RB
Cin
Bye 6`;

describe('yahooDraftLogParser', () => {
  it('correctly parses all 16 sample picks and matches canonical players', () => {
    const idp = loadAllIdpPlayers();
    const result = parseYahooDraftText(RAW_YAHOO_SAMPLE, SAMPLE_PLAYERS, idp, 10);

    expect(result.picks).toHaveLength(16);

    // Pick 1: Gibbs
    expect(result.picks[0]?.overall).toBe(1);
    expect(result.picks[0]?.managerName).toBe('Nikolas LeBlanc');
    expect(result.picks[0]?.playerId).toBe('9221');
    expect(result.picks[0]?.playerName).toBe('Jahmyr Gibbs');
    expect(result.picks[0]?.nflTeam).toBe('Det');
    expect(result.picks[0]?.byeWeek).toBe(6);

    // Pick 2: Bijan Robinson (disambiguated by Atl team against Brian Robinson)
    expect(result.picks[1]?.overall).toBe(2);
    expect(result.picks[1]?.managerName).toBe('Gabe');
    expect(result.picks[1]?.playerId).toBe('9509');
    expect(result.picks[1]?.playerName).toBe('Bijan Robinson');

    // Pick 3: Ja'Marr Chase with Q injury tag
    expect(result.picks[2]?.overall).toBe(3);
    expect(result.picks[2]?.managerName).toBe('matteo');
    expect(result.picks[2]?.playerId).toBe('7564');
    expect(result.picks[2]?.injury).toBe('Q');

    // Pick 4: Puka Nacua with Q injury tag and chat noise following
    expect(result.picks[3]?.overall).toBe(4);
    expect(result.picks[3]?.managerName).toBe('Scottie Mack');
    expect(result.picks[3]?.playerId).toBe('9493');

    // Pick 8: You (user pick)
    expect(result.picks[7]?.overall).toBe(8);
    expect(result.picks[7]?.isUserPick).toBe(true);
    expect(result.picks[7]?.playerId).toBe('9488');
    expect(result.detectedUserSlot).toBe(8);

    // Pick 9: James Cook III (suffix stripping)
    expect(result.picks[8]?.overall).toBe(9);
    expect(result.picks[8]?.playerId).toBe('8138');

    // Pick 13: You (second round user pick, slot 8 in snake 10-team = pick 13)
    expect(result.picks[12]?.overall).toBe(13);
    expect(result.picks[12]?.isUserPick).toBe(true);
    expect(result.picks[12]?.playerId).toBe('9226');

    // Pick 16: Chase Brown
    expect(result.picks[15]?.overall).toBe(16);
    expect(result.picks[15]?.playerId).toBe('9224');

    // Manager names mapping
    expect(result.slotToTeamName[1]).toBe('Nikolas LeBlanc');
    expect(result.slotToTeamName[2]).toBe('Gabe');
    expect(result.slotToTeamName[3]).toBe('matteo');
    expect(result.slotToTeamName[4]).toBe('Scottie Mack');
    expect(result.slotToTeamName[5]).toBe('Chris');
    expect(result.slotToTeamName[6]).toBe('Garcia-Mar');
    expect(result.slotToTeamName[7]).toBe('Tyler');
    expect(result.slotToTeamName[9]).toBe('Mark');
    expect(result.slotToTeamName[10]).toBe('Scott');
  });

  it('matches IDP picks against idpProjections dataset when not in offensive pool', () => {
    const idpText = `17
Scott
J. Brooks

LB
MIA
Bye 6
18
Mark
B. Baker

DB
ARI
Bye 14`;

    const idp = loadAllIdpPlayers();
    const result = parseYahooDraftText(idpText, SAMPLE_PLAYERS, idp, 10);

    expect(result.picks).toHaveLength(2);
    expect(result.picks[0]?.overall).toBe(17);
    expect(result.picks[0]?.playerName).toBe('Jordyn Brooks');
    expect(result.picks[0]?.matchedIdp?.pos).toBe('LB');
    expect(result.picks[0]?.playerId).toBeNull(); // IDP uses null playerId

    expect(result.picks[1]?.overall).toBe(18);
    expect(result.picks[1]?.playerName).toBe('Budda Baker');
    expect(result.picks[1]?.matchedIdp?.pos).toBe('DB');
  });
});
