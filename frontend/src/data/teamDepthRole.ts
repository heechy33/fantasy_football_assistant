import type { PlayerId, PlayerMeta, PlayerUsage, PlayerUsageArtifact } from '../../../shared/types';

/**
 * Team depth role — the card-face answer to "does this guy have the job?". Pure display state, no
 * React/network dependency, same contract as `positionalRank.ts` / `playerRole.ts`. No
 * `shared/types.d.ts` change (frontend display state only).
 *
 * A room is every player sharing `${player.team}|${player.position}` for QB/RB/WR/TE, grouped on
 * `PlayerMeta.position` (not `depthChartPosition`, which carries SWR/LWR/RWR/PR alignment noise).
 * Players with `team === null` never enter a room — this neutralizes the stale free-agent
 * `depthChartOrder` values — and resolve to `UNKNOWN_DEPTH_ROLE`.
 *
 * Each room has a primary and secondary ordering signal:
 *
 *   RB/WR/TE: primary volume share (desc) -> secondary depthChartOrder (asc)
 *   QB:       primary depthChartOrder (asc) -> secondary snap-games share (desc)
 *
 * Members with only a secondary are interleaved after the last already-placed member whose
 * secondary strictly precedes theirs (this is how a rookie lands at a correct slot without
 * colliding with a measured one); members with neither append last, basis `'unknown'`.
 *
 * QB "volume" is `snapPct × games` (snap-games), not raw `snapPct` — an appearance rate (a 3-game
 * backup can read 0.72 against Mahomes' 0.97). Snap-games are normalized over the room's total so
 * KC reads ~.87/.09 while NO reads ~.54/.43 (a real battle).
 *
 * Shape is only classified when slots 1 and 2 are BOTH measured (share != null) — otherwise
 * `'unassessable'` and plain ranks are used. This is the honesty guarantee: never claim
 * "Committee" from a depth chart.
 *
 * `basis` is the uniform data-provenance of the placement:
 *   - share measured on the room's team      -> `'volume'`
 *   - share measured on a different team     -> `'cross-team'` (disclosed, never demoted)
 *   - no share but a `depthChartOrder`       -> `'depth-chart'`
 *   - neither                                -> `'unknown'`
 * The card-face Role tile underlines `cross-team`/`depth-chart` in `--text-2` so measured-volume
 * slots are visually distinct from depth-chart-only guesses without a second line of text.
 */
export type DepthRolePosition = 'QB' | 'RB' | 'WR' | 'TE';

export type DepthRoleBasis = 'volume' | 'cross-team' | 'depth-chart' | 'unknown';

export type DepthRoleShape = 'clear' | 'split' | 'committee' | 'battle' | 'unassessable';

export interface DepthRoleMember {
  playerId: PlayerId;
  name: string;
  slot: number;
  /** Position volume share — carryShare (RB), targetShare (WR/TE), snap-games share (QB). */
  share: number | null;
  /** Touches/g (RB), airYardsShare (WR/TE), games (QB). */
  secondary: number | null;
  /** `usage.recentTeam` — differs from `room.team` exactly when this is a `'cross-team'` member. */
  measuredTeam: string | null;
  depthChartOrder: number | null;
  depthChartPosition: string | null;
  basis: DepthRoleBasis;
}

export interface TeamDepthRoom {
  team: string;
  position: DepthRolePosition;
  shape: DepthRoleShape;
  members: readonly DepthRoleMember[];
  topGap: number | null;
  crossTeamTop: boolean;
  contested: boolean;
  /** True when the top two WR/TE shares are within `nearTieGap` of each other — a display
   * disclosure only ("ranks only, no ambiguity label"). */
  nearTie: boolean;
  season: number | null;
}

export interface TeamDepthRole {
  playerId: PlayerId;
  /** Card face; `null` renders an em dash, never a guess. For split/committee/battle rooms this
   * is the room shape word ("Split"/"Committee"/"Battle"); otherwise the slot label
   * (RB1-RB3, WR1-WR3, TE1-TE2, QB1-QB2, Depth). */
  label: string | null;
  /** Drawer headline. */
  headline: string;
  /** Always names the signal that produced the slot. */
  provenance: string;
  slot: number | null;
  basis: DepthRoleBasis;
  shape: DepthRoleShape;
  room: TeamDepthRoom | null;
}

/** All tuning knobs in one exported const — the values were validated against the real committed
 * `data/players.json` + `data/player-usage.json` (see the threshold-distribution table in the
 * approval spec): RB 17 clear / 7 split / 8 committee on the real board. */
export const DEPTH_ROLE_THRESHOLDS = {
  rb: { committeeGap: 0.10, splitGap: 0.25, leadFloor: 0.25, volumeFloor: 0.05 },
  wr: { nearTieGap: 0.03, volumeFloor: 0.05 },
  te: { nearTieGap: 0.03, volumeFloor: 0.04 },
  qb: { battleGap: 0.20, battleShareFloor: 0.25 },
} as const;

export const UNKNOWN_DEPTH_ROLE: TeamDepthRole = {
  playerId: '' as PlayerId,
  label: null,
  headline: 'Team role unavailable',
  provenance: 'No prior-season volume or depth-chart slot available.',
  slot: null,
  basis: 'unknown',
  shape: 'unassessable',
  room: null,
};

interface RoomCandidate extends DepthRoleMember {
  /** Raw snap-games for QB (used to normalize the room); `null` otherwise. */
  rawVolume: number | null;
  /** Internal ordering keys — the sort is position-aware and is NOT the display `share`. */
  sortPrimary: number | null;
  sortSecondary: number | null;
  season: number | null;
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** The room's primary volume signal for one player, plus its raw (pre-normalization) form. */
function volumeShare(
  position: DepthRolePosition,
  opp: PlayerUsage['opportunity'] | undefined,
  usageFor: PlayerUsage | undefined,
): { share: number | null; raw: number | null } {
  if (position === 'RB') {
    const share = opp?.season.carryShare ?? usageFor?.carryShare ?? null;
    return { share: finite(share) ? share : null, raw: null };
  }
  if (position === 'WR' || position === 'TE') {
    const share = opp?.season.targetShare ?? usageFor?.targetShare ?? null;
    return { share: finite(share) ? share : null, raw: null };
  }
  if (position === 'QB') {
    const snap = opp?.season.snapPct ?? usageFor?.snapPct ?? null;
    const games = opp?.season.games ?? usageFor?.gamesWithAnySnap ?? null;
    const raw = finite(snap) && finite(games) && games > 0 ? snap * games : null;
    return { share: null, raw };
  }
  return { share: null, raw: null };
}

function secondarySignal(
  position: DepthRolePosition,
  opp: PlayerUsage['opportunity'] | undefined,
  usageFor: PlayerUsage | undefined,
): number | null {
  if (position === 'RB') return opp?.season.touchesPerGame ?? null;
  if (position === 'WR' || position === 'TE') return opp?.season.airYardsShare ?? null;
  if (position === 'QB') return opp?.season.games ?? usageFor?.gamesWithAnySnap ?? null;
  return null;
}

/**
 * Standalone per-position volume read, exported for direct unit coverage. RB -> carryShare,
 * WR/TE -> targetShare, QB -> snap-games (`snapPct × games`). `null` when the underlying usage
 * row is missing or the value isn't finite. Room normalization (QB) happens inside
 * `buildTeamDepthRoles`, not here — this function has no room context.
 */
export function depthRoleVolume(
  position: DepthRolePosition | string,
  usage: PlayerUsage | undefined,
): number | null {
  if (position === 'RB') {
    const share = usage?.opportunity?.season.carryShare ?? usage?.carryShare ?? null;
    return finite(share) ? share : null;
  }
  if (position === 'WR' || position === 'TE') {
    const share = usage?.opportunity?.season.targetShare ?? usage?.targetShare ?? null;
    return finite(share) ? share : null;
  }
  if (position === 'QB') {
    const snap = usage?.opportunity?.season.snapPct ?? usage?.snapPct ?? null;
    const games = usage?.opportunity?.season.games ?? usage?.gamesWithAnySnap ?? null;
    if (!finite(snap) || !finite(games) || games <= 0) return null;
    return snap * games;
  }
  return null;
}

/** Uniform basis derivation — see the module doc. */
function basisFor(
  share: number | null,
  measuredTeam: string | null,
  depthChartOrder: number | null,
  roomTeam: string,
): DepthRoleBasis {
  if (share != null && measuredTeam != null) {
    return measuredTeam === roomTeam ? 'volume' : 'cross-team';
  }
  if (depthChartOrder != null) return 'depth-chart';
  return 'unknown';
}

function buildCandidate(
  player: PlayerMeta,
  position: DepthRolePosition,
  roomTeam: string,
  usage: PlayerUsageArtifact,
): RoomCandidate {
  const usageFor = usage[player.playerId];
  const opp = usageFor?.opportunity;
  const { share, raw } = volumeShare(position, opp, usageFor);
  const secondary = secondarySignal(position, opp, usageFor);
  const measuredTeam = usageFor?.recentTeam ?? null;
  const depthChartOrder = player.depthChartOrder ?? null;
  const season = usageFor?.season ?? null;
  return {
    playerId: player.playerId,
    name: player.name,
    slot: 0,
    share,
    secondary,
    measuredTeam,
    depthChartOrder,
    depthChartPosition: player.depthChartPosition ?? null,
    basis: basisFor(share, measuredTeam, depthChartOrder, roomTeam),
    rawVolume: raw,
    sortPrimary: null,
    sortSecondary: null,
    season,
  };
}

function assignSortKeys(candidate: RoomCandidate, position: DepthRolePosition): void {
  if (position === 'QB') {
    // Primary depthChartOrder (asc); secondary snap-games share (desc).
    candidate.sortPrimary = candidate.depthChartOrder;
    candidate.sortSecondary = candidate.share;
  } else {
    // Primary volume share (desc); secondary depthChartOrder (asc).
    candidate.sortPrimary = candidate.share;
    candidate.sortSecondary = candidate.depthChartOrder;
  }
}

function compareCandidates(a: RoomCandidate, b: RoomCandidate, position: DepthRolePosition): number {
  const primaryDesc = position !== 'QB';
  const primaryCmp = primaryDesc
    ? (b.sortPrimary ?? 0) - (a.sortPrimary ?? 0)
    : (a.sortPrimary ?? 0) - (b.sortPrimary ?? 0);
  if (primaryCmp !== 0) return primaryCmp;
  const secondaryDesc = position === 'QB';
  if (a.sortSecondary == null && b.sortSecondary == null) return 0;
  if (a.sortSecondary == null) return 1;
  if (b.sortSecondary == null) return -1;
  const secondaryCmp = secondaryDesc
    ? b.sortSecondary - a.sortSecondary
    : a.sortSecondary - b.sortSecondary;
  if (secondaryCmp !== 0) return secondaryCmp;
  return a.playerId.localeCompare(b.playerId);
}

function secondaryPrecedes(placed: number, incoming: number, desc: boolean): boolean {
  return desc ? placed > incoming : placed < incoming;
}

/**
 * Merged room ordering (spec B2):
 * 1. Members with a primary value sort by primary, tiebreak secondary, then playerId.
 * 2. Members with only a secondary interleave after the last already-placed member whose secondary
 *    strictly precedes theirs (front of the placed order when every comparable placed secondary is
 *    equal-or-later; end when no placed member has a comparable secondary at all).
 * 3. Members with neither append last, basis `'unknown'`.
 */
function orderMembers(
  members: RoomCandidate[],
  position: DepthRolePosition,
): RoomCandidate[] {
  const withPrimary = members.filter((member) => member.sortPrimary != null);
  const withSecondaryOnly = members.filter((member) => member.sortPrimary == null && member.sortSecondary != null);
  const neither = members.filter((member) => member.sortPrimary == null && member.sortSecondary == null);

  withPrimary.sort((a, b) => compareCandidates(a, b, position));
  const secondaryDesc = position === 'QB';
  const secondaries = [...withSecondaryOnly]
    .sort((a, b) => {
      const cmp = secondaryPrecedes(a.sortSecondary!, b.sortSecondary!, secondaryDesc) ? -1 : 1;
      return cmp || a.playerId.localeCompare(b.playerId);
    });

  const ordered: RoomCandidate[] = [...withPrimary];
  for (const member of secondaries) {
    let insertAt = -1;
    let anyComparable = false;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const placed = ordered[i]!;
      if (placed.sortSecondary == null) continue;
      anyComparable = true;
      if (secondaryPrecedes(placed.sortSecondary, member.sortSecondary!, secondaryDesc)) {
        insertAt = i + 1;
        break;
      }
    }
    if (insertAt === -1) insertAt = anyComparable ? 0 : ordered.length;
    ordered.splice(insertAt, 0, member);
  }
  ordered.push(...neither);
  return ordered;
}

/** Volume leader (max share) vs depth-chart leader (min `depthChartOrder`) — a disclosure shown in
 * the drawer, never a demotion. Load-bearing for the QB `battle` clause: without it CIN (Flacco
 * out-snapped Burrow) and WAS (Mariota over Daniels) both falsely become "Battle". */
function roomContested(members: readonly DepthRoleMember[]): boolean {
  if (members.length < 2) return false;
  let volumeLeader: DepthRoleMember | null = null;
  let depthLeader: DepthRoleMember | null = null;
  for (const member of members) {
    // `volumeLeader`/`depthLeader` are only ever assigned when the field being compared is
    // non-null, so the `!` on the incumbent's field is safe.
    if (member.share != null && (volumeLeader == null || member.share > volumeLeader.share!)) {
      volumeLeader = member;
    }
    if (member.depthChartOrder != null && (depthLeader == null || member.depthChartOrder < depthLeader.depthChartOrder!)) {
      depthLeader = member;
    }
  }
  return volumeLeader != null && depthLeader != null && volumeLeader.playerId !== depthLeader.playerId;
}

/**
 * Shape classification (spec B2). Only fires when slots 1 and 2 are both measured — otherwise
 * `'unassessable'` and plain ranks are used (the honesty guarantee: never claim "Committee" from a
 * depth chart). `contested` is computed internally from the members.
 */
export function classifyRoomShape(
  position: DepthRolePosition,
  members: readonly DepthRoleMember[],
): { shape: DepthRoleShape; topGap: number | null } {
  const slot1 = members[0];
  const slot2 = members[1];
  if (slot1 == null || slot2 == null || slot1.share == null || slot2.share == null) {
    return { shape: 'unassessable', topGap: null };
  }
  const gap = Math.abs(slot1.share - slot2.share);

  if (position === 'RB') {
    if (slot1.share < DEPTH_ROLE_THRESHOLDS.rb.leadFloor) return { shape: 'committee', topGap: gap };
    if (gap < DEPTH_ROLE_THRESHOLDS.rb.committeeGap) return { shape: 'committee', topGap: gap };
    if (gap < DEPTH_ROLE_THRESHOLDS.rb.splitGap) return { shape: 'split', topGap: gap };
    return { shape: 'clear', topGap: gap };
  }

  if (position === 'QB') {
    const battle = gap <= DEPTH_ROLE_THRESHOLDS.qb.battleGap
      && slot2.share >= DEPTH_ROLE_THRESHOLDS.qb.battleShareFloor
      && !roomContested(members);
    return { shape: battle ? 'battle' : 'clear', topGap: gap };
  }

  // WR/TE: ranks only, no ambiguity label.
  return { shape: 'clear', topGap: gap };
}

const MAX_SLOT: Readonly<Record<DepthRolePosition, number>> = { QB: 2, RB: 3, WR: 3, TE: 2 };

function nearTieGapFor(position: DepthRolePosition): number {
  return position === 'TE' ? DEPTH_ROLE_THRESHOLDS.te.nearTieGap : DEPTH_ROLE_THRESHOLDS.wr.nearTieGap;
}

function volumeFloor(position: DepthRolePosition): number | null {
  if (position === 'RB') return DEPTH_ROLE_THRESHOLDS.rb.volumeFloor;
  if (position === 'WR') return DEPTH_ROLE_THRESHOLDS.wr.volumeFloor;
  if (position === 'TE') return DEPTH_ROLE_THRESHOLDS.te.volumeFloor;
  return null; // QB has no volume floor — snap-games are normalized within the room already.
}

/** Slot label with the volume-floor demotion: a measured member below the floor is Depth regardless
 * of slot (a 4.9% target share is not a WR3). The floor never applies to unmeasured members. */
function slotLabel(position: DepthRolePosition, slot: number, share: number | null): string {
  const maxSlot = MAX_SLOT[position];
  if (slot > maxSlot) return 'Depth';
  const floor = volumeFloor(position);
  if (floor != null && share != null && share < floor) return 'Depth';
  return `${position}${slot}`;
}

const SHAPE_WORD: Readonly<Record<'split' | 'committee' | 'battle', string>> = {
  split: 'Split',
  committee: 'Committee',
  battle: 'Battle',
};

function memberLabel(position: DepthRolePosition, slot: number, share: number | null, shape: DepthRoleShape): string {
  const base = slotLabel(position, slot, share);
  if (base === 'Depth') return 'Depth';
  if (shape === 'split' || shape === 'committee' || shape === 'battle') return SHAPE_WORD[shape];
  return base;
}

function volumeSignalName(position: DepthRolePosition): string {
  if (position === 'RB') return 'carry share';
  if (position === 'QB') return 'snap-games share';
  return 'target share';
}

function sleeperConfirmation(position: DepthRolePosition, member: DepthRoleMember): string {
  if (member.depthChartOrder != null) return ` Sleeper lists him ${position}${member.depthChartOrder}.`;
  if (member.depthChartPosition != null) return ` Sleeper lists him ${member.depthChartPosition}.`;
  return '';
}

function provenanceFor(
  position: DepthRolePosition,
  roomTeam: string,
  member: DepthRoleMember,
  season: number | null,
): string {
  const signal = volumeSignalName(position);
  const seasonText = season ?? 'prior-season';
  switch (member.basis) {
    case 'volume':
      return `Slot from ${seasonText} ${roomTeam} ${signal};${sleeperConfirmation(position, member)}`;
    case 'cross-team':
      return `Slot from ${seasonText} ${signal} measured at ${member.measuredTeam}, not ${roomTeam} — shares from different teams use different denominators, so this comparison is approximate.`;
    case 'depth-chart':
      return `Slot from Sleeper's depth chart only — no measured${season != null ? ` ${season}` : ''} NFL volume.`;
    case 'unknown':
      return UNKNOWN_DEPTH_ROLE.provenance;
  }
}

function headlineFor(position: DepthRolePosition, roomTeam: string, label: string): string {
  return `${label} · ${roomTeam} ${position}`;
}

function buildRoom(
  roomTeam: string,
  position: DepthRolePosition,
  players: readonly PlayerMeta[],
  usage: PlayerUsageArtifact,
): TeamDepthRoom {
  const candidates = players.map((player) => buildCandidate(player, position, roomTeam, usage));

  // QB snap-games are normalized over the room's total snap-games (spec B2) — a 3-game backup's
  // appearance rate must not read as a real share against a 17-game starter.
  if (position === 'QB') {
    const total = candidates.reduce((sum, member) => sum + (member.rawVolume ?? 0), 0);
    if (total > 0) {
      for (const member of candidates) {
        member.share = member.rawVolume != null ? member.rawVolume / total : null;
      }
    }
  }

  for (const member of candidates) assignSortKeys(member, position);
  const ordered = orderMembers(candidates, position);
  ordered.forEach((member, index) => {
    member.slot = index + 1;
  });

  const { shape, topGap } = classifyRoomShape(position, ordered);
  const contested = roomContested(ordered);
  const crossTeamTop = ordered[0]?.basis === 'cross-team';
  const nearTie = (position === 'WR' || position === 'TE')
    && ordered[0]?.share != null
    && ordered[1]?.share != null
    && Math.abs(ordered[0]!.share! - ordered[1]!.share!) < nearTieGapFor(position);
  const season = candidates.find((member) => member.season != null)?.season ?? null;

  return {
    team: roomTeam,
    position,
    shape,
    members: ordered,
    topGap,
    crossTeamTop,
    contested,
    nearTie,
    season,
  };
}

/**
 * Build every player's team-depth role from the committed player pool + prior-season usage
 * artifact. Players with `team === null` (including stale free agents), and every non-skill
 * position, resolve to `UNKNOWN_DEPTH_ROLE` (label `null` -> the card face renders an em dash).
 * The usage artifact is indexed by `PlayerId`; an empty artifact (degraded feed) throws nothing.
 */
export function buildTeamDepthRoles(
  players: readonly PlayerMeta[],
  usage: PlayerUsageArtifact,
): ReadonlyMap<PlayerId, TeamDepthRole> {
  const roles = new Map<PlayerId, TeamDepthRole>();
  const rooms = new Map<string, { team: string; position: DepthRolePosition; players: PlayerMeta[] }>();

  for (const player of players) {
    const position = player.position;
    if (player.team == null || (position !== 'QB' && position !== 'RB' && position !== 'WR' && position !== 'TE')) {
      roles.set(player.playerId, { ...UNKNOWN_DEPTH_ROLE, playerId: player.playerId });
      continue;
    }
    const key = `${player.team}|${position}`;
    const room = rooms.get(key);
    if (room) {
      room.players.push(player);
    } else {
      rooms.set(key, { team: player.team, position, players: [player] });
    }
  }

  for (const room of rooms.values()) {
    const built = buildRoom(room.team, room.position, room.players, usage);
    for (const member of built.members) {
      // `'unknown'` basis means neither measured volume nor a depth-chart slot backed the
      // placement — labeling it would be a guess, so the card face renders an em dash instead.
      const label = member.basis === 'unknown'
        ? null
        : memberLabel(built.position, member.slot, member.share, built.shape);
      roles.set(member.playerId, {
        playerId: member.playerId,
        label,
        headline: label == null ? UNKNOWN_DEPTH_ROLE.headline : headlineFor(built.position, built.team, label),
        provenance: provenanceFor(built.position, built.team, member, built.season),
        slot: member.slot,
        basis: member.basis,
        shape: built.shape,
        room: built,
      });
    }
  }

  return roles;
}

/** Cap the drawer table at `limit` ranks, always including `playerId` when they are in the room. */
export function visibleDepthMembers<T extends { playerId: PlayerId }>(
  members: readonly T[],
  playerId: PlayerId,
  limit = 5,
): readonly T[] {
  if (limit < 1 || members.length <= limit) return members;
  const viewedIndex = members.findIndex((member) => member.playerId === playerId);
  if (viewedIndex < 0 || viewedIndex < limit) return members.slice(0, limit);
  const half = Math.floor(limit / 2);
  let start = viewedIndex - half;
  let end = start + limit;
  if (end > members.length) {
    end = members.length;
    start = Math.max(0, end - limit);
  }
  if (start < 0) return members.slice(0, limit);
  return members.slice(start, end);
}





