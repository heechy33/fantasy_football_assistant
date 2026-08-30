import type { AdpEntry, PlayerId, PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import { adpPositionalRank } from '../data/positionalRank';
import { playerStatusTag } from '../data/playerStatusTag';
import type { Recommendation } from '../engine/recommend';

export interface PlayerBoardFaceProps {
  playerId: PlayerId;
  recommendation: Recommendation | null;
  player: PlayerMeta | undefined;
  adp?: number | null;
  adpBoard?: readonly AdpEntry[];
  /** Which upstream produced the ADP shown on the face (`AdpEntry.adpSource`), for
   * the honest per-player label. The ESPN session board is a mixed source (native
   * ESPN head + Sleeper-tail splice), so this must come from the player's own board
   * entry — never a board-wide "ESPN" badge. */
  adpSource?: AdpEntry['adpSource'] | null;
  usage?: PlayerUsage;
  depthRole?: TeamDepthRole | null;
  avgPointsPerGame?: number | null;
  /** Off-clock/market fallback when `recommendation` is null (see boardFaceValues) — an engine
   * recommendation's own `projectedPoints` always wins when present. */
  projectedPoints?: number | null;
  /** Off-clock/market fallback when `recommendation` is null — an engine recommendation's own
   * `availableNextPickProbability` always wins when present. */
  availableNextPickProbability?: number | null;
  /** The current overall pick number. With the row's ADP this yields the reach gap — the reach
   * chip on the card/row face ("Reach +24") is context, never a veto (plan policy: an explanation
   * label, not a "never reach" gate). */
  currentPick?: number | null;
}

/** The engine's reach threshold (`recommend.ts`'s ADP_REACH_WARNING_THRESHOLD): a player whose
 * ADP sits at least this many picks past the current pick is flagged "Reach +N" on the face —
 * informational, so a 90–110-ADP recommendation at pick 71 is self-explanatory. */
export const REACH_WARNING_GAP = 20;

/** The ADP gap past the current pick, when both numbers exist — the reach chip's input. */
export function reachGapFor(adp: number | null | undefined, currentPick: number | null | undefined): number | null {
  if (adp == null || !Number.isFinite(adp) || currentPick == null || !Number.isFinite(currentPick)) return null;
  return Math.round(adp - currentPick);
}

export function formatBoardStat(value: number | null | undefined): string {
  return value == null ? '\u2014' : value.toFixed(1);
}

/** Short display name for an ADP provenance (`adpSource`), or null when unknown. */
export function adpSourceLabel(source: AdpEntry['adpSource'] | null | undefined): string | null {
  if (source === 'espn') return 'ESPN';
  if (source === 'sleeper') return 'Sleeper';
  if (source === 'ffc') return 'FFC';
  if (source === 'underdog') return 'Underdog';
  return null;
}

export function boardUsageStat(position: string | null | undefined, usage: PlayerUsage | undefined): { label: string; value: string } | null {
  if (usage == null) return null;
  if (position === 'RB' && usage.carryShare != null) return { label: 'Carry', value: `${Math.round(usage.carryShare * 100)}%` };
  if ((position === 'WR' || position === 'TE') && usage.targetShare != null) return { label: 'Tgt', value: `${Math.round(usage.targetShare * 100)}%` };
  if (position === 'QB' && usage.completionPct != null) return { label: 'Cmp%', value: `${Math.round(usage.completionPct * 100)}%` };
  return null;
}

export function boardFaceValues({
  playerId, recommendation, player, adp, adpBoard, adpSource, usage, depthRole, avgPointsPerGame,
  projectedPoints, availableNextPickProbability, currentPick,
}: PlayerBoardFaceProps) {
  const isRoleless = player?.position === 'K' || player?.position === 'DEF';
  const adpValue = recommendation?.availabilityAdp ?? adp ?? null;
  const reachGap = reachGapFor(adpValue, currentPick);
  return {
    name: player?.name ?? playerId,
    projectionValue: recommendation?.projectedPoints ?? projectedPoints ?? null,
    adpValue,
    adpSourceLabel: adpSourceLabel(adpSource),
    availabilityValue: recommendation?.availableNextPickProbability ?? availableNextPickProbability ?? null,
    /** "Reach +N" chip input — null/under-threshold means no chip. Context only, never a veto. */
    reachGap: reachGap != null && reachGap >= REACH_WARNING_GAP ? reachGap : null,
    // adpPositionalRank returns the bare label ("RB43"); the row cell has no adjacent ADP-tile
    // context to lean on the way the card face does, so it spells "ADP" back out here.
    positionalRank: (() => {
      const rank = adpPositionalRank(playerId, player?.position, adpBoard);
      return rank == null ? null : `ADP ${rank}`;
    })(),
    usageStat: boardUsageStat(player?.position, usage),
    statusTag: player ? playerStatusTag(player, usage) : null,
    isRoleless,
    roleLabel: depthRole?.label ?? '\u2014',
    roleTitle: depthRole?.headline ?? 'Team role unavailable',
    avgPointsPerGame,
  };
}
