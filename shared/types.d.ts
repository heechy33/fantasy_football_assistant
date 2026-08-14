/**
 * Shared contract between the API (Azure Functions) and the frontend.
 *
 * This is a `.d.ts` file deliberately, not `.ts`: TypeScript never emits JS for
 * declaration files, so it can be imported from both `api/` and `frontend/`
 * without either build's `tsc` trying to emit it under its own `outDir` (which
 * would otherwise violate `rootDir`, since this file lives outside both
 * packages). It also structurally enforces the type-only rule â€” a `.d.ts` file
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
 * `pass_int`, `bonus_rec_te`, â€¦).
 *
 * This is load-bearing: Sleeper's league `scoring_settings` and its projection
 * `stats` share one vocabulary, so scoring a projection is a plain dot product
 * over matching keys. The ESPN and Yahoo adapters carry the burden of
 * normalising *their* scoring settings into these keys â€” that translation is the
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
 * Reception scoring, QB format, and draft type are independent â€” a league can
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
// Draft â€” the init/poll split
// ---------------------------------------------------------------------------

export type DraftType = 'snake' | 'linear' | 'auction';
export type DraftStatus = 'pre' | 'drafting' | 'complete';

/**
 * Fetched **once** per draft. Heavy and cacheable â€” settings, slot mapping,
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
  /**
   * Draft slot (1-indexed) -> fantasy team display name, resolved once in `init()`.
   * Optional because standalone Sleeper mocks have `league_id: null` and name lookup is
   * non-fatal. Consumers fall back to `Team {slot}`. Never used by `picks()`.
   */
  slotToTeamName?: Record<number, string>;
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
  heightInches?: number | null;
  weightLbs?: number | null;
  college?: string | null;
  jerseyNumber?: number | null;
  draftYear?: number | null;
  draftRound?: number | null;
  draftPick?: number | null;
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

/**
 * Descriptive prior-season context. `availabilityRate` is a recommendation input for bench-mode
 * depth pricing (`frontend/src/engine/eligibility.ts`'s `benchDepthValue`/`expectedUnavailableFraction`)
 * once a roster's starting slots are filled â€” it weights how much a bench candidate is worth as
 * insurance against an incumbent starter missing games. Every other field here remains descriptive
 * display context only, not a ranking input.
 */
export interface PlayerUsage {
  season: number;
  /**
   * True when the usage season has roster and/or snap evidence. False means
   * older durability/injury history exists, but this season's usage block
   * should not be presented as observed zeros.
   */
  usageSeasonObserved: boolean;
  snapPct: number | null;
  /** Prior-season QB completions divided by passing attempts, when available. Display-only. */
  completionPct?: number | null;
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
  /**
   * Last-season PPR production over the same appearance weeks as `opportunity`. Display-only â€”
   * never a Draft Score, planValue, or sort input. Absent on older artifacts and on players with
   * no usage-season snap evidence; the UI must fail open, not fabricate zeros.
   */
  production?: PlayerProduction | null;
}

export interface PlayerProduction {
  games: number;
  pointsPpr: number;
  pointsPprPerGame: number | null;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  rushingYards: number;
  rushingTds: number;
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
  /** Opponent team abbreviation â€” Sleeper provides this, so matchup context is free. */
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

/** Completed prior-season PPR results used by the player-card chart. */
export interface WeeklyFantasyPoints {
  week: number;
  pointsPpr: number;
}

export interface PlayerWeeklyScoringArtifact {
  schemaVersion: number;
  season: number;
  players: Record<PlayerId, WeeklyFantasyPoints[]>;
}

/**
 * One player-week from the weekly game-log artifact (`data/weekly-stats.json`).
 * `[week, ...values]`, positionally aligned to `PlayerWeeklyStatsArtifact.columns[position]`.
 * Heterogeneous by design: `opp` is a string, everything else is a number or null.
 *
 * A row's presence means the player was active that week. A raw Sleeper stat
 * key the pipeline never saw for that row is written as `0` (Sleeper omits
 * zero-valued keys entirely, so absence there means zero, not unknown). `null`
 * is reserved for genuinely not-computable values: `fin` when Sleeper's own
 * rank was the 999 "no sample" sentinel and no recomputation was possible,
 * `snp` when the snap-share denominator was null/0, `opp` when the
 * team/schedule join failed.
 */
export type WeeklyStatRow = readonly (number | string | null)[];

export interface PlayerWeeklyStatSeries {
  /** Position at artifact-build time; selects which `columns[position]` header applies. */
  p: string;
  /** Bye week of the player's last-resolved team that season, or null if unresolved. */
  bye: number | null;
  w: WeeklyStatRow[];
}

/** [p20, p40, p60, p80] over a position's startable-cohort player-weeks for one shaded
 *  column. Absent (null) below the minimum sample size â€” render that column unshaded
 *  rather than off a thin/degenerate ramp. */
export type WeeklyStatBreakpoints = readonly [number, number, number, number];

export interface PlayerWeeklyStatsArtifact {
  schemaVersion: number;
  /** The season these weekly rows are FROM (the usage season, i.e. draft season âˆ’ 1). */
  season: number;
  /**
   * Weeks whose upstream fetch succeeded. A week absent here is "not fetched" â€”
   * distinct from a fetched week in which a given player simply has no row
   * (bye/inactive/not yet rostered). Collapsing these two cases would make a
   * failed fetch read as a league-wide bye.
   */
  weeksFetched: number[];
  /** Column key order per position; index into a row with `columns[row.p][i] â†” row.w[j][i + 1]`. */
  columns: Record<string, string[]>;
  players: Record<PlayerId, PlayerWeeklyStatSeries>;
  /** Per position, per shaded column key. `opp` and `fin` are never shaded (unset/omitted). */
  heat: Record<string, Record<string, WeeklyStatBreakpoints | null>>;
}

/** Optional, local-only FantasyPros display decoration for player cards. */
export interface FantasyProsStars {
  rank: number;
  tier: number | null;
  upside: number | null;
  bust: number | null;
  sos: number | null;
  ecrVsAdp: number | null;
  positionRank: string;
}

export interface FantasyProsUnmatchedRow {
  rank: number;
  name: string;
  team: string | null;
  position: string;
}

export interface FantasyProsArtifact {
  schemaVersion: number;
  generatedAt: string;
  season: number;
  source: {
    name: 'fantasypros-draft-rankings-csv';
    file: string;
    rows: number;
    droppedNonRankRows: number;
    matched: number;
    unmatched: number;
    status: 'ok';
  };
  players: Record<PlayerId, FantasyProsStars>;
  unmatched: FantasyProsUnmatchedRow[];
}

/**
 * Display-only per-site ADP decoration (gitignored, local-only â€” absent in
 * production deploys). A parse of FantasyPros' Overall ADP export; the board's
 * own ADP (Sleeper lobby + FFC fallback) is the only provenance the engine
 * consumes. This type is structurally NOT `AdpEntry[]`, so it cannot be handed
 * to buildRecommendationBoard / draftScore.ts by accident.
 */
export interface FantasyProsAdpArtifact {
  schemaVersion: number;
  generatedAt: string;
  season: number;
  source: {
    name: 'fantasypros-overall-adp-csv';
    file: string;
    rows: number;
    matched: number;
    unmatched: number;
    emptyColumns: string[];
    status: 'ok';
  };
  /** Per-site ADP providers that had non-blank cells, in CSV header order. */
  providers: Array<{
    key: 'espn' | 'sleeper' | 'cbs' | 'rtsports' | 'fantrax';
    label: string;
    rows: number;
    matchedRows: number;
  }>;
  consensus: { key: 'avg'; label: string; rows: number };
  realTime: { key: 'realTime'; label: string; rows: number };
  players: Record<
    PlayerId,
    {
      rank: number;
      positionRank: string;
      /** FantasyPros AVG â€” the consensus number, never mixed into `adp`. */
      avg?: number;
      /** FantasyPros Real-Time rank + movement delta, never mixed into `adp`. */
      realTime?: { rank: number; delta: number | null };
      /** Blank provider cells are absent keys, never null. */
      adp?: Partial<Record<'espn' | 'sleeper' | 'cbs' | 'rtsports' | 'fantrax', number>>;
    }
  >;
  unmatched: Array<{
    rank: number;
    name: string;
    team: string | null;
    position: string;
    reason: string;
  }>;
}

/**
 * Display-only multi-provider season projections (committed, deployed). Stat
 * maps use Sleeper's vocabulary, keyed by playerId with no row-level source
 * field â€” structurally NOT `SeasonProjection[]`, so it cannot be handed to
 * buildRecommendationBoard / draftScore.ts by accident. Points are computed at
 * display time via scoreStats against the user's actual league scoring.
 */
export interface ProviderProjectionsArtifact {
  schemaVersion: number;
  generatedAt: string;
  season: number;
  displayOnly: true;
  providers: Array<{
    key: string;
    label: string;
    attribution: string;
    status: 'ok' | 'stale' | 'error';
    fetchedAt: string | null;
    upstreamUpdatedAt: string | null;
    rows: number;
    positionRows: Record<string, number>;
    positionsExcluded: Array<{ position: string; medianError: number }>;
    staleSinceDays: number | null;
    diagnostic: string | null;
  }>;
  players: Record<PlayerId, Record<string, StatMap>>;
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
   * observed one (see `stdevSource`) â€” Sleeper's draft-lobby ADP carries no
   * dispersion field at all, unlike FFC's.
   */
  stdev: number;
  /** Null when the source has no population-shape data (Sleeper's lobby ADP) rather than genuinely
   * zero â€” never coerce this to 0, which would read as "always the exact same pick." */
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
   * dispersion field) â€” see `pipeline/transform.py`'s `fitted_stdev`. Not a measurement of Sleeper's
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
      /** Only present on `adp_active_<format>` entries â€” which upstream actually produced the
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
       * clearing the rest of the context artifact. 'partial' is currently only
       * emitted by `sleeper_weekly_stats`: some but not all of the 18 weekly
       * fetches succeeded (see `weeksFetched`/`weeksFailed` below) â€” the
       * artifact still has real data, just fewer weeks than a full season.
       */
      status: 'ok' | 'stale' | 'partial' | 'error';
      /** `sleeper_weekly_stats` only: which of the 18 weekly fetches succeeded/failed. */
      weeksFetched?: number[];
      weeksFailed?: Record<string, string>;
    }
  >;
  crosswalk: {
    totalPlayers: number;
    /**
     * FFC name/position/team â†’ sleeper_id match rate on the top-N FFC ADP rows.
     * This is the pipeline CI coverage gate (`COVERAGE_GATE_THRESHOLD`), not
     * projection coverage on the active (usually Sleeper) board.
     */
    top300MatchRate: number;
    unmatchedTop300: string[];
  };
  projection?: {
    source: string;
    updatedAt: string | null;
    positionRows?: Record<string, number>;
    /**
     * Active-board ADP â†’ season-projection coverage (usually Sleeper top-N Ã—
     * FFToday). Distinct from `crosswalk.top300MatchRate`.
     */
    top300MatchRate?: number;
    unmatchedTop300?: string[];
    diagnostics?: Record<string, unknown>;
  };
  /**
   * Display-only multi-provider projections summary (data/projections-providers.json).
   * Lets DataHealth disclose provider status without fetching the ~200 KB artifact.
   */
  projectionProviders?: {
    updatedAt: string;
    providers: Record<
      string,
      {
        status: 'ok' | 'stale' | 'error';
        rows: number;
        staleSinceDays: number | null;
        diagnostic: string | null;
      }
    >;
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

/** Sleeper needs no auth at all â€” its API is read-only by design. */
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
  /** From SWA's `/.auth/me` â€” `clientPrincipal.userId`. */
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
 * provider it is talking to â€” that isolation is what makes ESPN's fragility
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

