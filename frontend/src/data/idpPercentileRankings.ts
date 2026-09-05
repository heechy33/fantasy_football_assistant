import type { IdpPlayer, IdpRoleSummary } from './idpProjections';
import { loadIdpPlayers } from './idpProjections';

export interface IdpPercentileStat {
  key: string;
  label: string;
  display: string | null;
  percentile: number | null;
}

export interface IdpPercentileGroup {
  id: string;
  label: string;
  stats: IdpPercentileStat[];
}

export interface IdpPercentileRankings {
  cohortSize: number;
  groups: IdpPercentileGroup[];
}

/**
 * Percent of the cohort at or below the player's value, 0-100.
 * Ties count in the player's favor, identical to offensive percentile rankings.
 */
export function percentileOf(cohortValues: readonly number[], value: number): number {
  if (cohortValues.length === 0) return 50;
  const atOrBelow = cohortValues.reduce((count, candidate) => (candidate <= value ? count + 1 : count), 0);
  return (atOrBelow / cohortValues.length) * 100;
}

/**
 * Builds the 5 defensive percentile ranking groups ("Snaps", "Tackles", "Pass Rush", "Coverage", "Form")
 * for a defensive player against their same Yahoo slot cohort ('D' or 'S').
 */
export function buildIdpPercentileRankings(
  player: IdpPlayer,
  allPlayersInSlot?: readonly IdpPlayer[],
): IdpPercentileRankings | null {
  const role = player.role;
  if (!role || role.gamesPlayed <= 0) return null;

  const pool = allPlayersInSlot ?? loadIdpPlayers(player.slot);
  const cohort = pool.filter((p) => (p.role?.gamesPlayed ?? 0) > 0);
  if (!cohort.some((p) => p.id === player.id)) {
    cohort.push(player);
  }

  function getPercentile(
    extract: (r: IdpRoleSummary) => number | null | undefined,
    currentVal: number | null | undefined,
  ): number | null {
    if (currentVal == null) return null;
    const values = cohort
      .map((p) => (p.role ? extract(p.role) : null))
      .filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return percentileOf(values, currentVal);
  }

  const groups: IdpPercentileGroup[] = [
    {
      id: 'snaps',
      label: 'Snaps',
      stats: [
        {
          key: 'snapPct',
          label: 'Def Snap Share',
          display: role.snapPct != null ? `${role.snapPct}%` : null,
          percentile: getPercentile((r) => r.snapPct, role.snapPct),
        },
        {
          key: 'snapsPerGame',
          label: 'Snaps / Game',
          display: role.snapsPerGame != null ? role.snapsPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.snapsPerGame, role.snapsPerGame),
        },
        {
          key: 'gamesStarted',
          label: 'Games Started',
          display: `${role.gamesStarted} / ${role.gamesPlayed}`,
          percentile: getPercentile((r) => r.gamesStarted, role.gamesStarted),
        },
      ],
    },
    {
      id: 'tackles',
      label: 'Tackles',
      stats: [
        {
          key: 'tacklesPerGame',
          label: 'Total Tackles / G',
          display: role.tacklesPerGame != null ? role.tacklesPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.tacklesPerGame, role.tacklesPerGame),
        },
        {
          key: 'soloPerGame',
          label: 'Solo Tackles / G',
          display: role.soloPerGame != null ? role.soloPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.soloPerGame, role.soloPerGame),
        },
        {
          key: 'astPerGame',
          label: 'Assisted Tackles / G',
          display: role.astPerGame != null ? role.astPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.astPerGame, role.astPerGame),
        },
        {
          key: 'tflPerGame',
          label: 'Tackles for Loss / G',
          display: role.tflPerGame != null ? role.tflPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.tflPerGame, role.tflPerGame),
        },
      ],
    },
    {
      id: 'passRush',
      label: 'Pass Rush',
      stats: [
        {
          key: 'sacksPerGame',
          label: 'Sacks / Game',
          display: role.sacksPerGame != null ? role.sacksPerGame.toFixed(2) : null,
          percentile: getPercentile((r) => r.sacksPerGame, role.sacksPerGame),
        },
        {
          key: 'totalSacks',
          label: 'Total Sacks',
          display: role.totalSacks != null ? role.totalSacks.toFixed(1) : null,
          percentile: getPercentile((r) => r.totalSacks, role.totalSacks),
        },
        {
          key: 'qbHitsPerGame',
          label: 'QB Hits / Game',
          display: role.qbHitsPerGame != null ? role.qbHitsPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.qbHitsPerGame, role.qbHitsPerGame),
        },
      ],
    },
    {
      id: 'coverage',
      label: 'Coverage',
      stats: [
        {
          key: 'pdPerGame',
          label: 'Passes Defended / G',
          display: role.pdPerGame != null ? role.pdPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.pdPerGame, role.pdPerGame),
        },
        {
          key: 'totalInt',
          label: 'Interceptions',
          display: role.totalInt != null ? String(role.totalInt) : null,
          percentile: getPercentile((r) => r.totalInt, role.totalInt),
        },
        {
          key: 'forcedFumbles',
          label: 'Forced Fumbles',
          display: role.forcedFumbles != null ? String(role.forcedFumbles) : null,
          percentile: getPercentile((r) => r.forcedFumbles, role.forcedFumbles),
        },
        {
          key: 'fumbleRecoveries',
          label: 'Fumble Recoveries',
          display: role.fumbleRecoveries != null ? String(role.fumbleRecoveries) : null,
          percentile: getPercentile((r) => r.fumbleRecoveries, role.fumbleRecoveries),
        },
      ],
    },
    {
      id: 'form',
      label: 'Form',
      stats: [
        {
          key: 'fptsPerGame',
          label: 'Season Yahoo FPTS / G',
          display: role.fptsPerGame != null ? role.fptsPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.fptsPerGame, role.fptsPerGame),
        },
        {
          key: 'last5FptsPerGame',
          label: 'Last 5 Games FPTS / G',
          display: role.last5FptsPerGame != null ? role.last5FptsPerGame.toFixed(1) : null,
          percentile: getPercentile((r) => r.last5FptsPerGame, role.last5FptsPerGame),
        },
        {
          key: 'ceiling',
          label: 'Season Ceiling',
          display: role.ceiling != null ? `${role.ceiling.toFixed(1)} pts` : null,
          percentile: getPercentile((r) => r.ceiling, role.ceiling),
        },
        {
          key: 'floor',
          label: 'Season Floor',
          display: role.floor != null ? `${role.floor.toFixed(1)} pts` : null,
          percentile: getPercentile((r) => r.floor, role.floor),
        },
      ],
    },
  ];

  return { cohortSize: cohort.length, groups };
}
