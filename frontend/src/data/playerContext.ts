import type { OpportunityPeriod, PlayerMeta, PlayerUsage } from '../../../shared/types';

const aliases: Record<string, string> = {
  'hamstring strain': 'hamstring',
  'strained hamstring': 'hamstring',
  'concussion protocol': 'concussion',
  'achilles tendon': 'achilles',
};

export function normalizeInjuryBodyPart(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    !normalized
    || normalized === 'rest'
    || ['rest ', 'veteran rest', 'not injury related', 'not injury-related'].some((prefix) => normalized.startsWith(prefix))
  ) {
    return null;
  }
  return aliases[normalized] ?? normalized;
}

function displayLabel(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function currentIssueHasPriorHistory(player: PlayerMeta, usage: PlayerUsage | undefined): boolean {
  const current = normalizeInjuryBodyPart(player.injuryBodyPart);
  return current != null && usage?.injuryHistory.some((item) => item.normalizedBodyPart === current) === true;
}

/**
 * Card/modal signals for a loaded usage row. Callers must not invoke this while
 * the context feed is still loading or known-unavailable — an undefined usage
 * then means "this player has no history," not "artifact missing."
 */
export function buildPlayerContextSignals(player: PlayerMeta, usage: PlayerUsage | undefined): string[] {
  const signals: string[] = [];
  const seasonCount = usage?.seasons.length ?? 0;
  if (seasonCount >= 2 && usage?.availabilityRate != null) {
    signals.push(`${seasonCount}-year availability: ${Math.round(usage.availabilityRate * 100)}%`);
  }
  for (const history of usage?.injuryHistory ?? []) {
    if (history.recurring) signals.push(`Recurring ${displayLabel(history.normalizedBodyPart).toLowerCase()} history`);
  }
  if (currentIssueHasPriorHistory(player, usage)) signals.push('Current issue has prior history');
  if (seasonCount < 2) signals.push('Limited history');
  return signals;
}

export function isPlayerContextFeedReady(
  manifestSources: Record<string, { status?: string } | undefined> | undefined,
  usageLoadStatus: 'loading' | 'ready' | 'error',
): boolean {
  if (usageLoadStatus !== 'ready' || !manifestSources) return false;
  return [
    'nflverse_player_stats',
    'nflverse_snap_counts',
    'nflverse_weekly_rosters',
    'nflverse_injuries',
  ].every((name) => manifestSources[name]?.status === 'ok');
}

export function resolvePlayerContextFeedStatus(
  manifestSources: Record<string, { status?: string } | undefined> | undefined,
  usageLoadStatus: 'loading' | 'ready' | 'error',
): 'loading' | 'ready' | 'unavailable' {
  if (usageLoadStatus === 'loading') return 'loading';
  if (usageLoadStatus === 'error') return 'unavailable';
  if (!isPlayerContextFeedReady(manifestSources, usageLoadStatus)) return 'unavailable';
  return 'ready';
}

export function formatOpportunityDelta(value: number | null, kind: 'count' | 'share' = 'count'): string {
  if (value == null) return 'n/a';
  if (kind === 'share') {
    const points = value * 100;
    return (points >= 0 ? '+' : '') + points.toFixed(1) + ' pp';
  }
  return (value >= 0 ? '+' : '') + value.toFixed(1);
}

function roleLabel(value: number | null, elite: number, strong: number): string {
  if (value == null) return 'Unavailable';
  if (value >= elite) return 'Elite';
  if (value >= strong) return 'Strong';
  if (value >= strong / 2) return 'Average';
  return 'Limited';
}

export interface OpportunityRoleItem {
  label: string;
  rating: string;
  basis: string;
  fill: number | null;
}

export function buildOpportunityRoleProfile(
  player: PlayerMeta,
  period: OpportunityPeriod,
): OpportunityRoleItem[] {
  const volume = player.position === 'RB' ? period.carryShare : period.targetShare;
  const goalLineRate = period.goalLineCarries == null || period.games === 0
    ? null
    : Math.min(1, period.goalLineCarries / period.games);
  const bigPlay = period.airYardsShare;
  const roles: OpportunityRoleItem[] = [
    {
      label: 'Volume',
      rating: roleLabel(volume, .4, .25),
      basis: player.position === 'RB' ? 'carry share ' + percentShare(volume) : 'target share ' + percentShare(volume),
      fill: volume == null ? null : Math.min(1, volume / .5),
    },
    {
      label: 'Receiving role',
      rating: roleLabel(period.targetShare, .2, .12),
      basis: 'target share ' + percentShare(period.targetShare),
      fill: period.targetShare == null ? null : Math.min(1, period.targetShare / .3),
    },
  ];
  if (player.position === 'RB') {
    roles.push({
      label: 'Goal-line role',
      rating: roleLabel(goalLineRate, .8, .4),
      basis: period.goalLineCarries == null ? 'PBP goal-line carries unavailable' : period.goalLineCarries + ' carries in ' + period.games + ' games',
      fill: goalLineRate,
    });
  }
  roles.push({
    label: 'Big-play role',
    rating: roleLabel(bigPlay, .3, .2),
    basis: 'air-yard share ' + percentShare(bigPlay),
    fill: bigPlay == null ? null : Math.min(1, bigPlay / .4),
  });
  return roles;
}

function percentShare(value: number | null): string {
  return value == null ? 'n/a' : Math.round(value * 100) + '%';
}
