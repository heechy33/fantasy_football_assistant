import type { AdpEntry, DataManifest, PlayerMeta, SeasonProjection } from '../../../shared/types';

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
