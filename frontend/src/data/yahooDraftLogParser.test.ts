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

    // Pick 6: Amon-Ra St. Brown (A. St. Brown matching)
    expect(result.picks[5]?.overall).toBe(6);
    expect(result.picks[5]?.playerId).toBe('7547');
    expect(result.picks[5]?.playerName).toBe('Amon-Ra St. Brown');
    expect(result.picks[5]?.matchedPlayer).toBeDefined();

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

  it('correctly parses user Yahoo live draft room paste with duplicate names and chat messages', () => {
    const fullPlayers: PlayerMeta[] = [
      ...SAMPLE_PLAYERS,
      meta({ playerId: '5859', name: 'A.J. Brown', position: 'WR', team: 'NE', eligiblePositions: ['WR'] }),
      meta({ playerId: '12507', name: 'Omarion Hampton', position: 'RB', team: 'LAC', eligiblePositions: ['RB'] }),
      meta({ playerId: '12527', name: 'Ashton Jeanty', position: 'RB', team: 'LV', eligiblePositions: ['RB'] }),
      meta({ playerId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF', eligiblePositions: ['QB'] }),
      meta({ playerId: '7569', name: 'Nico Collins', position: 'WR', team: 'HOU', eligiblePositions: ['WR'] }),
      meta({ playerId: '11566', name: 'Brock Bowers', position: 'TE', team: 'LV', eligiblePositions: ['TE'] }),
      meta({ playerId: '7588', name: 'Javonte Williams', position: 'RB', team: 'DAL', eligiblePositions: ['RB'] }),
      meta({ playerId: '8144', name: 'Chris Olave', position: 'WR', team: 'NO', eligiblePositions: ['WR'] }),
      meta({ playerId: '8112', name: 'Drake London', position: 'WR', team: 'ATL', eligiblePositions: ['WR'] }),
      meta({ playerId: '8150', name: 'Kyren Williams', position: 'RB', team: 'LAR', eligiblePositions: ['RB'] }),
      meta({ playerId: '13287', name: 'Jeremiyah Love', position: 'RB', team: 'ARI', eligiblePositions: ['RB'] }),
      meta({ playerId: '8132', name: 'George Pickens', position: 'WR', team: 'DAL', eligiblePositions: ['WR'] }),
      meta({ playerId: '8130', name: 'Trey McBride', position: 'TE', team: 'ARI', eligiblePositions: ['TE'] }),
      meta({ playerId: '7525', name: 'DeVonta Smith', position: 'WR', team: 'PHI', eligiblePositions: ['WR'] }),
    ];

    const userPaste = `Mark Jackson
J. Gibbs
J. Gibbs

RB
Det
Bye 6
2
Frank
B. Robinson
B. Robinson

RB
Atl
Bye 11
3
Tim
J. Chase
J. Chase
Q

WR
Cin
Bye 6
Chris
Chris
Chris joined
4
Dale
J. Taylor
J. Taylor

RB
Ind
Bye 13
5
You
P. Nacua
P. Nacua
Q

WR
LAR
Bye 11
6
Eddie
J. Smith-Njigba
J. Smith-Njigba

WR
Sea
Bye 11
7
Mike
J. Cook III
J. Cook III

RB
Buf
Bye 7
Tim
Tim
Tim joined
8
Tom
C. McCaffrey
C. McCaffrey
Q

RB
SF
Bye 8
9
Andrew
K. Walker III
K. Walker III

RB
KC
Bye 5
10
Chris
A. St. Brown
A. St. Brown

WR
Det
Bye 6
11
Chris
S. Barkley
S. Barkley

RB
Phi
Bye 10
12
Andrew
A. Brown
A. Brown

WR
NE
Bye 11
13
Tom
J. Jefferson
J. Jefferson

WR
Min
Bye 6
14
Mike
C. Lamb
C. Lamb

WR
Dal
Bye 14
15
Eddie
D. Henry
D. Henry

RB
Bal
Bye 13
Chris
Chris
Chris left
Chris
Chris
Chris joined
16
You
C. Brown
C. Brown

RB
Cin
Bye 6
Chris
Chris
Chris left
17
Dale
O. Hampton
O. Hampton

RB
LAC
Bye 7
18
Tim
A. Jeanty
A. Jeanty
Q

RB
LV
Bye 13
19
Frank
D. Achane
D. Achane

RB
Mia
Bye 6
Chris
Chris
Chris joined
20
Mark Jackson
J. Allen
J. Allen

QB
Buf
Bye 7
Tom
Tom
Tom left
21
Mark Jackson
N. Collins
N. Collins

WR
Hou
Bye 8
22
Frank
B. Bowers
B. Bowers

TE
LV
Bye 13
23
Tim
J. Williams
J. Williams

RB
Dal
Bye 14
24
Dale
C. Olave
C. Olave

WR
NO
Bye 8
25
You
D. London
D. London

WR
Atl
Bye 11
26
Eddie
K. Williams
K. Williams

RB
LAR
Bye 11
27
Mike
J. Love
J. Love
Q

RB
Ari
Bye 14
28
Tom
G. Pickens
G. Pickens

WR
Dal
Bye 14
29
Andrew
T. McBride
T. McBride

TE
Ari
Bye 14
30
Chris
D. Smith
D. Smith

WR
Phi
Bye 10`;

    const result = parseYahooDraftText(userPaste, fullPlayers, undefined, 10);

    expect(result.picks).toHaveLength(30);
    expect(result.detectedTeams).toBe(10);
    expect(result.detectedUserSlot).toBe(5);

    // Pick 1: Mark Jackson -> Gibbs
    expect(result.picks[0]?.overall).toBe(1);
    expect(result.picks[0]?.managerName).toBe('Mark Jackson');
    expect(result.picks[0]?.playerName).toBe('Jahmyr Gibbs');
    expect(result.picks[0]?.playerId).toBe('9221');

    // Pick 5: You -> Puka Nacua (slot 5)
    expect(result.picks[4]?.overall).toBe(5);
    expect(result.picks[4]?.isUserPick).toBe(true);
    expect(result.picks[4]?.playerName).toBe('Puka Nacua');
    expect(result.picks[4]?.playerId).toBe('9493');
    expect(result.picks[4]?.injury).toBe('Q');

    // Pick 10: Chris -> Amon-Ra St. Brown (matched, not unmatched!)
    expect(result.picks[9]?.overall).toBe(10);
    expect(result.picks[9]?.managerName).toBe('Chris');
    expect(result.picks[9]?.playerName).toBe('Amon-Ra St. Brown');
    expect(result.picks[9]?.playerId).toBe('7547');
    expect(result.picks[9]?.matchedPlayer).toBeDefined();

    // Pick 16: You -> Chase Brown (slot 5 in 10-team snake)
    expect(result.picks[15]?.overall).toBe(16);
    expect(result.picks[15]?.isUserPick).toBe(true);
    expect(result.picks[15]?.playerName).toBe('Chase Brown');
    expect(result.picks[15]?.playerId).toBe('9224');

    // Pick 25: You -> Drake London (slot 5 in 10-team snake)
    expect(result.picks[24]?.overall).toBe(25);
    expect(result.picks[24]?.isUserPick).toBe(true);
    expect(result.picks[24]?.playerName).toBe('Drake London');
    expect(result.picks[24]?.playerId).toBe('8112');

    // All 30 picks must be matched
    const unmatched = result.picks.filter((p) => !p.matchedPlayer);
    expect(unmatched).toHaveLength(0);

    // Team names mapping
    expect(result.slotToTeamName[1]).toBe('Mark Jackson');
    expect(result.slotToTeamName[2]).toBe('Frank');
    expect(result.slotToTeamName[3]).toBe('Tim');
    expect(result.slotToTeamName[4]).toBe('Dale');
    expect(result.slotToTeamName[5]).toBeUndefined(); // User slot
    expect(result.slotToTeamName[6]).toBe('Eddie');
    expect(result.slotToTeamName[7]).toBe('Mike');
    expect(result.slotToTeamName[8]).toBe('Tom');
    expect(result.slotToTeamName[9]).toBe('Andrew');
    expect(result.slotToTeamName[10]).toBe('Chris');
  });

  it('correctly parses user Yahoo Draft Board grid paste with reversed snake rows, on the clock, and empty cells', () => {
    const fullPlayers: PlayerMeta[] = [
      ...SAMPLE_PLAYERS,
      meta({ playerId: '12527', name: 'Ashton Jeanty', position: 'RB', team: 'LV', eligiblePositions: ['RB'] }),
    ];

    const boardPaste = `fart

Spoondog

Kai

Tiger Woods

Roy

You

Benjamin

ARMANDO

Dam

shawn
Jahmyr
Gibbs
RB
Det
1.1
Bijan
Robinson
RB
Atl
1.2
Jonathan
Taylor
RB
Ind
1.3
Ja'Marr
Chase
WR
Cin
1.4
Christian
McCaffrey
RB
SF
1.5
Puka
Nacua
WR
LAR
1.6
Jaxon
Smith-Njigba
WR
Sea
1.7
Amon-Ra
St. Brown
WR
Det
1.8
James
Cook III
RB
Buf
1.9
Saquon
Barkley
RB
Phi
1.10
2.10
2.9
On the Clock
2.8
Ashton
Jeanty
RB
LV
2.7
Justin
Jefferson
WR
Min
2.6
De'Von
Achane
RB
Mia
2.5
Derrick
Henry
RB
Bal
2.4
CeeDee
Lamb
WR
Dal
2.3
Kenneth
Walker III
RB
KC
2.2
Chase
Brown
RB
Cin
2.1
3.1
3.2
3.3
3.4
3.5
3.6
3.7
3.8
3.9
3.10
4.10
4.9
4.8
4.7
4.6
4.5
4.4
4.3
4.2.`;

    const result = parseYahooDraftText(boardPaste, fullPlayers, undefined, 10);

    expect(result.detectedTeams).toBe(10);
    expect(result.detectedUserSlot).toBe(6);

    // Slot to team mapping
    expect(result.slotToTeamName[1]).toBe('fart');
    expect(result.slotToTeamName[2]).toBe('Spoondog');
    expect(result.slotToTeamName[3]).toBe('Kai');
    expect(result.slotToTeamName[4]).toBe('Tiger Woods');
    expect(result.slotToTeamName[5]).toBe('Roy');
    expect(result.slotToTeamName[6]).toBeUndefined(); // You
    expect(result.slotToTeamName[7]).toBe('Benjamin');
    expect(result.slotToTeamName[8]).toBe('ARMANDO');
    expect(result.slotToTeamName[9]).toBe('Dam');
    expect(result.slotToTeamName[10]).toBe('shawn');

    // 17 filled picks (10 in round 1, 7 in round 2)
    expect(result.picks).toHaveLength(17);

    // Round 1 picks
    expect(result.picks[0]?.overall).toBe(1);
    expect(result.picks[0]?.managerName).toBe('fart');
    expect(result.picks[0]?.playerName).toBe('Jahmyr Gibbs');
    expect(result.picks[0]?.playerId).toBe('9221');

    expect(result.picks[1]?.overall).toBe(2);
    expect(result.picks[1]?.managerName).toBe('Spoondog');
    expect(result.picks[1]?.playerName).toBe('Bijan Robinson');

    // Pick 6: User pick (Puka Nacua)
    expect(result.picks[5]?.overall).toBe(6);
    expect(result.picks[5]?.isUserPick).toBe(true);
    expect(result.picks[5]?.managerName).toBe('You');
    expect(result.picks[5]?.playerName).toBe('Puka Nacua');

    // Pick 8: Amon-Ra St. Brown
    expect(result.picks[7]?.overall).toBe(8);
    expect(result.picks[7]?.playerName).toBe('Amon-Ra St. Brown');
    expect(result.picks[7]?.playerId).toBe('7547');

    // Pick 10: Saquon Barkley
    expect(result.picks[9]?.overall).toBe(10);
    expect(result.picks[9]?.managerName).toBe('shawn');
    expect(result.picks[9]?.playerName).toBe('Saquon Barkley');

    // Round 2 picks (sorted chronologically by overall, even though Yahoo board copies row 2 right-to-left)
    // Pick 11 (2.1): Chase Brown by shawn (slot 10)
    expect(result.picks[10]?.overall).toBe(11);
    expect(result.picks[10]?.managerName).toBe('shawn');
    expect(result.picks[10]?.playerName).toBe('Chase Brown');
    expect(result.picks[10]?.playerId).toBe('9224');

    // Pick 12 (2.2): Kenneth Walker III by Dam (slot 9)
    expect(result.picks[11]?.overall).toBe(12);
    expect(result.picks[11]?.managerName).toBe('Dam');
    expect(result.picks[11]?.playerName).toBe('Kenneth Walker');

    // Pick 13 (2.3): CeeDee Lamb by ARMANDO (slot 8)
    expect(result.picks[12]?.overall).toBe(13);
    expect(result.picks[12]?.managerName).toBe('ARMANDO');
    expect(result.picks[12]?.playerName).toBe('CeeDee Lamb');

    // Pick 14 (2.4): Derrick Henry by Benjamin (slot 7)
    expect(result.picks[13]?.overall).toBe(14);
    expect(result.picks[13]?.managerName).toBe('Benjamin');
    expect(result.picks[13]?.playerName).toBe('Derrick Henry');

    // Pick 15 (2.5): De'Von Achane by You (slot 6)
    expect(result.picks[14]?.overall).toBe(15);
    expect(result.picks[14]?.isUserPick).toBe(true);
    expect(result.picks[14]?.managerName).toBe('You');
    expect(result.picks[14]?.playerName).toBe("De'Von Achane");
    expect(result.picks[14]?.playerId).toBe('9226');

    // Pick 16 (2.6): Justin Jefferson by Roy (slot 5)
    expect(result.picks[15]?.overall).toBe(16);
    expect(result.picks[15]?.managerName).toBe('Roy');
    expect(result.picks[15]?.playerName).toBe('Justin Jefferson');

    // Pick 17 (2.7): Ashton Jeanty by Tiger Woods (slot 4)
    expect(result.picks[16]?.overall).toBe(17);
    expect(result.picks[16]?.managerName).toBe('Tiger Woods');
    expect(result.picks[16]?.playerName).toBe('Ashton Jeanty');
    expect(result.picks[16]?.playerId).toBe('12527');

    // All 17 picks matched
    const unmatched = result.picks.filter((p) => !p.matchedPlayer);
    expect(unmatched).toHaveLength(0);
  });
});
