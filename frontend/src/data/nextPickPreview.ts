import type { AdpEntry, Pick, PlayerId, PlayerMeta } from '../../../shared/types';
import { estimateAvailability } from '../engine/availability';

export interface NextPickPreviewRow {
  playerId: PlayerId;
  name: string;
  position: PlayerMeta['position'];
  adp: number;
  survivalProbability: number;
}

/** Informational market window only: the ten undrafted players whose consensus ADP is closest to
 * the user's next decision. This never selects recommendation or simulation candidates. */
export function buildNextPickPreview(
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
  adp: readonly AdpEntry[],
  picks: readonly Pick[],
  currentPick: number,
  nextPick: number,
  limit = 10,
): NextPickPreviewRow[] {
  if (limit <= 0 || nextPick <= currentPick) return [];
  const drafted = new Set(picks.flatMap((pick) => pick.playerId == null ? [] : [pick.playerId]));
  return adp
    .flatMap((entry): NextPickPreviewRow[] => {
      if (entry.playerId == null || drafted.has(entry.playerId) || !Number.isFinite(entry.adp)) return [];
      const player = playersById.get(entry.playerId);
      const availability = estimateAvailability(entry, { currentPick, nextPick });
      if (!player || availability == null) return [];
      return [{
        playerId: entry.playerId,
        name: player.name,
        position: player.position,
        adp: entry.adp,
        survivalProbability: availability.probability,
      }];
    })
    .sort((a, b) => Math.abs(a.adp - nextPick) - Math.abs(b.adp - nextPick)
      || a.adp - b.adp
      || a.playerId.localeCompare(b.playerId))
    .slice(0, limit);
}
