import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerPortrait } from './PlayerPortrait';

// The portrait uses alt="" deliberately (the card already shows the player's name as text next to
// it, so a screen reader announcing the image too would be redundant) — that gives it an implicit
// "presentation" role per ARIA, not "img", so these assert on the DOM node directly rather than via
// an accessible-role query.
function renderImg(props: Parameters<typeof PlayerPortrait>[0]) {
  const { container } = render(<PlayerPortrait {...props} />);
  return container.querySelector('img')!;
}

describe('PlayerPortrait', () => {
  it('points offensive players and kickers at the Sleeper player-headshot path', () => {
    const img = renderImg({ player: { playerId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' } });
    expect(img).toHaveAttribute('src', 'https://sleepercdn.com/content/nfl/players/9221.jpg');
  });

  it('points DEF (team-abbreviation playerId) at the team-logo path instead', () => {
    const img = renderImg({ player: { playerId: 'BUF', name: 'Buffalo Bills', position: 'DEF', team: 'BUF' } });
    expect(img).toHaveAttribute('src', 'https://sleepercdn.com/images/team_logos/nfl/buf.png');
  });

  it('falls back to a deterministic initials avatar when the portrait fails to load', () => {
    const img = renderImg({ player: { playerId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' } });
    fireEvent.error(img);
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(img.getAttribute('src')).toContain('JG'); // initials for "Jahmyr Gibbs"

    // A second error (e.g. the data URI itself somehow failing) must not loop/re-trigger a state update.
    const srcAfterFirstError = img.getAttribute('src');
    fireEvent.error(img);
    expect(img.getAttribute('src')).toBe(srcAfterFirstError);
  });

  it('uses the hero pixel size when requested', () => {
    const img = renderImg({
      player: { playerId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' },
      size: 'hero',
    });
    expect(img).toHaveAttribute('width', '160');
    expect(img).toHaveClass('player-portrait-hero');
  });

  it('goes straight to the initials fallback when a DEF player has no team code', () => {
    const img = renderImg({ player: { playerId: 'FA', name: 'Free Agent', position: 'DEF', team: null } });
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('resets to the new primary URL when the player identity changes without remounting', () => {
    const { container, rerender } = render(
      <PlayerPortrait player={{ playerId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }} />,
    );
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://sleepercdn.com/content/nfl/players/9221.jpg');

    rerender(<PlayerPortrait player={{ playerId: '9509', name: 'Bijan Robinson', position: 'RB', team: 'ATL' }} />);
    expect(img).toHaveAttribute('src', 'https://sleepercdn.com/content/nfl/players/9509.jpg');
  });
});
