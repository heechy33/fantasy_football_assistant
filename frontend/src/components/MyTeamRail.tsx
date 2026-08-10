import { useMemo } from 'react';
import type { LeagueSettings, Pick, PlayerId, PlayerMeta, RosterSlot, SeasonProjection } from '../../../shared/types';
import { optimizeLineup } from '../engine/eligibility';
import { scoreProjection } from '../engine/scoring';
import { PlayerPortrait } from './PlayerPortrait';

export interface MyTeamRailProps {
  settings: LeagueSettings;
  effectivePicks: Pick[];
  myTeamId: string | null;
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  projections: SeasonProjection[];
}

interface SlotRow {
  slot: RosterSlot;
  playerId: PlayerId | null;
}

/**
 * Right rail. The user's roster is a small subset (<=15) of the full player pool the board's
 * `buildRecommendationBoard` already excludes from its own candidate universe, so this scores those
 * few players directly with `scoreProjection` rather than threading the engine's internal score map
 * out through a prop — negligible extra cost, and keeps this a pure-presentation addition with no
 * engine surface change.
 */
export function MyTeamRail({ settings, effectivePicks, myTeamId, playersById, projections }: MyTeamRailProps) {
  const projectionById = useMemo(() => new Map(projections.map((p) => [p.playerId, p])), [projections]);

  const myPicks = useMemo(
    () => effectivePicks.filter((pick) => myTeamId != null && pick.teamId === myTeamId && pick.playerId != null),
    [effectivePicks, myTeamId],
  );
  const overallByPlayerId = useMemo(
    () => new Map(myPicks.map((pick) => [pick.playerId as PlayerId, pick.overall])),
    [myPicks],
  );
  const myPlayers = useMemo(
    () => myPicks
      .map((pick) => playersById.get(pick.playerId as PlayerId))
      .filter((player): player is PlayerMeta => player != null),
    [myPicks, playersById],
  );
  const points = useMemo(() => {
    const map = new Map<PlayerId, number>();
    for (const player of myPlayers) {
      const projection = projectionById.get(player.playerId);
      map.set(player.playerId, projection ? scoreProjection(projection, settings, player.position).points : 0);
    }
    return map;
  }, [myPlayers, projectionById, settings]);

  const lineup = useMemo(() => optimizeLineup(settings, myPlayers, points), [settings, myPlayers, points]);

  const slotRows = useMemo<SlotRow[]>(() => {
    const startingSlots = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR');
    // Assignments carry a slot *name*, not a slot *instance* — with two RB starting slots and one RB
    // drafted, exactly one assignment has slot: 'RB'. Queueing per slot name and shifting one entry
    // per instance in `startingSlots` order is what turns that into "one filled, one empty" instead
    // of matching by set membership (which would show both RB slots as filled or both empty).
    const queues = new Map<RosterSlot, PlayerId[]>();
    for (const assignment of lineup.assignments) {
      const queue = queues.get(assignment.slot);
      if (queue) queue.push(assignment.playerId);
      else queues.set(assignment.slot, [assignment.playerId]);
    }
    return startingSlots.map((slot) => ({ slot, playerId: queues.get(slot)?.shift() ?? null }));
  }, [settings.startingSlots, lineup.assignments]);

  const benchOrdered = useMemo(
    () => [...lineup.benched].sort((a, b) => (overallByPlayerId.get(a) ?? 0) - (overallByPlayerId.get(b) ?? 0)),
    [lineup.benched, overallByPlayerId],
  );

  return (
    <section className="my-team-rail" aria-label="My team">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Optimized</p>
          <h2>My team</h2>
        </div>
        <span>{lineup.value.toFixed(1)} pts</span>
      </div>
      <ol className="my-team-slots">
        {slotRows.map((row, index) => {
          const player = row.playerId ? playersById.get(row.playerId) : undefined;
          return (
            <li key={`${row.slot}-${index}`} className="my-team-slot" data-empty={!player || undefined}>
              <span className="my-team-slot-label">{row.slot}</span>
              {player ? (
                <>
                  <PlayerPortrait player={player} />
                  <span className="my-team-slot-name">{player.name}</span>
                  <span className="my-team-slot-points">{(points.get(player.playerId) ?? 0).toFixed(1)}</span>
                </>
              ) : (
                <span className="my-team-slot-name my-team-slot-empty">Empty</span>
              )}
            </li>
          );
        })}
      </ol>
      <h3>Bench</h3>
      {benchOrdered.length === 0 ? <p className="muted">No bench players yet.</p> : (
        <ol className="my-team-bench">
          {benchOrdered.map((playerId) => {
            const player = playersById.get(playerId);
            return (
              <li key={playerId} className="my-team-bench-row">
                {player && <PlayerPortrait player={player} />}
                <span>{player?.name ?? playerId}</span>
                <span className="my-team-slot-points">{(points.get(playerId) ?? 0).toFixed(1)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
