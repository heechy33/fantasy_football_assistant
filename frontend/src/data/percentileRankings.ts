import type {
  PlayerMeta,
  PlayerUsage,
  PlayerUsageArtifact,
} from '../../../shared/types';

/**
 * STACKED-style position-cohort percentile rankings for the Role panel (display-only, never a
 * ranking input). Groups are deliberately divergent per position (2026-08-25 user call,
 * reversing the earlier "shared shape" rule): RB reads like a backfield profile, WR/TE read
 * like pass-game profiles that differ in emphasis — see RB_GROUPS / WR_GROUPS / TE_GROUPS.
 * Each metric is percent-ranked 0-100 within the same-position cohort of `player-usage.json`
 * (the "0-100 within the position cohort" readout app.fantasyplaybook.ai popularized),
 * computed from our own committed data. Metrics we cannot source honestly (routes run,
 * targets/yards per route, ESPN's open/catch/YAC scores) are deliberately absent rather than
 * approximated. Efficiency metrics are per-attempt rates (EPA/carry, EPA/target) so volume
 * cannot masquerade as efficiency.
 *
 * Pure: no fetching, no mutation. Percentiles are computed at render time from the artifact
 * already in memory (`usePlayerBoardData`), so a stale/absent artifact degrades to `null`
 * percentiles, never fabricated ranks.
 */

export interface PercentileStat {
  key: string;
  label: string;
  /** The player's raw AVG (per-game) value, formatted for display. Null → shown as n/a. */
  display: string | null;
  /** 0-100 percentile within the same-position usage cohort. Null when the player's value or
   * the cohort can't support one (thin cohort, missing artifact fields). */
  percentile: number | null;
  /** true for a season-long ratio (aDOT, catch rate, …) rather than a per-game average — callers
   * should not append "per game" when describing this stat. */
  ratio?: boolean;
}

export interface PercentileGroup {
  id: string;
  /** Group header, e.g. "Rushing Volume". */
  label: string;
  stats: PercentileStat[];
}

export interface PercentileRankings {
  /** Same-position players with an observed usage season, including the player themself — the
   * denominator every percentile in `groups` was computed against. Surfaced so the panel can show
   * "vs. NNN players" instead of an unqualified rank. */
  cohortSize: number;
  groups: PercentileGroup[];
}

/** Below this many same-position players with observed usage, a percentile is noise — the row
 * renders its raw value with an n/a rank instead. Exported for `cardRoleStats.ts`, which ranks
 * the same RB/WR/TE cohorts for the card-bottom slot. */
export const MIN_COHORT = 5;

export type MetricKey =
  | 'fantasyPoints'
  | 'carries'
  | 'carryShare'
  | 'rushingYards'
  | 'rushingTds'
  | 'yardsPerCarry'
  | 'rushEpaPerCarry'
  | 'targets'
  | 'receptions'
  | 'receivingYards'
  | 'receivingTds'
  | 'targetShare'
  | 'recEpaPerTarget'
  | 'adot'
  | 'catchRate'
  | 'yardsPerReception'
  | 'yacPerReception'
  | 'airYardsShare'
  | 'snapShare'
  | 'redZoneTargets'
  | 'endZoneTargets'
  | 'goalLineCarries';

export interface MetricSpec {
  key: MetricKey;
  label: string;
  /** true → the raw value is a 0-1 share and displays as a percentage. */
  share?: boolean;
  /** true → a season-long ratio (aDOT, catch rate, yards/reception, …) rather than a per-game
   * average; carried through to `PercentileStat.ratio` so the panel doesn't call it "per game". */
  ratio?: boolean;
  extract: (usage: PlayerUsage) => number | null;
}

/** Guards a ratio extractor against a zero/missing denominator — never NaN/Infinity, which would
 * poison `percentileOf` for the whole cohort. */
function ratioOf(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function perGame(total: number | null | undefined, games: number | null | undefined): number | null {
  if (total == null || !games) return null;
  return total / games;
}

/** Exported for `cardRoleStats.ts` — the card-bottom slot ranks a handful of these metrics
 * against the same RB/WR/TE cohort this module already builds for the Role page, rather than
 * duplicating the extractors. */
export const METRICS: Readonly<Record<MetricKey, MetricSpec>> = {
  fantasyPoints: {
    key: 'fantasyPoints',
    label: 'Fantasy Points',
    extract: (u) => u.production?.pointsPprPerGame ?? null,
  },
  carries: {
    key: 'carries',
    label: 'Carries',
    extract: (u) => u.opportunity?.season.carriesPerGame ?? null,
  },
  carryShare: {
    key: 'carryShare',
    label: 'Carry Share',
    share: true,
    extract: (u) => u.opportunity?.season.carryShare ?? null,
  },
  rushingYards: {
    key: 'rushingYards',
    label: 'Rushing Yards',
    extract: (u) => perGame(u.production?.rushingYards, u.production?.games),
  },
  rushingTds: {
    key: 'rushingTds',
    label: 'Rushing TDs',
    extract: (u) => perGame(u.production?.rushingTds, u.production?.games),
  },
  // Pure efficiency reads: per-attempt rates, not per-game averages — a bellcow's volume must
  // not out-rank a more efficient back inside an "Efficiency" group.
  yardsPerCarry: {
    key: 'yardsPerCarry',
    label: 'Yards / Carry',
    ratio: true,
    extract: (u) => ratioOf(u.production?.rushingYards, u.opportunity?.season.carries),
  },
  rushEpaPerCarry: {
    key: 'rushEpaPerCarry',
    label: 'Rush EPA / Carry',
    ratio: true,
    extract: (u) => ratioOf(u.opportunity?.season.rushingEpa, u.opportunity?.season.carries),
  },
  targets: {
    key: 'targets',
    label: 'Targets',
    extract: (u) => u.opportunity?.season.targetsPerGame ?? null,
  },
  receptions: {
    key: 'receptions',
    label: 'Receptions',
    extract: (u) => perGame(u.production?.receptions, u.production?.games),
  },
  receivingYards: {
    key: 'receivingYards',
    label: 'Receiving Yards',
    extract: (u) => perGame(u.production?.receivingYards, u.production?.games),
  },
  receivingTds: {
    key: 'receivingTds',
    label: 'Receiving TDs',
    extract: (u) => perGame(u.production?.receivingTds, u.production?.games),
  },
  targetShare: {
    key: 'targetShare',
    label: 'Target Share',
    share: true,
    extract: (u) => u.opportunity?.season.targetShare ?? null,
  },
  recEpaPerTarget: {
    key: 'recEpaPerTarget',
    label: 'Rec EPA / Target',
    ratio: true,
    extract: (u) => ratioOf(u.opportunity?.season.receivingEpa, u.opportunity?.season.targets),
  },
  adot: {
    key: 'adot',
    label: 'aDOT',
    ratio: true,
    extract: (u) => ratioOf(u.opportunity?.season.airYards, u.opportunity?.season.targets),
  },
  catchRate: {
    key: 'catchRate',
    label: 'Catch Rate',
    share: true,
    ratio: true,
    extract: (u) => ratioOf(u.production?.receptions, u.opportunity?.season.targets),
  },
  yardsPerReception: {
    key: 'yardsPerReception',
    label: 'Yards / Reception',
    ratio: true,
    extract: (u) => ratioOf(u.production?.receivingYards, u.production?.receptions),
  },
  yacPerReception: {
    key: 'yacPerReception',
    label: 'YAC / Reception',
    ratio: true,
    extract: (u) => ratioOf(u.opportunity?.season.receivingYardsAfterCatch, u.production?.receptions),
  },
  airYardsShare: {
    key: 'airYardsShare',
    label: 'Air-Yard Share',
    share: true,
    extract: (u) => u.opportunity?.season.airYardsShare ?? null,
  },
  snapShare: {
    key: 'snapShare',
    label: 'Snap %',
    share: true,
    extract: (u) => u.opportunity?.season.snapPct ?? null,
  },
  // Red-zone/goal-line fields are season totals from the pbp gate — averaged over appearance
  // games so they read on the same AVG scale as everything else.
  redZoneTargets: {
    key: 'redZoneTargets',
    label: 'Red-Zone Targets',
    extract: (u) => perGame(u.opportunity?.season.redZoneTargets, u.opportunity?.season.games),
  },
  endZoneTargets: {
    key: 'endZoneTargets',
    label: 'End-Zone Targets',
    extract: (u) => perGame(u.opportunity?.season.endZoneTargets, u.opportunity?.season.games),
  },
  goalLineCarries: {
    key: 'goalLineCarries',
    label: 'Goal-Line Carries',
    extract: (u) => perGame(u.opportunity?.season.goalLineCarries, u.opportunity?.season.games),
  },
};

/**
 * RB reads like a backfield profile: volume first (the position's fantasy currency), pure
 * rushing efficiency as per-attempt rates, pass-game involvement as workload (not efficiency),
 * and a dedicated goal-line/red-zone group where RB value concentrates.
 */
const RB_GROUPS: ReadonlyArray<{ id: string; label: string; metrics: readonly MetricKey[] }> = [
  { id: 'fantasy', label: 'Fantasy', metrics: ['fantasyPoints'] },
  { id: 'backfield-volume', label: 'Backfield Volume', metrics: ['carries', 'carryShare', 'rushingYards', 'snapShare'] },
  { id: 'rushing-efficiency', label: 'Rushing Efficiency', metrics: ['yardsPerCarry', 'rushEpaPerCarry'] },
  { id: 'receiving-workload', label: 'Receiving Workload', metrics: ['targets', 'targetShare', 'receptions'] },
  { id: 'goal-line', label: 'Goal Line & Red Zone', metrics: ['goalLineCarries', 'redZoneTargets', 'rushingTds'] },
];

/** WR reads like a downfield pass-game profile: earning targets, then production, then how. */
const WR_GROUPS: ReadonlyArray<{ id: string; label: string; metrics: readonly MetricKey[] }> = [
  { id: 'fantasy', label: 'Fantasy', metrics: ['fantasyPoints'] },
  { id: 'target-earners', label: 'Target Earners', metrics: ['targets', 'targetShare', 'airYardsShare', 'snapShare'] },
  { id: 'receiving-production', label: 'Receiving Production', metrics: ['receptions', 'receivingYards', 'receivingTds'] },
  { id: 'ball-winning', label: 'Ball Winning', metrics: ['catchRate', 'yardsPerReception', 'yacPerReception', 'adot', 'recEpaPerTarget'] },
  { id: 'red-zone', label: 'Red Zone', metrics: ['redZoneTargets', 'endZoneTargets'] },
];

/**
 * TE keeps the WR skeleton but reweights emphasis: snap rate joins volume (TE route participation
 * lives in snaps), deep-ball aDOT drops out of Reliability (TE targets skew short), and EPA/target
 * stays as the efficiency read.
 */
const TE_GROUPS: ReadonlyArray<{ id: string; label: string; metrics: readonly MetricKey[] }> = [
  { id: 'fantasy', label: 'Fantasy', metrics: ['fantasyPoints'] },
  { id: 'volume', label: 'Volume', metrics: ['targets', 'targetShare', 'snapShare'] },
  { id: 'receiving-production', label: 'Production', metrics: ['receptions', 'receivingYards', 'receivingTds'] },
  { id: 'reliability', label: 'Reliability', metrics: ['catchRate', 'yardsPerReception', 'yacPerReception', 'recEpaPerTarget'] },
  { id: 'red-zone', label: 'Red Zone', metrics: ['redZoneTargets', 'endZoneTargets'] },
];

export function formatMetric(value: number, share: boolean | undefined): string {
  if (share) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

/** Percent of the cohort at or below the player's value, 0-100. Ties count in the player's
 * favor (a zero-heavy cohort of bench players shouldn't read a 0 for a zero). Exported for
 * `qbPercentileRankings.ts`, which percent-ranks the QB cohort of the weekly game log with
 * the exact same at-or-below semantics. */
export function percentileOf(cohortValues: readonly number[], value: number): number {
  const atOrBelow = cohortValues.reduce((count, candidate) => (candidate <= value ? count + 1 : count), 0);
  return (atOrBelow / cohortValues.length) * 100;
}

/**
 * Build the position-specific percentile groups for one player, or null when this panel
 * shouldn't render them at all (QB/K/DEF keep the weekly game-log columns; a player with no
 * observed usage season keeps the panel's existing fail-open messages).
 */
export function buildPercentileRankings(input: {
  player: PlayerMeta;
  usage: PlayerUsageArtifact;
  players: readonly PlayerMeta[];
}): PercentileRankings | null {
  const position = input.player.position;
  if (position !== 'RB' && position !== 'WR' && position !== 'TE') return null;

  const self = input.usage[input.player.playerId];
  if (!self?.usageSeasonObserved || self.opportunity == null) return null;

  const cohort: PlayerUsage[] = input.players
    .filter((candidate) => candidate.position === position)
    .map((candidate) => input.usage[candidate.playerId])
    .filter((candidate): candidate is PlayerUsage =>
      candidate?.usageSeasonObserved === true && candidate.opportunity != null);
  // The player themself may sit outside `players` (e.g. a stale pool) — keep them rankable.
  if (!cohort.includes(self)) cohort.push(self);
  if (cohort.length < MIN_COHORT) return null;

  const groupSpecs = position === 'RB' ? RB_GROUPS : position === 'WR' ? WR_GROUPS : TE_GROUPS;
  const groups: PercentileGroup[] = groupSpecs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    stats: spec.metrics.map((metricKey) => {
      const metric = METRICS[metricKey];
      const value = metric.extract(self);
      const display = value == null ? null : formatMetric(value, metric.share);
      let percentile: number | null = null;
      if (value != null) {
        const cohortValues = cohort
          .map(metric.extract)
          .filter((candidate): candidate is number => candidate != null);
        if (cohortValues.length >= MIN_COHORT) percentile = percentileOf(cohortValues, value);
      }
      return { key: metric.key, label: metric.label, display, percentile, ratio: metric.ratio };
    }),
  }));
  return { cohortSize: cohort.length, groups };
}
