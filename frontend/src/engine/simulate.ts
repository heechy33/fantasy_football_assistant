import type { AdpEntry, DraftType, LeagueSettings, PlayerId, PlayerMeta, Pick } from '../../../shared/types';
import { canonicalPicksSignature, computeOnTheClock } from '../adapters/draftOrder';
import { addPlayerToLineup, prepareLineup, type PreparedLineup } from './eligibility';
import { buildOpponentPool, computeScenarioPriorities, needBonusFromLineup, pickForTeam, type OpponentModelConfig, type PriorityEntry } from './opponentModel';
import { comparePlayersByScoreDesc } from './ranking';
import { createRng, deriveStream, hashStateSeed, type Seed } from './rng';

/**
 * S3's rollout engine: VONA via seeded opponent-pick simulation to the user's next turn
 * (PLAN.md §6/§7). Pure and Node-testable — no worker, no React; Stage C wires this into
 * `recommend.ts`'s output.
 *
 * `candidates` here is Stage C's display-independent rollout pool: the deterministic global top
 * unioned with per-position extensions. `recommend.ts` computes it without importing this module,
 * which keeps the simulation core independently testable. `selectCandidates`'s per-eligibility-
 * group prefilter is not itself the simulation pool: its loss-free proof rests on
 * `replacementAdjustedValue` monotonicity within a group, a property that does not extend to the
 * lookahead value this module computes.
 */

export interface ExecutionMode {
  mode: 'fixed' | 'budgeted';
  /** 'fixed': run exactly this many scenarios, no wall-clock check — byte-identical payload
   * except for the inherently measured `diagnostics.elapsedMs`. 'budgeted': this is the ceiling,
   * not a guarantee. */
  scenarios: number;
  /** Only meaningful in 'budgeted' mode. */
  timeBudgetMs?: number;
  /** How many scenarios run before each wall-clock check in 'budgeted' mode. */
  batchSize?: number;
}

export interface SimulationInput {
  settings: LeagueSettings;
  draftType: DraftType;
  teams: number;
  rounds: number;
  slotToTeam: Record<number, string>;
  draftId: string;
  myTeamId: string;
  /** The user's current roster (matched picks only). */
  myRoster: readonly PlayerMeta[];
  /** Projected points for every player this call could touch: `myRoster`, `candidates`, and every
   * entry in `remainingPlayers` (which itself should include `candidates` — see below). */
  scores: ReadonlyMap<PlayerId, number>;
  /** The pre-selected shortlist to rank — see this module's header. */
  candidates: readonly PlayerMeta[];
  /** The full undrafted, scored pool: feeds both the opponent-draftable pool and the follow-up
   * survivor scan. `syntheticAdpCount`/`unscoredPositionCount` in the result are scoped to exactly
   * this set, not any static dataset-wide figure — pass the board's actual current pool. */
  remainingPlayers: readonly PlayerMeta[];
  adp: readonly AdpEntry[];
  /** Full historical picks (used to reconstruct each opponent team's current roster). */
  picks: readonly Pick[];
  /** Full player universe, so an opponent's historical pick (drafted, not in `remainingPlayers`)
   * can still be resolved to a `PlayerMeta` for roster reconstruction. */
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  /** The user's next actual selection — see `adapters/draftOrder.ts`'s `userPickBoundaries`. Never
   * assigned to a simulated opponent pick. */
  decisionPick: number;
  /** The user's selection after that, or `null` if the draft ends first. */
  followUpPick: number | null;
  opponentConfig: OpponentModelConfig;
  executionMode: ExecutionMode;
  /** Injectable clock for 'budgeted' mode; defaults to `Date.now`. */
  now?: () => number;
  /** Caller-supplied `buildTeamRosters` result, bypassing that call inside `runSimulation`. Every
   * team's dedicated-slot solve there is a full exact re-solve (~33ms on a 15-man roster; 12 teams
   * ≈ 250-500ms measured on real committed data), yet is otherwise recomputed from scratch on every
   * call even though only one pick usually changed since the last one during a live draft.
   * `recommend.ts` maintains a persistent, incrementally-updated cache across calls and passes it
   * here; direct callers (tests) omit this and get the original from-scratch behavior, so
   * `runSimulation` stays pure and independently testable either way. */
  precomputedTeamRosters?: ReadonlyMap<string, PreparedLineup>;
}

export interface CandidateSimulationResult {
  playerId: PlayerId;
  /** mean_s V(roster + c + followUp_s) — the sort key Stage C ranks candidates by. Raw, not
   * baseline-adjusted, so ordering doesn't depend on how the baseline happens to be defined. */
  expectedFinalStarterValue: number;
  /** expectedFinalStarterValue - commonBaseline. Candidate-independent subtrahend, so this
   * preserves whatever ordering expectedFinalStarterValue already has. */
  lookaheadValue: number;
  /** MRV(c) - mean_s[best MRV among survivors | current roster] — PLAN.md §6's literal VONA.
   * Display/explanation only, never the sort key. */
  vona: number;
  /** Nearest-rank 10th percentile of (V_s(c) - commonBaseline) — same scale as lookaheadValue. */
  downside: number;
  /** Fraction of scenarios in which `c` was not drafted by a simulated opponent during the window. */
  simulatedSurvivalProbability: number;
}

export interface SimulationDiagnostics {
  scenariosRun: number;
  timedOut: boolean;
  elapsedMs: number;
  /** Scoped to `remainingPlayers` as passed to *this* call — see `SimulationInput`'s doc. */
  syntheticAdpCount: number;
  /** Scored players excluded from opponent sampling because `position === null`. */
  unscoredPositionCount: number;
}

export interface SimulationResult {
  diagnostics: SimulationDiagnostics;
  /** First-occurrence order from `input.candidates`; duplicate player IDs are coalesced. */
  candidates: CandidateSimulationResult[];
}

/** Establish the fixed on-clock team sequence once for a rollout window. A missing slot mapping is
 * malformed draft state, not the same thing as a completed draft: fail loudly rather than quietly
 * simulating only part of the user’s wait window. */
export function buildOpponentWindowSchedule(
  draftType: DraftType,
  teams: number,
  rounds: number,
  slotToTeam: Record<number, string>,
  windowStart: number,
  windowEnd: number,
): string[] {
  const teamIds: string[] = [];
  for (let overall = windowStart; overall <= windowEnd; overall += 1) {
    const onClock = computeOnTheClock(draftType, teams, rounds, overall - 1, slotToTeam);
    if (onClock) {
      teamIds.push(onClock.teamId);
      continue;
    }
    if (overall <= teams * rounds) {
      throw new Error(`Cannot simulate pick ${overall}: missing or unsupported draft-order mapping`);
    }
    break;
  }
  return teamIds;
}

function nearestRankQuantile(ascendingSorted: readonly number[], fraction: number): number {
  if (ascendingSorted.length === 0) return 0;
  const index = Math.max(1, Math.ceil(fraction * ascendingSorted.length));
  return ascendingSorted[Math.min(index, ascendingSorted.length) - 1] ?? 0;
}

/** Groups historical picks by team into `PreparedLineup`s as of right before `decisionPick`.
 * Unmatched picks (`playerId === null`) are excluded — they consume a bench spot in reality, but
 * have no known position, so they must not be guessed at (see `opponentModel.ts`'s `needBonusFromLineup`). */
export function buildTeamRosters(
  settings: LeagueSettings,
  picks: readonly Pick[],
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
  scores: ReadonlyMap<PlayerId, number>,
  decisionPick: number,
): Map<string, PreparedLineup> {
  const rosterPlayersByTeam = new Map<string, PlayerMeta[]>();
  for (const pick of picks) {
    if (pick.overall >= decisionPick || pick.playerId == null) continue;
    const meta = playersById.get(pick.playerId);
    if (!meta) continue;
    const list = rosterPlayersByTeam.get(pick.teamId);
    if (list) list.push(meta);
    else rosterPlayersByTeam.set(pick.teamId, [meta]);
  }
  const result = new Map<string, PreparedLineup>();
  for (const [teamId, players] of rosterPlayersByTeam) {
    const points = new Map(players.map((p) => [p.playerId, scores.get(p.playerId) ?? 0]));
    result.set(teamId, prepareLineup(settings, players, points));
  }
  return result;
}

function emptyTeamRoster(settings: LeagueSettings): PreparedLineup {
  return prepareLineup(settings, [], new Map());
}

/** Simulates opponent picks over `[windowStart, windowEnd]` (inclusive), starting from
 * `baseTeamRosters` and treating everyone in `initiallyDrafted` as already gone (e.g. the forced
 * candidate in a per-candidate rollout). Reuses `priorities` (this scenario's shocked order)
 * unchanged — the cascade differs only because availability differs, never because the noise does
 * (common random numbers). Returns the full drafted set after the window.
 *
 * Exported (alongside `bestFollowUpValue` and `buildTeamRosters` below) for direct, precise unit
 * testing of the window-boundary arithmetic — `runSimulation` only exposes aggregated results,
 * which can't isolate an off-by-one at the window edges from noise elsewhere in the pipeline. */
export function simulateOpponentWindow(
  settings: LeagueSettings,
  draftType: DraftType,
  teams: number,
  rounds: number,
  slotToTeam: Record<number, string>,
  windowStart: number,
  windowEnd: number,
  baseTeamRosters: ReadonlyMap<string, PreparedLineup>,
  scores: ReadonlyMap<PlayerId, number>,
  playersById: ReadonlyMap<PlayerId, PlayerMeta>,
  priorities: readonly PriorityEntry[],
  initiallyDrafted: ReadonlySet<PlayerId>,
  config: OpponentModelConfig,
  onClockTeamIds?: readonly string[],
): Set<PlayerId> {
  const drafted = new Set(initiallyDrafted);
  if (windowStart > windowEnd) return drafted;
  const teamRosters = new Map(baseTeamRosters);
  const schedule = onClockTeamIds ?? buildOpponentWindowSchedule(draftType, teams, rounds, slotToTeam, windowStart, windowEnd);
  if (schedule.length !== Math.max(0, windowEnd - windowStart + 1)) {
    throw new Error('Opponent window schedule does not cover the requested pick range');
  }
  for (const teamId of schedule) {
    const prepared = teamRosters.get(teamId) ?? emptyTeamRoster(settings);
    const need = needBonusFromLineup(prepared, config);
    const picked = pickForTeam(priorities, drafted, need, config.candidateWindow);
    if (picked == null) break; // opponent-draftable pool exhausted
    drafted.add(picked);
    const pickedMeta = playersById.get(picked);
    if (pickedMeta) {
      const points = scores.get(picked) ?? 0;
      // false: only needBonusFromLineup's per-dedicated-slot filled/empty count reads this state —
      // never occupant identity — so the exact-tie re-solve is pure overhead here (eligibility.ts's
      // addPlayerToLineup doc explains the value-invariance this relies on).
      teamRosters.set(teamId, addPlayerToLineup(prepared, pickedMeta, points, false).state);
    }
  }
  return drafted;
}

/** Exact branch-and-bound best follow-up: `V(R+f) - V(R) <= points(f)` (deleting `f` from the
 * optimal assignment of `R+f` is a legal assignment of `R`), so scanning survivors by points
 * descending and stopping once `points(f) <= bestValueSoFar` cannot miss a better option — anyone
 * later in the (points-descending) order has an even lower ceiling. `bestValueSoFar` starts at `0`,
 * i.e. "take no follow-up" is the default and wins outright whenever no survivor offers a positive
 * gain (an empty survivor set degenerates to this automatically, no special case needed). */
export function bestFollowUpValue(
  base: PreparedLineup,
  survivorScanOrder: readonly PlayerMeta[],
  scores: ReadonlyMap<PlayerId, number>,
  drafted: ReadonlySet<PlayerId>,
  excludePlayerId: PlayerId | null,
): number {
  let best = 0;
  for (const candidate of survivorScanOrder) {
    if (candidate.playerId === excludePlayerId || drafted.has(candidate.playerId)) continue;
    const points = scores.get(candidate.playerId) ?? 0;
    if (points <= best) break; // bound: no remaining (lower-points) survivor can beat `best` either
    // false: this scan only ever reads .result.value (never .state/.addedPlayerSlot), and it never
    // chains this call's result into anything else — the exact-tie identity re-solve buys nothing
    // here and was the dominant cost of a Stage C rollout (see eligibility.ts's doc).
    const gain = addPlayerToLineup(base, candidate, points, false).result.value - base.value;
    if (gain > best) best = gain;
  }
  return best;
}

export function runSimulation(input: SimulationInput): SimulationResult {
  // Defensive boundary: aggregate maps are keyed by player ID, so treating duplicate shortlist
  // rows as separate candidates would double-count a player while returning incoherent results.
  // Keep the first occurrence to preserve the caller’s deterministic ordering.
  const seenCandidateIds = new Set<PlayerId>();
  const candidates = input.candidates.filter((candidate) => {
    if (seenCandidateIds.has(candidate.playerId)) return false;
    seenCandidateIds.add(candidate.playerId);
    return true;
  });
  const rosterPoints = new Map(input.myRoster.map((p) => [p.playerId, input.scores.get(p.playerId) ?? 0]));
  const preparedRoster = prepareLineup(input.settings, [...input.myRoster], rosterPoints);
  const commonBaseline = preparedRoster.value;

  const observedScoredPlayers = [...input.playersById.values()].filter((player) => input.scores.has(player.playerId));
  const pool = buildOpponentPool(input.remainingPlayers, input.scores, input.adp, input.opponentConfig, observedScoredPlayers);

  // Deterministic per-candidate MRV never depends on scenarios — compute once. `false`: every
  // consumer of this map (below, and in the followUpPick === null branch) reads only
  // `.result.value`, directly or via `bestFollowUpValue` (itself value-only) — never occupant
  // identity — so the exact-tie re-solve is pure overhead (see eligibility.ts's doc).
  const afterCandidate = new Map(candidates.map((c) => [
    c.playerId,
    addPlayerToLineup(preparedRoster, c, input.scores.get(c.playerId) ?? 0, false),
  ]));

  // followUpPick === null: no second pick exists at all. No opponent randomness to model, no
  // baseline to compare against — every candidate's lookahead collapses to its deterministic MRV.
  if (input.followUpPick == null) {
    const results = candidates.map((c): CandidateSimulationResult => {
      const after = afterCandidate.get(c.playerId)!;
      const mrv = after.result.value - commonBaseline;
      return {
        playerId: c.playerId,
        expectedFinalStarterValue: after.result.value,
        lookaheadValue: mrv,
        vona: mrv,
        downside: mrv,
        simulatedSurvivalProbability: 1,
      };
    });
    return {
      diagnostics: {
        scenariosRun: 0, timedOut: false, elapsedMs: 0,
        syntheticAdpCount: pool.syntheticAdpCount, unscoredPositionCount: pool.unscoredPositionCount,
      },
      candidates: results,
    };
  }

  const baseTeamRosters = input.precomputedTeamRosters
    ?? buildTeamRosters(input.settings, input.picks, input.playersById, input.scores, input.decisionPick);
  const windowStart = input.decisionPick + 1;
  const windowEnd = input.followUpPick - 1;
  const opponentWindowSchedule = buildOpponentWindowSchedule(
    input.draftType, input.teams, input.rounds, input.slotToTeam, windowStart, windowEnd,
  );

  const baseSeed: Seed = hashStateSeed([input.draftId, input.myTeamId, String(input.decisionPick), canonicalPicksSignature(input.picks)]);

  // VONA’s subtrahend is the *best available option*, not merely the best player from the display
  // shortlist. Restrict to the complete opponent-draftable pool so this exactly matches PLAN §6.
  const remainingById = new Map(input.remainingPlayers.map((player) => [player.playerId, player]));
  const survivorScanOrder = pool.entries
    .map((entry) => remainingById.get(entry.playerId))
    .filter((player): player is PlayerMeta => player != null)
    .sort(comparePlayersByScoreDesc(input.scores));

  const survivalCount = new Map<PlayerId, number>(candidates.map((c) => [c.playerId, 0]));
  const perCandidateFinalValues = new Map<PlayerId, number[]>(candidates.map((c) => [c.playerId, []]));
  let bestSurvivorMrvSum = 0;

  const now = input.now ?? Date.now;
  const startedAt = now();
  const maxScenarios = input.executionMode.scenarios;
  const batchSize = input.executionMode.batchSize ?? 25;
  let scenariosRun = 0;
  let timedOut = false;

  outer: while (scenariosRun < maxScenarios) {
    const thisBatch = Math.min(batchSize, maxScenarios - scenariosRun);
    for (let i = 0; i < thisBatch; i += 1) {
      const scenarioIndex = scenariosRun; // prefix property: index is absolute, not batch-relative
      const rng = createRng(deriveStream(baseSeed, scenarioIndex));
      const priorities = computeScenarioPriorities(pool, rng, input.opponentConfig);

      // Baseline: the user takes nobody at decisionPick (no-op — decisionPick itself is never
      // simulated), then opponents run over the window only.
      const baselineDrafted = simulateOpponentWindow(
        input.settings, input.draftType, input.teams, input.rounds, input.slotToTeam,
        windowStart, windowEnd, baseTeamRosters, input.scores, input.playersById,
        priorities, new Set(), input.opponentConfig, opponentWindowSchedule,
      );
      const bestSurvivorMrvThisScenario = bestFollowUpValue(
        preparedRoster, survivorScanOrder, input.scores, baselineDrafted, null,
      );
      for (const c of candidates) {
        if (baselineDrafted.has(c.playerId)) continue;
        survivalCount.set(c.playerId, (survivalCount.get(c.playerId) ?? 0) + 1);
      }
      bestSurvivorMrvSum += bestSurvivorMrvThisScenario;

      // Per candidate: force c at decisionPick, replay this scenario's shocks over the same
      // window — the cascade differs only because c is unavailable to opponents this time.
      for (const c of candidates) {
        const after = afterCandidate.get(c.playerId)!;
        const candidateDrafted = simulateOpponentWindow(
          input.settings, input.draftType, input.teams, input.rounds, input.slotToTeam,
          windowStart, windowEnd, baseTeamRosters, input.scores, input.playersById,
          priorities, new Set([c.playerId]), input.opponentConfig, opponentWindowSchedule,
        );
        const followUp = bestFollowUpValue(after.state, survivorScanOrder, input.scores, candidateDrafted, c.playerId);
        perCandidateFinalValues.get(c.playerId)!.push(after.result.value + followUp);
      }

      scenariosRun += 1;
    }

    if (input.executionMode.mode === 'fixed') continue;
    const budget = input.executionMode.timeBudgetMs ?? Infinity;
    if (now() - startedAt >= budget) {
      timedOut = scenariosRun < maxScenarios;
      break outer;
    }
  }

  const elapsedMs = now() - startedAt;
  const vonaSubtrahend = scenariosRun > 0 ? bestSurvivorMrvSum / scenariosRun : 0;

  const results = candidates.map((c): CandidateSimulationResult => {
    const after = afterCandidate.get(c.playerId)!;
    const mrv = after.result.value - commonBaseline;
    const values = perCandidateFinalValues.get(c.playerId) ?? [];
    const expectedFinalStarterValue = values.length ? values.reduce((a, b) => a + b, 0) / values.length : after.result.value;
    const sortedRelative = values.map((v) => v - commonBaseline).sort((a, b) => a - b);
    return {
      playerId: c.playerId,
      expectedFinalStarterValue,
      lookaheadValue: expectedFinalStarterValue - commonBaseline,
      vona: mrv - vonaSubtrahend,
      downside: sortedRelative.length ? nearestRankQuantile(sortedRelative, 0.10) : mrv,
      simulatedSurvivalProbability: scenariosRun > 0 ? (survivalCount.get(c.playerId) ?? 0) / scenariosRun : 1,
    };
  });

  return {
    diagnostics: {
      scenariosRun, timedOut, elapsedMs,
      syntheticAdpCount: pool.syntheticAdpCount, unscoredPositionCount: pool.unscoredPositionCount,
    },
    candidates: results,
  };
}
