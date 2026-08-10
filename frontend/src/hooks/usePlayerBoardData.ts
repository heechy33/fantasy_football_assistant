import { useEffect, useMemo, useState } from 'react';
import type { AdpEntry, PlayerId, PlayerMeta, PlayerUsageArtifact, SeasonProjection } from '../../../shared/types';
import type { AdpFormat } from '../data/loadPlayerPool';

export type UsageLoadStatus = 'loading' | 'ready' | 'error';

export interface PlayerBoardData {
  players: PlayerMeta[];
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  projections: SeasonProjection[];
  adp: AdpEntry[];
  usage: PlayerUsageArtifact;
  usageLoadStatus: UsageLoadStatus;
  loadError: string | null;
}

/**
 * Single fetch of players/projections/ADP/usage for a connected draft session, shared by every
 * column of the workspace (DraftLog needs `playersById` for names on unmatched rows, the
 * recommendation cards need all four, MyTeamRail needs `players`+`projections`). Previously
 * `RecommendationPanel` fetched these itself; hoisting avoids re-fetching per column.
 *
 * `player-usage.json` is ~1.7MB uncommitted-projection-sized JSON — kept on its own effect so a
 * slow/failed usage fetch never blocks first paint of the core recommendation board (players,
 * projections, ADP degrade the whole panel per P0.6; usage degrades only the context signals).
 */
export function usePlayerBoardData(adpFormat: AdpFormat): PlayerBoardData {
  const [players, setPlayers] = useState<PlayerMeta[]>([]);
  const [projections, setProjections] = useState<SeasonProjection[]>([]);
  const [adp, setAdp] = useState<AdpEntry[]>([]);
  const [usage, setUsage] = useState<PlayerUsageArtifact>({});
  const [usageLoadStatus, setUsageLoadStatus] = useState<UsageLoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/data/players.json').then((response) => response.json() as Promise<PlayerMeta[]>),
      fetch('/data/projections-season.json').then((response) => response.json() as Promise<SeasonProjection[]>),
      fetch(`/data/adp-${adpFormat}.json`).then((response) => response.json() as Promise<AdpEntry[]>),
    ]).then(([nextPlayers, nextProjections, nextAdp]) => {
      if (!active) return;
      setPlayers(nextPlayers); setProjections(nextProjections); setAdp(nextAdp); setLoadError(null);
    }).catch(() => { if (active) setLoadError('Projection board is unavailable; use the ADP board/manual tracker.'); });
    return () => { active = false; };
  }, [adpFormat]);

  useEffect(() => {
    let active = true;
    setUsageLoadStatus('loading');
    fetch('/data/player-usage.json')
      .then((response) => {
        if (!response.ok) throw new Error(`player context fetch failed: ${response.status}`);
        return response.json() as Promise<PlayerUsageArtifact>;
      })
      .then((nextUsage) => {
        if (!active) return;
        setUsage(nextUsage);
        setUsageLoadStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setUsage({});
        setUsageLoadStatus('error');
      });
    return () => { active = false; };
  }, []);

  // players.json is ~4400 entries; a Map avoids an O(n) .find() per rendered row.
  const playersById = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players]);

  return { players, playersById, projections, adp, usage, usageLoadStatus, loadError };
}
