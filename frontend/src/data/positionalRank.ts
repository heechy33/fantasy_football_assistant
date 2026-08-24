import type { AdpEntry, PlayerId } from '../../../shared/types';

/**
 * ADP positional rank for the card face. Counts same-position ADP rows at or before this
 * player's ADP. Display-only — never a ranking input.
 */
export function adpPositionalRank(
  playerId: PlayerId,
  position: string | null | undefined,
  adpBoard: readonly AdpEntry[] | undefined,
): string | null {
  if (!position || adpBoard == null || adpBoard.length === 0) return null;
  const self = adpBoard.find((entry) => entry.playerId === playerId);
  if (self == null || !Number.isFinite(self.adp)) return null;
  const samePosition = adpBoard.filter(
    (entry) => entry.playerId != null && entry.position === position && Number.isFinite(entry.adp),
  );
  const rank = samePosition.filter((entry) => entry.adp <= self.adp).length;
  return rank > 0 ? `ADP ${position}${rank}` : null;
}
