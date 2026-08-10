import type { PlayerMeta } from '../../../shared/types';

/**
 * Sleeper's keyless CDN. Player headshots are indexed by Sleeper's own player id (our canonical
 * `playerId`), but team defenses are modeled with the team abbreviation as their `playerId` (see
 * `pipeline/transform.py`'s DEF rows) — that id isn't a real Sleeper player and 404s against the
 * player-headshot path, so DEF gets the team-logo path instead.
 *
 * No API key or CSP entry is required: `frontend/public/staticwebapp.config.json` sets no
 * `Content-Security-Policy` header, and Sleeper serves these images unauthenticated.
 */
export function playerPortraitUrl(player: Pick<PlayerMeta, 'playerId' | 'position' | 'team'>): string | null {
  if (player.position === 'DEF') {
    return player.team ? `https://sleepercdn.com/images/team_logos/nfl/${player.team.toLowerCase()}.png` : null;
  }
  return `https://sleepercdn.com/content/nfl/players/${player.playerId}.jpg`;
}

const AVATAR_PALETTE = ['#7dd3fc', '#a7f3d0', '#fca5a5', '#fcd34d', '#c4b5fd', '#f9a8d4', '#93c5fd', '#fdba74'];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Deterministic initials-avatar data URI, used as the `onError` fallback for a broken/missing
 * portrait (rookies without a Sleeper headshot yet, a bad DEF/team-code mismatch, or a network
 * failure). Deterministic on `playerId` so the same player always gets the same background color
 * across renders and reloads, rather than flashing a different fallback each time.
 */
export function initialsAvatarDataUri(playerId: string, name: string): string {
  const color = AVATAR_PALETTE[hashString(playerId) % AVATAR_PALETTE.length];
  const initials = initialsFor(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">`
    + `<rect width="96" height="96" rx="12" fill="${color}"/>`
    + `<text x="48" y="56" font-family="ui-sans-serif,system-ui,sans-serif" font-size="34" font-weight="800" `
    + `fill="#0b1220" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
