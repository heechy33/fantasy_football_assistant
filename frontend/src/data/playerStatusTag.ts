import type { PlayerMeta, PlayerUsage } from '../../../shared/types';

export type PlayerStatusTagKind = 'injury' | 'rookie' | 'new-team';

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
};

/**
 * At most one draft-board status chip. Injury beats rookie; rookie beats a new-team move.
 * Compact injury labels keep the meta line (`DEN · LWR #2 Q`) readable.
 */
export function playerStatusTag(
  player: Pick<PlayerMeta, 'injuryStatus' | 'yearsExp'>,
  usage?: Pick<PlayerUsage, 'teamChanged'> | null,
): PlayerStatusTag | null {
  const status = player.injuryStatus?.trim();
  if (status) {
    return { kind: 'injury', label: INJURY_LABELS[status.toLowerCase()] ?? status };
  }
  if (player.yearsExp === 0) {
    return { kind: 'rookie', label: 'Rookie' };
  }
  if (usage?.teamChanged === true) {
    return { kind: 'new-team', label: 'New team' };
  }
  return null;
}

export function statusTagClassName(kind: PlayerStatusTagKind): string {
  return kind === 'injury' ? 'badge badge-warning' : 'badge badge-info';
}
