import type { PlayerMeta, PlayerUsage } from '../../../shared/types';

export type PlayerStatusTagKind = 'unavailable' | 'injury' | 'rookie' | 'new-team';

export interface PlayerStatusTag {
  kind: PlayerStatusTagKind;
  label: string;
}

const INJURY_LABELS: Readonly<Record<string, string>> = {
  questionable: 'Q',
  pup: 'PUP',
  out: 'O',
  ir: 'IR',
  doubtful: 'D',
  suspended: 'SUS',
  suspension: 'SUS',
  // Sleeper emits these exact tokens on `injuryStatus` (verified live) — without these keys they
  // fell through to a raw, oddly-cased badge ('Sus', 'NA', 'DNR') instead of a normalized label.
  sus: 'SUS',
  na: 'NA',
  dnr: 'DNR',
  exempt: 'Exempt',
};

/**
 * Every status tag that applies to this player (unavailable, injury, rookie, new-team — a player
 * can be more than one at once, e.g. an injured rookie), in the same priority order as
 * playerStatusTag below. Used by the player detail drawer (2026-08-30), which has room to show the
 * full picture; the compact card/row surfaces stay on playerStatusTag.
 */
export function playerStatusTags(
  player: Pick<PlayerMeta, 'injuryStatus' | 'yearsExp' | 'status' | 'availability'>,
  usage?: Pick<PlayerUsage, 'teamChanged'> | null,
): PlayerStatusTag[] {
  const tags: PlayerStatusTag[] = [];
  // Season-long-or-longer unavailability (Exempt/Suspended/IR/PUP/NFI — see
  // pipeline/transform.py's resolve_availability/apply_status_overrides) is distinct from, and
  // takes priority over, the weekly injuryStatus tag below: a player can be simultaneously
  // "Questionable" for this week's game log and season-long Exempt.
  if ((player.availability ?? 1) <= 0) {
    tags.push({ kind: 'unavailable', label: player.status?.trim() || 'Unavailable' });
  }
  const status = player.injuryStatus?.trim();
  if (status) {
    tags.push({ kind: 'injury', label: INJURY_LABELS[status.toLowerCase()] ?? status });
  }
  if (player.yearsExp === 0) {
    tags.push({ kind: 'rookie', label: 'Rookie' });
  }
  if (usage?.teamChanged === true) {
    tags.push({ kind: 'new-team', label: 'New team' });
  }
  return tags;
}

/**
 * At most one draft-board status chip — the compact card/row surfaces have no room for a stack of
 * tags. Unavailable beats injury; injury beats rookie; rookie beats a new-team move. Compact
 * injury labels keep the meta line (`DEN · LWR #2 Q`) readable. Equivalent to
 * playerStatusTags(...)[0] ?? null.
 */
export function playerStatusTag(
  player: Pick<PlayerMeta, 'injuryStatus' | 'yearsExp' | 'status' | 'availability'>,
  usage?: Pick<PlayerUsage, 'teamChanged'> | null,
): PlayerStatusTag | null {
  return playerStatusTags(player, usage)[0] ?? null;
}

export function statusTagClassName(kind: PlayerStatusTagKind): string {
  if (kind === 'unavailable') return 'badge badge-danger';
  return kind === 'injury' ? 'badge badge-warning' : 'badge badge-info';
}
