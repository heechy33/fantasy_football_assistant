import type { AdpEntry, PlayerId, PlayerMeta } from '../../../shared/types';

/**
 * Memoized so the page fetches `/data/players.json` at most once per session,
 * however many callers (adapter unmatched-detection, player board) need it.
 */
let playerPoolPromise: Promise<PlayerMeta[]> | null = null;
const rankedPlayerPromises = new Map<AdpFormat, Promise<RankedPlayer[]>>();

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
 */
export async function loadRankedPlayers(format: AdpFormat = 'ppr'): Promise<RankedPlayer[]> {
  let promise = rankedPlayerPromises.get(format);
  if (!promise) {
    promise = Promise.all([
      loadPlayerPool(),
      fetch(`/data/adp-${format}.json`).then((res) => {
        if (!res.ok) throw new Error(`/data/adp-${format}.json fetch failed: ${res.status}`);
        return res.json() as Promise<AdpEntry[]>;
      }),
    ])
      .then(([players, adpEntries]) => rankPlayers(players, adpEntries))
      .catch((err: unknown) => {
        rankedPlayerPromises.delete(format);
        throw err;
      });
    rankedPlayerPromises.set(format, promise);
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
