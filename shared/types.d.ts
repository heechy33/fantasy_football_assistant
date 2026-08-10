/**
 * Shared contract between the API (Azure Functions) and the frontend.
 *
 * This is a `.d.ts` file deliberately, not `.ts`: TypeScript never emits JS for
 * declaration files, so it can be imported from both `api/` and `frontend/`
 * without either build's `tsc` trying to emit it under its own `outDir` (which
 * would otherwise violate `rootDir`, since this file lives outside both
 * packages). It also structurally enforces the type-only rule — a `.d.ts` file
 * can't contain runtime values (exported consts, functions, enums) even by
 * accident. Runtime constants belong next to whichever side uses them.
 */

// ---------------------------------------------------------------------------
// Providers and identity
// ---------------------------------------------------------------------------

export type Provider = 'sleeper' | 'espn' | 'yahoo';

/**
 * Canonical player id across the whole product = Sleeper's player id.
 *
 * Sleeper is our data spine: its `/players/nfl`, `/projections/...`, and
 * `/stats/...` endpoints are all keyed by it, and the DynastyProcess crosswalk
 * maps `espn_id` / `yahoo_id` onto it. ESPN and Yahoo ids are translated at the
 * adapter boundary so nothing above the adapters deals in provider ids.
 */
export type PlayerId = string;

/** Position vocabulary. Canonical spellings follow Sleeper (note `DEF`, not `D/ST`). */
export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

/**
 * Roster slot vocabulary. A superset of `Position` because lineups have
 * multi-position and non-scoring slots. `FLEX` is RB/WR/TE, `SUPER_FLEX` adds QB,
 * `WRRB_FLEX` excludes TE.
 */
export type RosterSlot =
  | Position
  | 'FLEX'
  | 'SUPER_FLEX'
  | 'WRRB_FLEX'
  | 'REC_FLEX'
  | 'BN'
  | 'IR';

// ---------------------------------------------------------------------------
// Stats and scoring
// ---------------------------------------------------------------------------

/**
 * Stat keys use **Sleeper's vocabulary** (`rush_yd`, `rec`, `rec_td`, `fum_lost`,
 * `pass_int`, `bonus_rec_te`, …).
 *
 * This is load-bearing: Sleeper's league `scoring_settings` and its projection
 * `stats` share one vocabulary, so scoring a projection is a plain dot product
 * over matching keys. The ESPN and Yahoo adapters carry the burden of
 * normalising *their* scoring settings into these keys — that translation is the
 * bulk of the work in those adapters, and it's deliberately paid once at the
 * boundary rather than smeared through the engine.
 *
 * Left as a `string` index rather than a closed union because Sleeper adds keys
 * (bonuses, IDP, special formats) and an unknown key must degrade to "not
 * scored" instead of failing to compile.
 */
export type StatMap = Record<string, number>;

/** League scoring weights, same key vocabulary as {@link StatMap}. */
export type ScoringMap = Record<string, number>;

// ---------------------------------------------------------------------------
// League
// ---------------------------------------------------------------------------

/**
 * Reception scoring, QB format, and draft type are independent — a league can
 * be PPR *and* two-QB at once, so these are separate dimensions rather than
 * one combined union. They select ADP sets and UI defaults; they never
 * replace the raw `LeagueSettings.scoring` map or roster slots, which stay
 * authoritative for actual scoring/lineup logic.
 */
export interface LeagueFormat {
  reception: 'standard' | 'half-ppr' | 'ppr' | 'custom';
  qb: 'one-qb' | 'two-qb' | 'superflex';
  draft: 'snake' | 'linear' | 'auction';
}

export interface LeagueRef {
  provider: Provider;
  leagueId: string;
  name: string;
  season: string;
  totalTeams: number;
  /** Present when the league has a draft we can track. */
  draftId?: string;
  /** Sleeper: `pre_draft` | `drafting` | `in_season` | `complete`. Normalised. */
  status?: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
}

export interface LeagueSettings {
  provider: Provider;
  leagueId: string;
  name: string;
  season: string;
  teams: number;
  /** Ordered starting lineup slots, e.g. ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF']. */
  startingSlots: RosterSlot[];
  /** Counts including bench/IR, e.g. { QB:1, RB:2, FLEX:1, BN:6 }. */
  rosterSlots: Partial<Record<RosterSlot, number>>;
  scoring: ScoringMap;
  /** Independent reception/QB/draft-type dimensions. See {@link LeagueFormat}. */
  format: LeagueFormat;
  waiverType?: 'faab' | 'rolling' | 'reverse';
  waiverBudget?: number;
  playoffStartWeek?: number;
}

// ---------------------------------------------------------------------------
// Draft — the init/poll split
// ---------------------------------------------------------------------------

export type DraftType = 'snake' | 'linear' | 'auction';
export type DraftStatus = 'pre' | 'drafting' | 'complete';

/**
 * Fetched **once** per draft. Heavy and cacheable — settings, slot mapping,
 * player pool metadata. Latency here is irrelevant.
 */
export interface DraftInit {
  provider: Provider;
  draftId: string;
  leagueId: string;
  draftType: DraftType;
  teams: number;
  rounds: number;
  /** Draft slot (1-indexed) -> provider team id. */
  slotToTeam: Record<number, string>;
  /** Which team is us. Needed for roster-need weighting and next-pick math. */
  myTeamId: string | null;
  mySlot: number | null;
  settings: LeagueSettings;
}

/**
 * Polled every 2-3s during a live draft. This is the only hot path in the
 * product, so it must resolve to exactly one upstream GET.
 */
export interface DraftPicks {
  status: DraftStatus;
  picks: Pick[];
  onTheClock: OnTheClock | null;
  /** Server timestamp (ms). Drives the stale-data banner. */
  fetchedAt: number;
}

export interface Pick {
  /** 1-indexed overall pick number. Must be strictly increasing across the array. */
  overall: number;
  round: number;
  /** Draft slot, 1-indexed. */
  slot: number;
  teamId: string;
  /**
   * Canonical id, or `null` when the crosswalk could not map the provider id.
   *
   * A null here is surfaced in the UI rather than dropped: one silently missing
   * pick corrupts every downstream recommendation (the player still shows as
   * available), so a visible gap is strictly safer than a quiet one.
   */
  playerId: PlayerId | null;
  providerPlayerId: string;
  /** Raw name from the provider. Lets the UI show something useful when playerId is null. */
  providerPlayerName?: string;
  /** Auction leagues only. */
  amount?: number;
}

export interface OnTheClock {
  teamId: string;
  slot: number;
  round: number;
  overall: number;
}

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

export interface Roster {
  teamId: string;
  ownerId: string;
  ownerName: string;
  /** Slot-assigned starters, parallel to `LeagueSettings.startingSlots`. */
  starters: (PlayerId | null)[];
  bench: PlayerId[];
  ir: PlayerId[];
}

// ---------------------------------------------------------------------------
// Pipeline artifacts (static JSON served from the CDN under /data)
// ---------------------------------------------------------------------------

export interface PlayerMeta {
  playerId: PlayerId;
  name: string;
  position: Position | null;
  /** Multi-position eligibility as reported by Sleeper (`fantasy_positions`). */
  eligiblePositions: Position[];
  team: string | null;
  byeWeek: number | null;
  age: number | null;
  yearsExp: number | null;
  injuryStatus: string | null;
  depthChartPosition?: string | null;
  depthChartOrder?: number | null;
  injuryBodyPart?: string | null;
  practiceParticipation?: string | null;
  ids: {
    espn?: string;
    yahoo?: string;
    fantasypros?: string;
    gsis?: string;
    mfl?: string;
    pfr?: string;
  };
}

export interface DurabilitySeason {
  season: number;
  teamGamesWhileRostered: number;
  gamesWithAnySnap: number;
  availabilityRate: number;
  injuryReportWeeks: number;
  outWeeks: number;
}

export type DurabilityBand = 'low concern' | 'mild concern' | 'moderate concern' | 'elevated concern' | 'high concern';

export interface DurabilityScoreComponents {
  baseline: number;
  recentGamesMissedPenalty: number;
  recurringInjuryPenalty: number;
  sameBodyPartPenalty: number;
  recentInjuryPenalty: number;
  highExposureAdjustment: number;
  agePositionBaselineAdjustment: number;
}

export interface DurabilityScore {
  score: number;
  band: DurabilityBand;
  components: DurabilityScoreComponents;
}

export interface OpportunityPeriod {
  season: number;
  games: number;
  targets: number;
  carries: number;
  touches: number;
  targetsPerGame: number | null;
  carriesPerGame: number | null;
  touchesPerGame: number | null;
  targetShare: number | null;
  carryShare: number | null;
  airYards: number | null;
  airYardsPerGame: number | null;
  airYardsShare: number | null;
  receivingYardsAfterCatch: number | null;
  redZoneTargets: number | null;
  endZoneTargets: number | null;
  goalLineCarries: number | null;
  snapPct: number | null;
}

export interface OpportunityProfile {
  season: OpportunityPeriod;
  finalFive: OpportunityPeriod | null;
  roleEvolution: {
    targetsPerGameDelta: number | null;
    targetShareDelta: number | null;
    airYardsShareDelta: number | null;
    touchesPerGameDelta: number | null;
  };
}

export interface InjuryReportHistory {
  season: number;
  week: number;
  /** Raw, source-provided injury labels; no broad anatomical merging. */
  labels: string[];
}

export interface InjuryBodyPartHistory {
  normalizedBodyPart: string;
  episodes: number;
  recurring: boolean;
  reports: InjuryReportHistory[];
}

/** Descriptive prior-season context. None of these fields are recommendation inputs. */
export interface PlayerUsage {
  season: number;
  /**
   * True when the usage season has roster and/or snap evidence. False means
   * older durability/injury history exists, but this season's usage block
   * should not be presented as observed zeros.
   */
  usageSeasonObserved: boolean;
  snapPct: number | null;
  targetShare: number | null;
  carryShare: number | null;
  gamesWithAnySnap: number;
  recentTeam: string | null;
  teamChanged: boolean | null;
  knownAbsent: boolean;
  /** Pooled observed availability, not a forecast or medical probability. */
  availabilityRate: number | null;
  seasons: DurabilitySeason[];
  injuryHistory: InjuryBodyPartHistory[];
  durabilityScore: DurabilityScore | null;
  opportunity: OpportunityProfile | null;
}

export type PlayerUsageArtifact = Record<PlayerId, PlayerUsage>;

export interface SeasonProjection {
  playerId: PlayerId;
  /** Projection source, e.g. 'rotowire'. Surfaced in the UI for honesty. */
  source: string;
  stats: StatMap;
}

export interface WeeklyProjection {
  playerId: PlayerId;
  week: number;
  /** Opponent team abbreviation — Sleeper provides this, so matchup context is free. */
  opponent: string | null;
  source: string;
  stats: StatMap;
}

/** Actual results, for breakout detection and projection-accuracy tracking. */
export interface WeeklyStats {
  playerId: PlayerId;
  week: number;
  stats: StatMap;
}

export interface AdpEntry {
  playerId: PlayerId | null;
  name: string;
  position: string;
  team: string | null;
  adp: number;
  /**
   * Standard deviation of draft position. The quiet MVP of this whole product:
   * it's what turns ADP from a point estimate into P(still available at my next
   * pick), which is the flagship feature DraftKick charges for.
   *
   * When `stdevSource` is `'fitted'` this is a synthesized estimate, not an
   * observed one (see `stdevSource`) — Sleeper's draft-lobby ADP carries no
   * dispersion field at all, unlike FFC's.
   */
  stdev: number;
  /** Null when the source has no population-shape data (Sleeper's lobby ADP) rather than genuinely
   * zero — never coerce this to 0, which would read as "always the exact same pick." */
  high: number | null;
  low: number | null;
  /** Null when the source doesn't expose a sample size (Sleeper's lobby ADP), not zero drafts. */
  timesDrafted: number | null;
  byeWeek: number | null;
  /** Which upstream produced this entry's adp value. 'sleeper' is Sleeper's own draft-lobby ADP
   * (the population this product actually drafts against); 'ffc' is Fantasy Football Calculator's
   * self-selected mock lobby, kept as the calibration input for `stdevSource: 'fitted'` and as the
   * automatic fallback when Sleeper's (undocumented) ADP endpoint is unavailable or too sparse. */
  adpSource: 'sleeper' | 'ffc';
  /** 'observed' when `stdev` came directly from the source (FFC). 'fitted' when it was synthesized
   * from FFC's coefficient-of-variation curve applied to a non-FFC adp mean (Sleeper has no
   * dispersion field) — see `pipeline/transform.py`'s `fitted_stdev`. Not a measurement of Sleeper's
   * actual draft-position spread; treat as experimental until calibrated against captured history. */
  stdevSource: 'observed' | 'fitted';
}

/** League-wide add/drop velocity from Sleeper. Powers waiver recommendations. */
export interface TrendingEntry {
  playerId: PlayerId;
  count: number;
}

export interface DataManifest {
  /** ISO timestamp of the pipeline run that produced these artifacts. */
  builtAt: string;
  season: string;
  /** Populated in-season; null during the preseason. */
  week: number | null;
  sources: Record<
    string,
    {
      url: string;
      rows: number;
      fetchedAt: string;
      /** Optional upstream display date, e.g. FFToday's Updated date. */
      upstreamUpdatedAt?: string;
      role?: string;
      termsUrl?: string;
      diagnostic?: string;
      population?: {
        mockDrafts: number | null;
        teams: number;
        season: number;
        format: string;
        rows: number;
      };
      /** Only present on `adp_active_<format>` entries — which upstream actually produced the
       * committed `adp-<format>.json` for this pipeline run. 'ffc-fallback' means Sleeper's ADP
       * endpoint was unavailable or returned too few usable rows, so the UI must disclose the FFC
       * board is active rather than silently keeping a stale "Sleeper" label (see CLAUDE.md's
       * "never switch sources silently" rule). */
      activeAdpSource?: 'sleeper' | 'ffc-fallback';
      /** Bumped when this source's manifest entry shape changes. */
      schemaVersion: number;
      /**
       * Core sources fail closed. Required nflverse context sources fail open
       * (error status + cleared player-usage). Optional PBP fails open without
       * clearing the rest of the context artifact.
       */
      status: 'ok' | 'stale' | 'error';
    }
  >;
  crosswalk: {
    totalPlayers: number;
    /** Match rate against the top-N players by ADP — the CI coverage gate. */
    top300MatchRate: number;
    unmatchedTop300: string[];
  };
  projection?: {
    source: string;
    updatedAt: string | null;
    positionRows?: Record<string, number>;
    diagnostics?: Record<string, unknown>;
  };
  context?: {
    usageSeason: number;
    historySeasons: number[];
    diagnostics: Record<string, unknown>;
    coverage: {
      total: number;
      covered: number;
      knownAbsent: number;
      missing: number;
      matchRate: number;
      missingPlayerIds: PlayerId[];
    };
  };
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** Sleeper needs no auth at all — its API is read-only by design. */
export interface SleeperCred {
  provider: 'sleeper';
  userId: string;
}

export interface EspnCred {
  provider: 'espn';
  /** Includes the surrounding braces, e.g. `{ABC-123}`. ESPN rejects it without. */
  swid: string;
  espnS2: string;
}

export interface YahooCred {
  provider: 'yahoo';
  /** Yahoo refresh tokens do not expire; access tokens last 1 hour. */
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

export type Cred = SleeperCred | EspnCred | YahooCred;

/** Shape stored per user in Cosmos. Secrets are AES-GCM sealed before write. */
export interface UserRecord {
  id: string;
  /** From SWA's `/.auth/me` — `clientPrincipal.userId`. */
  userId: string;
  userDetails: string;
  identityProvider: string;
  createdAt: string;
  sleeperUserId?: string;
  /** Base64 AES-GCM envelope, never plaintext. */
  espnSealed?: string;
  yahooSealed?: string;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Every provider implements this. Nothing above this boundary knows which
 * provider it is talking to — that isolation is what makes ESPN's fragility
 * survivable and what lets the in-season features work on all three for free.
 */
export interface ProviderAdapter {
  readonly provider: Provider;

  listLeagues(cred: Cred, season: string): Promise<LeagueRef[]>;

  /** Once per draft. May be slow. */
  init(cred: Cred, draftId: string): Promise<DraftInit>;

  /** Hot path: exactly one upstream GET, called every 2-3s. */
  picks(cred: Cred, draftId: string): Promise<DraftPicks>;

  /** In-season. */
  rosters(cred: Cred, leagueId: string): Promise<Roster[]>;
  freeAgents(cred: Cred, leagueId: string): Promise<PlayerId[]>;
  settings(cred: Cred, leagueId: string): Promise<LeagueSettings>;
}

// ---------------------------------------------------------------------------
// API envelopes
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  /** Stable, machine-readable so the UI can react (e.g. re-prompt for cookies). */
  code:
    | 'unauthenticated'
    | 'no_credentials'
    | 'credentials_invalid'
    | 'provider_unavailable'
    | 'not_found'
    | 'bad_request'
    | 'internal';
  provider?: Provider;
}

export type ApiResult<T> = T | ApiError;
