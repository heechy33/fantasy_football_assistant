import { describe, expect, it } from 'vitest';
import type { PlayerMeta, PlayerUsage } from '../../../shared/types';
import {
  buildOpportunityRoleProfile,
  buildPlayerContextSignals,
  currentIssueHasPriorHistory,
  formatOpportunityDelta,
  isPlayerContextFeedReady,
  normalizeInjuryBodyPart,
  resolvePlayerContextFeedStatus,
} from './playerContext';

const player: PlayerMeta = {
  playerId: '1', name: 'Test Player', position: 'RB', eligiblePositions: ['RB'],
  team: 'BUF', byeWeek: null, age: 26, yearsExp: 4, injuryStatus: 'Questionable',
  injuryBodyPart: ' Hamstring Strain ', ids: {},
};

const usage: PlayerUsage = {
  season: 2025, usageSeasonObserved: true, snapPct: .5, targetShare: .2, carryShare: .4, gamesWithAnySnap: 14,
  recentTeam: 'BUF', teamChanged: false, knownAbsent: false, availabilityRate: 30 / 34,
  durabilityScore: null, opportunity: null,
  seasons: [
    { season: 2024, teamGamesWhileRostered: 17, gamesWithAnySnap: 16, availabilityRate: 16 / 17, injuryReportWeeks: 2, outWeeks: 1 },
    { season: 2025, teamGamesWhileRostered: 17, gamesWithAnySnap: 14, availabilityRate: 14 / 17, injuryReportWeeks: 4, outWeeks: 2 },
  ],
  injuryHistory: [{
    normalizedBodyPart: 'hamstring', episodes: 2, recurring: true,
    reports: [{ season: 2024, week: 2, labels: ['Hamstring'] }, { season: 2025, week: 8, labels: ['Hamstring Strain'] }],
  }],
};

const okSources = {
  nflverse_player_stats: { status: 'ok' as const },
  nflverse_snap_counts: { status: 'ok' as const },
  nflverse_weekly_rosters: { status: 'ok' as const },
  nflverse_injuries: { status: 'ok' as const },
};

describe('player context signals', () => {
  it('uses conservative aliases to match a current issue against history', () => {
    expect(normalizeInjuryBodyPart('HAMSTRING strain')).toBe('hamstring');
    expect(normalizeInjuryBodyPart('Thigh')).toBe('thigh');
    expect(normalizeInjuryBodyPart('Not Injury Related - Suspension')).toBeNull();
    expect(currentIssueHasPriorHistory(player, usage)).toBe(true);
  });

  it('shows auditable history signals without predictive risk labels', () => {
    const signals = buildPlayerContextSignals(player, usage);
    expect(signals).toContain('2-year availability: 88%');
    expect(signals).toContain('Recurring hamstring history');
    expect(signals).toContain('Current issue has prior history');
    expect(signals.join(' ')).not.toMatch(/low|medium|high injury risk/i);
  });

  it('labels availability with the observed season count, not a fixed 3-year window', () => {
    const threeSeasonUsage: PlayerUsage = {
      ...usage,
      seasons: [
        ...usage.seasons,
        { season: 2023, teamGamesWhileRostered: 17, gamesWithAnySnap: 15, availabilityRate: 15 / 17, injuryReportWeeks: 1, outWeeks: 0 },
      ],
      availabilityRate: 45 / 51,
    };
    expect(buildPlayerContextSignals(player, threeSeasonUsage)).toContain('3-year availability: 88%');
  });

  it('marks fewer than two observed seasons as limited history', () => {
    expect(buildPlayerContextSignals(player, undefined)).toEqual(['Limited history']);
  });

  it('treats loading and fetch errors as not-ready so cards do not flash Limited history', () => {
    expect(isPlayerContextFeedReady(okSources, 'loading')).toBe(false);
    expect(isPlayerContextFeedReady(okSources, 'error')).toBe(false);
    expect(isPlayerContextFeedReady(okSources, 'ready')).toBe(true);
    expect(resolvePlayerContextFeedStatus(okSources, 'loading')).toBe('loading');
    expect(resolvePlayerContextFeedStatus(okSources, 'error')).toBe('unavailable');
    expect(resolvePlayerContextFeedStatus({
      ...okSources,
      nflverse_injuries: { status: 'error' as const },
    }, 'ready')).toBe('unavailable');
    expect(resolvePlayerContextFeedStatus(okSources, 'ready')).toBe('ready');
  });

  it('formats count deltas and share deltas distinctly', () => {
    expect(formatOpportunityDelta(3.04)).toBe('+3.0');
    expect(formatOpportunityDelta(-0.0754, 'share')).toBe('-7.5 pp');
    expect(formatOpportunityDelta(0.019, 'share')).toBe('+1.9 pp');
    expect(formatOpportunityDelta(null, 'share')).toBe('n/a');
  });

  it('builds qualitative opportunity roles from direct volume and quality metrics', () => {
    const profile = buildOpportunityRoleProfile({ ...player, position: 'RB' }, {
      season: 2025, games: 10, targets: 40, carries: 180, touches: 220,
      targetsPerGame: 4, carriesPerGame: 18, touchesPerGame: 22,
      targetShare: .2, carryShare: .58, airYards: 100, airYardsPerGame: 10,
      airYardsShare: .25, receivingYardsAfterCatch: 180,
      redZoneTargets: 12, endZoneTargets: 3, goalLineCarries: 8, snapPct: .72,
    });
    expect(profile.map(item => item.label)).toEqual(['Volume', 'Receiving role', 'Goal-line role', 'Big-play role']);
    expect(profile[0]!.rating).toBe('Elite');
    expect(profile[1]!.basis).toContain('target share');
    expect(profile[2]!.basis).toContain('8 carries');
    expect(profile[3]!.rating).toBe('Strong');
  });

  it('omits goal-line role for non-RB positions', () => {
    const profile = buildOpportunityRoleProfile({ ...player, position: 'WR' }, {
      season: 2025, games: 10, targets: 90, carries: 0, touches: 90,
      targetsPerGame: 9, carriesPerGame: 0, touchesPerGame: 9,
      targetShare: .28, carryShare: 0, airYards: 900, airYardsPerGame: 90,
      airYardsShare: .32, receivingYardsAfterCatch: 300,
      redZoneTargets: 12, endZoneTargets: 4, goalLineCarries: 0, snapPct: .8,
    });
    expect(profile.map(item => item.label)).toEqual(['Volume', 'Receiving role', 'Big-play role']);
  });
});
