import { describe, expect, it } from 'vitest';
import type { AdpEntry, LeagueSettings, Pick, PlayerMeta, Position, SeasonProjection } from '../../../shared/types';
import { buildRecommendationBoard, selectCandidates } from './recommend';

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
/** Enough depth that limit: 5 and limit: 3 can fail if slice/limit is ignored. */
const PLAYERS_PER_POSITION = 6;
const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'position-board', name: 'Position board', season: '2026', teams: 1,
  startingSlots: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1, BN: 4 },
  scoring: { bonus: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function player(playerId: string, position: Position): PlayerMeta {
  return {
    playerId, name: playerId, position, eligiblePositions: [position], team: 'SEA',
    byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {},
  };
}

const basePoints: Record<Position, number> = { QB: 180, RB: 220, WR: 170, TE: 160, K: 100, DEF: 90 };
const players = POSITIONS.flatMap((position) => (
  Array.from({ length: PLAYERS_PER_POSITION }, (_, index) => player(position.toLowerCase() + '-' + (index + 1), position))
));
const pointsById = new Map(players.map((entry) => {
  const suffix = Number(entry.playerId.split('-')[1] ?? 1);
  return [entry.playerId, basePoints[entry.position as Position] - (suffix - 1) * 2] as const;
}));
const projections: SeasonProjection[] = players.map((entry) => ({
  playerId: entry.playerId, source: 'fftoday', stats: { bonus: pointsById.get(entry.playerId) ?? 0 },
}));
const adp: AdpEntry[] = players.filter((entry) => entry.playerId !== 'wr-3').map((entry, index) => ({
  playerId: entry.playerId, name: entry.name, position: entry.position ?? '', team: entry.team,
  adp: index + 10.25, stdev: index + 1.5, high: index + 1, low: index + 30,
  timesDrafted: index + 20, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
}));
const unmatchedPick: Pick = {
  overall: 1, round: 1, slot: 1, teamId: 'other', playerId: null, providerPlayerId: 'missing-player',
};

function board(overrides: Partial<Parameters<typeof buildRecommendationBoard>[0]> = {}) {
  return buildRecommendationBoard({
    settings, players, projections, adp, picks: [unmatchedPick], myTeamId: 'me',
    currentPick: 2, nextPick: 4, limit: 5, draftRounds: 10, rosterSpotsPerTeam: 10,
    ...overrides,
  });
}

describe('position recommendation boards', () => {
  it('derives every position view from one calculation without changing ranking', () => {
    const snapshot = board({ limit: 5, displayPosition: null, includeRecommendationViews: true });
    expect(snapshot.recommendationViews?.ALL.map((entry) => entry.playerId))
      .toEqual(snapshot.recommendations.map((entry) => entry.playerId));
    for (const position of POSITIONS) {
      const direct = board({ limit: 5, displayPosition: position });
      expect(snapshot.recommendationViews?.[position].map((entry) => entry.playerId), position)
        .toEqual(direct.recommendations.map((entry) => entry.playerId));
    }
  });

  it('filters by exact metadata position and respects caller-provided limits', () => {
    for (const position of POSITIONS) {
      const result = board({ displayPosition: position });
      expect(result.recommendations.length, position).toBe(5);
      expect(result.recommendations.every((recommendation) => (
        players.find((entry) => entry.playerId === recommendation.playerId)?.position === position
      )), position).toBe(true);
      // 6 remaining at the position → limit must truncate; ignoring slice would return 6+.
      expect(players.filter((entry) => entry.position === position)).toHaveLength(PLAYERS_PER_POSITION);
    }
    expect(board().recommendations).toHaveLength(5);
    expect(board({ displayPosition: 'K', limit: 3 }).recommendations).toHaveLength(3);
    expect(board({ displayPosition: 'DEF', limit: 3 }).recommendations).toHaveLength(3);
    expect(board({ displayPosition: 'RB', limit: 3 }).recommendations).toHaveLength(3);
  });

  it('keeps league-wide diagnostics identical while reporting the active selected set', () => {
    const all = board();
    const scoreMap = new Map(projections.map((projection) => [projection.playerId, projection.stats.bonus ?? 0]));
    for (const position of POSITIONS) {
      const filtered = board({ displayPosition: position });
      expect(filtered.diagnostics.replacementLevels).toEqual(all.diagnostics.replacementLevels);
      expect(filtered.diagnostics.positionalDemand).toEqual(all.diagnostics.positionalDemand);
      expect(filtered.diagnostics.specialTeamsDraft).toEqual(all.diagnostics.specialTeamsDraft);
      expect(filtered.diagnostics.coreStartingSlotsFilled).toBe(all.diagnostics.coreStartingSlotsFilled);
      expect(filtered.diagnostics.unmatchedPickCount).toBe(all.diagnostics.unmatchedPickCount);
      expect(filtered.diagnostics.unmatchedPickOveralls).toEqual(all.diagnostics.unmatchedPickOveralls);
      const active = players.filter((entry) => entry.position === position);
      expect(filtered.diagnostics.candidatesEvaluated).toBe(selectCandidates(active, scoreMap, 5).length);
      expect(filtered.diagnostics.candidatesEvaluated).not.toBe(all.diagnostics.candidatesEvaluated);
    }
    expect(all.diagnostics.candidatesEvaluated).toBe(selectCandidates(players, scoreMap, 5).length);
  });

  it('preserves player metrics shared by All and a position board', () => {
    const all = board();
    const sharedAll = all.recommendations.find((recommendation) => {
      const position = players.find((entry) => entry.playerId === recommendation.playerId)?.position;
      return position !== 'K' && position !== 'DEF';
    });
    expect(sharedAll).toBeDefined();
    const position = players.find((entry) => entry.playerId === sharedAll!.playerId)?.position as Position;
    const sharedPosition = board({ displayPosition: position }).recommendations.find(
      (recommendation) => recommendation.playerId === sharedAll!.playerId,
    );
    expect(sharedPosition).toBeDefined();
    const parity = (recommendation: NonNullable<typeof sharedAll>) => ({
      projectedPoints: recommendation.projectedPoints,
      marginalRosterValue: recommendation.marginalRosterValue,
      replacementAdjustedValue: recommendation.replacementAdjustedValue,
      replacementLevelPoints: recommendation.replacementLevelPoints,
      vor: recommendation.vor,
      tier: recommendation.tier,
      tierGapAfter: recommendation.tierGapAfter,
      tierBoundaryGap: recommendation.tierBoundaryGap,
      tierUrgency: recommendation.tierUrgency,
      availableNextPickProbability: recommendation.availableNextPickProbability,
      availabilityAdp: recommendation.availabilityAdp,
      availabilityAdpHigh: recommendation.availabilityAdpHigh,
      availabilityAdpLow: recommendation.availabilityAdpLow,
      availabilityStdev: recommendation.availabilityStdev,
      availabilitySampleSize: recommendation.availabilitySampleSize,
      confidence: recommendation.confidence,
      scoringDiagnosticSeverity: recommendation.scoringDiagnosticSeverity,
      missingScoringKeys: recommendation.missingScoringKeys,
    });
    expect(parity(sharedPosition!)).toEqual(parity(sharedAll!));
  });

  it('passes matched ADP bounds exactly and uses nulls for unmatched rows', () => {
    const matched = board({ displayPosition: 'RB' }).recommendations.find((entry) => entry.playerId === 'rb-1');
    const source = adp.find((entry) => entry.playerId === 'rb-1');
    expect(matched?.availabilityAdpHigh).toBe(source?.high);
    expect(matched?.availabilityAdpLow).toBe(source?.low);
    const unmatched = board({ displayPosition: 'WR' }).recommendations.find((entry) => entry.playerId === 'wr-3');
    expect(unmatched?.availabilityAdp).toBeNull();
    expect(unmatched?.availabilityAdpHigh).toBeNull();
    expect(unmatched?.availabilityAdpLow).toBeNull();
  });

  it('ranks skill boards by RAV when that diverges from projected-points order', () => {
    // Fill the RB starter with a strong player so remaining RBs only get displacement MRV, while
    // an open QB slot still awards full points-over-replacement. Points order is RB-first; RAV is QB-first.
    const skillPlayers = [
      player('qb-open', 'QB'), player('qb-backup', 'QB'),
      player('rb-owned', 'RB'), player('rb-bench', 'RB'), player('rb-alt', 'RB'),
    ];
    const skillPoints = new Map([
      ['qb-open', 80], ['qb-backup', 5],
      ['rb-owned', 180], ['rb-bench', 200], ['rb-alt', 190],
    ]);
    const skillProjections: SeasonProjection[] = skillPlayers.map((entry) => ({
      playerId: entry.playerId, source: 'fftoday', stats: { bonus: skillPoints.get(entry.playerId) ?? 0 },
    }));
    const skillSettings: LeagueSettings = {
      ...settings,
      startingSlots: ['QB', 'RB'],
      rosterSlots: { QB: 1, RB: 1, BN: 2 },
    };
    const owned: Pick[] = [
      { overall: 1, round: 1, slot: 1, teamId: 'me', playerId: 'rb-owned', providerPlayerId: 'rb-owned' },
    ];
    const input = {
      settings: skillSettings, players: skillPlayers, projections: skillProjections, adp: [],
      picks: owned, myTeamId: 'me', currentPick: 2, nextPick: 3, limit: 5, draftRounds: 4, rosterSpotsPerTeam: 4,
    };

    const all = buildRecommendationBoard(input);
    const pointsOrder = [...skillPlayers]
      .filter((entry) => entry.playerId !== 'rb-owned')
      .sort((a, b) => (skillPoints.get(b.playerId) ?? 0) - (skillPoints.get(a.playerId) ?? 0)
        || a.playerId.localeCompare(b.playerId))
      .map((entry) => entry.playerId);
    expect(pointsOrder[0]).toBe('rb-bench');
    expect(all.recommendations.map((entry) => entry.playerId)[0]).toBe('qb-open');
    expect(all.recommendations.map((entry) => entry.playerId)).not.toEqual(pointsOrder);

    const qbTab = buildRecommendationBoard({ ...input, displayPosition: 'QB' });
    expect(qbTab.recommendations.map((entry) => entry.playerId)).toEqual(['qb-open', 'qb-backup']);
    expect(qbTab.recommendations[0]!.marginalRosterValue).toBe(qbTab.recommendations[0]!.projectedPoints);
    expect(qbTab.recommendations[0]!.replacementAdjustedValue)
      .toBeGreaterThan(qbTab.recommendations[1]!.replacementAdjustedValue);

    const rbTab = buildRecommendationBoard({ ...input, displayPosition: 'RB' });
    const rbByRav = [...rbTab.recommendations].sort((a, b) => (
      b.replacementAdjustedValue - a.replacementAdjustedValue
      || b.vor - a.vor
      || b.projectedPoints - a.projectedPoints
      || a.playerId.localeCompare(b.playerId)
    ));
    expect(rbTab.recommendations.map((entry) => entry.playerId))
      .toEqual(rbByRav.map((entry) => entry.playerId));
    // MRV collapse: top remaining RB is not worth its full projected points.
    expect(rbTab.recommendations[0]!.playerId).toBe('rb-bench');
    expect(rbTab.recommendations[0]!.marginalRosterValue)
      .toBeLessThan(rbTab.recommendations[0]!.projectedPoints);
    expect(rbTab.recommendations[0]!.replacementAdjustedValue)
      .toBeLessThan(all.recommendations.find((entry) => entry.playerId === 'qb-open')!.replacementAdjustedValue);
  });

  it('exposes early, filled/unavailable, and unconfigured K/D/ST in projection order', () => {
    const expected = (position: Position, omitted: ReadonlySet<string> = new Set()) => players
      .filter((entry) => entry.position === position && !omitted.has(entry.playerId))
      .sort((a, b) => (pointsById.get(b.playerId) ?? 0) - (pointsById.get(a.playerId) ?? 0)
        || a.playerId.localeCompare(b.playerId))
      .map((entry) => entry.playerId)
      .slice(0, 5);
    expect(board({ displayPosition: 'K' }).recommendations.map((entry) => entry.playerId)).toEqual(expected('K'));
    expect(board({ displayPosition: 'DEF' }).recommendations.map((entry) => entry.playerId)).toEqual(expected('DEF'));

    const selectedIds = ['qb-1', 'rb-1', 'wr-1', 'te-1', 'k-1', 'def-1'];
    const filledPicks: Pick[] = selectedIds.map((playerId, index) => ({
      overall: index + 1, round: index + 1, slot: 1, teamId: 'me', playerId, providerPlayerId: playerId,
    }));
    const filled = board({ displayPosition: 'K', picks: filledPicks });
    expect(filled.diagnostics.specialTeamsDraft.remaining.K).toBe(0);
    expect(filled.recommendations.map((entry) => entry.playerId)).toEqual(expected('K', new Set(['k-1'])));
    expect(filled.recommendations.every((entry) => entry.deprioritized)).toBe(true);
    expect(filled.recommendations.every((entry) => (
      !entry.warnings.some((warning) => /held back|reserved for your final/i.test(warning))
    ))).toBe(true);

    const unconfiguredSettings: LeagueSettings = {
      ...settings, startingSlots: ['QB', 'RB', 'WR', 'TE'],
      rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, BN: 6 },
    };
    for (const position of ['K', 'DEF'] as const) {
      const unconfigured = board({ settings: unconfiguredSettings, displayPosition: position });
      expect(unconfigured.diagnostics.specialTeamsDraft.configured[position]).toBe(0);
      expect(unconfigured.recommendations.map((entry) => entry.playerId)).toEqual(expected(position));
      expect(unconfigured.recommendations.every((entry) => entry.deprioritized)).toBe(true);
    }
  });

  it('surfaces mid-draft K/DEF on their tabs while All omits or deprioritizes them', () => {
    expect(board().diagnostics.coreStartingSlotsFilled).toBe(false);
    // Panel-sized All board: skill demand fills the top 5, so K/DEF are omitted from display.
    const allTop = board({ limit: 5 });
    expect(allTop.recommendations.every((entry) => {
      const position = players.find((playerEntry) => playerEntry.playerId === entry.playerId)?.position;
      return position !== 'K' && position !== 'DEF';
    })).toBe(true);

    const kTab = board({ displayPosition: 'K', limit: 5 });
    const defTab = board({ displayPosition: 'DEF', limit: 5 });
    expect(kTab.recommendations.length).toBe(5);
    expect(defTab.recommendations.length).toBe(5);
    expect(kTab.recommendations.every((entry) => entry.deprioritized)).toBe(true);
    expect(defTab.recommendations.every((entry) => entry.deprioritized)).toBe(true);
    expect(kTab.recommendations.map((entry) => entry.playerId)).toEqual(
      players.filter((entry) => entry.position === 'K')
        .sort((a, b) => (pointsById.get(b.playerId) ?? 0) - (pointsById.get(a.playerId) ?? 0)
          || a.playerId.localeCompare(b.playerId))
        .slice(0, 5)
        .map((entry) => entry.playerId),
    );

    // Wider All board still keeps K/DEF behind skill players and marks them deprioritized.
    const allWide = board({ limit: 30 });
    const specialOnAll = allWide.recommendations.filter((entry) => {
      const position = players.find((playerEntry) => playerEntry.playerId === entry.playerId)?.position;
      return position === 'K' || position === 'DEF';
    });
    expect(specialOnAll.length).toBeGreaterThan(0);
    expect(specialOnAll.every((entry) => entry.deprioritized)).toBe(true);
    const firstSpecialIndex = allWide.recommendations.findIndex((entry) => {
      const position = players.find((playerEntry) => playerEntry.playerId === entry.playerId)?.position;
      return position === 'K' || position === 'DEF';
    });
    expect(firstSpecialIndex).toBeGreaterThan(3);
  });
});

describe('near-tie display context', () => {
  const tiePlayers = [
    player('rb-a', 'RB'), player('rb-b', 'RB'), player('rb-c', 'RB'),
    player('k-a', 'K'), player('k-b', 'K'), player('k-c', 'K'),
  ];
  const tiePoints = new Map([
    ['rb-a', 100], ['rb-b', 99], ['rb-c', 98.9],
    ['k-a', 200], ['k-b', 198], ['k-c', 197.9],
  ]);
  const tieProjections: SeasonProjection[] = tiePlayers.map((entry) => ({
    playerId: entry.playerId, source: 'fftoday', stats: { bonus: tiePoints.get(entry.playerId) ?? 0 },
  }));
  const tieInput = {
    settings: { ...settings, startingSlots: ['RB', 'K'], rosterSlots: { RB: 1, K: 1, BN: 3 } },
    players: tiePlayers, projections: tieProjections, adp: [], picks: [], myTeamId: 'me',
    currentPick: 1, nextPick: 2, rosterSpotsPerTeam: 5,
  } satisfies Omit<Parameters<typeof buildRecommendationBoard>[0], 'limit' | 'displayPosition'>;

  it('uses RAV for skill boards and includes the exact threshold boundary', () => {
    const result = buildRecommendationBoard({ ...tieInput, displayPosition: 'RB', limit: 3 });
    expect(result.recommendations.map((entry) => entry.playerId)).toEqual(['rb-a', 'rb-b', 'rb-c']);
    expect(Math.abs(result.recommendations[0]!.replacementAdjustedValue
      - result.recommendations[1]!.replacementAdjustedValue)).toBeCloseTo(1, 8);
    expect(result.recommendations.map((entry) => entry.nearTie)).toEqual([true, true, false]);
  });

  it('uses projected points for K/D/ST and includes the one-percent boundary', () => {
    const result = buildRecommendationBoard({ ...tieInput, displayPosition: 'K', limit: 3 });
    expect(result.recommendations.map((entry) => entry.playerId)).toEqual(['k-a', 'k-b', 'k-c']);
    expect(result.recommendations.map((entry) => entry.nearTie)).toEqual([true, true, false]);
  });

  it('bands are computed over the full priority-sorted order (not only the displayed slice), requires two band members, and does not change order', () => {
    // Bands are localized to the fixed-anchor sorted order, independent of `limit` — rb-a and rb-b
    // band together whether or not rb-b is actually displayed, so slicing to a single row still
    // surfaces rb-a's band membership.
    const one = buildRecommendationBoard({ ...tieInput, displayPosition: 'RB', limit: 1 });
    expect(one.recommendations.map((entry) => entry.playerId)).toEqual(['rb-a']);
    expect(one.recommendations.map((entry) => entry.nearTie)).toEqual([true]);
    const two = buildRecommendationBoard({ ...tieInput, displayPosition: 'RB', limit: 2 });
    expect(two.recommendations.map((entry) => entry.playerId)).toEqual(['rb-a', 'rb-b']);
    expect(two.recommendations.map((entry) => entry.nearTie)).toEqual([true, true]);
  });
});
