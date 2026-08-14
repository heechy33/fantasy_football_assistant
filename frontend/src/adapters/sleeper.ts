import type {
  Cred,
  DraftInit,
  DraftPicks,
  DraftType,
  LeagueFormat,
  LeagueRef,
  LeagueSettings,
  Pick,
  PlayerId,
  ProviderAdapter,
  Roster,
  RosterSlot,
  ScoringMap,
  SleeperCred,
} from '../../../shared/types';
import { loadKnownPlayerIds } from '../data/loadPlayerPool';
import { computeOnTheClock, deriveDraftStatus } from './draftOrder';

/**
 * This module is the ONLY place raw-Sleeper-shape knowledge lives (field
 * names like `pick_no`, `roster_id`, `draft_slot`, `scoring_settings`).
 * Nothing above the adapter boundary should see these field names.
 *
 * Shapes verified against https://docs.sleeper.com/ on 2026-08-07.
 */
const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// ---------------------------------------------------------------------------
// Raw Sleeper API shapes (private to this module)
// ---------------------------------------------------------------------------

interface RawUser {
  user_id: string;
  username: string;
  display_name: string;
}

interface RawLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  draft_id?: string | null;
}

interface RawDraft {
  draft_id: string;
  /** Sleeper standalone mocks have no league record. */
  league_id: string | null;
  type: string;
  status: string;
  season?: string;
  metadata?: { name?: string; scoring_type?: string };
  settings: {
    teams?: number;
    rounds?: number;
    slots_qb?: number;
    slots_rb?: number;
    slots_wr?: number;
    slots_te?: number;
    slots_flex?: number;
    slots_super_flex?: number;
    slots_k?: number;
    slots_def?: number;
  };
  draft_order: Record<string, number> | null;
  slot_to_roster_id: Record<string, number> | null;
}

/** Sleeper standalone mocks expose only a scoring *type*, rather than a
 * league's full scoring_settings object. These are the standard Sleeper
 * linear defaults for the three built-in mock formats. Custom mocks cannot
 * be scored faithfully from the public draft payload and remain unsupported.
 */
const DEFAULT_MOCK_SCORING: Record<'ppr' | 'half-ppr' | 'standard', ScoringMap> = {
  ppr: { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, fgm: 3, xpm: 1, sack: 1, int: 2, fum_rec: 2, def_td: 6, def_kr_td: 6 },
  'half-ppr': { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, fgm: 3, xpm: 1, sack: 1, int: 2, fum_rec: 2, def_td: 6, def_kr_td: 6 },
  standard: { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, fgm: 3, xpm: 1, sack: 1, int: 2, fum_rec: 2, def_td: 6, def_kr_td: 6 },
};

interface RawPickMetadata {
  first_name?: string;
  last_name?: string;
}

interface RawPick {
  player_id: string;
  picked_by: string;
  roster_id: number | string | null;
  round: number;
  draft_slot: number;
  pick_no: number;
  metadata?: RawPickMetadata;
}

interface RawRoster {
  roster_id: number;
  owner_id: string;
  starters: string[];
  players: string[];
  reserve: string[];
}

interface RawLeagueUser {
  user_id: string;
  username: string;
  display_name: string;
  metadata?: { team_name?: string };
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

function parseRetryAfter(value: string | null): number | null {
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export class SleeperApiError extends Error {
  constructor(
    path: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`Sleeper API ${path} failed: ${status}`);
    this.name = 'SleeperApiError';
  }
}

async function sleeperFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, { cache: 'no-store', signal });
  if (!res.ok) {
    throw new SleeperApiError(path, res.status, parseRetryAfter(res.headers.get('Retry-After')));
  }
  return res.json() as Promise<T>;
}

function requireSleeperCred(cred: Cred): SleeperCred {
  if (cred.provider !== 'sleeper') {
    throw new Error(`sleeperAdapter received a ${cred.provider} credential`);
  }
  return cred;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const KNOWN_ROSTER_SLOTS = new Set<RosterSlot>([
  'QB', 'RB', 'WR', 'TE', 'K', 'DEF',
  'FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX', 'BN', 'IR',
]);

function toRosterSlot(token: string): RosterSlot | null {
  return KNOWN_ROSTER_SLOTS.has(token as RosterSlot) ? (token as RosterSlot) : null;
}

function toDraftType(raw: string): DraftType {
  if (raw === 'snake' || raw === 'linear' || raw === 'auction') return raw;
  console.warn(`sleeperAdapter: unrecognized draft type "${raw}", defaulting to snake`);
  return 'snake';
}

function normalizeSlotToTeam(raw: Record<string, number> | null | undefined): Record<number, string> {
  return Object.fromEntries(
    Object.entries(raw ?? {}).map(([slot, rosterId]) => [Number(slot), String(rosterId)]),
  );
}

function displayNameForUser(user: RawLeagueUser | undefined, fallbackOwnerId: string): string {
  return user?.metadata?.team_name || user?.display_name || user?.username || fallbackOwnerId;
}

/**
 * Built from `draft_order` (userId -> slot) and the league's `/users` list only — no roster
 * request. A slot whose owning user has no matching `/users` entry is omitted entirely rather
 * than falling back to the raw owner id; `DraftLog` supplies `Team {slot}` for those.
 */
function buildSlotToTeamName(
  rawDraftOrder: Record<string, number> | null | undefined,
  rawUsers: RawLeagueUser[],
): Record<number, string> | undefined {
  const usersById = new Map(rawUsers.map((user) => [user.user_id, user]));
  const slotToTeamName = Object.fromEntries(
    Object.entries(rawDraftOrder ?? {})
      .map(([userId, slot]) => {
        const user = usersById.get(userId);
        return user ? [slot, displayNameForUser(user, userId)] : null;
      })
      .filter((entry): entry is [number, string] => entry !== null),
  );
  return Object.keys(slotToTeamName).length > 0 ? slotToTeamName : undefined;
}

function normalizeScoring(raw: Record<string, number> | undefined): ScoringMap {
  return Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)),
  );
}

function deriveLeagueFormat(
  scoring: ScoringMap,
  startingSlots: RosterSlot[],
  draftType: DraftType,
): LeagueFormat {
  const rec = scoring.rec;
  const reception: LeagueFormat['reception'] =
    rec === 1 ? 'ppr' : rec === 0.5 ? 'half-ppr' : rec === undefined || rec === 0 ? 'standard' : 'custom';

  const qbCount = startingSlots.filter((s) => s === 'QB').length;
  const qb: LeagueFormat['qb'] = startingSlots.includes('SUPER_FLEX')
    ? 'superflex'
    : qbCount >= 2
      ? 'two-qb'
      : 'one-qb';

  return { reception, qb, draft: draftType };
}

/**
 * Reused by both `init()` (accurate `draftType`, from the draft call) and
 * `settings()` (no draft context available from the league endpoint alone —
 * defaults `draftType` to 'snake'; `settings()` isn't exercised by S1's exit
 * criteria so this is a documented, non-blocking limitation).
 */
function normalizeLeagueSettings(raw: RawLeague, draftType: DraftType): LeagueSettings {
  const scoring = normalizeScoring(raw.scoring_settings);
  const rosterPositions = raw.roster_positions ?? [];

  const startingSlots = rosterPositions
    .map(toRosterSlot)
    .filter((s): s is RosterSlot => s !== null && s !== 'BN' && s !== 'IR');

  const rosterSlots: Partial<Record<RosterSlot, number>> = {};
  for (const token of rosterPositions) {
    const slot = toRosterSlot(token);
    if (!slot) continue;
    rosterSlots[slot] = (rosterSlots[slot] ?? 0) + 1;
  }

  return {
    provider: 'sleeper',
    leagueId: raw.league_id,
    name: raw.name,
    season: raw.season,
    teams: raw.total_rosters,
    startingSlots,
    rosterSlots,
    scoring,
    format: deriveLeagueFormat(scoring, startingSlots, draftType),
    // waiverType/waiverBudget/playoffStartWeek: Sleeper's numeric waiver_type
    // enum wasn't verified against a real payload — left unset rather than
    // guessing wrong codes. Both fields are optional on LeagueSettings.
  };
}

/** Mock drafts use a draft-level settings payload instead of a league settings payload. */
function normalizeMockDraftSettings(raw: RawDraft, draftType: DraftType): LeagueSettings {
  const slots: Array<[RosterSlot, number | undefined]> = [
    ['QB', raw.settings.slots_qb],
    ['RB', raw.settings.slots_rb],
    ['WR', raw.settings.slots_wr],
    ['TE', raw.settings.slots_te],
    ['FLEX', raw.settings.slots_flex],
    ['SUPER_FLEX', raw.settings.slots_super_flex],
    ['K', raw.settings.slots_k],
    ['DEF', raw.settings.slots_def],
  ];
  const rosterSlots: Partial<Record<RosterSlot, number>> = {};
  const startingSlots: RosterSlot[] = [];
  for (const [slot, count] of slots) {
    if (!count || count < 1) continue;
    rosterSlots[slot] = count;
    startingSlots.push(...Array.from({ length: count }, () => slot));
  }

  const scoringType = raw.metadata?.scoring_type?.toLowerCase();
  const mockFormat = scoringType === 'half_ppr' || scoringType === 'half-ppr'
    ? 'half-ppr'
    : scoringType === 'ppr' || scoringType === 'standard' ? scoringType : null;
  // Copy the map so callers cannot mutate a shared default between sessions.
  const scoring: ScoringMap = mockFormat ? { ...DEFAULT_MOCK_SCORING[mockFormat] } : {};

  return {
    provider: 'sleeper',
    leagueId: `mock:${raw.draft_id}`,
    name: raw.metadata?.name || 'Sleeper mock draft',
    season: raw.season ?? '',
    teams: raw.settings.teams ?? 0,
    startingSlots,
    rosterSlots,
    scoring,
    format: deriveLeagueFormat(scoring, startingSlots, draftType),
  };
}

function toPick(raw: RawPick, knownPlayerIds: ReadonlySet<PlayerId>): Pick {
  const providerPlayerId = raw.player_id;
  const matched = knownPlayerIds.has(providerPlayerId);
  const name = [raw.metadata?.first_name, raw.metadata?.last_name].filter(Boolean).join(' ').trim();

  return {
    overall: raw.pick_no,
    round: raw.round,
    slot: raw.draft_slot,
    teamId: raw.roster_id == null ? String(raw.draft_slot) : String(raw.roster_id),
    playerId: matched ? providerPlayerId : null,
    providerPlayerId,
    providerPlayerName: name || undefined,
  };
}

// ---------------------------------------------------------------------------
// init()/picks() cache — lets picks() resolve to exactly one upstream GET
// ---------------------------------------------------------------------------

interface DraftInitCacheEntry {
  teams: number;
  rounds: number;
  draftType: DraftType;
  slotToTeam: Record<number, string>;
  rawStatus: string;
}

const initCache = new Map<string, DraftInitCacheEntry>();

// ---------------------------------------------------------------------------
// Public: user resolution (not on ProviderAdapter — needed before a
// SleeperCred can exist, since users type a username but SleeperCred.userId
// must be Sleeper's numeric id)
// ---------------------------------------------------------------------------

export async function resolveUser(
  usernameOrUserId: string,
): Promise<{ userId: string; username: string; displayName: string }> {
  const raw = await sleeperFetch<RawUser>(`/user/${encodeURIComponent(usernameOrUserId)}`);
  return { userId: raw.user_id, username: raw.username, displayName: raw.display_name || raw.username };
}

// ---------------------------------------------------------------------------
// ProviderAdapter implementation
// ---------------------------------------------------------------------------

async function listLeagues(cred: Cred, season: string): Promise<LeagueRef[]> {
  const { userId } = requireSleeperCred(cred);
  const raw = await sleeperFetch<RawLeague[]>(
    `/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
  );
  return raw.map((league) => ({
    provider: 'sleeper',
    leagueId: league.league_id,
    name: league.name,
    season: league.season,
    totalTeams: league.total_rosters,
    draftId: league.draft_id ?? undefined,
    status: league.status as LeagueRef['status'],
  }));
}

export interface SleeperDraftRef {
  draftId: string;
  name: string;
  season: string;
  totalTeams: number | null;
  status: string;
  type: string;
}

/**
 * Sleeper exposes mocks in a user's draft history, separately from leagues.
 * Keeping this Sleeper-specific avoids widening the provider contract before
 * ESPN/Yahoo can support the same flow.
 */
export async function listSleeperDrafts(cred: SleeperCred, season: string): Promise<SleeperDraftRef[]> {
  const raw = await sleeperFetch<RawDraft[]>(
    `/user/${encodeURIComponent(cred.userId)}/drafts/nfl/${encodeURIComponent(season)}`,
  );
  return raw.map((draft) => ({
    draftId: draft.draft_id,
    name: draft.metadata?.name || `Sleeper ${draft.type} draft`,
    season: draft.season ?? season,
    totalTeams: draft.settings?.teams ?? null,
    status: draft.status,
    type: draft.type,
  }));
}

async function init(cred: Cred, draftId: string): Promise<DraftInit> {
  const { userId } = requireSleeperCred(cred);

  const rawDraft = await sleeperFetch<RawDraft>(`/draft/${encodeURIComponent(draftId)}`);
  // Standalone Sleeper mocks return league_id: null. Their draft payload carries
  // enough settings to initialize a board, so never attempt /league/null.
  const rawLeague = rawDraft.league_id
    ? await sleeperFetch<RawLeague>(`/league/${encodeURIComponent(rawDraft.league_id)}`)
    : null;
  let slotToTeamName: Record<number, string> | undefined;
  if (rawDraft.league_id) {
    try {
      const rawUsers = await sleeperFetch<RawLeagueUser[]>(`/league/${encodeURIComponent(rawDraft.league_id)}/users`);
      slotToTeamName = buildSlotToTeamName(rawDraft.draft_order, rawUsers);
    } catch {
      // Team names are display metadata only. A transient user-lookup failure
      // must not make a usable draft fail initialization.
      slotToTeamName = undefined;
    }
  }
  await loadKnownPlayerIds(); // warms the memoized cache ahead of the picks() hot path

  const teams = rawDraft.settings?.teams ?? rawLeague?.total_rosters ?? 0;
  const rounds = rawDraft.settings?.rounds ?? 0;
  const draftType = toDraftType(rawDraft.type);
  const slotToTeam = normalizeSlotToTeam(rawDraft.slot_to_roster_id);

  const mySlot = rawDraft.draft_order?.[userId] ?? null;
  const myTeamId =
    mySlot != null && rawDraft.slot_to_roster_id?.[mySlot] != null
      ? String(rawDraft.slot_to_roster_id[mySlot])
      : null;

  initCache.set(draftId, { teams, rounds, draftType, slotToTeam, rawStatus: rawDraft.status });

  return {
    provider: 'sleeper',
    draftId: rawDraft.draft_id,
    leagueId: rawDraft.league_id ?? `mock:${rawDraft.draft_id}`,
    draftType,
    teams,
    rounds,
    slotToTeam,
    ...(slotToTeamName ? { slotToTeamName } : {}),
    myTeamId,
    mySlot,
    settings: rawLeague ? normalizeLeagueSettings(rawLeague, draftType) : normalizeMockDraftSettings(rawDraft, draftType),
  };
}

async function picks(cred: Cred, draftId: string, signal?: AbortSignal): Promise<DraftPicks> {
  requireSleeperCred(cred);

  const cached = initCache.get(draftId);
  if (!cached) {
    throw new Error(`sleeperAdapter.picks called before init() for draft ${draftId}`);
  }

  const knownPlayerIds = await loadKnownPlayerIds(); // already resolved by init(); no extra fetch
  // Hot path: exactly one upstream GET. Status is derived from the init-cached rawStatus plus
  // pick count — `deriveDraftStatus` already treats any picks as drafting and a full board as
  // complete, so a second `/draft/{id}` poll is unnecessary for the live clock path.
  const rawPicks = await sleeperFetch<RawPick[]>(`/draft/${encodeURIComponent(draftId)}/picks`, signal);

  const normalizedPicks = rawPicks.map((raw) => toPick(raw, knownPlayerIds));
  const status = deriveDraftStatus(cached.rawStatus, normalizedPicks.length, cached.teams, cached.rounds);
  const onTheClock = computeOnTheClock(
    cached.draftType,
    cached.teams,
    cached.rounds,
    normalizedPicks.length,
    cached.slotToTeam,
  );

  return { status, picks: normalizedPicks, onTheClock, fetchedAt: Date.now() };
}

async function rosters(cred: Cred, leagueId: string): Promise<Roster[]> {
  requireSleeperCred(cred);
  const [rawRosters, rawUsers] = await Promise.all([
    sleeperFetch<RawRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`),
    sleeperFetch<RawLeagueUser[]>(`/league/${encodeURIComponent(leagueId)}/users`),
  ]);
  const usersById = new Map(rawUsers.map((u) => [u.user_id, u]));

  return rawRosters.map((raw) => {
    const user = usersById.get(raw.owner_id);
    const starters = raw.starters ?? [];
    return {
      teamId: String(raw.roster_id),
      ownerId: raw.owner_id,
      ownerName: displayNameForUser(user, raw.owner_id),
      starters: starters.map((id) => (id && id !== '0' ? id : null)),
      bench: (raw.players ?? []).filter((id) => !starters.includes(id)),
      ir: raw.reserve ?? [],
    };
  });
}

async function freeAgents(cred: Cred, leagueId: string): Promise<PlayerId[]> {
  requireSleeperCred(cred);
  const [rawRosters, knownPlayerIds] = await Promise.all([
    sleeperFetch<RawRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`),
    loadKnownPlayerIds(),
  ]);
  const rostered = new Set<string>();
  for (const roster of rawRosters) {
    for (const id of roster.players ?? []) rostered.add(id);
  }
  return [...knownPlayerIds].filter((id) => !rostered.has(id));
}

async function settings(cred: Cred, leagueId: string): Promise<LeagueSettings> {
  requireSleeperCred(cred);
  const rawLeague = await sleeperFetch<RawLeague>(`/league/${encodeURIComponent(leagueId)}`);
  return normalizeLeagueSettings(rawLeague, 'snake');
}

export const sleeperAdapter: ProviderAdapter = {
  provider: 'sleeper',
  listLeagues,
  init,
  picks,
  rosters,
  freeAgents,
  settings,
};
