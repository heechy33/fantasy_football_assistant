import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerId } from '../../../shared/types';
import type { GuideRow } from '../data/guideBoard';
import { buildLaneCell, positionRankLabel, type GuideLane } from '../data/guideTableColumns';
import { PositionBadge } from './PositionBadge';
import { PlayerAvatar } from './PlayerAvatar';
import { PlayerPortrait } from './PlayerPortrait';
import { ProviderBadge } from './ProviderBadge';

export interface DraftGuideTableProps {
  rows: readonly GuideRow[];
  /** Label of the ANCHOR ranking (the leading rank column — engine or the selected source). */
  anchorLabel: string;
  /** Dense 1-based anchor ranks; a missing player renders an em-dash (never 0). */
  anchorRankByPlayer: ReadonlyMap<PlayerId, number>;
  /** Per-position ranks over the full pool, for the `RB1` chip. */
  positionRankByPlayer: ReadonlyMap<PlayerId, number>;
  /** One column per provider lane, in display order. Unavailable lanes render em-dash columns. */
  lanes: readonly GuideLane[];
  onSelectPlayer: (playerId: PlayerId) => void;
}

type SortKey = string; // 'anchor' or a lane key

const DELTA_TITLE = 'The gap between this provider\u2019s ADP and the anchor rank \u2014 disagreement between boards, not superiority. Neither direction may be marketed from current evidence (DECISIONS.md, 2026-08-25).';

/** Incremental-render window. The full pool is several hundred rows of buttons + two images each;
 * mounting all of it at once is the guide's dominant first-paint cost. Rows render in pages and
 * an IntersectionObserver sentinel appends the next page as the user scrolls near the end. */
const INITIAL_WINDOW = 120;
const WINDOW_STEP = 120;

/** The guide's STACKED-style table: an anchor rank column, a rich player cell, then one column
 * per provider lane showing raw ADP + the delta vs the anchor. Every numeric column sorts;
 * missing values render em-dashes and ALWAYS sort last regardless of direction (same contract
 * as sortGuideRows: never dropped, never first). */
export function DraftGuideTable({ rows, anchorLabel, anchorRankByPlayer, positionRankByPlayer, lanes, onSelectPlayer }: DraftGuideTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'anchor', dir: 'asc' });
  const [limit, setLimit] = useState(INITIAL_WINDOW);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // jsdom (tests) has no IntersectionObserver — there we render the full sorted list.
  const canWindow = typeof IntersectionObserver !== 'undefined';

  const sortRank = (row: GuideRow, key: SortKey): number | null => (
    key === 'anchor'
      ? anchorRankByPlayer.get(row.playerId) ?? null
      : lanes.find((lane) => lane.key === key)?.rankByPlayer.get(row.playerId) ?? null
  );

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    // Stable anchor: rows arrive pre-sorted by the anchor source, so insertion order breaks
    // ties deterministically.
    const order = new Map(rows.map((row, index) => [row.playerId, index]));
    return [...rows].sort((a, b) => {
      const valueA = sortRank(a, sort.key);
      const valueB = sortRank(b, sort.key);
      // Missing values ALWAYS sort last regardless of direction — an em-dash row never leads.
      if (valueA == null && valueB == null) return (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0);
      if (valueA == null) return 1;
      if (valueB == null) return -1;
      return dir * (valueA - valueB);
    });
    // sortRank reads only props; kept out of the deps to avoid re-creating per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, anchorRankByPlayer, lanes]);

  // The Rank column is ALWAYS the dense position in the current display order (1..n over the rows
  // the sort key covers, missing rows keeping their em-dash) — the user's mental model is "what
  // place is this row in the board I'm looking at", whether that's a provider lane or a filtered
  // pool under the anchor (a QB-filtered board ranks Josh Allen 1, not his global 22).
  const displayRankByPlayer = useMemo(() => {
    const map = new Map<PlayerId, number>();
    let next = 1;
    for (const row of sorted) {
      if (sortRank(row, sort.key) != null) map.set(row.playerId, next++);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, sort]);

  // Positional chips (RB1, WR2, ...) follow the CURRENT sort the same way: dense 1..n within each
  // position, in the active sort's board order (provider lane or anchor over a filtered pool).
  // Rows the sort key doesn't cover fall back to the engine's chip via positionRankByPlayer.
  const positionRankBySort = useMemo(() => {
    const byPosition = new Map<string, GuideRow[]>();
    for (const row of sorted) {
      const position = row.player?.position;
      if (position == null || sortRank(row, sort.key) == null) continue;
      const list = byPosition.get(position);
      if (list) list.push(row);
      else byPosition.set(position, [row]);
    }
    const ranks = new Map<PlayerId, number>();
    for (const list of byPosition.values()) {
      list.forEach((row, index) => ranks.set(row.playerId, index + 1));
    }
    return ranks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, sort]);

  function toggleSort(key: SortKey) {
    setSort((current) => (
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    ));
  }

  // A new dataset (filter/format change) restarts the window from the top.
  useEffect(() => { setLimit(INITIAL_WINDOW); }, [rows]);

  // Grow the window whenever the sentinel scrolls near the viewport.
  useEffect(() => {
    if (!canWindow || limit >= sorted.length) return;
    const sentinel = sentinelRef.current;
    if (sentinel == null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLimit((current) => Math.min(current + WINDOW_STEP, sorted.length));
      }
    }, { rootMargin: '600px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canWindow, limit, sorted.length]);

  const visible = canWindow ? sorted.slice(0, limit) : sorted;

  function ariaSortFor(key: SortKey): 'ascending' | 'descending' | undefined {
    if (sort.key !== key) return undefined;
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  }

  return (
    <div className="guide-table-scroll">
      <table className="guide-table">
      <thead>
        <tr>
          <th scope="col" aria-sort={ariaSortFor('anchor')} className="guide-col-rank">
            <button type="button" className="guide-sort-button" onClick={() => toggleSort('anchor')}>{anchorLabel}</button>
          </th>
          <th scope="col" className="guide-col-player">Player</th>
          {lanes.map((lane) => (
            <th scope="col" key={lane.key} aria-sort={ariaSortFor(lane.key)} data-unavailable={lane.status === 'unavailable' || undefined} className="guide-col-lane">
              {lane.status === 'ready' ? (
                <button type="button" className="guide-sort-button" onClick={() => toggleSort(lane.key)}>
                  <ProviderBadge brandKey={lane.brandKey} size="sm" />
                  <span>{lane.label}</span>
                </button>
              ) : (
                <span className="guide-lane-header" title={`${lane.label} is unavailable right now`}>
                  <ProviderBadge brandKey={lane.brandKey} size="sm" />
                  <span>{lane.label}</span>
                </span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visible.map((row) => {
          const anchorRank = anchorRankByPlayer.get(row.playerId);
          const displayRank = displayRankByPlayer == null ? anchorRank : displayRankByPlayer.get(row.playerId) ?? null;
          const player = row.player;
          // Rows the sort key doesn't cover (e.g. absent from a provider lane) keep their engine
          // chip instead of going blank.
          const posRank = positionRankLabel(row, positionRankBySort)
            ?? positionRankLabel(row, positionRankByPlayer);
          return (
            <tr key={row.playerId}>
              <td className="guide-col-rank" data-missing={displayRank == null || undefined}>{displayRank ?? '\u2014'}</td>
              <td className="guide-col-player">
                <button type="button" className="guide-player-cell" onClick={() => onSelectPlayer(row.playerId)}>
                  {player ? (
                    <PlayerPortrait player={player} className="guide-player-portrait" />
                  ) : (
                    <PlayerAvatar name={row.playerId} team={null} />
                  )}
                  <span className="guide-player-main">
                    <span className="guide-player-team">
                      {player?.team && (
                        <img
                          className="guide-team-logo"
                          src={`/team-logos/${player.team.toLowerCase()}.png`}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                        />
                      )}
                      {player?.team ?? 'FA'}
                    </span>
                    <span className="guide-player-name">
                      <span className="guide-player-name-text">{player?.name ?? row.playerId}</span>
                      {posRank != null ? (
                        <span className="guide-pos-pill guide-pos-pill-inline" data-position={player?.position ?? undefined}>{posRank}</span>
                      ) : player?.position != null ? (
                        <PositionBadge position={player.position} />
                      ) : null}
                    </span>
                  </span>
                </button>
              </td>
              {lanes.map((lane) => {
                const cell = buildLaneCell(lane, row.playerId, anchorRank ?? null);
                const deltaSign = cell.delta == null || Math.abs(cell.delta) < 0.05
                  ? 'zero'
                  : cell.delta > 0 ? 'pos' : 'neg';
                return (
                  <td key={lane.key} className="guide-col-lane" data-missing={cell.adp == null || undefined} data-unavailable={lane.status === 'unavailable' || undefined}>
                    {cell.adp == null ? (
                      <span className="guide-lane-missing">{'\u2014'}</span>
                    ) : (
                      <span className="guide-lane-cell" title={DELTA_TITLE}>
                        <span className="guide-lane-adp">{cell.adp.toFixed(1)}</span>
                        <span className="guide-lane-delta" data-sign={deltaSign} title={DELTA_TITLE}>
                          {cell.delta == null || Math.abs(cell.delta) < 0.05
                            ? '0.0'
                            : `${cell.delta > 0 ? '+' : ''}${cell.delta.toFixed(1)}`}
                        </span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
        {visible.length < sorted.length && (
          <tr aria-hidden="true" className="guide-table-more">
            <td colSpan={2 + lanes.length}>
              <div ref={sentinelRef} className="guide-table-sentinel">Loading more players…</div>
            </td>
          </tr>
        )}
      </tbody>
      </table>
    </div>
  );
}
