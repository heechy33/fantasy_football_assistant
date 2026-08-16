import { describe, expect, it } from 'vitest';
import { parseEspnDomPickRow } from './espnDom';

type KickerRow = readonly [text: string, pickNumber: number, name: string, team: string, position: string, fantasyTeam: string];

// Picks 136–140 are all kickers in the recon frame stream. "140" is the verbatim recon row; 136–139
// follow the exact same shape established by that row.
const KICKER_ROWS: readonly KickerRow[] = [
  ['136Cameron DickerLACKMy Squad137137.2undo', 136, 'Cameron Dicker', 'LAC', 'K', 'My Squad'],
  ["137Ka'imi FairbairnHOUKTeam Two138138.2undo", 137, "Ka'imi Fairbairn", 'HOU', 'K', 'Team Two'],
  ['138Chris BoswellPITKTeam Three139139.2undo', 138, 'Chris Boswell', 'PIT', 'K', 'Team Three'],
  ['139Brandon AubreyDALKTeam Four140140.2undo', 139, 'Brandon Aubrey', 'DAL', 'K', 'Team Four'],
];

describe('parseEspnDomPickRow', () => {
  it('parses the verbatim recon kicker row (pick 140)', () => {
    expect(parseEspnDomPickRow("140Jake BatesDETKKoston's Top-Notch Team141141.2undo", 140)).toEqual({
      pickNumber: 140,
      name: 'Jake Bates',
      teamAbbrev: 'DET',
      position: 'K',
      fantasyTeamName: "Koston's Top-Notch Team",
    });
  });

  it.each(KICKER_ROWS)('parses kicker rows of the recon shape (%s)', (text, pickNumber, name, team, position, fantasyTeam) => {
    expect(parseEspnDomPickRow(text, pickNumber)).toEqual({ pickNumber, name, teamAbbrev: team, position, fantasyTeamName: fantasyTeam });
  });

  it('parses a synthetic D/ST row (full franchise name + D/ST token)', () => {
    expect(parseEspnDomPickRow('61Buffalo Bills D/STBUFD/STMy Squad141141.2undo', 61)).toEqual({
      pickNumber: 61,
      name: 'Buffalo Bills D/ST',
      teamAbbrev: 'BUF',
      position: 'D/ST',
      fantasyTeamName: 'My Squad',
    });
  });

  it('anchors on an alias abbreviation (WSH) before a position token', () => {
    expect(parseEspnDomPickRow("33Jayden DanielsWSHQBKoston's Top-Notch Team3434.2undo", 33)).toEqual({
      pickNumber: 33,
      name: 'Jayden Daniels',
      teamAbbrev: 'WSH',
      position: 'QB',
      fantasyTeamName: "Koston's Top-Notch Team",
    });
  });

  // D3 regression: a player name that itself starts with digits ("49ers") must not be mistaken
  // for more of the pick number. `pickNumber` is the caller-supplied authoritative value (the
  // extension's data-pick-number attribute), not inferred from the text's leading digits.
  it('does not consume a digit-leading name as part of the pick number (49ers D/ST)', () => {
    expect(parseEspnDomPickRow('15249ers D/STSFD/STMy Squad153153.2undo', 152)).toEqual({
      pickNumber: 152,
      name: '49ers D/ST',
      teamAbbrev: 'SF',
      position: 'D/ST',
      fantasyTeamName: 'My Squad',
    });
  });

  it('returns null when the text does not start with the given pick number', () => {
    expect(parseEspnDomPickRow("140Jake BatesDETKKoston's Top-Notch Team141141.2undo", 141)).toBeNull();
  });

  it('returns null with no text, no pick number, or a non-finite pick number', () => {
    expect(parseEspnDomPickRow('Jake BatesDETKKoston', 140)).toBeNull();
    expect(parseEspnDomPickRow('', 140)).toBeNull();
    expect(parseEspnDomPickRow(null, 140)).toBeNull();
    expect(parseEspnDomPickRow('   ', 140)).toBeNull();
    expect(parseEspnDomPickRow("140Jake BatesDETKKoston's Top-Notch Team141141.2undo", null)).toBeNull();
    expect(parseEspnDomPickRow("140Jake BatesDETKKoston's Top-Notch Team141141.2undo", NaN)).toBeNull();
  });

  it('returns null when no team abbreviation is immediately followed by a position token', () => {
    expect(parseEspnDomPickRow("140Jake BatesKoston's Top-Notch Team141141.2undo", 140)).toBeNull();
  });
});
