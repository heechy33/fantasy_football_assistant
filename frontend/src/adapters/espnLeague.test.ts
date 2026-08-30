import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { espnLeagueToSettings, parseEspnLeagueJson } from './espnLeague';

/**
 * Runs against the committed fixture in fixtures/espn-contract/ — the same contract file the
 * parser must survive a fresh checkout with. The 2026-08-27 fixture is a documented-shape
 * SYNTHETIC stand-in pending the real extension recon slice; when a real capture replaces it,
 * these assertions are the regression gate for the real payload.
 */
const FIXTURE_PATH = join(__dirname, '../../..', 'fixtures/espn-contract/league-2026-08-27.json');

async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
}

describe('parseEspnLeagueJson (fixture)', () => {
  it('parses the real settings shape: identity, teams, rounds, slots, scoring, format', async () => {
    const snapshot = parseEspnLeagueJson(await loadFixture());
    expect(snapshot).not.toBeNull();
    expect(snapshot!.leagueId).toBe('983371779');
    expect(snapshot!.season).toBe('2026');
    expect(snapshot!.name).toBe('Gridiron Gurus League');
    expect(snapshot!.teams).toBe(10);
    expect(snapshot!.rounds).toBe(14);
    // Position slots first (QB, RB, RB, WR, WR, TE), then FLEX, then K/DEF.
    expect(snapshot!.startingSlots).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']);
    expect(snapshot!.rosterSlots).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 5, IR: 1 });
    // Sleeper vocabulary, translated — never raw ESPN statIds.
    expect(snapshot!.scoring).toEqual({ pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 });
    expect(snapshot!.format).toEqual({ reception: 'ppr', qb: 'one-qb', draft: 'snake' });
    // statId 55 (and the rest of ESPN's untranslated catalog) is summarized, never dropped.
    expect(snapshot!.diagnostics).toContain('1 ESPN scoring statIds carried non-zero points but have no Sleeper equivalent -- long-TD and yardage-game bonus categories the recommendation engine does not model (statIds: 55). All core fantasy categories are captured.');
    // Structured companion for the confirm card's per-bonus tags: statId 55 carried 2 points.
    expect(snapshot!.unmodeledScoringItems).toEqual([{ statId: 55, points: 2 }]);
    // Read from draftDetail, not derived.
    expect(snapshot!.roundsDerived).toBeFalsy();
    // Scraped team names feed the confirm card's "which team is yours?" dropdown.
    expect(snapshot!.teamNames).toEqual([
      { id: 1, name: 'Gridiron Gurus' },
      { id: 2, name: 'Two Minute Drill' },
      { id: 3, name: 'Three And Out' },
      { id: 4, name: 'Four Corners' },
      { id: 5, name: 'Five Yard Infraction' },
      { id: 6, name: 'Six Shooter' },
      { id: 7, name: 'Seven Blockers' },
      { id: 8, name: 'Eight Men in the Box' },
      { id: 9, name: 'Nine Routes' },
      { id: 10, name: 'Ten Yard Penalty' },
    ]);
  });

  it('carries the captured views and prefers a direct team `name` over location+nickname', async () => {
    const snapshot = parseEspnLeagueJson(
      {
        id: 42,
        seasonId: 2026,
        settings: { name: 'V', scoringSettings: { scoringItems: [{ statId: 3, points: 0.04 }] } },
        teams: [{ id: 1, name: 'Direct Name', location: 'Ignored', nickname: 'Fallback' }],
      },
      ['mSettings', 'mTeam', 'mSettings'],
    )!;
    expect(snapshot.views).toEqual(['mSettings', 'mTeam']);
    expect(snapshot.teamNames).toEqual([{ id: 1, name: 'Direct Name' }]);
    // With draftDetail absent, rounds DERIVE from roster size — but there are no slot counts at
    // all here, so it stays null and the gap is named.
    expect(snapshot.rounds).toBeNull();
  });

  it('translates the parsed snapshot into a LeagueSettings at the adapter boundary', async () => {
    const snapshot = parseEspnLeagueJson(await loadFixture())!;
    const settings = espnLeagueToSettings(snapshot);
    expect(settings.provider).toBe('espn');
    expect(settings.leagueId).toBe('983371779');
    expect(settings.name).toBe('Gridiron Gurus League');
    expect(settings.teams).toBe(10);
    expect(settings.format.reception).toBe('ppr');
  });
});

describe('parseEspnLeagueJson (partial/truncated payloads surface diagnostics, not confident wrongness)', () => {
  it('returns null for a non-league payload instead of inventing a leagueId', () => {
    expect(parseEspnLeagueJson(null)).toBeNull();
    expect(parseEspnLeagueJson('nope')).toBeNull();
    expect(parseEspnLeagueJson({ settings: { name: 'x' } })).toBeNull();
  });

  it('parses a truncated capture (no draftDetail, no scoringItems) with explicit gaps; rounds derive from roster size', () => {
    const snapshot = parseEspnLeagueJson({
      id: 123456,
      seasonId: 2026,
      settings: { name: 'Half captured', rosterSettings: { lineupSlotCounts: { '0': 1, '42': 2 } } },
    });
    expect(snapshot).not.toBeNull();
    // A snake draft picks once per roster spot: 1 QB + 2 unknown slots = 3 spots → 3 rounds,
    // honestly labeled as derived, never laundered as a mDraftDetail read.
    expect(snapshot!.rounds).toBe(3);
    expect(snapshot!.roundsDerived).toBe(true);
    expect(snapshot!.teams).toBe(0);
    expect(snapshot!.startingSlots).toEqual(['QB']);
    expect(snapshot!.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('Rounds derived from the roster size'),
      'Team count not found in the captured league JSON.',
      'Scoring items not found in the captured league JSON — open your league\'s League Settings page, then reconnect.',
      'Unmapped ESPN lineup-slot id: 42.',
    ]));
  });

  it('reports an unmapped slot id once even when repeated across counts', () => {
    // Built via JSON.parse to avoid a duplicate-key literal in source.
    const payload = JSON.parse('{"id":1,"settings":{"name":"x","rosterSettings":{"lineupSlotCounts":{"42":1,"42":2,"0":1}}},"teams":[]}');
    const snapshot = parseEspnLeagueJson(payload)!;
    const slotDiagnostics = snapshot!.diagnostics.filter((d) => d.startsWith('Unmapped ESPN lineup-slot id'));
    expect(slotDiagnostics).toEqual(['Unmapped ESPN lineup-slot id: 42.']);
  });

  it('does not let a truncated payload launder a fake team count or scoring map', () => {
    const snapshot = parseEspnLeagueJson({ id: 2, settings: { name: 'x' } })!;
    expect(snapshot.teams).toBe(0);
    expect(snapshot.scoring).toEqual({});
    expect(snapshot.startingSlots).toEqual([]);
    expect(snapshot.rounds).toBeNull();
    expect(snapshot.diagnostics.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts the legacy flat settings.scoringItems path as well as scoringSettings.scoringItems', () => {
    const snapshot = parseEspnLeagueJson({
      id: 9,
      seasonId: 2026,
      settings: { name: 'Flat', scoringItems: [{ statId: 4, points: 5 }] },
    })!;
    expect(snapshot.scoring).toEqual({ pass_td: 5 });
  });

  it('does not report 0-point unmapped statIds — they cannot change the scoring map', () => {
    // A standard-league settings payload lists ESPN's FULL catalog, most at 0 points
    // (2026-08-27 real capture: 51 statIds, ~44 of them zero-valued). Only non-zero
    // unmapped ids are a real parse gap worth a diagnostic.
    const snapshot = parseEspnLeagueJson({
      id: 11,
      seasonId: 2026,
      settings: {
        name: 'Standard',
        scoringSettings: {
          scoringItems: [
            { statId: 3, points: 0.04 },
            { statId: 19, points: 0 },
            { statId: 20, points: 0 },
            { statId: 25, points: 0 },
            { statId: 26, points: 0 },
            { statId: 35, points: 0 },
            { statId: 36, points: 0 },
            { statId: 37, points: 0 },
            { statId: 38, points: 0 },
            { statId: 55, points: 2 }, // unmapped AND non-zero — the real gap
          ],
        },
      },
    })!;
    expect(snapshot.scoring).toEqual({ pass_yd: 0.04 });
    expect(snapshot.diagnostics).toContain('1 ESPN scoring statIds carried non-zero points but have no Sleeper equivalent -- long-TD and yardage-game bonus categories the recommendation engine does not model (statIds: 55). All core fantasy categories are captured.');
  });

  it('merges duplicate unmapped statIds (summing points) and sorts the tag list', () => {
    // A repeated statId adds its points in the scoring map, so the tag list must match — one
    // merged chip per id, ascending, never duplicate React keys.
    const snapshot = parseEspnLeagueJson({
      id: 14,
      seasonId: 2026,
      settings: {
        name: 'Dupes',
        scoringSettings: {
          scoringItems: [
            { statId: 46, points: 2 },
            { statId: 35, points: 1 },
            { statId: 46, points: 1 },
            { statId: 3, points: 0.04 },
          ],
        },
      },
    })!;
    expect(snapshot.scoring).toEqual({ pass_yd: 0.04 });
    expect(snapshot.unmodeledScoringItems).toEqual([
      { statId: 35, points: 1 },
      { statId: 46, points: 3 },
    ]);
  });

  it('reads rounds from settings.draftSettings.rounds when no draftDetail view was captured', () => {
    const snapshot = parseEspnLeagueJson({
      id: 12,
      seasonId: 2026,
      settings: {
        name: 'mSettings only',
        draftSettings: { rounds: 15, type: 'SNAKE' },
        rosterSettings: { lineupSlotCounts: { '0': 1 } },
      },
    })!;
    expect(snapshot.rounds).toBe(15);
    expect(snapshot.roundsDerived).toBe(false);
    expect(snapshot.diagnostics.filter((d) => d.startsWith('Rounds'))).toEqual([]);
  });

  it('surfaces a known-failed draft-detail fetch as an explicit diagnostic on a derived-rounds snapshot', () => {
    const payload = {
      id: 13,
      seasonId: 2026,
      settings: { name: 'no draft detail', rosterSettings: { lineupSlotCounts: { '0': 1, '2': 2, '20': 2 } } },
      teams: [{ id: 1, name: 'A' }],
    };
    // Without the status flag: the plain derived message only.
    const plain = parseEspnLeagueJson(payload)!;
    expect(plain.roundsDerived).toBe(true);
    expect(plain.diagnostics.some((d) => d.includes('automatic draft-detail fetch failed'))).toBe(false);
    // With 'failed': the connect card names the failure instead of only the manual fallback.
    const failed = parseEspnLeagueJson(payload, undefined, 'failed')!;
    expect(failed.roundsDerived).toBe(true);
    expect(failed.diagnostics.some((d) => d.includes('automatic draft-detail fetch failed'))).toBe(true);
    // A successful fetch clears the status — no diagnostic either way.
    const ok = parseEspnLeagueJson({ ...payload, draftDetail: { rounds: 5 } }, undefined, 'ok')!;
    expect(ok.rounds).toBe(5);
    expect(ok.roundsDerived).toBe(false);
    expect(ok.diagnostics.some((d) => d.includes('automatic draft-detail fetch failed'))).toBe(false);
  });

  it('reads rounds from numeric-string rounds and a populated order array (real-payload shapes)', () => {
    const base = { id: 14, seasonId: 2026, settings: { name: 'string rounds' } };
    // A numeric string parses — the provisional number-only read rejected it.
    expect(parseEspnLeagueJson({ ...base, draftDetail: { rounds: '15' } })!.rounds).toBe(15);
    // No rounds field: a populated order array (one entry per round) is authoritative.
    const order = Array.from({ length: 14 }, (_, i) => ({ round: i + 1 }));
    expect(parseEspnLeagueJson({ ...base, draftDetail: { order } })!.rounds).toBe(14);
    // Garbage stays null → derivation fallback still runs.
    expect(parseEspnLeagueJson({ ...base, draftDetail: { rounds: 'abc' } })!.rounds).toBeNull();
    // Rounds read through draftDetailRounds also apply to settings.draftSettings / draft paths.
    expect(parseEspnLeagueJson({ ...base, settings: { name: 's', draftSettings: { rounds: '16' } } })!.rounds).toBe(16);
  });

  it('reads rounds from draftDetail.picks.length / teams (the real 2026 API shape)', () => {
    // Recon 2026-08-28, league 2018058011: draftDetail is [completeDate, drafted, inProgress,
    // picks] — no `rounds` field. 140 picks / 10 teams = 14 rounds (NOT the derived 15, which
    // wrongly counted the undrafted IR slot).
    const picks = Array.from({ length: 140 }, (_, i) => ({ overallPickNumber: i + 1 }));
    const snapshot = parseEspnLeagueJson({
      id: 2018058011,
      seasonId: 2026,
      settings: { name: 'real shape', rosterSettings: { lineupSlotCounts: { '0': 1, '2': 2, '4': 2, '6': 1, '23': 1, '17': 1, '16': 1, '20': 5, '21': 1 } } },
      teams: [{ id: 1, name: 'Himchan' }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }],
      draftDetail: { drafted: true, inProgress: false, picks },
    })!;
    expect(snapshot.rounds).toBe(14);
    expect(snapshot.roundsDerived).toBe(false);
    expect(snapshot.diagnostics.filter((d) => d.startsWith('Rounds'))).toEqual([]);
    // A remainder (partial capture) must NOT be divided into a confident wrong read.
    const partial = parseEspnLeagueJson({ id: 12, seasonId: 2026, settings: { name: 'partial' }, teams: [{ id: 1 }, { id: 2 }], draftDetail: { picks: picks.slice(0, 7) } })!;
    expect(partial.rounds).toBeNull();
  });

  it('carries draftDetail.picks forward as draftPicks + drafted for the import path', () => {
    const snapshot = parseEspnLeagueJson({
      id: 15,
      seasonId: 2026,
      settings: { name: 'with picks' },
      teams: [{ id: 1, name: 'Himchan' }],
      draftDetail: {
        drafted: true,
        inProgress: false,
        picks: [
          { pickNumber: 1, teamId: 1, playerId: '3139477', player: { fullName: 'Christian McCaffrey', defaultPositionId: 2, proTeamId: 22 } },
          { overallPickNumber: 2, teamId: 2, player: { id: '-16003', displayName: 'Ravens D/ST', defaultPositionId: 16, proTeamId: 3 } },
          { teamId: 2, player: { fullName: 'No Pick Number' } }, // no overall — skipped, never guessed
        ],
      },
    })!;
    expect(snapshot.drafted).toBe(true);
    expect(snapshot.draftPicks).toHaveLength(2);
    expect(snapshot.draftPicks![0]).toEqual({ overall: 1, teamId: 1, playerId: '3139477', playerName: 'Christian McCaffrey', position: 'RB', proTeamId: 22 });
    expect(snapshot.draftPicks![1]).toEqual({ overall: 2, teamId: 2, playerId: '-16003', playerName: 'Ravens D/ST', position: 'DEF', proTeamId: 3 });
    // No picks in the capture: drafted may still read, draftPicks stays absent.
    const bare = parseEspnLeagueJson({ id: 16, seasonId: 2026, settings: { name: 'bare' }, draftDetail: { drafted: false } })!;
    expect(bare.drafted).toBe(false);
    expect(bare.draftPicks).toBeUndefined();
  });
});