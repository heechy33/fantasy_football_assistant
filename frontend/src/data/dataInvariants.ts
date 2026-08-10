import type { AdpEntry, DataManifest, PlayerMeta, PlayerUsageArtifact, SeasonProjection } from '../../../shared/types';

export interface ValidationIssue {
  check: string;
  detail: string;
}

export function validateUniquePlayerIds(players: PlayerMeta[]): ValidationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const player of players) {
    if (seen.has(player.playerId)) duplicates.add(player.playerId);
    seen.add(player.playerId);
  }
  return [...duplicates].map((id) => ({
    check: 'unique-player-id',
    detail: `duplicate playerId ${id}`,
  }));
}

export function validateFiniteProjections(projections: SeasonProjection[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const projection of projections) {
    for (const [stat, value] of Object.entries(projection.stats)) {
      if (!Number.isFinite(value)) {
        issues.push({
          check: 'finite-projection-stat',
          detail: `${projection.playerId} stat ${stat} is not finite (${value})`,
        });
      }
    }
  }
  return issues;
}

export function validateAdpRanges(entries: AdpEntry[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const entry of entries) {
    if (!Number.isFinite(entry.adp) || entry.adp < 0) {
      issues.push({ check: 'adp-non-negative', detail: `${entry.name} has invalid adp ${entry.adp}` });
    }
    if (!Number.isFinite(entry.stdev) || entry.stdev < 0) {
      issues.push({
        check: 'adp-stdev-non-negative',
        detail: `${entry.name} has invalid stdev ${entry.stdev}`,
      });
    }
  }
  return issues;
}

/** `high`/`low`/`timesDrafted` are `null`, not a real 0, when a source (Sleeper's lobby ADP) doesn't
 * expose them at all — see AdpEntry's doc. Checks the provenance tags are one of the declared
 * values and that each source's nullability contract holds: FFC always carries observed population
 * fields; Sleeper always carries fitted stdev with null population fields. */
export function validateAdpProvenance(entries: AdpEntry[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const entry of entries) {
    if (entry.adpSource !== 'sleeper' && entry.adpSource !== 'ffc') {
      issues.push({ check: 'adp-source-valid', detail: `${entry.name} has invalid adpSource ${String(entry.adpSource)}` });
    }
    if (entry.stdevSource !== 'observed' && entry.stdevSource !== 'fitted') {
      issues.push({ check: 'adp-stdev-source-valid', detail: `${entry.name} has invalid stdevSource ${String(entry.stdevSource)}` });
    }
    for (const [field, value] of [['high', entry.high], ['low', entry.low], ['timesDrafted', entry.timesDrafted]] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        issues.push({ check: 'adp-population-field-non-negative', detail: `${entry.name} has invalid ${field} ${value}` });
      }
    }
    if (entry.adpSource === 'ffc') {
      if (entry.high == null || entry.low == null || entry.timesDrafted == null) {
        issues.push({
          check: 'adp-ffc-population-present',
          detail: `${entry.name} is adpSource 'ffc' but is missing high/low/timesDrafted`,
        });
      }
      if (entry.stdevSource !== 'observed') {
        issues.push({
          check: 'adp-ffc-stdev-observed',
          detail: `${entry.name} is adpSource 'ffc' but stdevSource is ${entry.stdevSource}`,
        });
      }
    }
    if (entry.adpSource === 'sleeper') {
      if (entry.stdevSource !== 'fitted') {
        issues.push({
          check: 'adp-sleeper-stdev-fitted',
          detail: `${entry.name} is adpSource 'sleeper' but stdevSource is ${entry.stdevSource}`,
        });
      }
      if (entry.high != null || entry.low != null || entry.timesDrafted != null) {
        issues.push({
          check: 'adp-sleeper-population-absent',
          detail: `${entry.name} is adpSource 'sleeper' but has high/low/timesDrafted set`,
        });
      }
    }
  }
  return issues;
}

export function validateManifestCrosswalk(manifest: DataManifest): ValidationIssue[] {
  const rate = manifest.crosswalk?.top300MatchRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return [
      {
        check: 'manifest-crosswalk-rate',
        detail: `top300MatchRate missing or out of [0,1]: ${rate}`,
      },
    ];
  }
  return [];
}

export function validatePlayerUsage(usage: PlayerUsageArtifact, draftSeason: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rateFields = ['snapPct', 'targetShare', 'carryShare', 'availabilityRate'] as const;
  for (const [playerId, player] of Object.entries(usage)) {
    if (typeof player.usageSeasonObserved !== 'boolean') {
      issues.push({ check: 'context-usage-season-flag', detail: `${playerId} missing usageSeasonObserved` });
    }
    for (const field of rateFields) {
      const value = player[field];
      if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
        issues.push({ check: 'context-rate', detail: `${playerId} ${field} is outside [0,1]: ${value}` });
      }
    }
    if (player.season >= draftSeason) {
      issues.push({ check: 'context-season-cutoff', detail: `${playerId} usage season ${player.season} is not prior to ${draftSeason}` });
    }
    if (!player.usageSeasonObserved) {
      if (player.knownAbsent || player.gamesWithAnySnap > 0 || player.snapPct != null || player.targetShare != null || player.carryShare != null) {
        issues.push({
          check: 'context-usage-season-empty',
          detail: `${playerId} has usage metrics without usage-season evidence`,
        });
      }
      if (player.opportunity != null) {
        issues.push({ check: 'context-usage-season-empty', detail: playerId + ' has derived context without usage-season evidence' });
      }
    }
    if (player.durabilityScore != null) {
      const score = player.durabilityScore;
      if (!Number.isFinite(score.score) || score.score < 0 || score.score > 100) {
        issues.push({ check: 'context-durability-score', detail: playerId + ' score is outside [0,100]' });
      }
      const expectedScore = Object.values(score.components).reduce((sum, value) => sum + value, 0);
      if (Math.abs(expectedScore - score.score) > 1.01) {
        issues.push({ check: 'context-durability-components', detail: playerId + ' score does not equal its components' });
      }
    }
    if (player.opportunity != null) {
      const periods = [player.opportunity.season, player.opportunity.finalFive].filter((value): value is NonNullable<typeof value> => value != null);
      for (const period of periods) {
        for (const field of ['targetShare', 'carryShare', 'airYardsShare', 'snapPct'] as const) {
          const value = period[field];
          if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) {
            issues.push({ check: 'context-opportunity-rate', detail: playerId + ' ' + field + ' is outside [0,1]' });
          }
        }
        if (period.games <= 0 || period.games > 34 || period.targets < 0 || period.carries < 0) {
          issues.push({ check: 'context-opportunity-denominator', detail: playerId + ' has invalid opportunity totals' });
        }
      }
      if (player.opportunity.finalFive && player.opportunity.finalFive.games > player.opportunity.season.games) {
        issues.push({ check: 'context-opportunity-final-five', detail: playerId + ' final-five games exceed season games' });
      }
      for (const value of Object.values(player.opportunity.roleEvolution)) {
        if (value != null && !Number.isFinite(value)) {
          issues.push({ check: 'context-opportunity-delta', detail: playerId + ' has a non-finite role delta' });
        }
      }
    }
    const ordered = [...player.seasons].sort((a, b) => a.season - b.season);
    if (player.seasons.some((value, index) => value.season !== ordered[index]?.season)) {
      issues.push({ check: 'context-season-order', detail: `${playerId} seasons are not ascending` });
    }
    let possible = 0;
    let appeared = 0;
    for (const season of player.seasons) {
      possible += season.teamGamesWhileRostered;
      appeared += season.gamesWithAnySnap;
      if (season.season >= draftSeason) {
        issues.push({ check: 'context-season-cutoff', detail: `${playerId} contains season ${season.season}` });
      }
      if (season.teamGamesWhileRostered <= 0 || season.gamesWithAnySnap < 0 || season.gamesWithAnySnap > season.teamGamesWhileRostered) {
        issues.push({ check: 'context-denominator', detail: `${playerId} has invalid ${season.season} game totals` });
      }
      const expected = season.gamesWithAnySnap / season.teamGamesWhileRostered;
      if (Math.abs(season.availabilityRate - expected) > 1e-9) {
        issues.push({ check: 'context-season-rate', detail: `${playerId} has inconsistent ${season.season} availability` });
      }
    }
    const expectedRollup = possible > 0 ? appeared / possible : null;
    if (
      (expectedRollup == null) !== (player.availabilityRate == null)
      || (expectedRollup != null && player.availabilityRate != null && Math.abs(expectedRollup - player.availabilityRate) > 1e-9)
    ) {
      issues.push({ check: 'context-rollup-rate', detail: `${playerId} pooled availability is inconsistent` });
    }
  }
  return issues;
}
