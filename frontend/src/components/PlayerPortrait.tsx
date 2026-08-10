import { useEffect, useState } from 'react';
import type { PlayerMeta } from '../../../shared/types';
import { initialsAvatarDataUri, playerPortraitUrl } from '../data/playerPortrait';

interface Props {
  player: Pick<PlayerMeta, 'playerId' | 'name' | 'position' | 'team'>;
  className?: string;
}

/** Fixed-dimension portrait with a deterministic initials fallback on load failure — used by both
 * the recommendation cards and the My Team rail. Fixed size + `loading="lazy"` avoid layout shift
 * as ~5-15 of these mount/unmount per tab switch or roster update. */
export function PlayerPortrait({ player, className }: Props) {
  const primaryUrl = playerPortraitUrl(player);
  const fallbackUrl = initialsAvatarDataUri(player.playerId, player.name);
  const [src, setSrc] = useState(primaryUrl ?? fallbackUrl);

  // My Team keys slots by `${slot}-${index}`, so optimizeLineup reshuffles can reuse this instance
  // for a different player without remounting — reset to the new primary URL when identity changes.
  useEffect(() => {
    setSrc(primaryUrl ?? fallbackUrl);
  }, [player.playerId, primaryUrl, fallbackUrl]);

  return (
    <img
      className={className ? `player-portrait ${className}` : 'player-portrait'}
      src={src}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      onError={() => { if (src !== fallbackUrl) setSrc(fallbackUrl); }}
    />
  );
}
