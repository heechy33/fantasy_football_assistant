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

export type Provider = 'sleeper' | 'espn' | 'yahoo' | 'manual';

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
  /**
   * ESPN bridge only: a human-readable desync signal — "the tab was opened after the draft
   * started" (unreliable order) or "N picks were missed" (DOM pick numbers run past the stream
   * count). Flags only: picks are never renumbered or dropped. Null/absent for providers with a
   * full-history GET (Sleeper), where this failure mode cannot occur.
   */
  desyncReason?: string | null;
  /** ESPN bridge only (Step 6): count of `picks` with `unattributed: true` — the stream's
   * absolute-pick offset was not confirmed for this normalization pass. `0`/absent once attribution
   * resolves. Drives a dedicated SessionAlerts entry distinct from `desyncReason`. */
  unattributedCount?: number;
}

/**
 * The extension's live pick stream, kept in its own storage key separate from the bounded, deduped
 * recon snapshot. `streamPicks` is uncapped and ordered by arrival (overall 1-based); `mySlot`
 * comes from the plaintext JOINED/TOKEN frames; `leagueId` from TOKEN (or the socket URL).
 */
export interface EspnLivePick {
  /** 1-based arrival index — the extension's own counter from when the socket was hooked, equal to
   * the draft overall only when the tab was open from pick 1. */
  overall: number;
  /** ESPN league team id from the SELECTED frame's first token. NOT a draft position — recon
   * (2026-08-15) proved the draft order is a random permutation of team ids, and the adapter
   * derives the position via espnDraftOrder. */
  slot: number;
  /** ESPN player id from the SELECTED frame (negative synthetics for D/ST — never canonical). */
  playerId: string;
  /** Raw third token from the SELECTED frame (observed 2, 4, 5 in recon). Position-shaped but its
   * enum is UNVERIFIED — never hard-decoded. The adapter self-calibrates a posToken -> position
   * mapping from picks that already resolved via ids.espn, then applies it to unresolved picks. */
  posToken?: number | null;
  /** Trailing {GUID} marks the user's own pick; retained for recon, unused by the app. */
  guid?: string | null;
  source?: string;
}

/** One [data-pick-number] row captured from the ESPN draft DOM, merged into the live snapshot by
 * pickNumber (Step B). Strictly better than the static D/ST id map: it resolves D/ST and the
 * non-ids.espn tail through the adapter's name/position/team tiers. */
export interface EspnDomPick {
  /** Absolute pick number shown by the row (the ESPN draft overall, not an arrival index). */
  pickNumber: number;
  /** Collapsed textContent of the row container, e.g.
   * "140Jake BatesDETKKoston's Top-Notch Team141141.2undo". */
  text: string;
  /** Direct-child text segments of the row container, captured now so a future run can drop the
   * text regex. */
  segments: string[];
  /** Opportunistic bonus join key for the Step 6 offset derivation. Recon (2026-08-15) confirmed
   * real pick rows carry NO `data-player-id` (only the Queue-button suggestions do), so this is
   * expected to be null on every real row — nothing in the offset derivation depends on it. */
  playerId?: string | null;
}

/**
 * One authoritative pick from ESPN's own `mDraftDetail` pick history (missed-frame
 * self-correction, 2026-08-28) — normalized by the extension's `asPick` from the raw payload.
 * `overall` is the ABSOLUTE draft pick number; `playerId` is the real ESPN player id (resolved
 * directly through the app's `ids.espn` crosswalk, never the fuzzy name tiers). `teamId` is the
 * drafting team's ESPN league team id, when the payload carried it.
 */
export interface EspnDetailPick {
  overall: number;
  playerId: string;
  name?: string | null;
  teamId?: string | null;
  position?: string | null;
  proTeam?: string | null;
  /** Whether this row carried a resolvable player id or name when captured (normalize.js's
   * `applyDetailPicks`) — `false` for ESPN's pre-generated teamId-only slate padding. Absent on
   * older snapshots (treat as unknown, not as padding). */
  identified?: boolean;
}

export interface EspnLiveSnapshot {
  schemaVersion: number;
  /** Monotonic draft-generation counter: the extension increments it on every league-change reset,
   * so the app can distinguish a clean switch (closed old mock, opened new mock) from a dirty
   * two-tab merge without inferring it from stream length. Absent on pre-reset snapshots; app code
   * must read it as `0` when undefined. As of Step 7, a schema-version reset (an incompatible prior
   * snapshot shape) ALSO bumps epoch — see `resetReason`. */
  epoch?: number;
  /** Why the extension last reset this snapshot to empty: `'new'` (no prior snapshot existed),
   * `'league-change'` (a different league's TOKEN/SELECTED arrived), or `'schema-change'` (the
   * stored shape didn't match `LIVE_SCHEMA_VERSION`). Absent on pre-Step-7 snapshots. Lets the app
   * distinguish a genuine new draft from a silent mid-draft restart instead of re-deriving pick 1
   * from wherever the stream happens to resume. */
  resetReason?: 'new' | 'league-change' | 'schema-change' | 'draft-restart';
  streamPicks: EspnLivePick[];
  mySlot: number | null;
  leagueId: string | null;
  lastHeartbeatAt: number | null;
  /** DOM pick rows merged by pickNumber (Step B). Absent on pre-v2 snapshots. */
  domPicks?: EspnDomPick[];
  /** Running max of every DOM `pickNumber` ever merged into `domPicks` this snapshot's life —
   * secondary board-depth signal for `espnOffset.ts` when `currentPickNumber` isn't available yet. */
  domMaxSeen?: number;
  /** `domMaxSeen` (or the on-the-clock reading minus one) at the instant the FIRST stream pick
   * landed — the primary absolute-offset estimate for a mid-draft attach. `0` only when
   * `domSampledBeforeStream` is also true (a confirmed-empty board); otherwise `null`, meaning no
   * estimate exists yet. See PLAN "espnOffset.ts" / Finding B (current-pick testid). */
  domMaxAtStreamStart?: number | null;
  /** True once the DOM has been reconciled at least once while `streamPicks` was still empty.
   * Distinguishes "the board was confirmed empty" from "we have not looked yet" — both would
   * otherwise read as `domMaxAtStreamStart === 0` and risk a false offset-0 confirmation on a
   * mid-draft attach (the 400ms DOM-reconcile debounce can lose the race against the first SELECTED
   * frame). */
  domSampledBeforeStream?: boolean;
  /**
   * Missed-frame self-correction (2026-08-28): the league's OWN pick history, re-read by the
   * extension from ESPN's `mDraftDetail` read API (absolute overall numbers + real player ids)
   * and merged by overall. The socket `streamPicks` stay the fast path and are never renumbered;
   * entries here REPAIR picks the tab's websocket missed. App readers must treat a `detailPicks`
   * entry as authoritative for "this player was taken at this absolute pick" — `EspnLivePick`
   * arrival ordinals remain provisional until the offset is confirmed.
   */
  detailPicks?: EspnDetailPick[];
  /** The DOM's own on-the-clock absolute pick number, from `[data-testid="current-pick"]` (e.g.
   * "On the Clock: Pick 146Team 3"). Present on the very first DOM reconcile, unlike `domMaxSeen`
   * which only accumulates from the (at most 4-row) pick-number ticker — the fastest offset signal
   * available. */
  currentPickNumber?: number | null;
  /** The ESPN team id named in the on-the-clock reading, when the league still uses ESPN's default
   * "Team N" names. A bonus cross-check only; null whenever the league has custom team names. */
  currentPickTeam?: number | null;
  /** League facts ESPN ITSELF reports (the extension's periodic mDraftDetail,mSettings read —
   * the same fetch that fills `detailPicks`). The socket cannot state the league size, draft
   * length, or season; these stamped values are authoritative where present and are what the app
   * corrects its seeded guesses against. Absent until the first reconcile lands. */
  leagueRounds?: number | null;
  leagueTeams?: number | null;
  leagueSeason?: string | null;
  /** The league's display name (`settings.name`), stamped by the same reconcile. Lets the launcher
   * show the real league name instead of `ESPN live draft (<id>)`. */
  leagueName?: string | null;
}

/**
 * A league (not draft) snapshot captured by the extension from ESPN's own league-API JSON
 * (`/apis/v3/games/ffl/seasons/<season>/segments/0/leagues/<id>?view=...`), stored in the
 * extension's `LEAGUE_STORAGE_KEY` and relayed to the app on request (see
 * `frontend/src/adapters/espnBridge.ts`'s `requestEspnLeague`). The RAW ESPN payload is stored
 * verbatim (redacted by the extension, as with the draft recon); parsing into this shape happens
 * at the adapter boundary in `frontend/src/adapters/espnLeague.ts` — the one place ESPN's integer
 * slot ids and scoringItems may be translated into RosterSlots and Sleeper's stat vocabulary
 * (CLAUDE.md, "Provider adapters"). What lands here is the PARSED, translated result.
 *
 * NOTE: the field mapping is provisional until the extension recon (fixtures/espn-contract)
 * confirms which `?view=` payloads the real league page emits (mSettings/mTeam/mDraftDetail) and
 * that the extension's redaction bounds don't truncate anything load-bearing.
 */
export interface EspnLeagueSnapshot {
  schemaVersion: number;
  /** The REAL ESPN league id — what retires the `'manual-session'` placeholder leagueId. */
  leagueId: string;
  season: string;
  name: string;
  teams: number;
  /** Null when mDraftDetail wasn't among the captured views. */
  rounds: number | null;
  startingSlots: RosterSlot[];
  rosterSlots: Partial<Record<RosterSlot, number>>;
  /** Sleeper's stat vocabulary — translated at the adapter boundary, never raw ESPN statIds. */
  scoring: ScoringMap;
  format: LeagueFormat;
  /** Non-null when the draftedPlayers/roster data identifies the viewer's team — usually null on
   * a plain league-page capture; the seat is typed at draft time in the Draft Room. */
  myTeamId: number | null;
  /** Untranslated ESPN values the parser couldn't map (slot ids, scoringItems) — surfaced, never
   * silently dropped (CLAUDE.md). */
  diagnostics: string[];
  /** The `?view=` params seen in the captured league-API calls (mirrored from the extension's
   * raw capture) — lets the connect UI say "open your Rosters tab too" instead of a dead end
   * when a needed view never fired. Absent on snapshots parsed before this existed. */
  views?: string[];
  /** Every team scraped from the league page (mTeam/mRoster views): ESPN id + display name.
   * The connect panel's "which team is yours?" dropdown is built from this — the capture cannot
   * know which team is the user's (swid|session are redacted), so the USER picks once. */
  teamNames: { id: number; name: string }[];
  /** ESPN scoring items that carried non-zero points but have NO Sleeper-vocabulary equivalent
   * (long-TD / yardage-game / tiered-FG bonuses the engine cannot score). Structured — statId +
   * the league's actual point value — so the confirm card can render readable per-bonus tags
   * instead of a prose diagnostic. Companion to (not a replacement for) the summarized
   * `diagnostics` string, which stays the full-disclosure fallback. Absent on older snapshots. */
  unmodeledScoringItems?: { statId: number; points: number }[];
  /** True when `rounds` was DERIVED (summed from roster size — a snake draft picks once per
   * roster spot) rather than read from mDraftDetail. The confirm card labels it honestly. */
  roundsDerived?: boolean;
  /** True when the capture's draftDetail says the league's draft has completed (the real 2026
   * draftDetail is `[completeDate, drafted, inProgress, picks]`). When true AND `draftPicks` is
   * populated, the connect card offers "Save league + import drafted roster". */
  drafted?: boolean;
  /** Raw pick summary from draftDetail.picks (2026-08-28 real-shape recon, league 2018058011).
   * One entry per drafted pick, in overall order; `playerId` is the raw ESPN id (resolved to a
   * canonical id only by the import adapter's crosswalk). Absent when the capture carried no
   * picks. */
  draftPicks?: EspnDraftPickSummary[];
  capturedAt: number;
}

/** One pick from the league capture's draftDetail.picks, untranslated. */
export interface EspnDraftPickSummary {
  /** 1-indexed overall pick number. */
  overall: number;
  /** The ESPN league team id that made the pick. Null when the capture omitted it. */
  teamId: number | null;
  /** Raw ESPN player id (D/ST ids are negative synthetics). Null when omitted. */
  playerId: string | null;
  playerName: string | null;
  /** Canonical position abbreviation (QB/RB/WR/TE/K/DEF) decoded from defaultPositionId. */
  position: string | null;
  /** ESPN NFL proTeamId, when the pick's player carried one — feeds the D/ST identity resolver. */
  proTeamId: number | null;
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
  /** ESPN bridge only: the raw ESPN league team id that made this pick (SELECTED first token).
   * The normalized `teamId`/`slot` are draft positions; this preserves the team id for display. */
  providerTeamId?: string;
  /** ESPN bridge only (Step 6): true when the stream's absolute-pick offset was not confirmed at
   * normalization time, so `slot`/`teamId` could not be derived and are zeroed (`0`/`''`) rather
   * than laundered from the raw ESPN team id. `overall` is a best-effort arrival-order ordinal in
   * this case, not a confirmed absolute pick number. The player is still resolved where possible and
   * the pick still appears — never silently dropped (CLAUDE.md) — but callers that key off
   * `slot`/`teamId` (rosters, pick-boundary math) must skip these until attribution resolves. */
  unattributed?: true;
  /** Auction leagues only. */
  amount?: number;
}

export interface OnTheClock {
  teamId: string;
  slot: number;
  round: number;
  overall: number;
}

/**
 * An override always wins over a live-polled pick at the same `overall`. It's the single
 * mechanism behind both "universal manual mode" (every pick is a `manual-entry` override, no live
 * picks underneath) and "undo/correction" (a `manual-correction` override sits on top of a
 * live-polled pick) — same merge function, unified data model.
 *
 * Moved here from `frontend/src/state/draftBoardState.ts` (which re-exports it unchanged) once
 * Phase 5 needed the identical shape on both sides of the wire — `SavedDraft` below carries an
 * array of these to Cosmos, so `api/`'s handlers need the type too.
 *
 * `round`/`slot`/`teamId` are optional because a correction can omit them and inherit from the
 * live pick underneath; a manual-entry override (no live pick to inherit from) should supply all
 * of them.
 */
export interface PickOverride {
  overall: number;
  round?: number;
  slot?: number;
  teamId?: string;
  playerId: PlayerId | null;
  /**
   * Provider's own player id, retained verbatim so a manual-entry override can round-trip the
   * provider id a live pick carried (the atomic manual-takeover freeze depends on this). Falls
   * back to the canonical id at read time.
   */
  providerPlayerId?: string;
  providerPlayerName?: string;
  source: 'manual-correction' | 'manual-entry';
  correctedAt: number;
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
  /** Season rushing EPA (nflverse `stats_player` weekly `rushing_epa`, summed over the same
   * appearance weeks as the rest of this period). Display-only percentile input — never a
   * ranking input. Null-safe on artifacts written before this field existed. */
  rushingEpa?: number;
  rushingEpaPerGame?: number | null;
  /** Season receiving EPA (nflverse `stats_player` weekly `receiving_epa`), same semantics. */
  receivingEpa?: number;
  receivingEpaPerGame?: number | null;
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
   * Last-season PPR production over the same appearance weeks as `opportunity`. Display-only —
   * never a planValue, recommendation-board, or sort input. Absent on older artifacts and on players with
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

/**
 * Display-only multi-provider season projections (committed, deployed). Stat
 * maps use Sleeper's vocabulary, keyed by playerId with no row-level source
 * field â€” structurally NOT `SeasonProjection[]`, so it cannot be handed to
 * buildRecommendationBoard by accident. Points are computed at
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
   * dispersion field at all, unlike FFC's. The ESPN board's stdev is fitted the
   * same way: ESPN's public leaguedefaults feed publishes no draft-position
   * distribution either.
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
   * automatic fallback when Sleeper's (undocumented) ADP endpoint is unavailable or too sparse.
   * 'espn' is ESPN's public default-league average draft position (the `adp-espn-ppr.json` board,
   * selected only for ESPN sessions) â€” same honesty caveat as Sleeper: no published range or sample
   * size, so its stdev is also a fitted estimate.
   * 'underdog' is Underdog's best-ball ADP (the `adp-underdog-bestball.json` board) — a SEPARATE
   * best-ball half-PPR TE-premium lane used for display/decoration and market-spread raw material
   * only; it is never selected as an engine board and never blended into redraft composites. */
  adpSource: 'sleeper' | 'ffc' | 'espn' | 'underdog';
  /** 'observed' when `stdev` came directly from the source (FFC). 'fitted' when it was synthesized
   * from FFC's coefficient-of-variation curve applied to a non-FFC adp mean (Sleeper has no
   * dispersion field; ESPN's leaguedefaults feed publishes no draft-position distribution either) â€”
   * see `pipeline/transform.py`'s `fitted_stdev`. Not a measurement of the source's actual
   * draft-position spread; treat as experimental until calibrated against captured history. */
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
       * "never switch sources silently" rule). 'espn' is only ever produced on the additive
       * `adp_active_espn_ppr` entry â€” the ESPN default-PPR board never replaces `adp-ppr.json`. */
      activeAdpSource?: 'sleeper' | 'ffc-fallback' | 'espn';
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

/** ESPN access via the local Chrome-extension relay — never cookie-based. Kept separate from the
 * legacy cookie {@link EspnCred} so the draft-day extension flow can never touch SWID/espn_s2. */
export interface EspnExtensionCred {
  provider: 'espn';
  transport: 'extension';
  leagueId: string;
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
  /** The auth provider's stable subject id (Clerk's `sub` claim, since the 2026-08-25/26 priority
   * change replaced SWA's built-in `/.auth/*` auth with Clerk — see DECISIONS.md). */
  userId: string;
  userDetails: string;
  identityProvider: string;
  createdAt: string;
  sleeperUserId?: string;
  /** Base64 AES-GCM envelope, never plaintext. */
  espnSealed?: string;
  yahooSealed?: string;
}

/**
 * A league the user has connected, kept indefinitely as a *pointer* — `providerLeagueId` lets the
 * app reconnect and re-fetch live via `ProviderAdapter.rosters()`/`settings()` at any time. This is
 * deliberately NOT an archive of draft results: Sleeper already remembers who's on a real league's
 * roster forever, so nothing here duplicates that. `providerLeagueId` is `null` only for a manual/
 * ESPN "league" with no upstream id to point at.
 */
export interface SavedLeague {
  id: string;
  userId: string;
  provider: 'sleeper' | 'espn' | 'manual';
  providerLeagueId: string | null;
  name: string;
  season: string;
  teams: number;
  rounds: number;
  mySlot: number | null;
  settings: LeagueSettings;
  /** Sleeper userId of the connected account, when known (`cred.userId` at save time) — lets a
   * hub card reconstruct a `SleeperCred` and re-track a draft without re-asking for a username.
   * Null/absent for manual/ESPN "leagues" with no upstream account. */
  providerUserId?: string | null;
  /** Sleeper username of the connected account, when known — `resolveUser` returns it and the
   * connect surface keeps it, so the app can say "connected as coach_x" instead of a numeric id.
   * Null/absent for leagues saved before this existed (the next save fills it in) and for
   * manual/ESPN leagues with no upstream account. */
  providerUsername?: string | null;
  /** The ESPN team id the user picked on the confirm card ("which team is yours?") — the capture
   * redacts swid|session, so ownership cannot be read from ESPN; it is chosen once and saved.
   * Null/absent for non-ESPN leagues and before the user confirms. */
  providerTeamId?: number | null;
  /** Display name of the team picked as `providerTeamId` (from the capture's team list) so hub
   * cards show "your team: X" without re-fetching ESPN. Null/absent when unset. */
  providerTeamName?: string | null;
  /** Last draft id tracked for this league, when known — either from `LeagueRef.draftId` at
   * save time or backfilled by draft sync whenever a tracked draft reports one. What makes the
   * hub's per-league "Track draft" button possible without another Sleeper round-trip. */
  latestDraftId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A draft's live-tracking transcript, synced only while it's useful:
 *
 * - Real Sleeper league draft: synced while `status: 'active'` purely so a second device can
 *   resume mid-draft, then DELETED once the draft completes — the `SavedLeague` pointer above is
 *   what survives, and any future feature reads the finished roster live from Sleeper rather than
 *   from a stored copy that could drift.
 * - Sleeper mock draft (`leagueId` starting `mock:`, see `adapters/sleeper.ts`): never written
 *   here at all, active or complete — no roster persists on Sleeper's side after a mock ends, so
 *   there's nothing worth reconnecting to.
 * - Manual/ESPN-bridge session: the one case with no upstream API, so `frozenInit`/`overrides`
 *   here are the only record that exists anywhere — kept durably, not auto-deleted.
 *
 * See DECISIONS.md's 2026-08-26 entry for the full reasoning.
 */
export interface SavedDraft {
  id: string;
  userId: string;
  /** FK to `SavedLeague.id`. */
  leagueId: string;
  provider: 'sleeper' | 'espn' | 'manual';
  providerDraftId: string | null;
  mode: 'live' | 'manual' | 'espn';
  frozenInit: DraftInit | null;
  overrides: PickOverride[];
  /**
   * The board's effective picks at last sync — written ONLY for providers with no upstream record
   * to re-read (`espn`/`manual`; the 2026-08-27 connect/start split reconstructs the drafted team
   * from these on /leagues/:id). Sleeper is deliberately excluded: its own API is the permanent
   * record, which is exactly why draftSync deletes completed Sleeper transcripts — storing a copy
   * that could drift against Sleeper's rosters would be an archive, not a pointer.
   */
  picks?: Pick[];
  status: 'active' | 'complete';
  createdAt: string;
  updatedAt: string;
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

  /** Hot path: exactly one upstream GET, called every 2-3s. Implementations must honor `signal`
   * so a backgrounded or timed-out request cannot hold up the next foreground refresh. */
  picks(cred: Cred, draftId: string, signal?: AbortSignal): Promise<DraftPicks>;

  /** In-season. */
  rosters(cred: Cred, leagueId: string): Promise<Roster[]>;
  freeAgents(cred: Cred, leagueId: string): Promise<PlayerId[]>;
  settings(cred: Cred, leagueId: string): Promise<LeagueSettings>;
}

/**
 * Narrow draft-day adapter for locally relayed snapshot providers (the ESPN extension bridge).
 * Both methods are local reads over the relayed snapshot — there is deliberately no upstream GET
 * hot path, and no fake rosters/freeAgents/listLeagues are shipped for this MVP.
 */
export interface DraftProviderAdapter {
  readonly provider: Provider;
  /** Merge the manual form's DraftInit with the relayed live snapshot (mySlot/leagueId). Local read. */
  init(base: DraftInit, live: EspnLiveSnapshot | null): DraftInit;
  /** Normalize the relayed live snapshot into DraftPicks (player crosswalk + derived clock). */
  picks(init: DraftInit, live: EspnLiveSnapshot | null): Promise<DraftPicks>;
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

