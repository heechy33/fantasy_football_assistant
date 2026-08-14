import type { AdpEntry, FantasyProsStars, PlayerId, PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import { adpPositionalRank, displayPositionalRank } from '../data/positionalRank';
import { playerStatusTag } from '../data/playerStatusTag';
import type { Recommendation } from '../engine/recommend';

export interface PlayerBoardFaceProps {
  playerId: PlayerId;
  recommendation: Recommendation | null;
  player: PlayerMeta | undefined;
  rank: number;
  adp?: number | null;
  adpBoard?: readonly AdpEntry[];
  fantasyPros?: FantasyProsStars;
  usage?: PlayerUsage;
  depthRole?: TeamDepthRole | null;
  avgPointsPerGame?: number | null;
}

export function formatBoardStat(value: number | null | undefined): string {
  return value == null ? '\u2014' : value.toFixed(1);
}

export function boardUsageStat(position: string | null | undefined, usage: PlayerUsage | undefined): { label: string; value: string } | null {
  if (usage == null) return null;
  if (position === 'RB' && usage.carryShare != null) return { label: 'Carry', value: `${Math.round(usage.carryShare * 100)}%` };
  if ((position === 'WR' || position === 'TE') && usage.targetShare != null) return { label: 'Tgt', value: `${Math.round(usage.targetShare * 100)}%` };
  if (position === 'QB' && usage.completionPct != null) return { label: 'Cmp%', value: `${Math.round(usage.completionPct * 100)}%` };
  return null;
}

export function boardFaceValues({ playerId, recommendation, player, adp, adpBoard, fantasyPros, usage, depthRole, avgPointsPerGame }: PlayerBoardFaceProps) {
  const isRoleless = player?.position === 'K' || player?.position === 'DEF';
  return {
    name: player?.name ?? playerId,
    projectionValue: recommendation?.projectedPoints ?? null,
    adpValue: recommendation?.availabilityAdp ?? adp ?? null,
    positionalRank: displayPositionalRank(fantasyPros?.positionRank, adpPositionalRank(playerId, player?.position, adpBoard)),
    usageStat: boardUsageStat(player?.position, usage),
    statusTag: player ? playerStatusTag(player, usage) : null,
    isRoleless,
    roleLabel: depthRole?.label ?? '\u2014',
    roleTitle: depthRole?.headline ?? 'Team role unavailable',
    avgPointsPerGame,
  };
}
