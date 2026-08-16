import { useEffect, useMemo, useState } from 'react';
import type { AdpEntry, FantasyProsAdpArtifact, FantasyProsArtifact, PlayerId, PlayerMeta, PlayerUsageArtifact, ProviderProjectionsArtifact, SeasonProjection } from '../../../shared/types';
import { fetchAdpBoard, type AdpBoardKey } from '../data/adpBoard';
import { loadFantasyProsAdp } from '../data/fantasyProsAdp';
import { loadFantasyProsStars } from '../data/fantasyProsStars';
import { loadPlayerPool, type AdpFormat } from '../data/loadPlayerPool';
import { loadProviderProjections } from '../data/providerProjections';

export type UsageLoadStatus = 'loading' | 'ready' | 'error';
export type FantasyProsStatus = 'loading' | 'ready' | 'unavailable';
export type FantasyProsAdpStatus = 'loading' | 'ready' | 'unavailable';
export type ProviderProjectionsStatus = 'loading' | 'ready' | 'unavailable';

export interface PlayerBoardData {
  players: PlayerMeta[];
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  projections: SeasonProjection[];
  adp: AdpEntry[];
  /** Which ADP board actually loaded (the requested key, or the plain format board after a
   * fail-open fallback). Drives the disclosure/health surfaces — never switch sources silently. */
  resolvedAdpKey: AdpBoardKey;
  usage: PlayerUsageArtifact;
  usageLoadStatus: UsageLoadStatus;
  loadError: string | null;
  fantasyProsArtifact: FantasyProsArtifact | null;
  fantasyProsStatus: FantasyProsStatus;
  adpProvidersArtifact: FantasyProsAdpArtifact | null;
  adpProvidersStatus: FantasyProsAdpStatus;
  providerProjectionsArtifact: ProviderProjectionsArtifact | null;
  providerProjectionsStatus: ProviderProjectionsStatus;
}

/**
 * Single fetch of players/projections/ADP/usage for a connected draft session, shared by every
 * column of the workspace. FantasyPros is a separate, optional effect: a 404 or validation miss
 * is `unavailable` and never blocks first paint of the core recommendation board.
 */
export function usePlayerBoardData(adpBoardKey: AdpBoardKey, adpFormat: AdpFormat): PlayerBoardData {
  const [players, setPlayers] = useState<PlayerMeta[]>([]);
  const [projections, setProjections] = useState<SeasonProjection[]>([]);
  const [adp, setAdp] = useState<AdpEntry[]>([]);
  const [resolvedAdpKey, setResolvedAdpKey] = useState<AdpBoardKey>(adpBoardKey);
  const [usage, setUsage] = useState<PlayerUsageArtifact>({});
  const [usageLoadStatus, setUsageLoadStatus] = useState<UsageLoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fantasyProsArtifact, setFantasyProsArtifact] = useState<FantasyProsArtifact | null>(null);
  const [fantasyProsStatus, setFantasyProsStatus] = useState<FantasyProsStatus>('loading');
  const [adpProvidersArtifact, setAdpProvidersArtifact] = useState<FantasyProsAdpArtifact | null>(null);
  const [adpProvidersStatus, setAdpProvidersStatus] = useState<FantasyProsAdpStatus>('loading');
  const [providerProjectionsArtifact, setProviderProjectionsArtifact] = useState<ProviderProjectionsArtifact | null>(null);
  const [providerProjectionsStatus, setProviderProjectionsStatus] = useState<ProviderProjectionsStatus>('loading');

  useEffect(() => {
    let active = true;
    setResolvedAdpKey(adpBoardKey);
    Promise.all([
      loadPlayerPool(),
      fetch('/data/projections-season.json').then((response) => {
        if (!response.ok) throw new Error(`projections fetch failed: ${response.status}`);
        return response.json() as Promise<SeasonProjection[]>;
      }),
      fetchAdpBoard(adpBoardKey, adpFormat),
    ]).then(([nextPlayers, nextProjections, adpBoard]) => {
      if (!active) return;
      setPlayers(nextPlayers); setProjections(nextProjections); setAdp(adpBoard.entries);
      setResolvedAdpKey(adpBoard.resolvedKey); setLoadError(null);
    }).catch(() => { if (active) setLoadError('Projection board is unavailable; use the ADP board/manual tracker.'); });
    return () => { active = false; };
    // The board key uniquely determines the fallback format ('espn-ppr' → 'ppr', else format ===
    // key), so the effect re-runs only on a key change — including adpFormat would be a redundant
    // re-fetch of the same board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adpBoardKey]);

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

  useEffect(() => {
    let active = true;
    setFantasyProsStatus('loading');
    loadFantasyProsStars().then((result) => {
      if (!active) return;
      if (result.status === 'ready') {
        setFantasyProsArtifact(result.artifact);
        setFantasyProsStatus('ready');
      } else {
        setFantasyProsArtifact(null);
        setFantasyProsStatus('unavailable');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setAdpProvidersStatus('loading');
    loadFantasyProsAdp().then((result) => {
      if (!active) return;
      if (result.status === 'ready') {
        setAdpProvidersArtifact(result.artifact);
        setAdpProvidersStatus('ready');
      } else {
        setAdpProvidersArtifact(null);
        setAdpProvidersStatus('unavailable');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setProviderProjectionsStatus('loading');
    loadProviderProjections().then((result) => {
      if (!active) return;
      if (result.status === 'ready') {
        setProviderProjectionsArtifact(result.artifact);
        setProviderProjectionsStatus('ready');
      } else {
        setProviderProjectionsArtifact(null);
        setProviderProjectionsStatus('unavailable');
      }
    });
    return () => { active = false; };
  }, []);

  // players.json is ~4400 entries; a Map avoids an O(n) .find() per rendered row.
  const playersById = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players]);

  return { players, playersById, projections, adp, resolvedAdpKey, usage, usageLoadStatus, loadError, fantasyProsArtifact, fantasyProsStatus, adpProvidersArtifact, adpProvidersStatus, providerProjectionsArtifact, providerProjectionsStatus };
}
