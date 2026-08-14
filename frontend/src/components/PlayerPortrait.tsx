import { useEffect, useState } from 'react';
import type { PlayerMeta } from '../../../shared/types';
import { initialsAvatarDataUri, playerPortraitUrl } from '../data/playerPortrait';

interface Props {
  player: Pick<PlayerMeta, 'playerId' | 'name' | 'position' | 'team'>;
  className?: string;
  size?: 'default' | 'hero';
}

/** Fixed-dimension portrait with a deterministic initials fallback on load failure — used by both
 * the recommendation cards and the My Team rail. Fixed size + `loading="lazy"` avoid layout shift
 * as ~5-15 of these mount/unmount per tab switch or roster update. */
const PIXEL_SIZE = { default: 48, hero: 160 } as const;

export function PlayerPortrait({ player, className, size = 'default' }: Props) {
  const primaryUrl = playerPortraitUrl(player);
  const fallbackUrl = initialsAvatarDataUri(player.playerId, player.name);
  const [src, setSrc] = useState(primaryUrl ?? fallbackUrl);
  const px = PIXEL_SIZE[size];
  const classes = ['player-portrait', size === 'hero' ? 'player-portrait-hero' : null, className]
    .filter(Boolean)
    .join(' ');

  // My Team keys slots by `${slot}-${index}`, so optimizeLineup reshuffles can reuse this instance
  // for a different player without remounting — reset to the new primary URL when identity changes.
  useEffect(() => {
    setSrc(primaryUrl ?? fallbackUrl);
  }, [player.playerId, primaryUrl, fallbackUrl]);

  return (
    <img
      className={classes}
      src={src}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      onError={() => { if (src !== fallbackUrl) setSrc(fallbackUrl); }}
    />
  );
}
