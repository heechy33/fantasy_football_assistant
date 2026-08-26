import type { AdpEntry, PlayerId } from '../../../shared/types';

/**
 * ADP positional rank for the card face. Counts same-position ADP rows at or before this
 * player's ADP. Display-only — never a ranking input.
 *
 * Returns the bare label (`RB43`) — the card face renders it as the head chip next to the
 * player name, where an "ADP" prefix is redundant with the adjacent ADP tile.
 * `PlayerBoardRow`'s list-row cell wants the prefix spelled out on its own (no such adjacent
 * context); it adds one back at the call site in `playerBoardFace.ts` rather than this helper
 * carrying two label conventions.
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
  return rank > 0 ? `${position}${rank}` : null;
}
