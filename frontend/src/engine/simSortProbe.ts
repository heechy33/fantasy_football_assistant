/**
 * Disagreement probe: does sorting by Stage C's simulated `lookaheadValue` (`simulate.ts`) ever pick
 * a different player than the production `planValue` sort (`recommend.ts`)? `lookaheadValue` is
 * computed every Stage C turn but never read by the board's comparator (`recommend.ts`'s
 * `rankingValue`/`compareWithinBand` have no lookahead branch — deliberate, `DECISIONS.md`
 * 2026-08-10). The 2025 backtest pilot found `engine` and `b4` (planning with/without simulation)
 * produced byte-identical picks across 240 paired drafts (`DECISIONS.md` 2026-08-22, finding 1),
 * which proves Stage C is display-only *for the analytic-vs-simulated-off comparison* but says
 * nothing about whether *sorting by the simulated value itself* would ever disagree.
 *
 * This module answers that cheaply: walk a normal `engine` draft trajectory (subject picks always
 * follow the real production sort, so the draft never diverges) and at every subject turn, also ask
 * "which player would a pure lookahead sort have chosen from the same evaluated board?" No extra
 * draft grid, no scoring against 2025 outcomes — a disagreement-rate measurement only. Precedent:
 * the nine-draft regret-ceiling prescreen that killed two-turn rollouts before they were built
 * (`DECISIONS.md` 2026-08-10, "Why one-turn, not two-turn").
 *
 * Pure, Node-testable — no file I/O, no `process.env`, no React (mirrors `backtest.ts`'s contract).
 * The runner (`simSortProbe.bench.ts`) loads fixtures and writes the report.
 */
import type { DraftType, Pick, PlayerId, PlayerMeta } from '../../../shared/types';
import { slotForOverall, userPickBoundaries } from '../adapters/draftOrder';
import {
  BACKTEST_ROUNDS,
  BACKTEST_TEAMS,
  draftSeedFor,
  pickOpponent,
  type BacktestContext,
} from './backtest';
import type { PreparedLineup } from './eligibility';
import { buildRecommendationBoard, DEFAULT_SCENARIOS, type Recommendation, type RecommendationInput, type RecommendationResult } from './recommend';

/**
 * The selection rule under test: what a pure Stage C lookahead sort would pick from an already-
 * evaluated board. Used by both the probe (this file) and, if the probe finds material
 * disagreement, the `c1` backtest arm — so the probe can never measure a policy a later scored arm
 * doesn't actually ship.
 *
 * 1. If the production top pick is K/DEF, defer to it unchanged. The engine's special-teams overdue
 *    class sorts strictly before the value term (`recommend.ts`'s `assembleBoard`); substituting the
 *    value term must not also override roster-construction policy, or this measures "never drafts a
 *    kicker" instead of "sorts differently" (`fixtures/backtest/2025/gates.md`'s B3 finding: 0
 *    coverage, ~10-15 pts/week forfeited when K/DEF forcing is skipped).
 * 2. Otherwise, the pool is the non-K/DEF rows of `result.analysis.simulatedRows` (production's
 *    exact pre-sort pool — `recommend.ts`'s `sortSet`) that carry a non-null `lookaheadValue`; take
 *    max `lookaheadValue`, tie-broken by `planValue` desc then `playerId` asc for determinism.
 * 3. If no row has a `lookaheadValue` (no follow-up pick, zero scenarios, off-clock — Stage C's own
 *    all-or-nothing contract), defer to the production top pick.
 *
 * Requires `RecommendationInput.includeAnalysisRows: true` on the call that produced `result` —
 * fails loudly rather than silently falling back to `result.recommendations`, matching the project's
 * "never silently drop" convention (a caller that forgot the flag has a bug, not a degraded mode).
 */
export interface SimSortChoice {
  playerId: PlayerId;
  basis: 'lookahead' | 'special-teams-deferred' | 'no-lookahead';
}

export function simSortChoice(
  result: RecommendationResult,
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
): SimSortChoice {
  const top = result.recommendations[0];
  if (!top) throw new Error('simSortChoice: result.recommendations is empty');
  const topPosition = playersById.get(top.playerId)?.position;
  if (topPosition === 'K' || topPosition === 'DEF') {
    return { playerId: top.playerId, basis: 'special-teams-deferred' };
  }
  if (!result.analysis) {
    throw new Error('simSortChoice requires RecommendationInput.includeAnalysisRows: true on the board that produced this result');
  }
  const pool = result.analysis.simulatedRows.filter((row) => {
    if (row.lookaheadValue == null) return false;
    const position = playersById.get(row.playerId)?.position;
    return position !== 'K' && position !== 'DEF';
  });
  if (!pool.length) {
    return { playerId: top.playerId, basis: 'no-lookahead' };
  }
  const best = [...pool].sort((a, b) =>
    (b.lookaheadValue as number) - (a.lookaheadValue as number)
    || b.planValue - a.planValue
    || a.playerId.localeCompare(b.playerId))[0]!;
  return { playerId: best.playerId, basis: 'lookahead' };
}

/** Spearman's rank correlation between the `planValue` order and the `lookaheadValue` order over
 * `rows` (already filtered to comparable candidates — see callers). `null` when fewer than 2 rows
 * share both fields, since a correlation is undefined below that. Ties are broken identically to
 * `simSortChoice`/production so the two rank vectors are well-defined. */
export function spearmanPlanValueVsLookahead(rows: readonly Recommendation[]): number | null {
  const comparable = rows.filter((row) => row.lookaheadValue != null);
  const n = comparable.length;
  if (n < 2) return null;
  const byPlanValue = [...comparable].sort((a, b) =>
    b.planValue - a.planValue || a.playerId.localeCompare(b.playerId));
  const byLookahead = [...comparable].sort((a, b) =>
    (b.lookaheadValue as number) - (a.lookaheadValue as number) || a.playerId.localeCompare(b.playerId));
  const planRank = new Map(byPlanValue.map((row, index) => [row.playerId, index]));
  const lookaheadRank = new Map(byLookahead.map((row, index) => [row.playerId, index]));
  let sumSquaredDiff = 0;
  for (const row of comparable) {
    const diff = (planRank.get(row.playerId) ?? 0) - (lookaheadRank.get(row.playerId) ?? 0);
    sumSquaredDiff += diff * diff;
  }
  return 1 - (6 * sumSquaredDiff) / (n * (n * n - 1));
}

export interface SimSortObservation {
  slot: number;
  seedIndex: number;
  overall: number;
  round: number;
  enginePickId: PlayerId;
  simPickId: PlayerId;
  agree: boolean;
  basis: SimSortChoice['basis'];
  enginePickHasAdp: boolean;
  simPickHasAdp: boolean;
  /** Index of `simPickId` within `result.recommendations` (the actual displayed, final-sorted
   * board) — 0 when `agree`. `null` when the sim-preferred player fell outside the displayed
   * top-`limit` rows entirely (rare: the rollout pool is a superset of the display window, but
   * `simulationCandidateLimit` can leave a rolled-out row outside `recommendations`). */
  deltaRank: number | null;
  lookaheadOfEnginePick: number | null;
  planValueOfSimPick: number | null;
  simulatedCandidateCount: number;
  spearman: number | null;
}

/** Mirrors `backtest.ts`'s `pickByEngineFamily(ctx, 'engine', ...)` exactly (same
 * `RecommendationInput` shape, same `DEFAULT_SCENARIOS`), plus `includeAnalysisRows: true` so
 * `simSortChoice` has a pool to compare against. Kept local rather than widening the backtest arm's
 * signature — the probe never drives a draft off this pick, only observes it (see
 * `runSimSortProbeDraft`, which always advances on `result.recommendations[0]`, identical to the
 * real `engine` arm's trajectory). */
function evaluateSubjectTurn(
  ctx: BacktestContext,
  overall: number,
  picks: readonly Pick[],
  myTeamId: string,
  draftId: string,
): RecommendationResult {
  const boundaries = userPickBoundaries('snake', BACKTEST_TEAMS, BACKTEST_ROUNDS, overall - 1, ctx.slotToTeam, myTeamId);
  const input: RecommendationInput = {
    settings: ctx.settings,
    players: ctx.players,
    projections: ctx.projections,
    adp: ctx.adp,
    picks: picks as Pick[],
    myTeamId,
    nextPick: boundaries.followUpPick,
    currentPick: overall,
    limit: 24,
    rolloutDisplayLimit: 5,
    simulationCandidateLimit: 10,
    includeAnalysisRows: true,
    displayPosition: null,
    includeRecommendationViews: false,
    includeMarketRecommendations: false,
    includeExpansion: false,
    rosterSpotsPerTeam: BACKTEST_ROUNDS,
    draftRounds: BACKTEST_ROUNDS,
    simulation: {
      draftId,
      draftType: 'snake' as DraftType,
      teams: BACKTEST_TEAMS,
      rounds: BACKTEST_ROUNDS,
      slotToTeam: ctx.slotToTeam,
      decisionPick: boundaries.decisionPick as number,
      followUpPick: boundaries.followUpPick,
      secondFollowUpPick: boundaries.secondFollowUpPick,
      executionMode: { mode: 'fixed' as const, scenarios: DEFAULT_SCENARIOS },
    },
  };
  return buildRecommendationBoard(input);
}

function buildObservation(
  ctx: BacktestContext,
  slot: number,
  seedIndex: number,
  overall: number,
  round: number,
  result: RecommendationResult,
  choice: SimSortChoice,
): SimSortObservation {
  const enginePickId = result.recommendations[0]!.playerId;
  const simulatedRows = result.analysis!.simulatedRows;
  const byPlayerId = new Map(simulatedRows.map((row) => [row.playerId, row]));
  const nonSpecialTeams = simulatedRows.filter((row) => {
    const position = ctx.playersById.get(row.playerId)?.position;
    return position !== 'K' && position !== 'DEF';
  });
  return {
    slot,
    seedIndex,
    overall,
    round,
    enginePickId,
    simPickId: choice.playerId,
    agree: enginePickId === choice.playerId,
    basis: choice.basis,
    enginePickHasAdp: ctx.adpByPlayerId.has(enginePickId),
    simPickHasAdp: ctx.adpByPlayerId.has(choice.playerId),
    deltaRank: (() => {
      const index = result.recommendations.findIndex((row) => row.playerId === choice.playerId);
      return index === -1 ? null : index;
    })(),
    lookaheadOfEnginePick: byPlayerId.get(enginePickId)?.lookaheadValue ?? null,
    planValueOfSimPick: byPlayerId.get(choice.playerId)?.planValue ?? null,
    simulatedCandidateCount: result.analysis!.simulatedCandidateCount,
    spearman: spearmanPlanValueVsLookahead(nonSpecialTeams),
  };
}

/** Runs one complete 192-pick draft for (slot, seedIndex), always advancing on the real production
 * pick (`result.recommendations[0]`) — the subject's trajectory is byte-identical to the `engine`
 * backtest arm. Records one `SimSortObservation` per subject turn without altering what gets
 * drafted. Opponent picks reuse `backtest.ts`'s exact `pickOpponent`/seed derivation. */
export function runSimSortProbeDraft(
  ctx: BacktestContext,
  slot: number,
  seedIndex: number,
): SimSortObservation[] {
  const seed = draftSeedFor(slot, seedIndex);
  const myTeamId = ctx.slotToTeam[slot]!;
  const draftId = `simsort-probe-s${slot}-n${seedIndex}`;
  const picks: Pick[] = [];
  const preparedByTeam = new Map<string, PreparedLineup>();
  const rostersByTeam = new Map<string, PlayerMeta[]>();
  const observations: SimSortObservation[] = [];

  for (let overall = 1; overall <= BACKTEST_TEAMS * BACKTEST_ROUNDS; overall += 1) {
    const slotOf = slotForOverall('snake', BACKTEST_TEAMS, overall);
    const teamId = ctx.slotToTeam[slotOf]!;
    const round = Math.ceil(overall / BACKTEST_TEAMS);
    let player: PlayerMeta;
    if (slotOf === slot) {
      const result = evaluateSubjectTurn(ctx, overall, picks, myTeamId, draftId);
      const choice = simSortChoice(result, ctx.playersById);
      observations.push(buildObservation(ctx, slot, seedIndex, overall, round, result, choice));
      const enginePlayer = ctx.playersById.get(result.recommendations[0]!.playerId);
      if (!enginePlayer) throw new Error(`simsort probe: unknown engine pick ${result.recommendations[0]!.playerId} at overall ${overall}`);
      player = enginePlayer;
    } else {
      player = pickOpponent(ctx, teamId, overall, picks, preparedByTeam, rostersByTeam, seed);
    }
    picks.push({
      overall, round, slot: slotOf, teamId,
      playerId: player.playerId,
      providerPlayerId: player.playerId,
      providerPlayerName: player.name,
    });
  }
  return observations;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface RoundBand {
  label: string;
  minRound: number;
  maxRound: number;
}

export const SIM_SORT_ROUND_BANDS: readonly RoundBand[] = [
  { label: '1-3', minRound: 1, maxRound: 3 },
  { label: '4-8', minRound: 4, maxRound: 8 },
  { label: '9-12', minRound: 9, maxRound: 12 },
  { label: '13-16', minRound: 13, maxRound: 16 },
];

export interface DisagreementBucket {
  picks: number;
  disagreements: number;
  disagreementRate: number;
  meanDeltaRank: number;
  meanSpearman: number | null;
}

function summarize(observations: readonly SimSortObservation[]): DisagreementBucket {
  const picks = observations.length;
  const disagreements = observations.filter((o) => !o.agree).length;
  const deltaRanks = observations.map((o) => o.deltaRank).filter((v): v is number => v != null);
  const spearmans = observations.map((o) => o.spearman).filter((v): v is number => v != null);
  return {
    picks,
    disagreements,
    disagreementRate: picks ? disagreements / picks : 0,
    meanDeltaRank: deltaRanks.length ? deltaRanks.reduce((a, b) => a + b, 0) / deltaRanks.length : 0,
    meanSpearman: spearmans.length ? spearmans.reduce((a, b) => a + b, 0) / spearmans.length : null,
  };
}

export interface SimSortProbeReport {
  overall: DisagreementBucket;
  byRoundBand: { band: RoundBand; bucket: DisagreementBucket }[];
  noAdpCoverage: DisagreementBucket;
  basisCounts: Record<SimSortChoice['basis'], number>;
  totalObservations: number;
}

/** Pre-declared decision rule (see `DECISIONS.md`): build the C1 backtest arm only if this reports
 * material disagreement. `simulatedCandidateLimit`/`round`-derived buckets, not a single number,
 * because a flat aggregate can hide late-round-only disagreement. */
export function summarizeSimSortProbe(observations: readonly SimSortObservation[]): SimSortProbeReport {
  const byRoundBand = SIM_SORT_ROUND_BANDS.map((band) => ({
    band,
    bucket: summarize(observations.filter((o) => o.round >= band.minRound && o.round <= band.maxRound)),
  }));
  const noAdpCoverage = summarize(observations.filter((o) => !o.enginePickHasAdp || !o.simPickHasAdp));
  const basisCounts: Record<SimSortChoice['basis'], number> = {
    lookahead: 0, 'special-teams-deferred': 0, 'no-lookahead': 0,
  };
  for (const o of observations) basisCounts[o.basis] += 1;
  return {
    overall: summarize(observations),
    byRoundBand,
    noAdpCoverage,
    basisCounts,
    totalObservations: observations.length,
  };
}

/** Pre-declared gate (`DECISIONS.md`): build the C1 arm if ANY threshold is met. Kept as a pure
 * function of the summary so the threshold values are visible in one place and testable. */
export const SIM_SORT_BUILD_ARM_THRESHOLDS = {
  overallTop1DisagreementRate: 0.05,
  roundBandDisagreementRate: 0.10,
  noAdpCoverageDisagreementRate: 0.10,
} as const;

export function shouldBuildSimSortArm(report: SimSortProbeReport): boolean {
  if (report.overall.disagreementRate >= SIM_SORT_BUILD_ARM_THRESHOLDS.overallTop1DisagreementRate) return true;
  if (report.byRoundBand.some(({ bucket }) =>
    bucket.disagreementRate >= SIM_SORT_BUILD_ARM_THRESHOLDS.roundBandDisagreementRate)) return true;
  if (report.noAdpCoverage.disagreementRate >= SIM_SORT_BUILD_ARM_THRESHOLDS.noAdpCoverageDisagreementRate) return true;
  return false;
}
