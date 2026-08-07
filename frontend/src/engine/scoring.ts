import type { LeagueSettings, Position, SeasonProjection, StatMap } from '../../../shared/types';

export type ScoringComponentApplicability = 'applicable' | 'non-applicable';
export type ScoringDiagnosticSeverity = 'none' | 'minor' | 'material';

export interface ScoringComponentDiagnostic {
  key: string;
  applicability: ScoringComponentApplicability;
  severity: Exclude<ScoringDiagnosticSeverity, 'none'>;
}

export interface ScoreDiagnostics {
  points: number;
  scoredKeys: string[];
  /** Applicable league scoring keys that the projection source did not provide. */
  unsupportedScoringKeys: string[];
  /** Every non-zero league scoring key absent from the projection, before position filtering. */
  rawMissingScoringKeys: string[];
  /** Per-key applicability/severity, retained for expandable diagnostic details. */
  componentDiagnostics: ScoringComponentDiagnostic[];
  missingProjectionKeys: string[];
  severity: ScoringDiagnosticSeverity;
  approximate: boolean;
}

type StatFamily = 'passing' | 'rushing' | 'receiving' | 'turnover' | 'kicking' | 'defense' | 'unknown';

function statFamily(key: string): StatFamily {
  if (
    key.startsWith('def_') || key.startsWith('st_') || key.startsWith('pts_allow')
    || key.startsWith('yds_allow') || ['sack', 'int', 'fum_rec', 'def_td', 'def_kr_td', 'blk_kick', 'safe'].includes(key)
  ) return 'defense';
  if (/^(?:fg|xp)/.test(key) || key.startsWith('kick_')) return 'kicking';
  if (key.startsWith('pass_') || key.includes('_pass_')) return 'passing';
  if (key.startsWith('rush_') || key.includes('_rush_')) return 'rushing';
  if (key === 'rec' || key.startsWith('rec_') || key.includes('_rec_')) return 'receiving';
  if (key === 'fum' || key === 'fum_lost' || key.startsWith('fum_')) return 'turnover';
  return 'unknown';
}

function isApplicable(key: string, position: Position | null | undefined): boolean {
  if (position == null) return true;
  const family = statFamily(key);
  if (position === 'QB') return ['passing', 'rushing', 'turnover', 'unknown'].includes(family);
  if (position === 'RB' || position === 'WR') return ['rushing', 'receiving', 'turnover', 'unknown'].includes(family);
  if (position === 'TE') return ['rushing', 'receiving', 'turnover', 'unknown'].includes(family);
  if (position === 'K') return family === 'kicking';
  return family === 'defense';
}

function missingSeverity(key: string, position: Position | null | undefined): 'minor' | 'material' {
  if (/(?:^|_)2pt(?:_|$)|two_pt/.test(key) || key === 'fum' || key === 'fum_lost') return 'minor';
  // FFToday does not publish TE rushing projections. The category is applicable, but rare enough
  // to disclose as a minor approximation rather than invalidate otherwise standard PPR scoring.
  if (position === 'TE' && statFamily(key) === 'rushing') return 'minor';
  return 'material';
}

export function scoreStats(stats: StatMap, scoring: Record<string, number>, position?: Position | null): ScoreDiagnostics {
  let points = 0;
  const scoredKeys: string[] = [];
  const unsupportedScoringKeys: string[] = [];
  const rawMissingScoringKeys: string[] = [];
  const componentDiagnostics: ScoringComponentDiagnostic[] = [];
  const missingProjectionKeys: string[] = [];

  for (const [key, weight] of Object.entries(scoring)) {
    if (!Number.isFinite(weight) || weight === 0) continue;
    const value = stats[key];
    if (value == null) {
      rawMissingScoringKeys.push(key);
      const applicability = isApplicable(key, position) ? 'applicable' : 'non-applicable';
      const severity = missingSeverity(key, position);
      componentDiagnostics.push({ key, applicability, severity });
      if (applicability === 'applicable') unsupportedScoringKeys.push(key);
      continue;
    }
    if (!Number.isFinite(value)) throw new Error(`non-finite projection component: ${key}`);
    points += value * weight;
    scoredKeys.push(key);
  }
  for (const key of Object.keys(stats)) {
    if (!(key in scoring) || !Number.isFinite(scoring[key]) || scoring[key] === 0) {
      missingProjectionKeys.push(key);
    }
  }
  const applicableDiagnostics = componentDiagnostics.filter((diagnostic) => diagnostic.applicability === 'applicable');
  const severity: ScoringDiagnosticSeverity = applicableDiagnostics.some((diagnostic) => diagnostic.severity === 'material')
    ? 'material'
    : applicableDiagnostics.some((diagnostic) => diagnostic.severity === 'minor') ? 'minor' : 'none';
  return {
    points,
    scoredKeys,
    unsupportedScoringKeys,
    rawMissingScoringKeys,
    componentDiagnostics,
    missingProjectionKeys,
    severity,
    approximate: severity !== 'none',
  };
}

export function scoreProjection(projection: SeasonProjection, settings: LeagueSettings, position?: Position | null): ScoreDiagnostics {
  return scoreStats(projection.stats, settings.scoring, position);
}
