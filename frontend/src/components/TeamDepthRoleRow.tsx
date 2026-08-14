import type { PlayerId, Position } from '../../../shared/types';
import { visibleDepthMembers, type TeamDepthRole } from '../data/teamDepthRole';
import type { PlayerContextFeedStatus } from './PlayerContextBody';

export interface TeamDepthRoleRowProps {
  depthRole: TeamDepthRole | null;
  playerId: PlayerId;
  feedStatus: PlayerContextFeedStatus;
  /** K and DEF never get a room (see `buildTeamDepthRoles`), so this column would otherwise sit
   * empty for them; falls back to average weekly fantasy points instead of a blank space. */
  position?: Position | null;
  avgPointsPerGame?: number | null;
}

function formatShare(value: number | null): string {
  return value == null ? '\u2014' : `${Math.round(value * 100)}%`;
}

function formatSecondary(position: 'QB' | 'RB' | 'WR' | 'TE', value: number | null): string {
  if (value == null) return '\u2014';
  if (position === 'RB') return `${value.toFixed(1)}/g`;
  if (position === 'WR' || position === 'TE') return `${Math.round(value * 100)}%`;
  return String(Math.round(value));
}

/**
 * Team-depth role interpretation for the player drawer — the card-face "Role" label expanded into
 * the room's ordered depth table ("does this guy have the job?"). Fails open on a degraded usage
 * feed the same way PlayerRolePanel does, and fabricates no slot when there is nothing honest to
 * say (K/DEF, a team-less player, or a feed that never resolved).
 */
export function TeamDepthRoleRow({ depthRole, playerId, feedStatus, position, avgPointsPerGame }: TeamDepthRoleRowProps) {
  if (feedStatus === 'loading') {
    return (
      <div className="team-depth-role-row">
        <h3>Team depth role</h3>
        <p className="muted">Loading prior-season context…</p>
      </div>
    );
  }
  if (feedStatus === 'unavailable') {
    return (
      <div className="team-depth-role-row">
        <h3>Team depth role</h3>
        <p className="muted">Prior-season role is temporarily unavailable. Core projections and ADP are unaffected.</p>
      </div>
    );
  }
  if (depthRole == null || depthRole.label == null) {
    if ((position === 'K' || position === 'DEF') && avgPointsPerGame != null) {
      return (
        <div className="team-depth-role-row">
          <h3>Weekly production</h3>
          <div className="team-depth-role-fallback">
            <strong>{avgPointsPerGame.toFixed(1)}</strong>
            <span>Avg FPTS / week</span>
          </div>
        </div>
      );
    }
    return null;
  }

  const room = depthRole.room;
  const members = room ? visibleDepthMembers(room.members, playerId) : [];
  return (
    <div className="team-depth-role-row">
      <h3>Depth chart</h3>
      {room && members.length > 0 && (
        <table className="context-table team-depth-role-table">
          <thead>
            <tr><th>Depth</th><th>Player</th><th>Share</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const crossTeam = member.basis === 'cross-team';
              return (
                <tr key={member.playerId} data-viewed={member.playerId === playerId || undefined}>
                  <td>{member.slot}</td>
                  <td>
                    {member.name}
                    {crossTeam && member.measuredTeam != null ? ` (${member.measuredTeam})` : ''}
                  </td>
                  <td>{crossTeam ? `${formatShare(member.share)}*` : formatShare(member.share)}</td>
                  <td>{formatSecondary(room.position, member.secondary)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
