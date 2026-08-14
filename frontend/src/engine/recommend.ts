import type { AdpEntry, DraftType, LeagueSettings, Pick, PlayerId, PlayerMeta, Position, RosterSlot, SeasonProjection } from '../../../shared/types';
import { canonicalPicksSignature } from '../adapters/draftOrder';
import { estimateAvailability } from './availability';
import {
  addPlayerToLineup,
  benchDepthValue as computeBenchDepthValue,
  coreStartingSlotsFilled,
  prepareLineup,
  rosterUtility,
  type PreparedLineup,
} from './eligibility';
import { defaultOpponentModelConfig, type OpponentModelConfig } from './opponentModel';
import {
  computeValueAnchor,
  positionalDemand,
  replacementLevels,
  replacementPointsByPosition,
  vorForPlayer,
  type PositionalDemand,
  type ReplacementLevel,
} from './replacement';
import { scoreProjection } from './scoring';
import type { ScoreDiagnostics, ScoringDiagnosticSeverity } from './scoring';
import { buildTeamRosters, runSimulation, runSimulationAsync, type ExecutionMode, type SimulationDiagnostics, type SimulationResult } from './simulate';
import { buildTiers } from './tiers';

export interface Recommendation {
  playerId: PlayerId;
  rank: number;
  projectedPoints: number;
  /** optimizeLineup(roster + player) - optimizeLineup(roster). PLAN.md §2's MRV, unchanged meaning. */
  marginalRosterValue: number;
  /** Change in unified starter-plus-depth portfolio utility if this player is selected now. */
  marginalRosterUtility: number;
  /** Expected marginal utility of the best analytically-surviving option at the next user pick. */
  expectedFollowUpValue: number;
  /** Ranking objective: intrinsic marginal utility plus expected best next-pick utility. */
  planValue: number;
  /** Number of future user selections represented by planValue (zero on a final/no-clock board). */
  planningHorizon: 0 | 1 | 2;
  /** optimizeLineup(roster + player) - optimizeLineup(roster + replacement-level alternative). The
   * sort key: reduces to VOR when the player's slot is open, to MRV when it's already filled by a
   * better incumbent. Fixes the old sort degenerating to raw projected points on an open slot. */
  replacementAdjustedValue: number;
  /** What the replacement baseline above was, for the explanation. */
  replacementLevelPoints: number;
  vor: number;
  vona: number | null;
  vonaSource: 'analytic' | 'simulationFallback' | 'unavailable';
  lookaheadValue: number | null;
  downside: number | null;
  simulatedSurvivalProbability: number | null;
  /** Insurance value of rostering this player as bench depth — see `eligibility.ts`'s
   * `benchDepthValue`. `0` before `coreStartingSlotsFilled` (nothing to insure against yet, and
   * `marginalRosterValue`/`replacementAdjustedValue` already price an open-slot pickup correctly).
   * Non-zero once starters fill, when `marginalRosterValue` collapses to `0` for almost every
   * remaining candidate and stops distinguishing them. */
  benchDepthValue: number;
  /** Whether this row is a starter pickup or bench depth. Core slots may be occupied while an
   * available player still has positive MRV, so this is deliberately per-row rather than a mirror
   * of `RecommendationDiagnostics.coreStartingSlotsFilled`. */
  recommendationMode: 'starter' | 'bench';
  /** Which field actually decided this row's position in `sorted` — for the UI to headline the
   * number that matters instead of a fixed field, and so a stale-looking `0`/flat value is never
   * presented as the ranking rationale when it isn't one. K/DEF always sort on `projectedPoints`
   * once their disposition class and overdue-ness are equal (see `isSpecialTeamsDisplay`). */
  rankingBasis: 'planValue' | 'rosterUtility' | 'specialTeams';
  /** K/DEF held back until both the core-starter gate and their settings-aware late-draft window
   * permit them. Due K/DEF receive a separate priority class; filled/unconfigured slots are omitted
   * from the displayed board while the underlying candidate pool remains ungated. */
  deprioritized: boolean;
  tier: number;
  /** Adjacent-player gap. This is not the tier-boundary cliff. */
  tierGapAfter: number;
  tierBoundaryGap: number;
  /** Bounded [0,1] cliff signal — explanation only, never a ranking term (see tiers.ts). */
  tierUrgency: number;
  availableNextPickProbability: number | null;
  availabilityAdp: number | null;
  availabilityAdpHigh: number | null;
  availabilityAdpLow: number | null;
  availabilityStdev: number | null;
  availabilitySampleSize: number | null;
  /** Display-only indication that this card sits inside a localized near-tie band with at least
   * one other row — see `buildRecommendationBoard`'s band construction. Renamed from the old
   * `nearTieWithLeader`: a row can now be marked here even when it is not close to the board
   * leader, as long as it is close to its own local band anchor. A `true` row's exact position
   * within the band was decided by the within-band comparator (survival -> ADP -> planValue -> id),
   * not purely by `rankingBasis`'s named field — the UI must not present that field as the sole
   * explanation for such a row's position. */
  nearTie: boolean;
  scoringDiagnosticSeverity: ScoringDiagnosticSeverity;
  missingScoringKeys: string[];
  confidence: 'low' | 'medium' | 'high';
  assignedRosterSlot: string | null;
  replacementPlayerId: PlayerId | null;
  /** Explanation/action label, never a hard "never reach" veto — see `computePickAction`'s doc.
   * `'take-now'` at base row construction (before one-pick planning has run); finalized once
   * `vona`/`vonaSource` are final, immediately after the first `applyOnePickPlanning` pass. */
  pickAction: 'take-now' | 'wait-target';
  reasons: string[];
  warnings: string[];
}

export interface RecommendationSimulationContext {
  draftId: string;
  draftType: DraftType;
  teams: number;
  rounds: number;
  slotToTeam: Record<number, string>;
  decisionPick: number;
  followUpPick: number | null;
  /** Analysis-only second future user pick. Production stays one-horizon after the gate rejection. */
  secondFollowUpPick?: number | null;
  opponentConfig?: OpponentModelConfig;
  executionMode?: ExecutionMode;
  now?: () => number;
}

export interface RecommendationInput {
  settings: LeagueSettings;
  players: PlayerMeta[];
  projections: SeasonProjection[];
  adp: AdpEntry[];
  picks: Pick[];
  myTeamId: string | null;
  nextPick: number | null;
  /** Optional Stage C rollout context. Omit to retain the deterministic S2 board. */
  simulation?: RecommendationSimulationContext;
  /** The pick currently on the clock, for survival-conditioned availability. Defaults to
   * `picks.length + 1` so existing callers keep compiling with the old unconditional behavior. */
  currentPick?: number;
  limit?: number;
  /** Sizes the original simulation/planning candidate pool (Stage C rollout eligibility and the
   * analytic one-pick planner's follow-up shortlist) independently of `limit`, which now also
   * controls how many *display* rows the UI can page through (5/10/15/20). Defaults to `limit` so
   * existing callers are unaffected. Pass a small fixed value (e.g. the UI's initial page size)
   * while still allowing `limit` up to 20 — see the fixed analytic expansion depth below, which
   * backfills the extra display rows without inflating the rollout/planning pool this field sizes. */
  rolloutDisplayLimit?: number;
  /** Optional production latency guard for Stage C only. The deterministic board, analytic
   * planner, opponent-draftable pool, and best-survivor scan remain complete; this caps only the
   * costly per-candidate Monte Carlo replays. Omit to preserve the calibrated engine behavior. */
  simulationCandidateLimit?: number;
  /** Exact-position display filter. Null/omitted keeps the league-wide All board. */
  displayPosition?: Position | null;
  /** Draftable spots per team, passed to `positionalDemand`. Defaults to
   * `rosterSpotsPerTeam(settings)`, which under-counts for Sleeper mock drafts (no `BN` entry in
   * `rosterSlots` — see `replacement.ts`'s doc). Pass `DraftInit.rounds` when available. */
  rosterSpotsPerTeam?: number;
  /** Actual selections per team. Used only for the late-draft K/DEF schedule; unlike
   * `rosterSpotsPerTeam`, there is intentionally no settings-derived fallback because a partial
   * provider roster cannot establish how many selections remain. Pass `DraftInit.rounds`. */
  draftRounds?: number;
  /** `PlayerUsage.availabilityRate` by player, for bench-depth pricing (`eligibility.ts`'s
   * `benchDepthValue`). Omitted or missing entries fall back to `DEFAULT_AVAILABILITY_RATE`
   * (average-durable) — never required, since `player-usage.json` can fail to load independently of
   * the core projection/ADP board (see `usePlayerBoardData`'s doc). */
  availabilityByPlayer?: ReadonlyMap<PlayerId, number>;
  /** Harness-only opt-in analysis channel (benchmarkAvailability.bench.ts, PLAN.md S6 gate B).
   * Default `false`/absent — every existing caller is unaffected and `RecommendationResult.analysis`
   * stays `undefined`. Never flip this on in production code paths: raising `limit` to see more rows
   * would also inflate `rolloutLimit` and distort what Stage C actually simulates, which is exactly
   * what this flag exists to avoid — it captures the full pre-slice pools without changing `limit`,
   * `sorted`, or `displayed`. */
  includeAnalysisRows?: boolean;
  /** Production worker opt-in: build every position view from one evaluated core so UI-only
   * filtering and pagination never rerun lineup optimization or simulation. */
  includeRecommendationViews?: boolean;
  /** Whether to build the full ADP/market board. The cheap worker snapshot leaves this off so
   * its first response is limited to paintable Engine rows and diagnostics. Defaults to true for
   * every existing non-worker caller. */
  includeMarketRecommendations?: boolean;
  /** Whether to add the position/market expansion universe. Defaults to true; the worker's first
   * snapshot disables it and evaluates only its bounded All-tab candidate set. */
  includeExpansion?: boolean;
  /** Worker-only opt-in: precomputed scoring diagnostics keyed by player id, produced once per
   * static pool + settings pair (see recommendation.worker.ts) and reused across on-clock calls
   * so the deterministic pass never re-scores the full ~4,400-projection pool. Must be consistent
   * with `settings`, `players`, and `projections` — a mismatch is a caller bug, not reconciled. */
  precomputedScores?: ReadonlyMap<PlayerId, ScoreDiagnostics>;
  /** Worker-only opt-in alongside `precomputedScores`: the already-computed pick-invariant
   * VALUE_ANCHOR (see replacement.ts's computeValueAnchor doc), so it is not recomputed on every
   * on-clock call either. `null` is a valid precomputed value (degenerate league), distinct from
   * `undefined` = "not provided, compute it here". */
  precomputedValueAnchor?: number | null;

}

/** Worker-only continuation hooks. Never placed on `RecommendationWorkerDynamicInput` — they are
 * not structured-cloneable and exist only inside the worker after S2 has already evaluated. */
export interface RecommendationBuildOptions {
  /** Called with a paint-sized board (no planning, no Stage C, no views/market) after the
   * deterministic evaluate pass. Returning `'abort'` skips refine. */
  onDeterministicSnapshot?: (snapshot: RecommendationResult) => 'continue' | 'abort' | void | Promise<'continue' | 'abort' | void>;
  yieldBetweenBatches?: () => Promise<void>;
  shouldAbort?: () => boolean;
}

/** Populated only when `RecommendationInput.includeAnalysisRows` is `true` — see that field's doc.
 * `deterministicRows`/`simulatedRows` are the exact pre-slice `evaluated`/`sortSet` pools a normal
 * caller never sees (only `sorted.slice(0, limit)` is returned as `recommendations`), so a benchmark
 * harness can score every deterministically-evaluated candidate, not just the displayed top `limit`.
 */
export interface RecommendationAnalysis {
  /** Full deterministic pass, pre-slice — one row per candidate `selectCandidates` returned.
   * Analytic plan/VONA fields are populated whenever one-pick planning is active; rollout-only
   * diagnostics remain null for candidates outside the rollout pool. */
  deterministicRows: Recommendation[];
  /** The actual production-shape rollout output, pre-slice: `sortSet` exactly as the real sort
   * consumes it. Equal to `deterministicRows` whenever Stage C did not run (off-clock, no
   * simulation context, or the explicit zero-scenario S2 fallback) — never assume this is a strict
   * subset without checking `simulatedCandidateCount`. */
  simulatedRows: Recommendation[];
  deterministicCandidateCount: number;
  /** Rows in `simulatedRows` that carry a non-null `simulatedSurvivalProbability` — i.e. were
   * rolled out, rather than merely receiving analytic plan/VONA fields. */
  simulatedCandidateCount: number;
  /** `buildRolloutPool`'s output size for this decision point (0 when Stage C did not run). */
  rolloutPoolSize: number;
}

export type SpecialTeamsPosition = 'K' | 'DEF';

export interface SpecialTeamsDraftDiagnostics {
  /** Null when the caller cannot establish the user's draft clock reliably. */
  draftRounds: number | null;
  teamPicksMade: number | null;
  remainingPicks: number | null;
  configured: Readonly<Record<SpecialTeamsPosition, number>>;
  rostered: Readonly<Record<SpecialTeamsPosition, number>>;
  remaining: Readonly<Record<SpecialTeamsPosition, number>>;
  /** Positions whose reserved late-round window has arrived, regardless of the separate core gate. */
  due: readonly SpecialTeamsPosition[];
  /** Due positions whose ideal selection has already passed. */
  overdue: readonly SpecialTeamsPosition[];
  /** Fewer team selections remain than configured K/DEF slots still need. */
  impossibleToFill: boolean;
}

export interface RecommendationDiagnostics {
  /** Drafted picks the crosswalk could not match to a player — they stay recommendable because
   * they're absent from `drafted`, so the board may be showing someone who is already gone. */
  unmatchedPickCount: number;
  unmatchedPickOveralls: number[];
  candidatesEvaluated: number;
  replacementLevels: ReplacementLevel[];
  positionalDemand: PositionalDemand;
  /** Whether every non-K/DEF starting slot is currently filled — see `coreStartingSlotsFilled`.
   * K/DEF cannot become due while this is `false`. */
  coreStartingSlotsFilled: boolean;
  specialTeamsDraft: SpecialTeamsDraftDiagnostics;
  /** Null when no Stage C rollout was requested or an explicit zero-scenario request fell back to S2. */
  simulation: SimulationDiagnostics | null;
}

/** One row of the ADP/market board — the league-wide consensus-order alternative to the Engine
 * board, joined against evaluated Engine recommendations where available. */
export interface MarketRecommendation {
  playerId: PlayerId;
  /** 1-based position in the full league-wide market ordering, computed before any
   * `displayPosition` filtering is applied — see `RecommendationResult.marketRecommendations`'s doc. */
  rank: number;
  adp: number;
  /** `adp - currentPick`. Negative means the player's consensus ADP has already passed; positive
   * means the market expects them to last further. */
  pickDelta: number;
  /** `null` only when the player has no season projection (`scoreProjection` never ran for them) —
   * or falls outside the bounded 24-row All/per-position display universe. Market ordering remains
   * complete; only expensive engine enrichment is bounded. */
  recommendation: Recommendation | null;
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  diagnostics: RecommendationDiagnostics;
  /** Whether more league-wide Engine rows exist beyond recommendations for this position filter. */
  hasMoreRecommendations: boolean;
  /** Undrafted, finite-ADP players in league-wide market order: players whose ADP has already
   * passed the current pick first (largest fall first), then upcoming players in closest-ADP
   * order. Never filtered by `displayPosition` — callers filter this array themselves so `rank`
   * stays anchored to the league-wide order (see `MarketRecommendation.rank`'s doc). Players
   * without ADP are excluded entirely; players without a projection are included with
   * `recommendation: null`. In bounded worker snapshots, deeper rows outside the
   * display universe are also intentionally left unenriched. */
  marketRecommendations: MarketRecommendation[];
  /** Complete ranked views derived from the same core calculation. Present only when requested. */
  recommendationViews?: Record<'ALL' | Position, Recommendation[]>;
  /** Only present when `RecommendationInput.includeAnalysisRows` is `true`. */
  analysis?: RecommendationAnalysis;
}

/** `${position}|${sorted eligiblePositions}` — players sharing this key compete for the same slots,
 * so they share one replacement-baseline `optimizeLineup` solve instead of each getting their own. */
function candidateGroupKey(player: PlayerMeta): string {
  const position = player.position ?? '';
  const eligible = player.eligiblePositions.length ? player.eligiblePositions : position ? [position] : [];
  return `${position}|${[...eligible].sort().join(',')}`;
}

/** Shared empty fallback so a caller that omits `availabilityByPlayer` doesn't allocate a fresh Map
 * per candidate — every lookup then takes `benchDepthValue`'s documented `DEFAULT_AVAILABILITY_RATE`
 * path uniformly. */
const NO_AVAILABILITY_DATA: ReadonlyMap<PlayerId, number> = new Map();

/** A recommendation is a market "reach" once its consensus ADP sits this many picks later than the
 * current overall pick — i.e. the model is recommending someone the market doesn't expect to be
 * drafted here at all yet. Matches the plan's stated threshold; informational only, never a veto. */
const ADP_REACH_WARNING_THRESHOLD = 20;

/** An explanation/action label, never a hard "never reach" veto — a genuine roster need or cliff can
 * still make an early selection correct via `planValue`; a `'wait-target'` row still displays and
 * can still be `rank: 1` if `planValue` puts it there. `'wait-target'` requires ALL of:
 *   - a future user pick actually exists (survival is otherwise undefined, so this is implied by
 *     `availableNextPickProbability` being non-null at all);
 *   - at least 70% conditional survival to that pick;
 *   - `vonaSource === 'analytic'` with a non-null `vona` no more than 10% of `VALUE_ANCHOR` — VONA
 *     stays an explanation *gate* here, never a ranking input;
 *   - consensus ADP at least `ADP_REACH_WARNING_THRESHOLD` picks later than the current pick.
 * Call only once `vona`/`vonaSource` are final (after the first `applyOnePickPlanning` pass) — see
 * `Recommendation.pickAction`'s doc. */
function computePickAction(
  recommendation: Recommendation,
  currentPick: number,
  valueAnchor: number | null,
): Recommendation['pickAction'] {
  const survival = recommendation.availableNextPickProbability;
  if (survival == null || survival < 0.70) return 'take-now';
  if (recommendation.vonaSource !== 'analytic' || recommendation.vona == null) return 'take-now';
  if (valueAnchor == null || !Number.isFinite(valueAnchor) || valueAnchor <= 0) return 'take-now';
  if (recommendation.vona > 0.10 * valueAnchor) return 'take-now';
  const adp = recommendation.availabilityAdp;
  if (adp == null || adp - currentPick < ADP_REACH_WARNING_THRESHOLD) return 'take-now';
  return 'wait-target';
}

const REPLACEMENT_SENTINEL_PREFIX = '__replacement__:';

function syntheticReplacementPlayer(groupKey: string, template: PlayerMeta): PlayerMeta {
  const position = template.position ?? null;
  const eligiblePositions = template.eligiblePositions.length ? template.eligiblePositions : position ? [position] : [];
  return {
    playerId: `${REPLACEMENT_SENTINEL_PREFIX}${groupKey}`,
    name: 'Replacement level',
    position,
    eligiblePositions,
    team: null,
    byeWeek: null,
    age: null,
    yearsExp: null,
    injuryStatus: null,
    ids: {},
  };
}

/**
 * K/DEF are demoted until core starters (including FLEX) are filled and their reserved late-draft
 * window arrives. The optional diagnostics argument preserves the old two-argument behavior for
 * callers without reliable round data. Ranking policy only: never call this from `selectCandidates`,
 * opponent pick selection, or the simulator's survivor pool. Exported so Stage C's final displayed
 * sort can reuse the same policy without gating opponent drafting or the full survivor pool.
 */
export function isDeprioritized(
  player: PlayerMeta,
  coreFilled: boolean,
  specialTeamsDraft?: SpecialTeamsDraftDiagnostics,
): boolean {
  if (player.position !== 'K' && player.position !== 'DEF') return false;
  if (!coreFilled) return true;
  if (!specialTeamsDraft) return false;
  const position = player.position;
  if (specialTeamsDraft.remaining[position] <= 0) return true;
  if (specialTeamsDraft.remainingPicks == null) return false;
  return !specialTeamsDraft.due.includes(position);
}

function specialTeamsCount(settings: LeagueSettings, position: SpecialTeamsPosition): number {
  return settings.startingSlots.filter((slot) => slot === position).length;
}

function buildSpecialTeamsDraftDiagnostics(
  input: RecommendationInput,
  myRoster: readonly PlayerMeta[],
): SpecialTeamsDraftDiagnostics {
  const configured = {
    K: specialTeamsCount(input.settings, 'K'),
    DEF: specialTeamsCount(input.settings, 'DEF'),
  };
  const rostered = {
    K: myRoster.filter((player) => player.position === 'K').length,
    DEF: myRoster.filter((player) => player.position === 'DEF').length,
  };
  const remaining = {
    K: Math.max(0, configured.K - rostered.K),
    DEF: Math.max(0, configured.DEF - rostered.DEF),
  };

  const validRounds = input.draftRounds != null
    && Number.isFinite(input.draftRounds)
    && Number.isInteger(input.draftRounds)
    && input.draftRounds > 0;
  const draftRounds = validRounds ? input.draftRounds as number : null;
  const teamPicksMade = draftRounds != null && input.myTeamId != null
    ? input.picks.filter((pick) => pick.teamId === input.myTeamId).length
    : null;
  const remainingPicks = draftRounds != null && teamPicksMade != null
    ? Math.max(0, draftRounds - teamPicksMade)
    : null;

  const due: SpecialTeamsPosition[] = [];
  const overdue: SpecialTeamsPosition[] = [];
  if (remainingPicks != null) {
    // Remaining DEF slots are scheduled immediately before remaining K slots. Recomputing from the
    // user's actual roster lets an early special-team pick give its reserved selection back to the
    // bench instead of freezing an obsolete absolute round number.
    const deadlines: Readonly<Record<SpecialTeamsPosition, number>> = {
      DEF: remaining.DEF + remaining.K,
      K: remaining.K,
    };
    for (const position of ['DEF', 'K'] as const) {
      if (remaining[position] <= 0 || remainingPicks > deadlines[position]) continue;
      due.push(position);
      if (remainingPicks < deadlines[position]) overdue.push(position);
    }
  }

  return {
    draftRounds,
    teamPicksMade,
    remainingPicks,
    configured,
    rostered,
    remaining,
    due,
    overdue,
    impossibleToFill: remainingPicks != null && remainingPicks < remaining.K + remaining.DEF,
  };
}

type SpecialTeamsDisposition = 'due' | 'normal' | 'early' | 'unavailable';

function dispositionSortClass(disposition: SpecialTeamsDisposition): number {
  return disposition === 'due' ? 0 : disposition === 'normal' ? 1 : disposition === 'early' ? 2 : 3;
}

function specialTeamsDisposition(
  player: PlayerMeta,
  coreFilled: boolean,
  diagnostics: SpecialTeamsDraftDiagnostics,
): SpecialTeamsDisposition {
  if (player.position !== 'K' && player.position !== 'DEF') return 'normal';
  if (diagnostics.remaining[player.position] <= 0) return 'unavailable';
  if (!coreFilled) return 'early';
  // Missing clock data deliberately preserves the pre-schedule behavior: once the core is filled,
  // K/DEF participate normally instead of guessing at a round from partial roster settings.
  if (diagnostics.remainingPicks == null) return 'normal';
  return diagnostics.due.includes(player.position) ? 'due' : 'early';
}

function overdueBy(
  position: SpecialTeamsPosition,
  diagnostics: SpecialTeamsDraftDiagnostics,
): number {
  if (diagnostics.remainingPicks == null) return 0;
  const deadline = position === 'DEF'
    ? diagnostics.remaining.DEF + diagnostics.remaining.K
    : diagnostics.remaining.K;
  return Math.max(0, deadline - diagnostics.remainingPicks);
}

/**
 * Cheap prefilter before the expensive per-candidate `optimizeLineup` solve. Within a fixed
 * `candidateGroupKey` the replacement baseline is constant and `optimizeLineup(roster + p).value`
 * is non-decreasing in `p`'s points (it's a max over assignments, each linear in p's points), so
 * `replacementAdjustedValue` is monotone in points within a group — anyone outside a group's top
 * `limit + 2` is dominated by that group's own top entries and can never place. Loss-free; see
 * engine.test.ts's prefilter-equivalence test.
 */
export function selectCandidates(remaining: PlayerMeta[], projectedPoints: ReadonlyMap<PlayerId, number>, limit: number): PlayerMeta[] {
  const perGroup = new Map<string, PlayerMeta[]>();
  for (const player of remaining) {
    const key = candidateGroupKey(player);
    const list = perGroup.get(key);
    if (list) list.push(player);
    else perGroup.set(key, [player]);
  }
  const take = limit + 2;
  const selected: PlayerMeta[] = [];
  for (const list of perGroup.values()) {
    list.sort((a, b) => (projectedPoints.get(b.playerId) ?? 0) - (projectedPoints.get(a.playerId) ?? 0) || a.playerId.localeCompare(b.playerId));
    selected.push(...list.slice(0, take));
  }
  return selected;
}

const SKILL_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE'];

/** Display-independent Stage C simulation shortlist (PLAN.md S3): the global
 * `max(3 * limit, 15)` deterministic S2 leaders, unioned with up to two positive-MRV,
 * non-deprioritized leaders from each of QB/RB/WR/TE, unioned with each of QB/RB/WR/TE's own top
 * `displayLimit` regardless of MRV — the third term is what guarantees a position tab can always
 * return `displayLimit` simulated cards even when the top global leaders are concentrated in other
 * positions (or, as at a due-K/DEF pick, in K/DEF, which never enter these position extensions).
 * Returned in the original S2 order. S2's displayed ordering itself receives no positional quota;
 * K/DEF are excluded only from these position extensions, never from the global term. */
export function buildRolloutPool(
  s2Ordered: readonly Recommendation[],
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
  rolloutLimit: number,
  displayLimit: number,
): Recommendation[] {
  const selected = new Set(s2Ordered.slice(0, rolloutLimit).map((recommendation) => recommendation.playerId));
  for (const position of SKILL_POSITIONS) {
    const atPosition = s2Ordered.filter((recommendation) => playersById.get(recommendation.playerId)?.position === position);
    for (const recommendation of atPosition.filter((entry) => entry.marginalRosterValue > 0 && !entry.deprioritized).slice(0, 2)) {
      selected.add(recommendation.playerId);
    }
    for (const recommendation of atPosition.slice(0, displayLimit)) {
      selected.add(recommendation.playerId);
    }
  }
  return s2Ordered.filter((recommendation) => selected.has(recommendation.playerId));
}

/**
 * Selected 2026-08-10 against the real committed `data/` (`recommendPerformance.test.ts`'s
 * worst-case fixture: 12 teams, 16 rounds, slot 1 — the longest opponent window a 12-team snake
 * ever produces, and a near-full 14-incumbent roster). Two measurements matter, not one:
 *
 * - **Cold** (nothing cached — the first Stage C-eligible turn of a session): dominated by fixed
 *   overhead (the deterministic prefilter pass, `buildTeamRosters`'s from-scratch opponent solves)
 *   more than by scenario count. Rare in practice — only the very first qualifying turn pays it.
 * - **Warm** (the realistic steady-state — `teamRosterCache` extends its previous prefix instead of
 *   rebuilding, which is what happens on every subsequent Stage C-eligible turn during a live
 *   draft): fixed overhead drops to ~75-90ms, and scenario cost becomes the real, roughly linear
 *   driver at ~23ms/scenario. Measured medians over 7 warm runs: 5 → 155ms, 8 → 233ms,
 *   10 → 304ms, 25 → 639ms, 50 → 1364ms, 100 → 2366ms, 200 → 4696ms.
 *
 * `8` keeps the warm case comfortably under 250ms with real margin. That target is intentionally
 * tighter than the product's 3s clock test: the 2.5-3s live poll interval (`CLAUDE.md`) already
 * consumes most of that budget on its own, so Stage C's own compute needs to stay small relative to
 * it, not merely small relative to 3s. `runSimulation`'s common-random-numbers design (every
 * candidate in a scenario shares the same noise draws) keeps candidate *comparisons* reasonably
 * stable even at this modest count — PLAN.md's S3 exit criteria asks for stability "across
 * reasonable simulation counts," not high absolute Monte Carlo precision.
 */
export const DEFAULT_SCENARIOS = 8;
export const FOLLOW_UP_GLOBAL_LIMIT = 12;
export const FOLLOW_UP_GROUP_LIMIT = 3;
export const LATE_FOLLOW_UP_GLOBAL_LIMIT = 8;
export const LATE_FOLLOW_UP_GROUP_LIMIT = 2;

/** Exact pairwise utility rematches are the analytic planner's dominant cost. The smaller late
 * shortlist applies only once at most one core hole remains — the cohort this change targets and
 * benchmarks — while earlier boards retain the wider cross-position search. */
export function followUpShortlistLimits(openCoreSlots: number): { global: number; perGroup: number } {
  return openCoreSlots <= 1
    ? { global: LATE_FOLLOW_UP_GLOBAL_LIMIT, perGroup: LATE_FOLLOW_UP_GROUP_LIMIT }
    : { global: FOLLOW_UP_GLOBAL_LIMIT, perGroup: FOLLOW_UP_GROUP_LIMIT };
}

const DEFAULT_EXECUTION_MODE: ExecutionMode = {
  mode: 'fixed',
  scenarios: DEFAULT_SCENARIOS,
};

let simulationCache: { key: string; result: SimulationResult } | null = null;
let planningPairUtilityCache: { key: string; values: Map<string, number> } | null = null;

/** Clears Stage C's result/roster caches and the analytic planner's exact pair-utility cache.
 * Tests call this around every case so cache assertions remain explicit; production memoization is
 * deterministic because each cache key fingerprints every input that can vary independently. */
export function clearSimulationCache(): void {
  simulationCache = null;
  planningPairUtilityCache = null;
  teamRosterCache = null;
}

function numberFingerprint(value: number | null | undefined): string {
  return value == null ? '~' : String(value);
}

// `input.players` and `input.adp` are the static per-session/per-format arrays `usePlayerBoardData`
// fetches once and never mutates (see that hook's doc). `simulationKey` used to re-sort and
// re-stringify all ~4,400 `players.json` entries on every call — including cache *hits*, which is
// exactly the case this cache exists to make cheap. Measured against the real committed data:
// rebuilding that signature cost ~4.3ms per call; the ADP array is much smaller (~300 rows,
// ~0.35ms) and isn't itself a bottleneck, but its per-player fingerprint is memoized alongside for
// the same reason, so a real format switch is still a correct (if cheap) invalidation. A `WeakMap`
// keyed on the array reference recomputes only when the array is actually replaced — a data reload
// or format switch — never on a same-session poll tick or tab switch.
const playerFingerprintCache = new WeakMap<readonly PlayerMeta[], string>();
function playerFingerprint(players: readonly PlayerMeta[]): string {
  const cached = playerFingerprintCache.get(players);
  if (cached != null) return cached;
  const signature = [...players]
    .sort((a, b) => a.playerId.localeCompare(b.playerId))
    .map((player) => player.playerId + ':' + (player.position ?? '~') + ':' + [...player.eligiblePositions].sort().join(','))
    .join('|');
  playerFingerprintCache.set(players, signature);
  return signature;
}

const adpFingerprintCache = new WeakMap<readonly AdpEntry[], ReadonlyMap<PlayerId, string>>();
function adpFingerprintById(adp: readonly AdpEntry[]): ReadonlyMap<PlayerId, string> {
  const cached = adpFingerprintCache.get(adp);
  if (cached != null) return cached;
  const byId = new Map<PlayerId, string>();
  for (const entry of adp) {
    if (entry.playerId == null) continue;
    byId.set(entry.playerId, numberFingerprint(entry.adp) + ':' + numberFingerprint(entry.stdev) + ':' + numberFingerprint(entry.timesDrafted));
  }
  adpFingerprintCache.set(adp, byId);
  return byId;
}

export function settingsFingerprint(settings: LeagueSettings): string {
  return [
    [...Object.entries(settings.scoring)].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join(','),
    settings.startingSlots.join(','),
    [...Object.entries(settings.rosterSlots)].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join(','),
  ].join('|');
}

/**
 * Incrementally-maintained cache for Stage C's opponent-roster reconstruction (`simulate.ts`'s
 * `buildTeamRosters`, which `runSimulation` otherwise re-solves from scratch — 12 full exact
 * lineup solves, ~250-500ms measured on real committed data — on every call). A live draft mostly
 * *appends* picks between polls, so when the new call's relevant picks (`overall < decisionPick`,
 * matched only) are exactly the cached ones plus some new ones at the end, apply just the delta via
 * the same value-safe fast path used elsewhere in this module (see `addPlayerToLineup`'s doc) —
 * `needBonusFromLineup` never reads occupant identity, only per-dedicated-slot fill state. Any
 * non-append change (a manual correction rewriting an earlier pick, a settings change, a different
 * draft) fails the prefix check and falls back to a full rebuild, so this is never wrong, only
 * sometimes not faster. Cleared by `clearSimulationCache` alongside the simulation-result cache.
 */
let teamRosterCache: { settingsSignature: string; pickFingerprints: readonly string[]; rosters: Map<string, PreparedLineup> } | null = null;

function getTeamRosters(
  settings: LeagueSettings,
  picks: readonly Pick[],
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
  scores: ReadonlyMap<PlayerId, number>,
  decisionPick: number,
): Map<string, PreparedLineup> {
  const relevant = picks
    .filter((pick) => pick.overall < decisionPick && pick.playerId != null)
    .slice()
    .sort((a, b) => a.overall - b.overall);
  const fingerprints = relevant.map((pick) => `${pick.overall}:${pick.playerId}:${pick.teamId}`);
  const settingsSignature = settingsFingerprint(settings);

  if (teamRosterCache && teamRosterCache.settingsSignature === settingsSignature) {
    const cached = teamRosterCache.pickFingerprints;
    let prefixLen = 0;
    while (prefixLen < cached.length && prefixLen < fingerprints.length && cached[prefixLen] === fingerprints[prefixLen]) prefixLen += 1;
    if (prefixLen === cached.length) {
      const rosters = new Map(teamRosterCache.rosters);
      for (let i = prefixLen; i < relevant.length; i += 1) {
        const pick = relevant[i] as Pick;
        const meta = playersById.get(pick.playerId as PlayerId);
        if (!meta) continue;
        const prepared = rosters.get(pick.teamId) ?? prepareLineup(settings, [], new Map());
        const points = scores.get(pick.playerId as PlayerId) ?? 0;
        // false: only needBonusFromLineup's per-dedicated-slot filled/empty count ever reads this
        // roster's occupancy — never who specifically occupies which slot.
        rosters.set(pick.teamId, addPlayerToLineup(prepared, meta, points, false).state);
      }
      teamRosterCache = { settingsSignature, pickFingerprints: fingerprints, rosters };
      return rosters;
    }
  }

  // Cold start, a manual correction rewriting an earlier pick, or a settings/draft change: no
  // valid prefix to extend, so rebuild exactly via the same logic `runSimulation` uses directly.
  const rosters = buildTeamRosters(settings, picks, playersById, scores, decisionPick);
  teamRosterCache = { settingsSignature, pickFingerprints: fingerprints, rosters };
  return rosters;
}

function simulationKey(
  input: RecommendationInput,
  context: RecommendationSimulationContext,
  remainingPlayers: readonly PlayerMeta[],
  myRoster: readonly PlayerMeta[],
  rolloutPool: readonly PlayerMeta[],
  scores: ReadonlyMap<PlayerId, number>,
  executionMode: ExecutionMode,
  opponentConfig: OpponentModelConfig,
): string {
  const settings = settingsFingerprint(input.settings);
  // Opponent historical rosters affect their need bonuses, so include their matched picked-player
  // scores as well as the requested remaining/my-roster/rollout union.
  const scoreIds = new Set<PlayerId>([
    ...remainingPlayers.map((player) => player.playerId),
    ...myRoster.map((player) => player.playerId),
    ...rolloutPool.map((player) => player.playerId),
    ...input.picks.flatMap((pick) => pick.playerId == null ? [] : [pick.playerId]),
  ]);
  const scoreSignature = [...scoreIds].sort().map((id) => id + '=' + numberFingerprint(scores.get(id))).join('|');
  // `buildOpponentPool` uses the complete scored board (not only the remaining board) to establish
  // positional synthetic-ADP depth and spread. A drafted player's ADP can therefore still change
  // the simulation for an unlisted remaining player, so every scored board player belongs in this
  // cache fingerprint.
  const adpByIdSignature = adpFingerprintById(input.adp);
  const adpSignature = [...new Set(input.players
    .filter((player) => scores.has(player.playerId))
    .map((player) => player.playerId))]
    .sort()
    .map((id) => id + ':' + (adpByIdSignature.get(id) ?? '~'))
    .join('|');
  const slotSignature = Object.entries(context.slotToTeam).sort(([a], [b]) => Number(a) - Number(b)).map(([slot, team]) => slot + '=' + team).join('|');
  const configSignature = [opponentConfig.shockScale, opponentConfig.needBonusCap, opponentConfig.candidateWindow, opponentConfig.fallbackStdev, opponentConfig.syntheticStep, opponentConfig.noAdpAtAllFallback].join(',');
  const executionSignature = [executionMode.mode, executionMode.scenarios, numberFingerprint(executionMode.timeBudgetMs), numberFingerprint(executionMode.batchSize)].join(',');
  const rolloutSignature = rolloutPool.map((player) => player.playerId).sort().join('|');
  return [
    canonicalPicksSignature(input.picks),
    context.draftId, input.myTeamId, context.decisionPick, context.followUpPick ?? '~',
    context.draftType, context.teams, context.rounds, slotSignature,
    settings, playerFingerprint(input.players), scoreSignature, adpSignature, configSignature, executionSignature, rolloutSignature,
  ].join('\u001f');
}

/** The interactive worker prepares at most 24 rows for every view. Keep legacy callers'
 * full market-board enrichment intact while bounding that expensive work in the worker path. */
const WORKER_VIEW_EXPANSION_DEPTH = 24;
const LEGACY_EXPANSION_DEPTH = 20;
const ALL_DISPLAY_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export function buildRecommendationBoard(input: RecommendationInput): RecommendationResult;
export function buildRecommendationBoard(
  input: RecommendationInput,
  options: RecommendationBuildOptions,
): Promise<RecommendationResult | null>;
export function buildRecommendationBoard(
  input: RecommendationInput,
  options?: RecommendationBuildOptions,
): RecommendationResult | Promise<RecommendationResult | null> {
  const limit = input.limit ?? 3;
  const rolloutDisplayLimit = input.rolloutDisplayLimit ?? limit;
  const expansionDepth = input.includeRecommendationViews
    ? WORKER_VIEW_EXPANSION_DEPTH
    : LEGACY_EXPANSION_DEPTH;
  const currentPick = input.currentPick ?? input.picks.length + 1;

  const playersById = new Map(input.players.map((player) => [player.playerId, player]));
  const projectionById = new Map(input.projections.map((projection) => [projection.playerId, projection]));
  const scores = new Map<PlayerId, number>();
  const scoringDiagnosticsById = new Map<PlayerId, ScoreDiagnostics>();
  if (input.precomputedScores != null) {
    for (const [id, diagnostic] of input.precomputedScores) {
      scores.set(id, diagnostic.points);
      scoringDiagnosticsById.set(id, diagnostic);
    }
  } else {
    for (const [id, projection] of projectionById) {
      const diagnostic = scoreProjection(projection, input.settings, playersById.get(id)?.position);
      scores.set(id, diagnostic.points);
      scoringDiagnosticsById.set(id, diagnostic);
    }
  }

  // A crosswalk miss leaves `pick.playerId` null (see shared/types.d.ts's Pick doc) — that player is
  // never added to `drafted` and stays recommendable forever. Counted, not silently absorbed.
  let unmatchedPickCount = 0;
  const unmatchedPickOveralls: number[] = [];
  const drafted = new Set<PlayerId>();
  for (const pick of input.picks) {
    if (pick.playerId != null) drafted.add(pick.playerId);
    else {
      unmatchedPickCount += 1;
      unmatchedPickOveralls.push(pick.overall);
    }
  }

  const remainingPlayers = input.players.filter((player) => !drafted.has(player.playerId) && scores.has(player.playerId));

  const consumedByPosition = new Map<string, number>();
  for (const playerId of drafted) {
    const player = playersById.get(playerId);
    if (player?.position && scores.has(playerId)) {
      consumedByPosition.set(player.position, (consumedByPosition.get(player.position) ?? 0) + 1);
    }
  }

  // S2.2: demand-derived replacement (not a starters-only count) so the baseline keeps draining
  // into realistic bench/late-round territory instead of clamping to the best remaining player once
  // starter demand is consumed — see replacement.ts's module doc for the pick-67 pathology this
  // fixes (a fully-consumed position's best player was pinned to replacementAdjustedValue === 0).
  const demand = positionalDemand({
    settings: input.settings,
    adp: input.adp,
    rosterSpotsPerTeam: input.rosterSpotsPerTeam,
    scoredPlayerIds: new Set(scores.keys()),
  });
  const levels = replacementLevels(input.settings, remainingPlayers, scores, {
    consumedByPosition,
    demandByPosition: demand.byPosition,
  });
  const replacementPoints = replacementPointsByPosition(levels);
  const tiers = buildTiers(remainingPlayers, scores);
  const adpById = new Map(input.adp.filter((entry) => entry.playerId != null).map((entry) => [entry.playerId as PlayerId, entry]));

  // VALUE_ANCHOR: computed from the full scored pool with zero consumed players (see
  // replacement.ts's computeValueAnchor doc), independently of `remainingPlayers`/`levels` above so
  // it stays invariant pick to pick — never derived from or cached alongside the remaining-board
  // replacement levels.
  const valueAnchor = input.precomputedValueAnchor !== undefined
    ? input.precomputedValueAnchor
    : computeValueAnchor({
        settings: input.settings,
        players: input.players,
        projections: input.projections,
        adp: input.adp,
        rosterSpotsPerTeam: input.rosterSpotsPerTeam,
      });

  const myRosterIds = input.picks
    .filter((pick) => input.myTeamId != null && pick.teamId === input.myTeamId && pick.playerId != null)
    .map((pick) => pick.playerId as PlayerId);
  const myRoster = myRosterIds.map((id) => playersById.get(id)).filter((player): player is PlayerMeta => player != null);
  const specialTeamsDraft = buildSpecialTeamsDraftDiagnostics(input, myRoster);
  const rosterPoints = new Map<PlayerId, number>(myRoster.map((player) => [player.playerId, scores.get(player.playerId) ?? 0]));
  // S3: solve the base roster once, then reuse the exact O(slots^2) incremental step
  // (`addPlayerToLineup`) for every candidate and every replacement-baseline synthetic below,
  // instead of a full re-solve each time — see eligibility.ts's doc comment for why this is exact,
  // not approximate. Full re-solves cost ~33ms each at a 15-man roster; recommend.ts calls this
  // O(candidates) times per board, which made the S2 board a latent multi-second clock-test risk.
  const preparedRoster = prepareLineup(input.settings, myRoster, rosterPoints);
  const currentValue = preparedRoster.value;
  const coreFilled = coreStartingSlotsFilled(preparedRoster);
  const openCoreSlots = preparedRoster.slots.filter((slot, index) =>
    slot !== 'K' && slot !== 'DEF' && preparedRoster.occupantBySlot[index] == null).length;
  const followUpLimits = followUpShortlistLimits(openCoreSlots);
  const availabilityData = input.availabilityByPlayer ?? NO_AVAILABILITY_DATA;
  const currentRosterUtility = rosterUtility(preparedRoster, replacementPoints, availabilityData);

  // Display filtering belongs after every league-wide calculation above. In particular, positional
  // demand, replacement levels, tiers, roster state, and K/DEF diagnostics must not change when the
  // user switches tabs.
  const displayPlayers = input.displayPosition == null
    ? remainingPlayers
    : remainingPlayers.filter((player) => player.position === input.displayPosition);
  const simulationContext = input.simulation;
  const executionMode = simulationContext?.executionMode ?? DEFAULT_EXECUTION_MODE;
  // An explicit zero-scenario request is a deliberate S2 fallback only when a real follow-up exists.
  // The final-pick null-follow-up collapse still carries useful deterministic lookahead fields.
  const stageC = simulationContext != null
    && input.myTeamId != null
    // A candidate may only be forced at the pick that is actually on the clock. The present
    // rollout has no pre-decision opponent window, so accepting a future decisionPick would skip
    // real intervening picks and overstate survival. Callers must omit simulation off-clock until
    // that wider timeline is implemented.
    && simulationContext.decisionPick === currentPick
    && !(executionMode.scenarios === 0 && simulationContext.followUpPick != null);
  const planningActive = input.myTeamId != null
    && input.nextPick != null
    && input.nextPick > currentPick;
  const rolloutLimit = Math.max(3 * rolloutDisplayLimit, 15);
  const candidates = stageC || planningActive
    ? selectCandidates(remainingPlayers, scores, rolloutLimit)
    : selectCandidates(displayPlayers, scores, rolloutDisplayLimit);
  // Fixed analytic expansion (validated decisions): add candidates the original rollout/planning
  // pool above never needed, purely so up to `expansionDepth` rows per position can be displayed
  // (and the market board can join a wide ADP range) without widening `rolloutLimit` itself.
  // `planningEligibleIds`/`simulationEligibleIds` freeze the original pool so these additions never
  // enter the follow-up shortlist, `deterministicOrder`, or the Monte Carlo candidate pool below.
  const includedCandidateIds = new Set(candidates.map((player) => player.playerId));
  const expansionPlayers: PlayerMeta[] = [];
  function addExpansionCandidate(player: PlayerMeta): void {
    if (includedCandidateIds.has(player.playerId)) return;
    includedCandidateIds.add(player.playerId);
    expansionPlayers.push(player);
  }
  const remainingByPosition = new Map<Position, PlayerMeta[]>();
  for (const player of remainingPlayers) {
    if (!player.position) continue;
    const list = remainingByPosition.get(player.position);
    if (list) list.push(player);
    else remainingByPosition.set(player.position, [player]);
  }
  function finiteAdpAscending(pool: readonly PlayerMeta[]): PlayerMeta[] {
    return pool
      .filter((player) => {
        const entry = adpById.get(player.playerId);
        return entry != null && Number.isFinite(entry.adp);
      })
      .slice()
      .sort((a, b) => (adpById.get(a.playerId)!.adp - adpById.get(b.playerId)!.adp) || a.playerId.localeCompare(b.playerId));
  }
  if (input.includeExpansion !== false) {
    for (const position of ALL_DISPLAY_POSITIONS) {
      const atPosition = remainingByPosition.get(position) ?? [];
      const alreadyIncluded = atPosition.reduce((count, player) => count + (includedCandidateIds.has(player.playerId) ? 1 : 0), 0);
      if (alreadyIncluded < expansionDepth) {
        const ranked = atPosition
          .filter((player) => !includedCandidateIds.has(player.playerId))
          .sort((a, b) => (scores.get(b.playerId) ?? 0) - (scores.get(a.playerId) ?? 0) || a.playerId.localeCompare(b.playerId));
        for (const player of ranked.slice(0, expansionDepth - alreadyIncluded)) addExpansionCandidate(player);
      }
    }
    for (const player of finiteAdpAscending(remainingPlayers).slice(0, expansionDepth)) addExpansionCandidate(player);
    for (const position of ALL_DISPLAY_POSITIONS) {
      for (const player of finiteAdpAscending(remainingByPosition.get(position) ?? []).slice(0, expansionDepth)) addExpansionCandidate(player);
    }
    if (!input.includeRecommendationViews && input.includeMarketRecommendations !== false) {
      // Preserve the historical full market-board join for non-worker consumers.
      for (const player of finiteAdpAscending(remainingPlayers)) addExpansionCandidate(player);
    }
  }
  // The worker UI caps every All/position view at 24 rows. Its bounded union therefore covers every
  // row the user can expose without paying pairwise planning cost for the finite-ADP tail.
  const planningEligibleIds = new Set(candidates.map((player) => player.playerId));
  const simulationEligibleIds = planningEligibleIds;
  const expandedCandidates = [...candidates, ...expansionPlayers];

  const replacementBaselineCache = new Map<string, number>();
  function replacementBaselineValue(player: PlayerMeta): number {
    const groupKey = candidateGroupKey(player);
    const cached = replacementBaselineCache.get(groupKey);
    if (cached != null) return cached;
    const levelPoints = player.position ? replacementPoints.get(player.position) ?? 0 : 0;
    const synthetic = syntheticReplacementPlayer(groupKey, player);
    const value = addPlayerToLineup(preparedRoster, synthetic, levelPoints, false).result.value;
    replacementBaselineCache.set(groupKey, value);
    return value;
  }

  // Candidates with the same eligible-slot group and score are symmetric for a single addition to
  // this immutable base roster: their value and assigned slot are identical. Memoizing that pair
  // also avoids repeating a canonical fallback for common zero-projection K/DEF candidates.
  //
  // `false`: this bulk pass runs over every evaluated candidate (up to the Stage C rollout
  // prefilter's ~100), but `assignedRosterSlot`/the "currently fits" reason are only ever shown for
  // the handful that end up displayed. Value stays exact regardless of tie-break identity (see
  // eligibility.ts's doc), so the expensive exact re-solve is deferred to `patchExactAssignment`
  // below, which re-resolves it only for the displayed set — the same fix that made Stage C's
  // rollout loop itself cheap, applied to this widened deterministic pass.
  const candidateLineupCache = new Map<PlayerId, { state: PreparedLineup; value: number; addedPlayerSlot: RosterSlot | null }>();
  function candidateLineup(player: PlayerMeta, points: number): { state: PreparedLineup; value: number; addedPlayerSlot: RosterSlot | null } {
    const cached = candidateLineupCache.get(player.playerId);
    if (cached) return cached;
    const incremental = addPlayerToLineup(preparedRoster, player, points, false);
    const result = { state: incremental.state, value: incremental.result.value, addedPlayerSlot: incremental.addedPlayerSlot };
    candidateLineupCache.set(player.playerId, result);
    return result;
  }

  /** Re-resolves `assignedRosterSlot` (and its "currently fits"/"bench-only" reason line, always
   * `reasons[1]` — see its construction below) to the canonical exact-tie-break identity, for a
   * recommendation that's actually going to be displayed. `bestKind` itself (whether *any* slot
   * fills at all) is never ambiguous — only *which* slot among value-tied options — so this can
   * only ever change the slot *name*, never flip between "fits a slot" and "bench-only". */
  function patchExactAssignment(recommendation: Recommendation): Recommendation {
    const player = playersById.get(recommendation.playerId);
    if (!player) return recommendation;
    const points = scores.get(recommendation.playerId) ?? 0;
    let exactSlot = exactAssignmentCache.get(recommendation.playerId);
    if (exactSlot === undefined) {
      exactSlot = addPlayerToLineup(preparedRoster, player, points, true).addedPlayerSlot;
      exactAssignmentCache.set(recommendation.playerId, exactSlot);
    }
    if (exactSlot === recommendation.assignedRosterSlot) return recommendation;
    const reasons = [...recommendation.reasons];
    reasons[1] = exactSlot
      ? `Projects for ${points.toFixed(1)} PPR points and currently fits ${exactSlot}.`
      : recommendation.recommendationMode === 'bench'
        ? `Projects for ${points.toFixed(1)} PPR points and would currently be bench-only; depth is priced within total roster utility.`
        : `Projects for ${points.toFixed(1)} PPR points and would currently be bench-only.`;
    return { ...recommendation, assignedRosterSlot: exactSlot, reasons };
  }

  const exactAssignmentCache = new Map<PlayerId, string | null>();
  const dispositionByPlayerId = new Map<PlayerId, SpecialTeamsDisposition>();
  let evaluated = expandedCandidates.map((player): Recommendation => {
    const points = scores.get(player.playerId) ?? 0;
    const afterValue = candidateLineup(player, points);

    const tier = tiers.get(player.playerId);
    const level = levels.find((entry) => entry.position === player.position);
    const vor = vorForPlayer(player, points, levels);
    const availability = input.nextPick == null
      ? null
      : estimateAvailability(adpById.get(player.playerId), { currentPick, nextPick: input.nextPick });
    const adpEntry = adpById.get(player.playerId);
    const marginalRosterValue = afterValue.value - currentValue;
    const afterRosterUtility = rosterUtility(afterValue.state, replacementPoints, availabilityData);
    const marginalRosterUtility = afterRosterUtility.total - currentRosterUtility.total;
    const depthUtilityDelta = afterRosterUtility.depthValue - currentRosterUtility.depthValue;
    const replacementAdjustedValue = afterValue.value - replacementBaselineValue(player);
    // `coreStartingSlotsFilled` establishes that every core slot has an occupant, not that the
    // current occupants are unbeatable. Keep a player who can still improve today's lineup on the
    // starter path; only a non-positive-MRV skill player is genuinely bench-only.
    const isStarterUpgrade = coreFilled && marginalRosterValue > 0;
    // `benchDepthValue` is provably 0 whenever a slot is still open (see its own doc), which is
    // every candidate pre-fill — skip its O(slots^2) reachability search entirely in starter mode
    // rather than pay it on every one of ~100 rollout candidates for a result that's always 0.
    const benchValue = coreFilled
      ? computeBenchDepthValue(preparedRoster, player, points, replacementPoints, input.availabilityByPlayer ?? NO_AVAILABILITY_DATA)
      : 0;

    const scoringDiagnostic = scoringDiagnosticsById.get(player.playerId);
    const scoringSeverity = scoringDiagnostic?.severity ?? 'none';
    const disposition = specialTeamsDisposition(player, coreFilled, specialTeamsDraft);
    dispositionByPlayerId.set(player.playerId, disposition);
    const deprioritized = isDeprioritized(player, coreFilled, specialTeamsDraft);
    const warnings: string[] = [];
    if (scoringSeverity === 'minor') warnings.push('Medium confidence: FFToday omits minor projected scoring components.');
    if (scoringSeverity === 'material') warnings.push('Low confidence: FFToday lacks material components used by this league.');
    if (player.position === 'K' || player.position === 'DEF') warnings.push('Low-confidence custom-scoring recommendation: FFToday does not expose every distance/range component.');
    if (disposition === 'early') {
      warnings.push(
        !coreFilled
          ? 'K/DEF are held back until your core starting slots are filled.'
          : player.position === 'DEF'
            ? 'D/ST is reserved for your final selections immediately before kicker.'
            : 'Kicker is reserved for your final team selection.',
      );
    }
    if (disposition === 'due' && player.position && specialTeamsDraft.overdue.includes(player.position as SpecialTeamsPosition)) {
      warnings.push(`${player.position === 'DEF' ? 'D/ST' : 'Kicker'} is overdue; too few selections remain to follow the ideal late-draft schedule.`);
    }
    if (level?.floored) warnings.push(`Remaining ${player.position ?? ''} demand is nearly exhausted; the replacement baseline is a floor, not a market-derived estimate.`);
    if (availability?.lowConfidence) warnings.push('ADP sample is sparse or its spread is estimated rather than observed; availability is approximate.');
    const adpReachGap = adpEntry != null && Number.isFinite(adpEntry.adp) ? adpEntry.adp - currentPick : null;
    if (adpReachGap != null && adpReachGap >= ADP_REACH_WARNING_THRESHOLD) {
      const survivalPct = availability?.probability;
      const reasonTail = survivalPct != null && survivalPct < 0.5
        ? `the model estimates only a ${Math.round(survivalPct * 100)}% chance this player lasts to your next pick`
        : "the model's projection places this player in a higher value tier than its ADP reflects";
      warnings.push(`This is a reach of ${Math.round(adpReachGap)} picks ahead of consensus ADP (${adpEntry!.adp.toFixed(1)}); ${reasonTail}. Not a veto — verify the projection before trusting it over the market.`);
    }
    if (unmatchedPickCount > 0) {
      warnings.push(`${unmatchedPickCount} drafted pick${unmatchedPickCount === 1 ? '' : 's'} could not be matched to a player; someone shown here may already be gone.`);
    }

    const reasons = [
      `Adds ${marginalRosterUtility.toFixed(1)} total roster utility: ${marginalRosterValue.toFixed(1)} starter value and ${depthUtilityDelta.toFixed(1)} depth-portfolio value.`,
    ];
    const assignedSlot = afterValue.addedPlayerSlot;
    if (assignedSlot) reasons.push(`Projects for ${points.toFixed(1)} PPR points and currently fits ${assignedSlot}.`);
    else reasons.push(
      coreFilled && !isStarterUpgrade && player.position != null && SKILL_POSITIONS.includes(player.position)
        ? `Projects for ${points.toFixed(1)} PPR points and would currently be bench-only; depth is priced within total roster utility.`
        : `Projects for ${points.toFixed(1)} PPR points and would currently be bench-only.`,
    );
    if (tier && tier.tierBoundaryGap > 0) {
      reasons.push(
        tier.isTierLast
          ? `Last tier-${tier.tier} ${player.position ?? ''}; the next tier starts ${tier.tierBoundaryGap.toFixed(1)} points lower.`
          : `${tier.remainingInTier} tier-${tier.tier} ${player.position ?? ''}${tier.remainingInTier === 1 ? '' : 's'} remain; the cliff after this tier is ${tier.tierBoundaryGap.toFixed(1)} points.`,
      );
    }
    if (availability) {
      reasons.push(`The ADP model estimates a ${Math.round(availability.probability * 100)}% chance to last to pick #${input.nextPick}, conditional on being available at #${currentPick}; this does not affect S2 ordering.`);
    }
    if (disposition === 'due') {
      reasons.push(`${player.position === 'DEF' ? 'D/ST' : 'Kicker'} is due under the late-draft roster plan.`);
    }

    // Availability `lowConfidence` still fires for fitted stdev (every Sleeper lobby
    // row) so the warning/disclosure above stay honest — but board confidence must
    // not demote on that alone, or every skill-position card becomes uniformly
    // "medium" while players missing ADP stay "high". Demote only when the
    // estimate is actually broken (degenerate / non-positive stdev) or the
    // *observed* sample is sparse.
    const adpSpreadBroken = availability != null && adpEntry != null && (!Number.isFinite(adpEntry.stdev) || adpEntry.stdev <= 0);
    const availabilityDemotesConfidence = Boolean(
      availability?.degenerate
      || adpSpreadBroken
      || (availability?.sampleSize != null && availability.sampleSize < 20),
    );

    let confidence: Recommendation['confidence'] = 'high';
    if (scoringSeverity === 'minor' || availabilityDemotesConfidence) confidence = 'medium';
    if (scoringSeverity === 'material' || player.position === 'K' || player.position === 'DEF' || unmatchedPickCount > 0) confidence = 'low';

    return {
      playerId: player.playerId,
      rank: 0,
      projectedPoints: points,
      marginalRosterValue,
      marginalRosterUtility,
      expectedFollowUpValue: 0,
      planValue: marginalRosterUtility,
      planningHorizon: 0,
      replacementAdjustedValue,
      replacementLevelPoints: level?.points ?? 0,
      vor,
      vona: null,
      vonaSource: 'unavailable',
      lookaheadValue: null,
      downside: null,
      simulatedSurvivalProbability: null,
      benchDepthValue: benchValue,
      recommendationMode: coreFilled && !isStarterUpgrade && player.position != null && SKILL_POSITIONS.includes(player.position)
        ? 'bench'
        : 'starter',
      rankingBasis: (player.position === 'K' || player.position === 'DEF')
        ? 'specialTeams'
        : 'rosterUtility',
      deprioritized,
      tier: tier?.tier ?? 0,
      tierGapAfter: tier?.gapAfter ?? 0,
      tierBoundaryGap: tier?.tierBoundaryGap ?? 0,
      tierUrgency: tier?.urgency ?? 0,
      availableNextPickProbability: availability?.probability ?? null,
      availabilityAdp: availability == null ? null : adpEntry?.adp ?? null,
      availabilityAdpHigh: availability == null ? null : adpEntry?.high ?? null,
      availabilityAdpLow: availability == null ? null : adpEntry?.low ?? null,
      availabilityStdev: availability == null ? null : adpEntry?.stdev ?? null,
      availabilitySampleSize: availability == null ? null : availability.sampleSize ?? null,
      nearTie: false,
      scoringDiagnosticSeverity: scoringSeverity,
      missingScoringKeys: scoringDiagnostic?.unsupportedScoringKeys ?? [],
      confidence,
      assignedRosterSlot: assignedSlot,
      replacementPlayerId: level?.playerId ?? null,
      // Placeholder — vona/vonaSource aren't final until after one-pick planning runs, so this is
      // overwritten by a computePickAction() pass immediately after that (see Recommendation.pickAction).
      pickAction: 'take-now',
      reasons,
      warnings,
    } satisfies Recommendation;
  });

  // One-pick planning is an analytic expectation over a single, shared roster objective. It does
  // not add a separate wait-loss correction to the Monte Carlo rollout (which would double-count
  // survival and follow-up effects already entangled in that rollout).
  const utilityByCandidate = new Map<PlayerId, number>(
    evaluated.map((row) => [row.playerId, currentRosterUtility.total + row.marginalRosterUtility]),
  );
  const followUpSkillRows = evaluated.filter((row) => {
    const position = playersById.get(row.playerId)?.position;
    return position != null
      && SKILL_POSITIONS.includes(position)
      && dispositionByPlayerId.get(row.playerId) !== 'unavailable'
      // Expansion-only rows exist purely to fill out display/market rows; they never enter the
      // shared follow-up shortlist (see the expansion-depth docs above).
      && planningEligibleIds.has(row.playerId);
  });
  const followUpIds = new Set<PlayerId>(
    [...followUpSkillRows]
      .sort((a, b) => b.marginalRosterUtility - a.marginalRosterUtility || a.playerId.localeCompare(b.playerId))
      .slice(0, followUpLimits.global)
      .map((row) => row.playerId),
  );
  const byEligibilityGroup = new Map<string, Recommendation[]>();
  for (const row of followUpSkillRows) {
    const player = playersById.get(row.playerId);
    if (!player) continue;
    const key = candidateGroupKey(player);
    const group = byEligibilityGroup.get(key);
    if (group) group.push(row);
    else byEligibilityGroup.set(key, [row]);
  }
  for (const group of byEligibilityGroup.values()) {
    group
      .sort((a, b) => b.marginalRosterUtility - a.marginalRosterUtility || a.playerId.localeCompare(b.playerId))
      .slice(0, followUpLimits.perGroup)
      .forEach((row) => followUpIds.add(row.playerId));
  }
  const followUpRows = followUpSkillRows.filter((row) => followUpIds.has(row.playerId));
  const planningParticipantIds = [...new Set([
    ...preparedRoster.activePlayerIds,
    ...evaluated.map((row) => row.playerId),
    ...followUpRows.map((row) => row.playerId),
  ])].sort();
  const planningUtilityKey = [
    settingsFingerprint(input.settings),
    preparedRoster.activePlayerIds.slice().sort().join(','),
    [...replacementPoints.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([position, points]) => position + '=' + numberFingerprint(points)).join(','),
    planningParticipantIds.map((id) => {
      const player = playersById.get(id);
      return [
        id,
        numberFingerprint(scores.get(id)),
        player?.position ?? '~',
        player ? [...player.eligiblePositions].sort().join(',') : '~',
        numberFingerprint(player?.byeWeek),
        numberFingerprint(availabilityData.get(id)),
      ].join(':');
    }).join('|'),
  ].join('\u001f');
  const pairUtilityCache = planningPairUtilityCache?.key === planningUtilityKey
    ? planningPairUtilityCache.values
    : new Map<string, number>();
  if (planningPairUtilityCache?.key !== planningUtilityKey) {
    planningPairUtilityCache = { key: planningUtilityKey, values: pairUtilityCache };
  }

  function pairRosterUtility(firstId: PlayerId, secondId: PlayerId): number {
    const ids = [firstId, secondId].sort();
    const key = ids.join('|');
    const cached = pairUtilityCache.get(key);
    if (cached != null) return cached;
    let state = preparedRoster;
    for (const id of ids) {
      const player = playersById.get(id);
      if (!player) continue;
      state = addPlayerToLineup(state, player, scores.get(id) ?? 0, false).state;
    }
    const total = rosterUtility(state, replacementPoints, availabilityData).total;
    pairUtilityCache.set(key, total);
    return total;
  }

  function survivalFor(row: Recommendation): number {
    const probability = row.availableNextPickProbability ?? row.simulatedSurvivalProbability ?? 0;
    return Math.max(0, Math.min(1, probability));
  }

  function expectedBest(
    rows: readonly Recommendation[],
    valueFor: (row: Recommendation) => number,
  ): number {
    const ordered = rows
      .map((row) => ({ row, value: Math.max(0, valueFor(row)), survival: survivalFor(row) }))
      .filter((entry) => entry.value > 0 && entry.survival > 0)
      .sort((a, b) => b.value - a.value || a.row.playerId.localeCompare(b.row.playerId));
    let noneHigher = 1;
    let expected = 0;
    for (const entry of ordered) {
      expected += noneHigher * entry.survival * entry.value;
      noneHigher *= 1 - entry.survival;
    }
    return expected;
  }

  function applyOnePickPlanning(rows: Recommendation[]): Recommendation[] {
    if (!planningActive) return rows;
    const lookup = new Map(rows.map((row) => [row.playerId, row]));
    return rows.map((row) => {
      const player = playersById.get(row.playerId);
      if (!player || player.position == null || !SKILL_POSITIONS.includes(player.position)) return row;
      const afterCurrent = utilityByCandidate.get(row.playerId) ?? currentRosterUtility.total;
      const availableFollowUps = followUpRows
        .filter((candidate) => candidate.playerId !== row.playerId)
        .map((candidate) => lookup.get(candidate.playerId) ?? candidate);
      const expectedFollowUpValue = expectedBest(
        availableFollowUps,
        (candidate) => pairRosterUtility(row.playerId, candidate.playerId) - afterCurrent,
      );
      const sameGroup = (byEligibilityGroup.get(candidateGroupKey(player)) ?? [])
        .filter((candidate) => candidate.playerId !== row.playerId)
        .map((candidate) => lookup.get(candidate.playerId) ?? candidate);
      // VONA asks about the best *alternative* at the next turn. Its availability source must
      // therefore be derived from the competitor pool, not from `row`, which is being selected
      // now and cannot be its own surviving substitute.
      const source: Recommendation['vonaSource'] = sameGroup.some((candidate) => candidate.availableNextPickProbability != null)
        ? 'analytic'
        : sameGroup.some((candidate) => candidate.simulatedSurvivalProbability != null)
          ? 'simulationFallback'
          : 'unavailable';
      const expectedSameGroup = expectedBest(sameGroup, (candidate) => candidate.marginalRosterUtility);
      const vona = source === 'unavailable'
        ? null
        : Math.max(0, row.marginalRosterUtility - expectedSameGroup);
      const planValue = row.marginalRosterUtility + expectedFollowUpValue;
      const reasons = row.reasons
        .filter((reason) => !reason.startsWith('Plan value:') && !reason.startsWith('Wait cost:'))
        .map((reason) => reason.replace(
          'this does not affect S2 ordering.',
          'this probability feeds the deterministic one-pick plan.',
        ));
      reasons.push(
        `Plan value: ${row.marginalRosterUtility.toFixed(1)} intrinsic roster utility + ${expectedFollowUpValue.toFixed(1)} expected best follow-up = ${planValue.toFixed(1)} over one future pick.`,
      );
      if (vona != null) {
        const sourceLabel = source === 'analytic' ? 'analytic' : 'simulation-fallback';
        reasons.push(`Wait cost: ${sourceLabel} VONA ${vona.toFixed(1)} versus the expected next-pick value from the same eligibility group.`);
        const adpGap = row.availabilityAdp == null ? null : row.availabilityAdp - currentPick;
        if (vona < 0.5 && adpGap != null && adpGap >= ADP_REACH_WARNING_THRESHOLD) {
          reasons.push('This player has near-zero wait cost, so the ranking is not claiming they are scarce; taking a more urgent option first is reasonable.');
        }
      }
      const warnings = source === 'unavailable' && !row.warnings.some((warning) => warning.startsWith('Availability unknown:'))
        ? [...row.warnings, 'Availability unknown: no ADP or simulated fallback; the plan does not assume this player will last.']
        : row.warnings;
      const confidence = source === 'simulationFallback' && row.confidence === 'high' ? 'medium' : row.confidence;
      return {
        ...row,
        expectedFollowUpValue,
        planValue,
        planningHorizon: 1,
        vona,
        vonaSource: source,
        rankingBasis: 'planValue',
        reasons,
        warnings,
        confidence,
      };
    });
  }

  function rankingValue(recommendation: Recommendation): number {
    switch (recommendation.rankingBasis) {
      case 'planValue': return recommendation.planValue;
      case 'specialTeams': return recommendation.projectedPoints;
      case 'rosterUtility': default: return recommendation.marginalRosterUtility;
    }
  }
  function compareWithinBand(a: Recommendation, b: Recommendation): number {
    const aSurvival = a.availableNextPickProbability ?? a.simulatedSurvivalProbability;
    const bSurvival = b.availableNextPickProbability ?? b.simulatedSurvivalProbability;
    if (aSurvival == null && bSurvival != null) return 1;
    if (aSurvival != null && bSurvival == null) return -1;
    if (aSurvival != null && bSurvival != null && aSurvival !== bSurvival) return aSurvival - bSurvival;
    const aAdp = a.availabilityAdp;
    const bAdp = b.availabilityAdp;
    if (aAdp == null && bAdp != null) return 1;
    if (aAdp != null && bAdp == null) return -1;
    if (aAdp != null && bAdp != null && aAdp !== bAdp) return aAdp - bAdp;
    if (a.planValue !== b.planValue) return b.planValue - a.planValue;
    return a.playerId.localeCompare(b.playerId);
  }
  function orderNearTieBands(rows: readonly Recommendation[]): {
    sorted: Recommendation[];
    nearTieIds: Set<PlayerId>;
  } {
    const sorted = [...rows];
    const nearTieIds = new Set<PlayerId>();
    let bandStart = 0;
    while (bandStart < sorted.length) {
    const anchor = sorted[bandStart] as Recommendation;
    const anchorClass = dispositionSortClass(dispositionByPlayerId.get(anchor.playerId) ?? 'normal');
    const anchorValue = rankingValue(anchor);
    const threshold = Math.max(1, 0.01 * Math.abs(anchorValue));
    let bandEnd = bandStart + 1;
    while (bandEnd < sorted.length) {
      const candidate = sorted[bandEnd] as Recommendation;
      if (candidate.rankingBasis !== anchor.rankingBasis) break;
      if (dispositionSortClass(dispositionByPlayerId.get(candidate.playerId) ?? 'normal') !== anchorClass) break;
      if (Math.abs(rankingValue(candidate) - anchorValue) > threshold) break;
      bandEnd += 1;
    }
    if (bandEnd - bandStart >= 2) {
      const bandMembers = sorted.slice(bandStart, bandEnd).sort(compareWithinBand);
      for (let i = 0; i < bandMembers.length; i += 1) {
        const member = bandMembers[i] as Recommendation;
        sorted[bandStart + i] = member;
        nearTieIds.add(member.playerId);
      }
    }
      bandStart = bandEnd;
    }
    return { sorted, nearTieIds };
  }

  function assembleBoard(
    rows: Recommendation[],
    simulationDiagnostics: SimulationDiagnostics | null,
    planningSort: boolean,
    stageCActive: boolean,
    rolloutPoolSize: number,
  ): RecommendationResult {
    let sortSet = rows.filter((recommendation) =>
      input.displayPosition == null || playersById.get(recommendation.playerId)?.position === input.displayPosition);
    const usePlanSort = planningSort && input.displayPosition !== 'K' && input.displayPosition !== 'DEF';
    const initialSorted = input.displayPosition === 'K' || input.displayPosition === 'DEF'
      ? [...sortSet].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))
      : sortSet.filter((recommendation) => dispositionByPlayerId.get(recommendation.playerId) !== 'unavailable').sort((a, b) => {
      const aPosition = playersById.get(a.playerId)?.position;
      const bPosition = playersById.get(b.playerId)?.position;
      const aOverdueBy = aPosition === 'K' || aPosition === 'DEF' ? overdueBy(aPosition, specialTeamsDraft) : 0;
      const bOverdueBy = bPosition === 'K' || bPosition === 'DEF' ? overdueBy(bPosition, specialTeamsDraft) : 0;
      const valueComparison = usePlanSort
        ? b.planValue - a.planValue
        : b.marginalRosterUtility - a.marginalRosterUtility;
      return dispositionSortClass(dispositionByPlayerId.get(a.playerId) ?? 'normal')
      - dispositionSortClass(dispositionByPlayerId.get(b.playerId) ?? 'normal')
      || bOverdueBy - aOverdueBy
      || valueComparison
      || b.vor - a.vor
      || b.projectedPoints - a.projectedPoints
      || a.playerId.localeCompare(b.playerId);
    });
    const analysis: RecommendationAnalysis | undefined = input.includeAnalysisRows
      ? {
          deterministicRows: rows,
          simulatedRows: sortSet,
          deterministicCandidateCount: expandedCandidates.length,
          simulatedCandidateCount: sortSet.filter((recommendation) => recommendation.simulatedSurvivalProbability != null).length,
          rolloutPoolSize,
        }
      : undefined;
    const { sorted, nearTieIds } = orderNearTieBands(initialSorted);
    const displayedExact = sorted.slice(0, limit).map(patchExactAssignment);
    const recommendations = displayedExact.map((recommendation, index) => {
      const alternative = sorted[index + 1];
      const altPlayer = alternative && playersById.get(alternative.playerId);
      const reasons = alternative && altPlayer
        ? [
            ...recommendation.reasons,
            alternative.availableNextPickProbability != null
              ? `Next value-board option: ${altPlayer.name} (${altPlayer.position ?? ''}); the ADP model estimates ${Math.round(alternative.availableNextPickProbability * 100)}% next-pick availability.`
              : `Next value-board option: ${altPlayer.name} (${altPlayer.position ?? ''}).`,
          ]
        : recommendation.reasons;
      return {
        ...recommendation,
        reasons,
        rank: index + 1,
        nearTie: nearTieIds.has(recommendation.playerId),
      };
    });
    function decorateView(viewSorted: readonly Recommendation[]): Recommendation[] {
      const { sorted: ordered, nearTieIds: viewNearTieIds } = orderNearTieBands(viewSorted);
      return ordered.slice(0, limit).map(patchExactAssignment).map((recommendation, index) => {
        const alternative = ordered[index + 1];
        const altPlayer = alternative && playersById.get(alternative.playerId);
        const reasons = alternative && altPlayer
          ? [
              ...recommendation.reasons,
              alternative.availableNextPickProbability != null
                ? `Next value-board option: ${altPlayer.name} (${altPlayer.position ?? ''}); the ADP model estimates ${Math.round(alternative.availableNextPickProbability * 100)}% next-pick availability.`
                : `Next value-board option: ${altPlayer.name} (${altPlayer.position ?? ''}).`,
            ]
          : recommendation.reasons;
        return {
          ...recommendation,
          reasons,
          rank: index + 1,
          nearTie: viewNearTieIds.has(recommendation.playerId),
        };
      });
    }
    const recommendationViews = input.includeRecommendationViews
      ? Object.fromEntries([
          ['ALL', decorateView(initialSorted)],
          ...ALL_DISPLAY_POSITIONS.map((position) => {
            const positionRows = position === 'K' || position === 'DEF'
              ? rows
                  .filter((row) => playersById.get(row.playerId)?.position === position)
                  .sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))
              : initialSorted.filter((row) => playersById.get(row.playerId)?.position === position);
            return [position, decorateView(positionRows)];
          }),
        ]) as Record<'ALL' | Position, Recommendation[]>
      : undefined;
    const marketRecommendations: MarketRecommendation[] = input.includeMarketRecommendations === false
      ? []
      : buildMarketRecommendations({
          adp: input.adp,
          currentPick,
          drafted,
          evaluatedById: new Map(rows.map((recommendation) => [recommendation.playerId, recommendation])),
          scoredIds: new Set(scores.keys()),
        });
    return {
      recommendations,
      hasMoreRecommendations: sorted.length > limit,
      marketRecommendations,
      ...(recommendationViews ? { recommendationViews } : {}),
      diagnostics: {
        unmatchedPickCount,
        unmatchedPickOveralls,
        candidatesEvaluated: stageCActive ? candidates.length : selectCandidates(displayPlayers, scores, limit).length,
        replacementLevels: levels,
        positionalDemand: demand,
        coreStartingSlotsFilled: coreFilled,
        specialTeamsDraft,
        simulation: simulationDiagnostics,
      },
      ...(analysis ? { analysis } : {}),
    };
  }

  const deterministicRows = evaluated.map((row) => ({
    ...row,
    pickAction: computePickAction(row, currentPick, valueAnchor),
  }));

  function refineFromEvaluated(baseRows: Recommendation[]): RecommendationResult | Promise<RecommendationResult> {
  let nextRows = applyOnePickPlanning(baseRows);
  nextRows = nextRows.map((row) => ({ ...row, pickAction: computePickAction(row, currentPick, valueAnchor) }));

  let simulationDiagnostics: SimulationDiagnostics | null = null;
  let rolloutPoolSize = 0;

  const finish = (): RecommendationResult => assembleBoard(
    nextRows,
    simulationDiagnostics,
    planningActive,
    stageC,
    rolloutPoolSize,
  );

  if (!(stageC && simulationContext && input.myTeamId != null)) return finish();

  const myTeamId = input.myTeamId;
  {
    const deterministicOrder = [...nextRows]
      .filter((recommendation) => dispositionByPlayerId.get(recommendation.playerId) !== 'unavailable'
        // Expansion-only rows never compete for the rollout pool — see the expansion-depth docs.
        && simulationEligibleIds.has(recommendation.playerId))
      .sort((a, b) => {
        const aPosition = playersById.get(a.playerId)?.position;
        const bPosition = playersById.get(b.playerId)?.position;
        const aOverdueBy = aPosition === 'K' || aPosition === 'DEF' ? overdueBy(aPosition, specialTeamsDraft) : 0;
        const bOverdueBy = bPosition === 'K' || bPosition === 'DEF' ? overdueBy(bPosition, specialTeamsDraft) : 0;
        // Bench mode: pick rollout candidates by insurance value, not by a cross-position VOR ladder
        // that reads as a starter-value signal it no longer is (see eligibility.ts's benchDepthValue
        // doc) — otherwise the simulated pool could miss exactly the depth candidates bench mode
        // cares about in favor of stale-VOR leaders.
        const deterministicValue = planningActive
          ? b.planValue - a.planValue
          : b.marginalRosterUtility - a.marginalRosterUtility;
        return dispositionSortClass(dispositionByPlayerId.get(a.playerId) ?? 'normal')
        - dispositionSortClass(dispositionByPlayerId.get(b.playerId) ?? 'normal')
        || bOverdueBy - aOverdueBy
        || deterministicValue
        || b.vor - a.vor
        || b.projectedPoints - a.projectedPoints
        || a.playerId.localeCompare(b.playerId);
      });
    // `rolloutDisplayLimit`, not the (now pagination-driven) `limit`: the per-position tab-fill
    // term must stay sized to the original rollout pool, or paging the UI to 20 would silently
    // widen what Stage C actually simulates — exactly what `rolloutDisplayLimit` exists to prevent.
    const rolloutRecommendations = buildRolloutPool(deterministicOrder, playersById, rolloutLimit, rolloutDisplayLimit);
    rolloutPoolSize = rolloutRecommendations.length;
    // K/DEF are excluded here only — from the pool actually simulated. They remain in
    // `rolloutRecommendations` (and hence the final displayed sort) and in `remainingPlayers` (so
    // they stay opponent-draftable); this is purely "don't spend a rollout window on a candidate
    // whose tab never reads its VONA" (see buildRolloutPool's doc).
    const simulationCandidatePool = rolloutRecommendations
      .map((recommendation) => playersById.get(recommendation.playerId))
      .filter((player): player is PlayerMeta => player != null && player.position !== 'K' && player.position !== 'DEF');
    const requestedSimulationLimit = input.simulationCandidateLimit;
    const simulationCandidateLimit = requestedSimulationLimit == null
      ? simulationCandidatePool.length
      : Math.max(0, Math.floor(requestedSimulationLimit));
    const displayedCandidateIds = new Set(deterministicOrder
      .filter((recommendation) => input.displayPosition == null
        || playersById.get(recommendation.playerId)?.position === input.displayPosition)
      .slice(0, Math.min(limit, simulationCandidateLimit))
      .map((recommendation) => recommendation.playerId));
    const rolloutCandidateIds = new Set(rolloutRecommendations.map((recommendation) => recommendation.playerId));
    const cappedCandidatePool = deterministicOrder
      .filter((recommendation) => displayedCandidateIds.has(recommendation.playerId)
        || rolloutCandidateIds.has(recommendation.playerId))
      .map((recommendation) => playersById.get(recommendation.playerId))
      .filter((player): player is PlayerMeta => player != null
        && player.position !== 'K'
        && player.position !== 'DEF'
        && (input.displayPosition == null || player.position === input.displayPosition));
    const simulationCandidates = requestedSimulationLimit == null
      ? simulationCandidatePool
      : cappedCandidatePool.slice(0, simulationCandidateLimit);
    const opponentConfig = simulationContext.opponentConfig ?? defaultOpponentModelConfig(simulationContext.teams, simulationContext.rounds);
    const key = simulationKey(input, simulationContext, remainingPlayers, myRoster, simulationCandidates, scores, executionMode, opponentConfig);
    const simInput = {
      settings: input.settings,
      draftType: simulationContext.draftType,
      teams: simulationContext.teams,
      rounds: simulationContext.rounds,
      slotToTeam: simulationContext.slotToTeam,
      draftId: simulationContext.draftId,
      myTeamId,
      myRoster,
      scores,
      candidates: simulationCandidates,
      remainingPlayers,
      adp: input.adp,
      picks: input.picks,
      playersById,
      decisionPick: simulationContext.decisionPick,
      followUpPick: simulationContext.followUpPick,
      opponentConfig,
      executionMode,
      now: simulationContext.now,
      precomputedTeamRosters: getTeamRosters(input.settings, input.picks, playersById, scores, simulationContext.decisionPick),
    };
    const applySimulation = (result: SimulationResult): RecommendationResult => {
      if (simulationContext.now == null) simulationCache = { key, result };
      simulationDiagnostics = result.diagnostics;
      if (simulationContext.followUpPick == null || result.diagnostics.scenariosRun > 0) {
        const simulationByPlayerId = new Map(result.candidates.map((candidate) => [candidate.playerId, candidate]));
        nextRows = nextRows.map((recommendation) => {
          const player = playersById.get(recommendation.playerId);
          const simulation = player && player.position !== 'K' && player.position !== 'DEF'
            ? simulationByPlayerId.get(recommendation.playerId)
            : undefined;
          if (!simulation) return recommendation;
          const reasons = recommendation.reasons.filter((reason) => !reason.startsWith('Simulation check:'));
          reasons.push('Simulation check: ' + Math.round(simulation.simulatedSurvivalProbability * 100)
            + '% seeded-rollout chance to still be available next turn; analytic availability remains the primary timing input.');
          const warnings = result.diagnostics.timedOut
            ? [...recommendation.warnings, 'Rollout truncated after ' + result.diagnostics.scenariosRun + '/' + executionMode.scenarios + ' scenarios; wait-cost estimates are directional.']
            : recommendation.warnings;
          return {
            ...recommendation,
            lookaheadValue: simulation.lookaheadValue,
            downside: simulation.downside,
            simulatedSurvivalProbability: simulation.simulatedSurvivalProbability,
            reasons,
            warnings,
          };
        });
        nextRows = applyOnePickPlanning(nextRows);
      }
      return finish();
    };
    if (simulationContext.now == null && simulationCache?.key === key) {
      return applySimulation(simulationCache.result);
    }
    if (options?.yieldBetweenBatches) {
      return runSimulationAsync(simInput, options.yieldBetweenBatches, options.shouldAbort).then(applySimulation);
    }
    return applySimulation(runSimulation(simInput));
  }
  }

  if (options?.onDeterministicSnapshot) {
    const snapshot = assembleBoard(deterministicRows, null, false, false, 0);
    return Promise.resolve(options.onDeterministicSnapshot(snapshot)).then((signal) => {
      if (signal === 'abort' || options.shouldAbort?.()) return null;
      return refineFromEvaluated(deterministicRows);
    });
  }
  return refineFromEvaluated(deterministicRows);
}

export function buildMarketRecommendations(args: {
  adp: readonly AdpEntry[];
  currentPick: number;
  drafted: ReadonlySet<PlayerId>;
  evaluatedById: ReadonlyMap<PlayerId, Recommendation>;
  scoredIds: ReadonlySet<PlayerId>;
}): MarketRecommendation[] {
  const marketEligible = args.adp
    .filter((entry): entry is typeof entry & { playerId: PlayerId } =>
      entry.playerId != null && !args.drafted.has(entry.playerId) && Number.isFinite(entry.adp))
    .map((entry) => ({ playerId: entry.playerId, adp: entry.adp, pickDelta: entry.adp - args.currentPick }));
  const marketOrderCompare = (a: typeof marketEligible[number], b: typeof marketEligible[number]) =>
    a.pickDelta - b.pickDelta || a.adp - b.adp || a.playerId.localeCompare(b.playerId);
  const pastAdp = marketEligible.filter((entry) => entry.pickDelta < 0).sort(marketOrderCompare);
  const upcoming = marketEligible.filter((entry) => entry.pickDelta >= 0).sort(marketOrderCompare);
  return [...pastAdp, ...upcoming].map((entry, index) => ({
    playerId: entry.playerId,
    rank: index + 1,
    adp: entry.adp,
    pickDelta: entry.pickDelta,
    recommendation: args.scoredIds.has(entry.playerId) ? args.evaluatedById.get(entry.playerId) ?? null : null,
  }));
}


export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  return buildRecommendationBoard(input).recommendations;
}
