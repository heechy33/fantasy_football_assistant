import type { DraftInit, DraftProviderAdapter, EspnLiveSnapshot, Pick, PlayerId, PlayerMeta } from '../../../shared/types';
import { loadPlayerPool } from '../data/loadPlayerPool';
import { computeOnTheClock, deriveDraftStatus, roundForOverall } from './draftOrder';
import { canonicalTeam, teamFromFranchiseName, teamFromProTeamId } from './espnTeams';

export interface EspnPickCandidate {
  /** ESPN player id from the SELECTED frame (or a DOM row's data-player-id). */
  providerPlayerId: string;
  /** Player name from the DOM pick row — the visible fallback when nothing resolves. */
  name?: string | null;
  /** ESPN position id (1=QB 2=RB 3=WR 4=TE 5=K 16=DEF) or abbreviation, when the DOM/correlation provides it. */
  position?: string | number | null;
  /** ESPN proTeamId, when the pool payload provides it. */
  proTeamId?: number | null;
  /** NFL team text from the DOM pick row (e.g. "Commanders" or "WAS"). */
  teamText?: string | null;
}

export interface EspnResolveResult {
  playerId: PlayerId | null;
  providerPlayerName: string | null;
}

export interface EspnPlayerIndex {
  byEspnId: Map<string, PlayerMeta>;
  byDefTeam: Map<string, PlayerMeta>;
  byNamePositionTeam: Map<string, PlayerMeta[]>;
  byNamePosition: Map<string, PlayerMeta[]>;
}

const ESPN_POSITION_BY_ID: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

function foldName(name: string): string {
  return name.trim().toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ');
}

function positionKey(position: string | number | null | undefined): string | null {
  if (position == null) return null;
  if (typeof position === 'number') return ESPN_POSITION_BY_ID[position] ?? null;
  const upper = position.trim().toUpperCase();
  if (upper === 'D/ST' || upper === 'DST') return 'DEF';
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(upper) ? upper : null;
}

/** Build the lookup indexes once per player-pool load (players.json is memoized). */
export function buildEspnPlayerIndex(players: PlayerMeta[]): EspnPlayerIndex {
  const byEspnId = new Map<string, PlayerMeta>();
  const byDefTeam = new Map<string, PlayerMeta>();
  const byNamePositionTeam = new Map<string, PlayerMeta[]>();
  const byNamePosition = new Map<string, PlayerMeta[]>();
  const push = (map: Map<string, PlayerMeta[]>, key: string, player: PlayerMeta) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(player); else map.set(key, [player]);
  };
  for (const player of players) {
    if (player.ids?.espn) byEspnId.set(String(player.ids.espn), player);
    if (player.position === 'DEF' && player.team) {
      const key = canonicalTeam(player.team) ?? player.team;
      if (!byDefTeam.has(key)) byDefTeam.set(key, player);
    }
    const position = player.position ?? '?';
    const team = canonicalTeam(player.team) ?? '';
    push(byNamePositionTeam, `${foldName(player.name)}|${position}|${team}`, player);
    push(byNamePosition, `${foldName(player.name)}|${position}`, player);
  }
  return { byEspnId, byDefTeam, byNamePositionTeam, byNamePosition };
}

function uniquePlayer(bucket: PlayerMeta[] | undefined): PlayerMeta | null {
  return bucket && bucket.length === 1 ? bucket[0] ?? null : null;
}

/**
 * Draft-day resolution order:
 * 1. Exact ids.espn match (covers 272 of the top 300 by PPR ADP).
 * 2. D/ST by team identity — ESPN DEF ids are negative synthetics and must never be used; the team
 *    comes from proTeamId and/or the DOM pick-row team text, canonicalized (WSH -> WAS).
 * 3. Unique name + position + team, then unique name + position.
 * 4. playerId: null with the DOM name retained — never silently drop a pick.
 */
export function resolveEspnPlayer(index: EspnPlayerIndex, candidate: EspnPickCandidate): EspnResolveResult {
  const providerPlayerName = candidate.name ?? null;

  const direct = index.byEspnId.get(candidate.providerPlayerId);
  if (direct) return { playerId: direct.playerId, providerPlayerName: providerPlayerName ?? direct.name };

  const position = positionKey(candidate.position);
  if (position === 'DEF') {
    const team = teamFromProTeamId(candidate.proTeamId)
      ?? (candidate.teamText ? teamFromFranchiseName(candidate.teamText) : null)
      ?? (candidate.teamText ? canonicalTeam(candidate.teamText) : null);
    if (team) {
      const def = index.byDefTeam.get(team);
      if (def) return { playerId: def.playerId, providerPlayerName: providerPlayerName ?? def.name };
    }
  }

  if (candidate.name && position) {
    const folded = foldName(candidate.name);
    const team = teamFromProTeamId(candidate.proTeamId)
      ?? (candidate.teamText ? teamFromFranchiseName(candidate.teamText) : null)
      ?? (candidate.teamText ? canonicalTeam(candidate.teamText) : null);
    if (team) {
      const hit = uniquePlayer(index.byNamePositionTeam.get(`${folded}|${position}|${team}`));
      if (hit) return { playerId: hit.playerId, providerPlayerName: candidate.name };
    }
    const hit = uniquePlayer(index.byNamePosition.get(`${folded}|${position}`));
    if (hit) return { playerId: hit.playerId, providerPlayerName: candidate.name };
  }

  return { playerId: null, providerPlayerName };
}

// ---------------------------------------------------------------------------
// DraftProviderAdapter (narrow, per the ESPN plan's correction #3) — the bridge
// merges the manual form's settings with the relayed snapshot and normalizes the
// live pick stream locally. No upstream GET, no fake in-season methods.
// ---------------------------------------------------------------------------

/** Merge the manual form's DraftInit with the relayed live snapshot: ESPN stamps provider/leagueId,
 * and JOINED/TOKEN override mySlot (the form's slot is only a pre-~6:00 PM placeholder). */
export function mergeBridgeInit(base: DraftInit, live: EspnLiveSnapshot | null): DraftInit {
  const mySlot = live?.mySlot ?? base.mySlot;
  return {
    ...base,
    provider: 'espn',
    leagueId: live?.leagueId ?? base.leagueId,
    mySlot,
    myTeamId: mySlot != null ? String(mySlot) : null,
  };
}

/** Normalize the relayed stream into canonical Pick[]. Unresolved players keep playerId null and any
 * available name — never silently dropped. */
export function bridgePicksToNormalized(init: DraftInit, index: EspnPlayerIndex, live: EspnLiveSnapshot | null): Pick[] {
  return (live?.streamPicks ?? []).map((stream) => {
    const resolved = resolveEspnPlayer(index, { providerPlayerId: stream.playerId });
    return {
      overall: stream.overall,
      round: roundForOverall(init.teams, stream.overall),
      slot: stream.slot,
      teamId: init.slotToTeam[stream.slot] ?? String(stream.slot),
      playerId: resolved.playerId,
      providerPlayerId: stream.playerId,
      providerPlayerName: resolved.providerPlayerName ?? undefined,
    };
  });
}

let playerIndexPromise: Promise<EspnPlayerIndex> | null = null;
/** players.json is memoized upstream; this additionally caches the built crosswalk across polls. */
function loadEspnPlayerIndex(): Promise<EspnPlayerIndex> {
  if (!playerIndexPromise) {
    playerIndexPromise = loadPlayerPool()
      .then((players) => buildEspnPlayerIndex(players))
      .catch((err: unknown) => {
        playerIndexPromise = null;
        throw err;
      });
  }
  return playerIndexPromise;
}

export const espnAdapter: DraftProviderAdapter = {
  provider: 'espn',
  init: mergeBridgeInit,
  async picks(init, live) {
    const index = await loadEspnPlayerIndex();
    const picks = bridgePicksToNormalized(init, index, live);
    const status = deriveDraftStatus('pre', picks.length, init.teams, init.rounds);
    const onTheClock = computeOnTheClock(init.draftType, init.teams, init.rounds, picks.length, init.slotToTeam);
    return { status, picks, onTheClock, fetchedAt: Date.now() };
  },
};
