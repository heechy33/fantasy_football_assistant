import type { AdpEntry, PlayerId, PlayerMeta } from '../../../shared/types';
import { fetchAdpBoard, type AdpBoardKey } from './adpBoard';

/**
 * Memoized so the page fetches `/data/players.json` at most once per session,
 * however many callers (adapter unmatched-detection, player board) need it.
 */
let playerPoolPromise: Promise<PlayerMeta[]> | null = null;
const rankedPlayerPromises = new Map<AdpBoardKey, Promise<RankedPlayer[]>>();

export type AdpFormat = 'standard' | 'half-ppr' | 'ppr' | '2qb';

/** A draftable player enriched with the rank shown on the manual board. */
export interface RankedPlayer extends PlayerMeta {
  /** One-based rank within the selected ADP format. */
  rank: number;
  adp: number;
}

export function loadPlayerPool(): Promise<PlayerMeta[]> {
  if (!playerPoolPromise) {
    playerPoolPromise = fetch('/data/players.json')
      .then((res) => {
        if (!res.ok) throw new Error(`/data/players.json fetch failed: ${res.status}`);
        return res.json() as Promise<PlayerMeta[]>;
      })
      .catch((err: unknown) => {
        // Don't memoize a rejection — a transient failure would otherwise
        // permanently poison the cache (e.g. every future Reconnect keeps
        // failing forever, even after the network recovers).
        playerPoolPromise = null;
        throw err;
      });
  }
  return playerPoolPromise;
}

export async function loadKnownPlayerIds(): Promise<ReadonlySet<PlayerId>> {
  const players = await loadPlayerPool();
  return new Set(players.map((p) => p.playerId));
}

/**
 * Joins the canonical player pool to the selected ADP board. PlayerMeta has no
 * opinionated ranking of its own; ADP is the available, format-specific rank.
 * The board is selected by `key` (the same `AdpBoardKey` the rest of the app
 * uses, so an ESPN session's manual board reads `adp-espn-ppr.json` too), with
 * `fetchAdpBoard`'s fail-open fallback to the plain format board.
 */
export async function loadRankedPlayers(key: AdpBoardKey = 'ppr'): Promise<RankedPlayer[]> {
  let promise = rankedPlayerPromises.get(key);
  if (!promise) {
    // Additive board keys (espn-ppr, yahoo-half-ppr, yahoo-ppr, yahoo-standard) share their
    // base-format artifact; the fail-open in fetchAdpBoard will load the additive key on its
    // own if the file exists. (Format-key mapping kept here so a future 'yahoo-ppr' or
    // 'espn-half-ppr' would resolve correctly without breaking the existing 'espn-ppr'
    // shortcut.)
    const format: AdpFormat = key === 'espn-ppr'
      ? 'ppr'
      : key === 'yahoo-half-ppr' ? 'half-ppr'
        : key === 'yahoo-ppr' ? 'ppr'
          : key === 'yahoo-standard' ? 'standard'
            : key;
    promise = Promise.all([
      loadPlayerPool(),
      fetchAdpBoard(key, format).then(({ entries }) => entries),
    ])
      .then(([players, adpEntries]) => rankPlayers(players, adpEntries))
      .catch((err: unknown) => {
        rankedPlayerPromises.delete(key);
        throw err;
      });
    rankedPlayerPromises.set(key, promise);
  }
  return promise;
}

/** Exported for focused tests; production callers should use loadRankedPlayers. */
export function rankPlayers(players: PlayerMeta[], adpEntries: AdpEntry[]): RankedPlayer[] {
  const playersById = new Map(players.map((player) => [player.playerId, player]));
  return [...adpEntries]
    .filter((entry): entry is AdpEntry & { playerId: PlayerId } => entry.playerId != null)
    .sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name))
    .flatMap((entry, index) => {
      const player = playersById.get(entry.playerId);
      return player ? [{ ...player, rank: index + 1, adp: entry.adp }] : [];
    });
}

/** Test-only: clears the memoized promises so each test starts from a clean cache. */
export function __resetPlayerPoolCache(): void {
  playerPoolPromise = null;
  rankedPlayerPromises.clear();
}
