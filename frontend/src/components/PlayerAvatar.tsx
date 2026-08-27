/** Monogram avatar chip — the draft guide's stand-in for player headshots (the repo ships no
 * portrait assets). Tinted with the player's team identity via `[data-team]` → `--team-ink` /
 * `--team-primary` (styles/teamColors.css); free agents get the neutral surface treatment.
 * Decorative by design: the player's name is always rendered beside it. */
export function PlayerAvatar({ name, team }: { name: string; team: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || '?';
  return (
    <span className="player-avatar" data-team={team ?? undefined} aria-hidden="true">
      {initials}
    </span>
  );
}