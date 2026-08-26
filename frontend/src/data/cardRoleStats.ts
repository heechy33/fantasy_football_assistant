import type {
  PlayerId, PlayerMeta, PlayerUsage, PlayerUsageArtifact,
  PlayerWeeklyStatSeries, PlayerWeeklyStatsArtifact,
} from '../../../shared/types';
import { METRICS, MIN_COHORT, percentileOf, type MetricKey } from './percentileRankings';
import { buildQbPercentileRankings } from './qbPercentileRankings';
import { formatCount, formatShare, formatWhole } from './roleColumn';
import { columnValues, mean, sum } from './weeklyRoleColumns';

/**
 * The headline role-page stats shown in a PlayerCard's bottom slot (see PlayerCard's slot
 * rule: 2 when a next-up chip or the survival meter shares the slot, up to 4 when the card has
 * the room — the 2-stat states take the first 2 of the 4 below).
 *
 * 2026-08-25 user rule: one **production** stat, one **opportunity/efficiency** stat, then more
 * of either — never two picks that are algebraically the same measurement. The original picks
 * failed this (RB showed Carry Share + Touches/g, both raw backfield volume; WR/TE showed
 * Target Share + Targets/g, the same target count expressed two ways). The set was reshaped twice
 * the same day: a fourth pick per position filled the no-next-up card state (user: fill the
 * empty middle), then the user swapped RB's Targets/g + Snap % for Goal-Line Carries + Rush TD/g
 * and WR/TE's Yds/Rec + Snap % for YAC/Rec + Red-Zone Targets — every pick below is still not
 * derivable from the others shown:
 *
 * | Pos | 1 (production) | 2               | 3              | 4               |
 * |-----|-----------------|-----------------|----------------|-----------------|
 * | QB  | Fantasy Pts/g   | Pass Yd/g       | Rush Yd/g      | Pass TD/g       |
 * | RB  | Fantasy Pts/g   | YPC             | GL Carries/g   | Rush TD/g       |
 * | WR  | Fantasy Pts/g   | Targets/g       | YAC/Rec        | RZ Tgt/g        |
 * | TE  | Fantasy Pts/g   | Targets/g       | YAC/Rec        | RZ Tgt/g        |
 * | K   | FGM/g           | FG%             | 50+ FGM        | XPM/g           |
 * | DEF | Sacks/g         | Takeaways/g     | Pts allow/g    | PD/g            |
 *
 * Every stat now carries a 0-100 cohort percentile (rendered as a `PercentileBar`), matching the
 * Role page's STACKED view — RB/WR/TE rank against `METRICS` from `percentileRankings.ts` (the
 * same extractors the Role page uses), QB against `qbPercentileRankings.ts`'s weekly-game-log
 * cohort, and K/DEF against their own weekly-artifact cohort (new here — the Role page has no
 * K/DEF percentile view to borrow from). `percentile: null` means the cohort was too thin
 * (`MIN_COHORT`) or the player's own value is missing — the card renders the raw value with an
 * empty/hatched rail rather than a fabricated rank.
 *
 * `buildCardRoleStatsIndex` computes every player's stats in one pass per position: each
 * `(position, metric)` cohort array is built once and reused, rather than
 * `buildPercentileRankings`'s per-metric-per-player rebuild (fine for a single drawer, too slow
 * for a whole board's worth of cards). Display-only: nothing here feeds planValue or any sort
 * comparator.
 */

export interface CardRoleStat {
  label: string;
  display: string;
  /** 0-100 cohort percentile, or null when no rank could be computed. */
  percentile: number | null;
  /** Full-sentence tooltip carrying the provenance the compact tile can't. */
  title: string;
}

export interface CardRoleStatsIndexInput {
  players: readonly PlayerMeta[];
  usage: PlayerUsageArtifact;
  /** Board-wide weekly game log artifact (`useBoardWeeklyStats`). QB/K/DEF stats derive from
   * it; null/absent means those three positions resolve to no stats (RB/WR/TE are unaffected —
   * they source from `usage`). */
  weeklyArtifact: PlayerWeeklyStatsArtifact | null | undefined;
}

const PROVENANCE_SUFFIX = 'Display context only — never a ranking input.';

function formatSkillMetric(value: number, share: boolean | undefined): string {
  return share ? formatShare(value) : formatCount(value);
}

function skillStatTitle(
  label: string, display: string, percentile: number | null, cohortSize: number, season: number | null,
): string {
  const base = `${display} ${label.toLowerCase()} — from player-usage.json's ${season ?? 'prior'}-season opportunity aggregate`;
  return percentile == null
    ? `${base}. ${PROVENANCE_SUFFIX}`
    : `${base}, ${Math.round(percentile)}th percentile vs ${cohortSize} same-position players with observed usage. ${PROVENANCE_SUFFIX}`;
}

const RB_PICKS: ReadonlyArray<{ key: MetricKey; label: string }> = [
  { key: 'fantasyPoints', label: 'Fantasy Pts/g' },
  { key: 'yardsPerCarry', label: 'YPC' },
  { key: 'goalLineCarries', label: 'GL Carries/g' },
  { key: 'rushingTds', label: 'Rush TD/g' },
];
const WR_PICKS: ReadonlyArray<{ key: MetricKey; label: string }> = [
  { key: 'fantasyPoints', label: 'Fantasy Pts/g' },
  { key: 'targets', label: 'Targets/g' },
  { key: 'yacPerReception', label: 'YAC/Rec' },
  { key: 'redZoneTargets', label: 'RZ Tgt/g' },
];
const TE_PICKS: ReadonlyArray<{ key: MetricKey; label: string }> = [
  { key: 'fantasyPoints', label: 'Fantasy Pts/g' },
  { key: 'targets', label: 'Targets/g' },
  { key: 'yacPerReception', label: 'YAC/Rec' },
  { key: 'redZoneTargets', label: 'RZ Tgt/g' },
];
const SKILL_PICKS: Readonly<Record<'RB' | 'WR' | 'TE', ReadonlyArray<{ key: MetricKey; label: string }>>> = {
  RB: RB_PICKS, WR: WR_PICKS, TE: TE_PICKS,
};

/** RB/WR/TE — builds each position's cohort once (same membership rule as
 * `buildPercentileRankings`: observed usage season + an opportunity aggregate), then ranks every
 * player at that position against it in a single pass. */
function buildSkillStats(input: {
  players: readonly PlayerMeta[];
  usage: PlayerUsageArtifact;
  map: Map<PlayerId, readonly CardRoleStat[]>;
}): void {
  const { players, usage, map } = input;
  (['RB', 'WR', 'TE'] as const).forEach((position) => {
    const cohort: PlayerUsage[] = [];
    for (const player of players) {
      if (player.position !== position) continue;
      const u = usage[player.playerId];
      if (u?.usageSeasonObserved === true && u.opportunity != null) cohort.push(u);
    }
    const picks = SKILL_PICKS[position];
    const cohortValuesByKey = new Map<MetricKey, number[]>(
      picks.map((pick) => [
        pick.key,
        cohort.map(METRICS[pick.key].extract).filter((v): v is number => v != null),
      ]),
    );

    for (const player of players) {
      if (player.position !== position) continue;
      const self = usage[player.playerId];
      if (self?.usageSeasonObserved !== true || self.opportunity == null) continue;
      const stats: CardRoleStat[] = [];
      for (const pick of picks) {
        const spec = METRICS[pick.key];
        const value = spec.extract(self);
        if (value == null) continue;
        const cohortValues = cohortValuesByKey.get(pick.key)!;
        const percentile = cohortValues.length >= MIN_COHORT ? percentileOf(cohortValues, value) : null;
        const display = formatSkillMetric(value, spec.share);
        stats.push({ label: pick.label, display, percentile, title: skillStatTitle(pick.label, display, percentile, cohort.length, self.season) });
      }
      if (stats.length > 0) map.set(player.playerId, stats);
    }
  });
}

const QB_PICKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'fantasyPoints', label: 'Fantasy Pts/g' },
  { key: 'passingYards', label: 'Pass Yd/g' },
  { key: 'rushingYards', label: 'Rush Yd/g' },
  { key: 'passingTds', label: 'Pass TD/g' },
];

/** QB — headline STACKED percentile stats: fantasy production, passing volume, the rushing
 * floor that actually separates starting QBs from each other, then passing TDs (a scoring
 * column, not derivable from Pass Yd/g). Percentiles come from the same weekly-game-log cohort
 * the Role page renders (`qbPercentileRankings.ts`). */
function buildQbStats(input: {
  players: readonly PlayerMeta[];
  weeklyArtifact: PlayerWeeklyStatsArtifact;
  map: Map<PlayerId, readonly CardRoleStat[]>;
}): void {
  const { players, weeklyArtifact, map } = input;
  for (const player of players) {
    if (player.position !== 'QB') continue;
    const rankings = buildQbPercentileRankings({ player, artifact: weeklyArtifact });
    if (rankings == null) continue;
    const byKey = new Map(rankings.groups.flatMap((group) => group.stats).map((stat) => [stat.key, stat]));
    const stats: CardRoleStat[] = [];
    for (const pick of QB_PICKS) {
      const stat = byKey.get(pick.key);
      if (stat?.display == null) continue;
      stats.push({
        label: pick.label,
        display: stat.display,
        percentile: stat.percentile,
        title: `${stat.display} ${pick.label.toLowerCase()} — per-game average from the ${weeklyArtifact.season} weekly game log`
          + (stat.percentile == null
            ? `, percentile unavailable vs ${rankings.cohortSize} QBs. ${PROVENANCE_SUFFIX}`
            : `, ${Math.round(stat.percentile)}th percentile vs ${rankings.cohortSize} QBs with observed weeks. ${PROVENANCE_SUFFIX}`),
      });
    }
    if (stats.length > 0) map.set(player.playerId, stats);
  }
}

interface WeeklyCardMetric {
  key: string;
  label: string;
  column: string;
  aggregate: 'mean' | 'sum';
  /** value = sum(column) / sum(denominatorColumn) — a season-long rate, not a per-game mean. */
  denominatorColumn?: string;
  /** true → the raw value is a 0-1 fraction, displayed and compared as a percentage. */
  share?: boolean;
  /** true → a whole-number count (e.g. "1", not "1.0"). */
  whole?: boolean;
}

function weeklyMetricValue(series: PlayerWeeklyStatSeries, columns: string[], spec: WeeklyCardMetric): number | null {
  if (spec.denominatorColumn != null) {
    const denominator = sum(columnValues(series, columns, spec.denominatorColumn));
    return denominator > 0 ? sum(columnValues(series, columns, spec.column)) / denominator : null;
  }
  const values = columnValues(series, columns, spec.column);
  if (values.length === 0) return null;
  return spec.aggregate === 'sum' ? sum(values) : mean(values);
}

function weeklyMetricDisplay(value: number, spec: WeeklyCardMetric): string {
  if (spec.share) return `${(value * 100).toFixed(1)}%`;
  if (spec.whole) return formatWhole(value);
  return formatCount(value);
}

const K_METRICS: readonly WeeklyCardMetric[] = [
  { key: 'fgm', label: 'FGM/g', column: 'fgm', aggregate: 'mean' },
  { key: 'fgPct', label: 'FG%', column: 'fgm', aggregate: 'mean', denominatorColumn: 'fga', share: true },
  { key: 'fgm50', label: '50+ FGM', column: 'fgm_50p', aggregate: 'sum', whole: true },
  { key: 'xpm', label: 'XPM/g', column: 'xpm', aggregate: 'mean' },
];

/** K — no percentile in the old version (a `formatWhole`/`formatCount` readout only); now ranked
 * against the same weekly-artifact K cohort as everyone else, same honesty rule as elsewhere:
 * a thin/absent cohort degrades to `percentile: null`, never a fabricated rank. */
function buildKStats(input: {
  players: readonly PlayerMeta[];
  weeklyArtifact: PlayerWeeklyStatsArtifact;
  map: Map<PlayerId, readonly CardRoleStat[]>;
}): void {
  const { players, weeklyArtifact, map } = input;
  const columns = weeklyArtifact.columns.K;
  if (columns == null) return;
  const cohort = Object.values(weeklyArtifact.players).filter((series) => series.p === 'K' && series.w.length > 0);
  const cohortValuesByKey = new Map(K_METRICS.map((spec) => [
    spec.key,
    cohort.map((series) => weeklyMetricValue(series, columns, spec)).filter((v): v is number => v != null),
  ]));

  for (const player of players) {
    if (player.position !== 'K') continue;
    const series = weeklyArtifact.players[player.playerId];
    if (series == null || series.p !== 'K' || series.w.length === 0) continue;
    const stats: CardRoleStat[] = [];
    for (const spec of K_METRICS) {
      const value = weeklyMetricValue(series, columns, spec);
      if (value == null) continue;
      // FG% needs an attempt on the board to mean anything — same guard the old fgaSum > 0 check made.
      if (spec.key === 'fgPct' && sum(columnValues(series, columns, 'fga')) <= 0) continue;
      const cohortValues = cohortValuesByKey.get(spec.key)!;
      const percentile = cohortValues.length >= MIN_COHORT ? percentileOf(cohortValues, value) : null;
      const display = weeklyMetricDisplay(value, spec);
      stats.push({
        label: spec.label,
        display,
        percentile,
        title: `${display} ${spec.label.toLowerCase()} from the ${weeklyArtifact.season} weekly game log`
          + (percentile == null
            ? `, percentile unavailable vs ${cohort.length} kickers. ${PROVENANCE_SUFFIX}`
            : `, ${Math.round(percentile)}th percentile vs ${cohort.length} kickers with observed weeks. ${PROVENANCE_SUFFIX}`),
      });
    }
    if (stats.length > 0) map.set(player.playerId, stats);
  }
}

interface DefCardMetric {
  key: string;
  label: string;
  compute: (series: PlayerWeeklyStatSeries, columns: string[]) => number | null;
  /** true → lower raw value is better (points allowed); the percentile is inverted so a stingy
   * defense still reads a high (good) band — same inversion `defPreventionColumn` in
   * `weeklyRoleColumns.ts` applies to its fill. */
  invert?: boolean;
}

const DEF_METRICS: readonly DefCardMetric[] = [
  { key: 'sacks', label: 'Sacks/g', compute: (s, c) => mean(columnValues(s, c, 'sack')) },
  {
    key: 'takeaways',
    label: 'Takeaways/g',
    compute: (s, c) => {
      const intPerGame = mean(columnValues(s, c, 'int'));
      const fumRecPerGame = mean(columnValues(s, c, 'fum_rec'));
      return intPerGame == null && fumRecPerGame == null ? null : (intPerGame ?? 0) + (fumRecPerGame ?? 0);
    },
  },
  { key: 'ptsAllow', label: 'Pts allow/g', compute: (s, c) => mean(columnValues(s, c, 'pts_allow')), invert: true },
  { key: 'passDef', label: 'PD/g', compute: (s, c) => mean(columnValues(s, c, 'def_pass_def')) },
];

/** DEF — same weekly-artifact percentile treatment as K. */
function buildDefStats(input: {
  players: readonly PlayerMeta[];
  weeklyArtifact: PlayerWeeklyStatsArtifact;
  map: Map<PlayerId, readonly CardRoleStat[]>;
}): void {
  const { players, weeklyArtifact, map } = input;
  const columns = weeklyArtifact.columns.DEF;
  if (columns == null) return;
  const cohort = Object.values(weeklyArtifact.players).filter((series) => series.p === 'DEF' && series.w.length > 0);
  const cohortValuesByKey = new Map(DEF_METRICS.map((spec) => [
    spec.key,
    cohort.map((series) => spec.compute(series, columns)).filter((v): v is number => v != null),
  ]));

  for (const player of players) {
    if (player.position !== 'DEF') continue;
    const series = weeklyArtifact.players[player.playerId];
    if (series == null || series.p !== 'DEF' || series.w.length === 0) continue;
    const stats: CardRoleStat[] = [];
    for (const spec of DEF_METRICS) {
      const value = spec.compute(series, columns);
      if (value == null) continue;
      const cohortValues = cohortValuesByKey.get(spec.key)!;
      let percentile: number | null = null;
      if (cohortValues.length >= MIN_COHORT) {
        const raw = percentileOf(cohortValues, value);
        percentile = spec.invert ? 100 - raw : raw;
      }
      const display = formatCount(value);
      stats.push({
        label: spec.label,
        display,
        percentile,
        title: `${display} ${spec.label.toLowerCase()} from the ${weeklyArtifact.season} weekly game log`
          + (percentile == null
            ? `, percentile unavailable vs ${cohort.length} defenses. ${PROVENANCE_SUFFIX}`
            : `, ${Math.round(percentile)}th percentile vs ${cohort.length} defenses with observed weeks. ${PROVENANCE_SUFFIX}`),
      });
    }
    if (stats.length > 0) map.set(player.playerId, stats);
  }
}

/** Board-wide card-bottom role stats for every player in the pool. See the file doc comment for
 * the per-position picks. Returns an empty map entry (player absent) rather than `[]` when a
 * position/player has nothing to show — callers should treat "no key" the same as "empty list". */
export function buildCardRoleStatsIndex(input: CardRoleStatsIndexInput): Map<PlayerId, readonly CardRoleStat[]> {
  const { players, usage, weeklyArtifact } = input;
  const map = new Map<PlayerId, readonly CardRoleStat[]>();
  buildSkillStats({ players, usage, map });
  if (weeklyArtifact != null) {
    buildQbStats({ players, weeklyArtifact, map });
    buildKStats({ players, weeklyArtifact, map });
    buildDefStats({ players, weeklyArtifact, map });
  }
  return map;
}
