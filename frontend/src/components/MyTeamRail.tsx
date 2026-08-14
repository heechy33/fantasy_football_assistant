import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { LeagueSettings, Pick, PlayerId, PlayerMeta, Position, RosterSlot, SeasonProjection } from '../../../shared/types';
import { optimizeLineup } from '../engine/eligibility';
import { scoreProjection } from '../engine/scoring';
import { teamLogoUrl } from '../data/playerPortrait';

export interface MyTeamRailProps {
  settings: LeagueSettings;
  effectivePicks: Pick[];
  myTeamId: string | null;
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  projections: SeasonProjection[];
  /** Total rounds in this draft — the denominator of the "drafted / total" header counter. */
  rounds: number;
  /** Row-click → player detail drawer (the same handler DraftLog's cards use). */
  onViewPlayer?: (playerId: PlayerId) => void;
}

interface SlotRow {
  slot: RosterSlot;
  playerId: PlayerId | null;
}

type GroupKey = Position | 'FLEX';

interface RosterGroup {
  key: GroupKey;
  rows: SlotRow[];
  /** How many of this group's rows are FLEX-like slots (folds into the "+ 1 FLEX" header count). */
  flexCount: number;
}

const GROUP_ORDER: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const GROUP_LABELS: Record<GroupKey, string> = {
  QB: 'Quarterbacks',
  RB: 'Running Backs',
  WR: 'Wide Receivers',
  TE: 'Tight Ends',
  K: 'Kickers',
  DEF: 'Defense',
  FLEX: 'Flex',
};

/** RosterSlot values that are FLEX-like (multi-position eligibility) rather than a base position. */
const FLEX_SLOTS: ReadonlySet<RosterSlot> = new Set(['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX']);

/** Team-identity CSS custom property for the row's logo watermark (see App.css's `.my-team-slot`
 * rules). A background-image `::after`, not an `<img>`: a 404 on a renamed-franchise abbreviation
 * just doesn't paint, so there's no `onError`/fallback machinery to maintain and no a11y-tooling or
 * layout-shift risk from a broken image tag. */
function byeLabel(byeWeek: number | null | undefined): string {
  return byeWeek != null ? `Bye ${byeWeek}` : 'Bye \u2014';
}

function rowStyle(team: string | null): CSSProperties {
  const logo = teamLogoUrl(team);
  return { '--team-logo': logo ? `url(${logo})` : 'none' } as CSSProperties;
}

/** e.g. `(2 + 1 FLEX)` when FLEX rows folded into the group, else `(2)`. */
function groupCountLabel(group: RosterGroup): string {
  return group.flexCount > 0
    ? `${group.rows.length - group.flexCount} + ${group.flexCount} FLEX`
    : String(group.rows.length);
}

/**
 * Right rail. The user's roster is a small subset (<=15) of the full player pool the board's
 * `buildRecommendationBoard` already excludes from its own candidate universe, so this scores those
 * few players directly with `scoreProjection` rather than threading the engine's internal score map
 * out through a prop — negligible extra cost, and keeps this a pure-presentation addition with no
 * engine surface change.
 */
export function MyTeamRail({ settings, effectivePicks, myTeamId, playersById, projections, rounds, onViewPlayer }: MyTeamRailProps) {
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

  // DraftSharks-style grouping built on top of `slotRows` (never replacing it — the slot-queue
  // logic above is load-bearing). A FLEX row folds into the group of whoever fills it (that's where
  // the "+ 1 FLEX" header count comes from); an empty FLEX gets its own Flex group so it stays
  // visible even before anyone lands there.
  const groups = useMemo<RosterGroup[]>(() => {
    const byKey = new Map<GroupKey, RosterGroup>();
    for (const row of slotRows) {
      const isFlex = FLEX_SLOTS.has(row.slot);
      let key: GroupKey;
      if (isFlex) {
        const player = row.playerId ? playersById.get(row.playerId) : undefined;
        key = player?.position ?? 'FLEX';
      } else {
        // BN/IR are filtered out of `slotRows` and FLEX_SLOTS is handled above, so the only
        // remaining slot vocabulary here is the base Position set.
        key = row.slot as Position;
      }
      const group = byKey.get(key) ?? { key, rows: [], flexCount: 0 };
      group.rows.push(row);
      if (isFlex) group.flexCount += 1;
      byKey.set(key, group);
    }
    return [...byKey.values()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a.key as Position);
      const bi = GROUP_ORDER.indexOf(b.key as Position);
      return (ai === -1 ? GROUP_ORDER.length : ai) - (bi === -1 ? GROUP_ORDER.length : bi);
    });
  }, [slotRows, playersById]);

  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Row-click handler stays stable (rows are few, but there is no reason to churn closures here).
  const onViewPlayerRef = useRef(onViewPlayer);
  onViewPlayerRef.current = onViewPlayer;

  const benchCollapsed = collapsedKeys.has('BN');

  return (
    <section className="my-team-rail" aria-label="My team">
      <div className="section-heading">
        <div className="my-team-heading-title">
          <h2 className="section-title-accent">My Team</h2>
          <span className="my-team-count">{myPicks.length}/{rounds}</span>
        </div>
        <span className="my-team-points">{lineup.value.toFixed(1)} pts</span>
      </div>

      {groups.map((group) => {
        const isCollapsed = collapsedKeys.has(group.key);
        return (
          <div key={group.key} className="my-team-group">
            <h3 className="my-team-group-header">
              <button
                type="button"
                className="my-team-group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.key)}
              >
                <span className="my-team-chevron" data-open={!isCollapsed || undefined} aria-hidden="true" />
                <span className="my-team-group-label">{GROUP_LABELS[group.key]}</span>
                <span className="my-team-group-count">({groupCountLabel(group)})</span>
              </button>
              <span className="my-team-group-bye">Bye</span>
            </h3>
            {!isCollapsed && (
              <ol className="my-team-slots">
                {group.rows.map((row, index) => {
                  const player = row.playerId ? playersById.get(row.playerId) : undefined;
                  return (
                    <li
                      key={`${row.slot}-${index}`}
                      className="my-team-slot"
                      data-empty={!player || undefined}
                      data-team={player?.team ?? undefined}
                      style={rowStyle(player?.team ?? null)}
                    >
                      {player ? (
                        <button
                          type="button"
                          className="my-team-row"
                          onClick={() => onViewPlayerRef.current?.(player.playerId)}
                        >
                          <span className="my-team-player-name">{player.name}</span>
                          <span className="my-team-player-team">{player.team ?? 'FA'}</span>
                          <span className="my-team-bye">{byeLabel(player.byeWeek)}</span>
                        </button>
                      ) : (
                        <span className="my-team-row my-team-row-empty">Empty</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}

      <div className="my-team-group">
        <h3 className="my-team-group-header">
          <button
            type="button"
            className="my-team-group-toggle"
            aria-expanded={!benchCollapsed}
            onClick={() => toggleGroup('BN')}
          >
            <span className="my-team-chevron" data-open={!benchCollapsed || undefined} aria-hidden="true" />
            <span className="my-team-group-label">Bench</span>
            <span className="my-team-group-count">({benchOrdered.length})</span>
          </button>
          <span className="my-team-group-bye">Bye</span>
        </h3>
        {!benchCollapsed && (
          <ol className="my-team-bench">
            {benchOrdered.length === 0 ? (
              <li className="my-team-bench-row">
                <span className="my-team-row my-team-row-empty">No bench players yet.</span>
              </li>
            ) : (
              benchOrdered.map((playerId) => {
                const player = playersById.get(playerId);
                return (
                  <li
                    key={playerId}
                    className="my-team-bench-row"
                    data-team={player?.team ?? undefined}
                    style={rowStyle(player?.team ?? null)}
                  >
                    <button
                      type="button"
                      className="my-team-row"
                      onClick={() => onViewPlayerRef.current?.(playerId)}
                    >
                      <span className="my-team-player-name">{player?.name ?? playerId}</span>
                      <span className="my-team-player-team">{player?.team ?? 'FA'}</span>
                      <span className="my-team-bye">{byeLabel(player?.byeWeek)}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
