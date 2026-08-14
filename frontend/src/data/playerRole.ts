import type {
  OpportunityPeriod,
  OpportunityProfile,
  PlayerMeta,
  PlayerProduction,
  PlayerUsage,
  PlayerWeeklyStatSeries,
  WeeklyFantasyPoints,
} from '../../../shared/types';
import { formatOpportunityDelta } from './playerContext';
import { pprFromReceptions, pprFromRushes, resolvePointsPerGame } from './pprProduction';
import {
  deltaTone,
  formatCount,
  formatShare,
  formatWhole,
  type RoleColumn,
  type RoleStat,
} from './roleColumn';
import { buildWeeklyRoleColumns } from './weeklyRoleColumns';

// Re-exported for existing callers (StatBar.tsx, playerRole.test.ts) --
// the canonical definitions now live in roleColumn.ts, shared with
// weeklyRoleColumns.ts, to avoid a circular import between the two.
export type { RoleColumnId, DeltaTone } from './roleColumn';
export type { RoleColumn, RoleStat };
export { deltaTone, formatCount, formatShare, formatWhole };

function roleLabel(value: number | null, elite: number, strong: number): string {
  if (value == null) return 'Unavailable';
  if (value >= elite) return 'Elite';
  if (value >= strong) return 'Strong';
  if (value >= strong / 2) return 'Average';
  return 'Limited';
}

function formRating(delta: number | null): string {
  if (delta == null) return 'Unavailable';
  if (delta >= 0.5) return 'Rising';
  if (delta <= -0.5) return 'Falling';
  return 'Steady';
}

function clamp01(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function shareFill(value: number | null, cap: number): number | null {
  return value == null ? null : clamp01(value / cap);
}

function deltaFill(delta: number | null): number | null {
  if (delta == null) return null;
  return clamp01(0.5 + Math.max(-0.5, Math.min(0.5, delta / 4)));
}

function productionResult(
  touchesPerGame: number | null,
  ppg: number | null,
): string | undefined {
  if (ppg == null) return undefined;
  if (touchesPerGame == null) return `${ppg.toFixed(1)} PPR/g`;
  return `${formatCount(touchesPerGame)} touches/g → ${ppg.toFixed(1)} PPR/g`;
}

/**
 * Position-aware FIFA columns for the player-detail role panel. Display-only: nothing here
 * feeds planValue, or any sort comparator.
 *
 * QB/K/DEF delegate entirely to `weeklyRoleColumns.ts` (the weekly game log),
 * not the `opportunity` aggregate below: `player-usage.json`'s opportunity
 * builder nulls QB target share on purpose (pipeline/context.py) and has no
 * passing/kicking/defense fields at all, so weekly is the only source that
 * can populate these positions without a pipeline/artifact schema change.
 * RB/WR/TE stay on the season `opportunity` path unchanged.
 */
export function buildRoleColumns(input: {
  player: PlayerMeta;
  usage: PlayerUsage | undefined;
  weeks?: readonly WeeklyFantasyPoints[];
  weeklyStats?: { series: PlayerWeeklyStatSeries | undefined; columns: Record<string, string[]> };
}): RoleColumn[] {
  const position = input.player.position;

  if (position === 'QB' || position === 'K' || position === 'DEF') {
    if (input.weeklyStats == null) return [];
    return buildWeeklyRoleColumns({
      position,
      series: input.weeklyStats.series,
      columns: input.weeklyStats.columns,
    });
  }

  const opportunity = input.usage?.opportunity;
  if (opportunity == null) return [];

  const season = opportunity.season;
  const finalFive = opportunity.finalFive;
  const evolution = opportunity.roleEvolution;
  const production = input.usage?.production ?? null;
  const ppg = resolvePointsPerGame(input.weeks ?? [], production);

  if (position === 'RB') {
    return [
      volumeColumn(season, production, ppg, 'RB'),
      receivingColumn(season, production, evolution),
      scoringColumn(season, 'RB'),
      formColumn(finalFive, evolution, 'RB'),
    ];
  }

  const skillPosition = position === 'TE' ? 'TE' : 'WR';
  return [
    volumeColumn(season, production, ppg, skillPosition),
    skillReceivingColumn(season, production, evolution),
    scoringColumn(season, skillPosition),
    formColumn(finalFive, evolution, skillPosition),
  ];
}

function volumeColumn(
  season: OpportunityPeriod,
  production: PlayerProduction | null,
  ppg: number | null,
  position: string,
): RoleColumn {
  const isRb = position === 'RB';
  const volume = isRb ? season.carryShare : season.targetShare;
  const stats: RoleStat[] = isRb
    ? [
      { label: 'Carry share', display: formatShare(season.carryShare), fill: shareFill(season.carryShare, 0.5) },
      { label: 'Touches/game', display: formatCount(season.touchesPerGame), fill: shareFill(season.touchesPerGame, 25) },
    ]
    : [
      { label: 'Target share', display: formatShare(season.targetShare), fill: shareFill(season.targetShare, 0.3) },
      { label: 'Targets/game', display: formatCount(season.targetsPerGame), fill: shareFill(season.targetsPerGame, 12) },
    ];
  if (isRb && production) {
    // Yards per carry -- the efficiency lens on the same carries counted above.
    const ypc = season.carries > 0 ? production.rushingYards / season.carries : null;
    stats.push({
      label: 'YPC',
      display: formatCount(ypc),
      fill: shareFill(ypc, 5),
    });
    stats.push({
      label: 'PPR from rushes',
      display: pprFromRushes(production.rushingYards, production.rushingTds).toFixed(1),
      fill: shareFill(pprFromRushes(production.rushingYards, production.rushingTds), 200),
    });
  }
  if (!isRb && production) {
    stats.push({
      label: 'Receptions',
      display: formatWhole(production.receptions),
      fill: shareFill(production.receptions, 120),
    });
  }
  return {
    id: 'volume',
    label: 'Volume',
    rating: roleLabel(volume, isRb ? 0.4 : 0.25, isRb ? 0.25 : 0.15),
    fill: shareFill(volume, isRb ? 0.5 : 0.3),
    result: productionResult(isRb ? season.touchesPerGame : season.targetsPerGame, ppg),
    stats,
  };
}

function receivingColumn(
  season: OpportunityPeriod,
  production: PlayerProduction | null,
  evolution: OpportunityProfile['roleEvolution'],
): RoleColumn {
  const stats: RoleStat[] = [
    {
      label: 'Target share',
      display: formatShare(season.targetShare),
      fill: shareFill(season.targetShare, 0.3),
      delta: evolution.targetShareDelta == null ? undefined : {
        text: formatOpportunityDelta(evolution.targetShareDelta, 'share'),
        tone: deltaTone(evolution.targetShareDelta),
      },
    },
    {
      label: 'Targets/game',
      display: formatCount(season.targetsPerGame),
      fill: shareFill(season.targetsPerGame, 12),
      delta: evolution.targetsPerGameDelta == null ? undefined : {
        text: formatOpportunityDelta(evolution.targetsPerGameDelta),
        tone: deltaTone(evolution.targetsPerGameDelta),
      },
    },
  ];
  let result: string | undefined;
  if (production) {
    // Yards per reception -- the efficiency lens on the catches counted below.
    const ypr = production.receptions > 0 ? production.receivingYards / production.receptions : null;
    stats.push(
      { label: 'Receptions', display: formatWhole(production.receptions), fill: shareFill(production.receptions, 120) },
      { label: 'Rec. yards', display: formatWhole(production.receivingYards), fill: shareFill(production.receivingYards, 1200) },
      { label: 'YPR', display: formatCount(ypr), fill: shareFill(ypr, 15) },
      { label: 'Rec. TDs', display: formatWhole(production.receivingTds), fill: shareFill(production.receivingTds, 12) },
    );
    result = `${pprFromReceptions(production.receptions, production.receivingYards, production.receivingTds).toFixed(1)} PPR from catches`;
  }
  return {
    id: 'receiving',
    label: 'Receiving',
    rating: roleLabel(season.targetShare, 0.2, 0.12),
    fill: shareFill(season.targetShare, 0.3),
    result,
    stats,
  };
}

/**
 * WR/TE receiving column: production (yards, yards-per-reception, TDs) plus the
 * air-efficiency pair (air-yard share, YAC) that used to be its own separate
 * "Air" column. Folding them in keeps the panel at a clean 2x2 grid while
 * closing the old gap where WR/TE showed no receptions or receiving yards at
 * all. The rating anchors on air-yard share -- the strongest pure "role" signal
 * for pass catchers -- and the numbers below carry the actual production.
 */
function skillReceivingColumn(
  season: OpportunityPeriod,
  production: PlayerProduction | null,
  evolution: { airYardsShareDelta: number | null },
): RoleColumn {
  const stats: RoleStat[] = [];
  if (production) {
    const ypr = production.receptions > 0 ? production.receivingYards / production.receptions : null;
    stats.push(
      { label: 'Rec. yards', display: formatWhole(production.receivingYards), fill: shareFill(production.receivingYards, 1200) },
      { label: 'YPR', display: formatCount(ypr), fill: shareFill(ypr, 15) },
      { label: 'Rec. TDs', display: formatWhole(production.receivingTds), fill: shareFill(production.receivingTds, 12) },
    );
  }
  stats.push(
    {
      label: 'Air-yard share',
      display: formatShare(season.airYardsShare),
      fill: shareFill(season.airYardsShare, 0.4),
      delta: evolution.airYardsShareDelta == null ? undefined : {
        text: formatOpportunityDelta(evolution.airYardsShareDelta, 'share'),
        tone: deltaTone(evolution.airYardsShareDelta),
      },
    },
    {
      label: 'YAC',
      display: formatCount(season.receivingYardsAfterCatch, 0),
      fill: shareFill(season.receivingYardsAfterCatch, 500),
    },
  );
  return {
    id: 'receiving',
    label: 'Receiving',
    rating: roleLabel(season.airYardsShare, 0.3, 0.2),
    fill: shareFill(season.airYardsShare, 0.4),
    result: production == null ? undefined : `${formatWhole(production.receivingYards)} rec yds`,
    stats,
  };
}

function scoringColumn(
  season: OpportunityPeriod,
  position: string,
): RoleColumn {
  const isRb = position === 'RB';
  const goalLineRate = season.goalLineCarries == null || season.games === 0
    ? null
    : Math.min(1, season.goalLineCarries / season.games);
  const stats: RoleStat[] = isRb
    ? [
      { label: 'Goal-line carries', display: formatWhole(season.goalLineCarries), fill: goalLineRate },
      { label: 'Red-zone targets', display: formatWhole(season.redZoneTargets), fill: shareFill(season.redZoneTargets, 20) },
    ]
    : [
      { label: 'Red-zone targets', display: formatWhole(season.redZoneTargets), fill: shareFill(season.redZoneTargets, 20) },
      { label: 'End-zone targets', display: formatWhole(season.endZoneTargets), fill: shareFill(season.endZoneTargets, 8) },
    ];
  const fill = isRb ? goalLineRate : shareFill(season.redZoneTargets, 20);
  const rating = isRb
    ? roleLabel(goalLineRate, 0.8, 0.4)
    : roleLabel(season.redZoneTargets == null || season.games === 0 ? null : season.redZoneTargets / season.games, 0.8, 0.4);
  return {
    id: 'scoring',
    label: 'Scoring',
    rating,
    fill,
    stats,
  };
}

function formColumn(
  finalFive: OpportunityPeriod | null,
  evolution: {
    targetsPerGameDelta: number | null;
    targetShareDelta: number | null;
    airYardsShareDelta: number | null;
    touchesPerGameDelta: number | null;
  },
  position: string,
): RoleColumn {
  const primaryDelta = position === 'RB' || position === 'QB'
    ? evolution.touchesPerGameDelta
    : evolution.targetsPerGameDelta;
  const stats: RoleStat[] = [
    {
      label: 'Final 5 targets/g',
      display: formatCount(finalFive?.targetsPerGame ?? null),
      fill: shareFill(finalFive?.targetsPerGame ?? null, 12),
      delta: evolution.targetsPerGameDelta == null ? undefined : {
        text: formatOpportunityDelta(evolution.targetsPerGameDelta),
        tone: deltaTone(evolution.targetsPerGameDelta),
      },
    },
    {
      label: 'Final 5 touches/g',
      display: formatCount(finalFive?.touchesPerGame ?? null),
      fill: shareFill(finalFive?.touchesPerGame ?? null, 25),
      delta: evolution.touchesPerGameDelta == null ? undefined : {
        text: formatOpportunityDelta(evolution.touchesPerGameDelta),
        tone: deltaTone(evolution.touchesPerGameDelta),
      },
    },
  ];
  if (position !== 'QB') {
    stats.push({
      label: 'Target share change',
      display: formatOpportunityDelta(evolution.targetShareDelta, 'share'),
      fill: null,
    });
  }
  stats.push({
    label: 'Air-yard share change',
    display: formatOpportunityDelta(evolution.airYardsShareDelta, 'share'),
    fill: null,
  });
  return {
    id: 'form',
    label: 'Form',
    rating: formRating(primaryDelta),
    fill: deltaFill(primaryDelta),
    result: finalFive == null ? undefined : `Last ${finalFive.games} observed games`,
    stats,
  };
}
