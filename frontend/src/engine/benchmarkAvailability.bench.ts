import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AdpEntry,
  DataManifest,
  PlayerId,
  PlayerMeta,
  Position,
  SeasonProjection,
  SleeperCred,
} from '../../../shared/types';
import { userPickBoundaries } from '../adapters/draftOrder';
import { sleeperAdapter } from '../adapters/sleeper';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';
import { estimateAvailability } from './availability';
import { addPlayerToLineup, prepareLineup, rosterUtility } from './eligibility';
import { comparePlayersByScoreDesc } from './ranking';
import { replacementPointsByPosition } from './replacement';
import {
  buildRecommendationBoard,
  clearSimulationCache,
  DEFAULT_SCENARIOS,
  followUpShortlistLimits,
  type Recommendation,
} from './recommend';
import { scoreProjection } from './scoring';
import { bestFollowUpValue } from './simulate';

/**
 * Availability/VONA calibration harness (PLAN.md S6 gate B, evaluation layer B) — scores
 * `availableNextPickProbability` (analytic ADP model), `simulatedSurvivalProbability` (Stage C
 * Monte Carlo), and `vona`/`lookaheadValue` against nine real, completed, recorded Sleeper mock
 * drafts (10- and 12-team PPR snake, single human participant, `fixtures/sleeper/recorded/<draftId>/`;
 * capture with `npm run fetch:sleeper-mock -- <draftId>`).
 *
 * Opt-in only, gated exactly like `recommendPerformance.test.ts`'s `STAGE_C_BENCH` block — run
 * with `npm run benchmark:availability` (root `package.json`), never as part of `npm test`. This is
 * based on nine recorded drafts, within the plan's 5-10-draft directional-report target. It remains
 * a calibration sample rather than a historical draft-strategy backtest; extending it is a one-line
 * change: add a captured draft ID to RECORDED_DRAFT_IDS below and rerun.
 *
 * Four corrections baked into this design (see the plan this file implements for the full
 * derivation against `simulate.ts`/`recommend.ts`):
 *   1. The opponent-attrition window is `(currentPick, followUpPick)`, open on both ends —
 *      `simulate.ts`'s own `windowStart`/`windowEnd` mean "survived through followUpPick - 1," not
 *      through `followUpPick` itself.
 *   2. The user's own two real picks at `currentPick`/`followUpPick` never enter the scored
 *      candidate or opponent-attrition sets — the open-open window already excludes both real
 *      overalls automatically (nobody else occupies them in a snake draft), and the row matching
 *      the user's actual `currentPick` selection is explicitly excluded from the scored candidates.
 *   3. VONA and lookahead get two different oracles (`oracleBaselineFollowUp` — "take nobody" — vs.
 *      per-candidate `oracleFollowUp` — "take c"), mirroring `simulate.ts`'s `vonaSubtrahend` vs.
 *      per-candidate `bestFollowUpValue`, and are reported as separate tables — never collapsed
 *      into one oracle.
 *   4. `buildRecommendationBoard`'s `includeAnalysisRows` opt-in (this module's only production
 *      code dependency, see `recommend.ts`) exposes the full pre-slice deterministic/simulated
 *      pools without inflating `rolloutLimit` the way a bigger `limit` would.
 *
 * Ground-truth integrity: opponent picks in the attrition window with `playerId: null` (Sleeper
 * crosswalk miss) are invisible to `realWindowDrafted` and would silently flip `actualSurvived`.
 * Each `DecisionPointLog` records `unmatchedWindowPickCount`/`unmatchedWindowPickOveralls`, and the
 * harness asserts the pooled count is zero after writing the report.
 */

const RECORDED_DRAFT_IDS = [
  '1392688856670687232',
  '1391308704153874432',
  '1392730676591087616',
  '1392730609540935680',
  '1392732613948473344',
  '1392732908569001984',
  '1392733045735329792',
  '1392733148135043072',
  '1392735522555703296',
] as const;

/** The single human `draft_order` participant shared by both recorded drafts (verified against
 * each draft's raw `draft.json` at capture time — every other slot is a bot autopick). */
const HUMAN_SLEEPER_USER_ID = '1136796957760483328';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = join(repoRoot, 'data');
const fixturesDir = join(repoRoot, 'fixtures', 'sleeper', 'recorded');
const reportsDir = join(repoRoot, 'benchmarks', 'reports');

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function eligibilityGroupKey(player: PlayerMeta): string {
  const position = player.position ?? '';
  const eligible = player.eligiblePositions.length ? player.eligiblePositions : position ? [position] : [];
  return `${position}|${[...eligible].sort().join(',')}`;
}

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}

/** Stubs `fetch` exactly like `sleeper.test.ts` does, but serving the real committed
 * `data/players.json` (so the crosswalk this harness scores against is the same one production
 * uses) and this specific draft's recorded raw capture. */
function installFetchMock(players: PlayerMeta[], rawDraft: unknown, rawPicks: unknown, draftId: string) {
  const mock = vi.fn((input: string) => {
    const url = String(input);
    if (url === '/data/players.json') return jsonResponse(players);
    if (url.endsWith(`/draft/${draftId}/picks`)) return jsonResponse(rawPicks);
    if (url.endsWith(`/draft/${draftId}`)) return jsonResponse(rawDraft);
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

// ---------------------------------------------------------------------------
// Per-candidate scored record
// ---------------------------------------------------------------------------

interface CandidateRecord {
  draftId: string;
  decisionPick: number;
  followUpPick: number;
  round: number;
  playerId: PlayerId;
  position: Position | null;
  recommendationMode: Recommendation['recommendationMode'];
  adp: number | null;
  rawProjection: number;
  staticVor: number;
  deterministicS2: number;
  /** Ground truth: not drafted by an opponent anywhere in `(decisionPick, followUpPick)`. */
  actualSurvived: boolean;
  predictedAvailable: number | null;
  unconditionalProbability: number | null;
  simulatedSurvival: number | null;
  cohort: 'analytic-only' | 'analytic+simulated';
  oracleVona: number;
  oracleLookahead: number;
  engineVona: number | null;
  engineLookahead: number | null;
  marginalRosterUtility: number;
  enginePlanValue: number;
  oraclePlanValue: number;
}

interface PlanDecisionRecord {
  draftId: string;
  decisionPick: number;
  followUpPick: number;
  openCoreSlots: number;
  cohort: 'one-hole' | 'zero-hole' | 'other';
  engineTopPlayerId: PlayerId;
  oracleTopPlayerId: PlayerId;
  engineRegret: number;
  deterministicS2Regret: number;
  adpRegret: number;
  projectionRegret: number;
  targetPlayers: Record<string, {
    planValue: number;
    marginalRosterUtility: number;
    expectedFollowUpValue: number;
    vona: number | null;
    availability: number | null;
  }>;
}

interface DecisionPointLog {
  draftId: string;
  decisionPick: number;
  followUpPick: number | null;
  scoredCandidates: number;
  deterministicCandidateCount: number;
  simulatedCandidateCount: number;
  rolloutPoolSize: number;
  /**
   * Opponent picks in the open-open attrition window `(decisionPick, followUpPick)` whose
   * Sleeper→internal crosswalk returned `playerId: null`. These are invisible to
   * `realWindowDrafted`, so any candidate row for that real drafted player gets a false
   * `actualSurvived: true` and corrupts Brier / VONA / lookahead oracles for that row.
   * Surfaced here (and asserted zero at the end of the harness) so extending
   * `RECORDED_DRAFT_IDS` cannot silently ship wrong calibration numbers.
   */
  unmatchedWindowPickCount: number;
  unmatchedWindowPickOveralls: number[];
  skippedReason?: string;
}

// ---------------------------------------------------------------------------
// Per-draft replay
// ---------------------------------------------------------------------------

async function replayDraft(
  draftId: string,
  players: PlayerMeta[],
  projections: SeasonProjection[],
  adp: AdpEntry[],
): Promise<{ candidates: CandidateRecord[]; decisionPoints: DecisionPointLog[]; planDecisions: PlanDecisionRecord[] }> {
  const rawDraft = loadJson<unknown>(join(fixturesDir, draftId, 'draft.json'));
  const rawPicks = loadJson<unknown>(join(fixturesDir, draftId, 'picks.json'));
  __resetPlayerPoolCache();
  installFetchMock(players, rawDraft, rawPicks, draftId);

  const cred: SleeperCred = { provider: 'sleeper', userId: HUMAN_SLEEPER_USER_ID };
  const init = await sleeperAdapter.init(cred, draftId);
  const draftPicks = await sleeperAdapter.picks(cred, draftId);
  const picks = draftPicks.picks;
  const myTeamId = init.myTeamId;
  if (myTeamId == null) throw new Error(`draft ${draftId}: sleeperAdapter.init could not resolve myTeamId`);

  const playersById = new Map(players.map((p) => [p.playerId, p]));
  const projectionById = new Map(projections.map((p) => [p.playerId, p]));
  const scores = new Map<PlayerId, number>();
  for (const [id, projection] of projectionById) {
    scores.set(id, scoreProjection(projection, init.settings, playersById.get(id)?.position).points);
  }
  const adpById = new Map(adp.filter((e): e is AdpEntry & { playerId: PlayerId } => e.playerId != null).map((e) => [e.playerId, e]));

  const candidates: CandidateRecord[] = [];
  const decisionPoints: DecisionPointLog[] = [];
  const planDecisions: PlanDecisionRecord[] = [];

  for (let k = 0; k < picks.length; k += 1) {
    const pick = picks[k] as (typeof picks)[number];
    if (pick.teamId !== myTeamId) continue;

    const boundaries = userPickBoundaries(init.draftType, init.teams, init.rounds, k, init.slotToTeam, myTeamId);
    const { decisionPick, followUpPick } = boundaries;
    if (decisionPick == null || decisionPick !== pick.overall) {
      throw new Error(`draft ${draftId}: pick index ${k} boundary mismatch (pick.overall=${pick.overall}, decisionPick=${String(decisionPick)})`);
    }

    // Attrition window (corrections 1+2): open-open `(decisionPick, followUpPick)`. Count
    // crosswalk misses *before* filtering them out of the drafted set — a miss makes the real
    // drafted player invisible to `actualSurvived` / the VONA oracle (see DecisionPointLog doc).
    const windowPicks = followUpPick == null
      ? []
      : picks.filter((p) => p.overall > decisionPick && p.overall < followUpPick);
    const unmatchedWindowPicks = windowPicks.filter((p) => p.playerId == null);
    const unmatchedWindowPickCount = unmatchedWindowPicks.length;
    const unmatchedWindowPickOveralls = unmatchedWindowPicks.map((p) => p.overall);

    if (pick.playerId == null) {
      decisionPoints.push({
        draftId, decisionPick, followUpPick,
        scoredCandidates: 0, deterministicCandidateCount: 0, simulatedCandidateCount: 0, rolloutPoolSize: 0,
        unmatchedWindowPickCount, unmatchedWindowPickOveralls,
        skippedReason: 'self-pick unmatched by the crosswalk (playerId null) — cannot exclude it from candidates',
      });
      continue;
    }
    if (followUpPick == null) {
      decisionPoints.push({
        draftId, decisionPick, followUpPick: null,
        scoredCandidates: 0, deterministicCandidateCount: 0, simulatedCandidateCount: 0, rolloutPoolSize: 0,
        unmatchedWindowPickCount: 0, unmatchedWindowPickOveralls: [],
        skippedReason: 'final pick of the draft, no follow-up — deterministic MRV collapse, nothing to score',
      });
      continue;
    }

    const picksSoFar = picks.slice(0, k);
    clearSimulationCache();
    const board = buildRecommendationBoard({
      settings: init.settings, players, projections, adp, picks: picksSoFar,
      myTeamId, nextPick: followUpPick, currentPick: decisionPick, limit: 5,
      draftRounds: init.rounds, rosterSpotsPerTeam: init.rounds,
      simulation: {
        draftId, draftType: init.draftType, teams: init.teams, rounds: init.rounds, slotToTeam: init.slotToTeam,
        decisionPick, followUpPick, executionMode: { mode: 'fixed', scenarios: DEFAULT_SCENARIOS },
      },
      includeAnalysisRows: true,
    });
    const analysis = board.analysis;
    if (!analysis) {
      decisionPoints.push({
        draftId, decisionPick, followUpPick,
        scoredCandidates: 0, deterministicCandidateCount: 0, simulatedCandidateCount: 0, rolloutPoolSize: 0,
        unmatchedWindowPickCount, unmatchedWindowPickOveralls,
        skippedReason: 'Stage C did not run for this decision point (off-clock or zero-scenario fallback)',
      });
      continue;
    }

    // Corrections 1+2: open-open window, opponents only (nobody but the user occupies overall
    // `decisionPick` or `followUpPick` in a single-human-participant snake draft, so this excludes
    // both real user picks automatically). Crosswalk misses are counted above and asserted zero
    // after the report write — they cannot contribute to this set.
    const realWindowDrafted = new Set(
      windowPicks
        .filter((p): p is typeof p & { playerId: PlayerId } => p.playerId != null)
        .map((p) => p.playerId),
    );

    const simulatedIds = new Set(
      analysis.simulatedRows.filter((r) => r.simulatedSurvivalProbability != null).map((r) => r.playerId),
    );

    // Correction 3's oracle setup — the harness's own independent reconstruction (not
    // recommend.ts's internal state), so scoring the engine against it is a real check.
    const myRosterIds = picksSoFar.filter((p) => p.teamId === myTeamId && p.playerId != null).map((p) => p.playerId as PlayerId);
    const myRoster = myRosterIds.map((id) => playersById.get(id)).filter((p): p is PlayerMeta => p != null);
    const rosterPoints = new Map(myRoster.map((p) => [p.playerId, scores.get(p.playerId) ?? 0]));
    const preparedRoster = prepareLineup(init.settings, myRoster, rosterPoints);
    const commonBaseline = preparedRoster.value;
    const replacementPoints = replacementPointsByPosition(board.diagnostics.replacementLevels);
    const availabilityData: ReadonlyMap<PlayerId, number> = new Map();
    const commonRosterUtility = rosterUtility(preparedRoster, replacementPoints, availabilityData).total;
    const openCoreSlots = preparedRoster.slots.filter((slot, index) =>
      slot !== 'K' && slot !== 'DEF' && preparedRoster.occupantBySlot[index] == null).length;
    const followUpLimits = followUpShortlistLimits(openCoreSlots);

    const draftedSoFar = new Set(picksSoFar.filter((p) => p.playerId != null).map((p) => p.playerId as PlayerId));
    const realSurvivors = players
      .filter((p) => !draftedSoFar.has(p.playerId) && scores.has(p.playerId))
      .sort(comparePlayersByScoreDesc(scores));

    const roundOfDecision = Math.ceil(decisionPick / init.teams);

    const planRows = analysis.simulatedRows.filter((row) => {
      const position = playersById.get(row.playerId)?.position;
      return position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE';
    });
    const followUpIds = new Set(
      [...analysis.deterministicRows]
        .filter((row) => {
          const position = playersById.get(row.playerId)?.position;
          return position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE';
        })
        .sort((a, b) => b.marginalRosterUtility - a.marginalRosterUtility || a.playerId.localeCompare(b.playerId))
        .slice(0, followUpLimits.global)
        .map((row) => row.playerId),
    );
    const groupRows = new Map<string, Recommendation[]>();
    for (const row of analysis.deterministicRows) {
      const player = playersById.get(row.playerId);
      if (!player || player.position == null || !['QB', 'RB', 'WR', 'TE'].includes(player.position)) continue;
      const key = eligibilityGroupKey(player);
      const group = groupRows.get(key);
      if (group) group.push(row);
      else groupRows.set(key, [row]);
    }
    for (const group of groupRows.values()) {
      group
        .sort((a, b) => b.marginalRosterUtility - a.marginalRosterUtility || a.playerId.localeCompare(b.playerId))
        .slice(0, followUpLimits.perGroup)
        .forEach((row) => followUpIds.add(row.playerId));
    }
    const followUpRows = analysis.deterministicRows.filter((row) => followUpIds.has(row.playerId));
    const afterState = new Map<PlayerId, ReturnType<typeof addPlayerToLineup>>();
    const afterUtility = new Map<PlayerId, number>();
    for (const row of analysis.deterministicRows) {
      const player = playersById.get(row.playerId);
      if (!player) continue;
      const added = addPlayerToLineup(preparedRoster, player, scores.get(row.playerId) ?? 0, false);
      afterState.set(row.playerId, added);
      afterUtility.set(row.playerId, rosterUtility(added.state, replacementPoints, availabilityData).total);
    }
    const pairUtility = new Map<string, number>();
    function terminalUtility(firstId: PlayerId, secondId: PlayerId): number {
      const ids = [firstId, secondId].sort();
      const key = ids.join('|');
      const cached = pairUtility.get(key);
      if (cached != null) return cached;
      let state = preparedRoster;
      for (const id of ids) {
        const player = playersById.get(id);
        if (player) state = addPlayerToLineup(state, player, scores.get(id) ?? 0, false).state;
      }
      const utility = rosterUtility(state, replacementPoints, availabilityData).total;
      pairUtility.set(key, utility);
      return utility;
    }
    const oraclePlanById = new Map<PlayerId, number>();
    for (const row of planRows) {
      const after = afterUtility.get(row.playerId) ?? commonRosterUtility;
      let bestFollowUp = 0;
      for (const followUp of followUpRows) {
        if (followUp.playerId === row.playerId || realWindowDrafted.has(followUp.playerId)) continue;
        bestFollowUp = Math.max(bestFollowUp, terminalUtility(row.playerId, followUp.playerId) - after);
      }
      oraclePlanById.set(row.playerId, after - commonRosterUtility + bestFollowUp);
    }

    const scoredRows = analysis.deterministicRows.filter((row) => row.playerId !== pick.playerId);
    for (const row of scoredRows) {
      const player = playersById.get(row.playerId);
      if (!player) continue;
      const points = scores.get(row.playerId) ?? 0;
      const added = addPlayerToLineup(preparedRoster, player, points, true);
      const afterC = added.result.value;
      const sameGroup = player == null ? [] : groupRows.get(eligibilityGroupKey(player)) ?? [];
      const bestSurvivingSameGroup = sameGroup
        .filter((candidate) => candidate.playerId !== row.playerId && !realWindowDrafted.has(candidate.playerId))
        .reduce((best, candidate) => Math.max(best, candidate.marginalRosterUtility), 0);
      const oracleVona = Math.max(0, row.marginalRosterUtility - bestSurvivingSameGroup);
      const oracleFollowUp = bestFollowUpValue(added.state, realSurvivors, scores, realWindowDrafted, row.playerId);
      const oracleLookahead = afterC + oracleFollowUp - commonBaseline;

      const adpEntry = adpById.get(row.playerId) ?? null;
      const availability = estimateAvailability(adpEntry, { currentPick: decisionPick, nextPick: followUpPick });
      // Fixed-intersection amendment: "simulated cohort" for the analytic-vs-simulated comparison
      // requires BOTH predictions to exist, not merely that this candidate was rolled out.
      const inSimulatedCohort = simulatedIds.has(row.playerId) && availability != null;

      candidates.push({
        draftId, decisionPick, followUpPick, round: roundOfDecision,
        playerId: row.playerId, position: player.position, recommendationMode: row.recommendationMode,
        adp: adpEntry?.adp ?? null,
        rawProjection: points,
        staticVor: row.vor,
        deterministicS2: row.replacementAdjustedValue,
        actualSurvived: !realWindowDrafted.has(row.playerId),
        predictedAvailable: availability?.probability ?? null,
        unconditionalProbability: availability?.unconditionalProbability ?? null,
        simulatedSurvival: inSimulatedCohort ? row.simulatedSurvivalProbability : null,
        cohort: inSimulatedCohort ? 'analytic+simulated' : 'analytic-only',
        oracleVona, oracleLookahead,
        engineVona: row.vona, engineLookahead: row.lookaheadValue,
        marginalRosterUtility: row.marginalRosterUtility,
        enginePlanValue: row.planValue,
        oraclePlanValue: oraclePlanById.get(row.playerId) ?? row.marginalRosterUtility,
      });
    }

    const oracleEligible = planRows.filter((row) => oraclePlanById.has(row.playerId));
    const oracleTop = [...oracleEligible].sort((a, b) =>
      (oraclePlanById.get(b.playerId) ?? 0) - (oraclePlanById.get(a.playerId) ?? 0)
      || a.playerId.localeCompare(b.playerId))[0];
    const engineTop = board.recommendations.find((row) => oraclePlanById.has(row.playerId))
      ?? [...oracleEligible].sort((a, b) => b.planValue - a.planValue || a.playerId.localeCompare(b.playerId))[0];
    if (oracleTop && engineTop) {
      const baselineTop = (score: (row: Recommendation) => number, ascending = false) =>
        [...oracleEligible].sort((a, b) => {
          const delta = score(a) - score(b);
          return (ascending ? delta : -delta) || a.playerId.localeCompare(b.playerId);
        })[0] as Recommendation;
      const s2Top = baselineTop((row) => row.recommendationMode === 'bench' ? row.benchDepthValue : row.replacementAdjustedValue);
      const adpTop = baselineTop((row) => row.availabilityAdp ?? Infinity, true);
      const projectionTop = baselineTop((row) => row.projectedPoints);
      const oracleBest = oraclePlanById.get(oracleTop.playerId) ?? 0;
      const regret = (row: Recommendation) => oracleBest - (oraclePlanById.get(row.playerId) ?? 0);
      const targetIds = ['1466', '5045', '6819', '8136'];
      const targetPlayers = Object.fromEntries(targetIds.flatMap((id) => {
        const row = analysis.deterministicRows.find((candidate) => candidate.playerId === id);
        return row ? [[id, {
          planValue: row.planValue,
          marginalRosterUtility: row.marginalRosterUtility,
          expectedFollowUpValue: row.expectedFollowUpValue,
          vona: row.vona,
          availability: row.availableNextPickProbability,
        }]] : [];
      }));
      planDecisions.push({
        draftId, decisionPick, followUpPick, openCoreSlots,
        cohort: openCoreSlots === 0 ? 'zero-hole' : openCoreSlots === 1 ? 'one-hole' : 'other',
        engineTopPlayerId: engineTop.playerId,
        oracleTopPlayerId: oracleTop.playerId,
        engineRegret: regret(engineTop),
        deterministicS2Regret: regret(s2Top),
        adpRegret: regret(adpTop),
        projectionRegret: regret(projectionTop),
        targetPlayers,
      });
    }

    decisionPoints.push({
      draftId, decisionPick, followUpPick,
      scoredCandidates: scoredRows.length,
      deterministicCandidateCount: analysis.deterministicCandidateCount,
      simulatedCandidateCount: analysis.simulatedCandidateCount,
      rolloutPoolSize: analysis.rolloutPoolSize,
      unmatchedWindowPickCount,
      unmatchedWindowPickOveralls,
    });
  }

  return { candidates, decisionPoints, planDecisions };
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function brierScore(records: readonly { predicted: number; actual: boolean }[]): number | null {
  if (records.length === 0) return null;
  const sum = records.reduce((acc, r) => acc + (r.predicted - (r.actual ? 1 : 0)) ** 2, 0);
  return sum / records.length;
}

interface CalibrationBucket {
  bucket: string;
  n: number;
  meanPredicted: number;
  observedRate: number;
}

function calibrationDeciles(records: readonly { predicted: number; actual: boolean }[]): CalibrationBucket[] {
  const buckets: { predicted: number; actual: boolean }[][] = Array.from({ length: 10 }, () => []);
  for (const r of records) {
    const idx = Math.min(9, Math.max(0, Math.floor(r.predicted * 10)));
    (buckets[idx] as { predicted: number; actual: boolean }[]).push(r);
  }
  return buckets.map((bucket, i) => ({
    bucket: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
    n: bucket.length,
    meanPredicted: bucket.length ? bucket.reduce((s, r) => s + r.predicted, 0) / bucket.length : 0,
    observedRate: bucket.length ? bucket.reduce((s, r) => s + (r.actual ? 1 : 0), 0) / bucket.length : 0,
  }));
}

interface CalibrationReport {
  n: number;
  brier: number | null;
  deciles: CalibrationBucket[];
}

function calibrationReport(records: readonly { predicted: number | null; actual: boolean }[]): CalibrationReport {
  const usable = records.filter((r): r is { predicted: number; actual: boolean } => r.predicted != null);
  return { n: usable.length, brier: brierScore(usable), deciles: calibrationDeciles(usable) };
}

/** Pooled, prediction-eligible calibration split by one descriptive field. These
 * strata are diagnostic only; they identify where more capture is needed rather than supporting
 * parameter retuning. */
function calibrationBy<T extends { predictedAvailable: number | null; actualSurvived: boolean }>(
  records: readonly T[],
  keyFor: (record: T) => string,
): Record<string, CalibrationReport> {
  const buckets = new Map<string, T[]>();
  for (const record of records) {
    const key = keyFor(record);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(record);
    else buckets.set(key, [record]);
  }
  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([key, bucket]) => [key, calibrationReport(bucket.map((r) => ({ predicted: r.predictedAvailable, actual: r.actualSurvived })))]),
  );
}

interface MaeBias {
  n: number;
  mae: number;
  bias: number;
}

function maeAndBias(diffs: readonly number[]): MaeBias {
  const n = diffs.length;
  if (n === 0) return { n: 0, mae: 0, bias: 0 };
  return {
    n,
    mae: diffs.reduce((s, d) => s + Math.abs(d), 0) / n,
    bias: diffs.reduce((s, d) => s + d, 0) / n,
  };
}

/** Spearman rank correlation with average ranks for ties. Null when either series has zero
 * variance (undefined correlation) or fewer than 2 points. */
function spearman(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  if (n < 2 || b.length !== n) return null;
  const rankOf = (values: readonly number[]): number[] => {
    const order = values.map((_, i) => i).sort((i, j) => (values[i] as number) - (values[j] as number));
    const ranks = new Array<number>(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && values[order[j + 1] as number] === values[order[i] as number]) j += 1;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) ranks[order[k] as number] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  const ra = rankOf(a);
  const rb = rankOf(b);
  const meanA = ra.reduce((s, v) => s + v, 0) / n;
  const meanB = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (ra[i] as number) - meanA;
    const db = (rb[i] as number) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

function mean(values: readonly number[]): number | null {
  const usable = values.filter((v) => !Number.isNaN(v));
  return usable.length ? usable.reduce((s, v) => s + v, 0) / usable.length : null;
}

function groupByDecisionPoint(records: readonly CandidateRecord[]): CandidateRecord[][] {
  const map = new Map<string, CandidateRecord[]>();
  for (const r of records) {
    const key = `${r.draftId}|${r.decisionPick}`;
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return [...map.values()];
}

interface RankAgreementReport {
  decisionPointsConsidered: number;
  vsAdp: number | null;
  vsRawProjection: number | null;
  vsStaticVor: number | null;
  vsDeterministicS2: number | null;
  /** Only over decision points where at least 2 candidates were actually simulated. */
  vsEngine: number | null;
  engineDecisionPointsConsidered: number;
}

function rankAgreementReport(
  records: readonly CandidateRecord[],
  oracleField: 'oracleVona' | 'oracleLookahead',
  engineField: 'engineVona' | 'engineLookahead' | null,
): RankAgreementReport {
  const groups = groupByDecisionPoint(records).filter((g) => g.length >= 2);
  const vsAdp: number[] = [];
  const vsRawProjection: number[] = [];
  const vsStaticVor: number[] = [];
  const vsDeterministicS2: number[] = [];
  const vsEngine: number[] = [];
  for (const group of groups) {
    const oracleVals = group.map((r) => r[oracleField]);
    const adpEntries = group.filter((r) => r.adp != null);
    if (adpEntries.length >= 2) {
      // Negate ADP so "higher = better" matches the oracle's direction (lower ADP = drafted
      // earlier = presumably more valuable, so its rank correlation should read the same sign).
      const corr = spearman(adpEntries.map((r) => r[oracleField]), adpEntries.map((r) => -(r.adp as number)));
      if (corr != null) vsAdp.push(corr);
    }
    const corrProjection = spearman(oracleVals, group.map((r) => r.rawProjection));
    if (corrProjection != null) vsRawProjection.push(corrProjection);
    const corrVor = spearman(oracleVals, group.map((r) => r.staticVor));
    if (corrVor != null) vsStaticVor.push(corrVor);
    const corrS2 = spearman(oracleVals, group.map((r) => r.deterministicS2));
    if (corrS2 != null) vsDeterministicS2.push(corrS2);

    if (engineField != null) {
      const simulatedGroup = group.filter((r) => r[engineField] != null);
      if (simulatedGroup.length >= 2) {
        const corrEngine = spearman(simulatedGroup.map((r) => r[oracleField]), simulatedGroup.map((r) => r[engineField] as number));
        if (corrEngine != null) vsEngine.push(corrEngine);
      }
    }
  }
  return {
    decisionPointsConsidered: groups.length,
    vsAdp: mean(vsAdp),
    vsRawProjection: mean(vsRawProjection),
    vsStaticVor: mean(vsStaticVor),
    vsDeterministicS2: mean(vsDeterministicS2),
    vsEngine: mean(vsEngine),
    engineDecisionPointsConsidered: vsEngine.length,
  };
}

function empiricalBaselineMap(records: readonly CandidateRecord[]): Map<string, { survived: number; total: number }> {
  const map = new Map<string, { survived: number; total: number }>();
  for (const r of records) {
    const key = `${r.round}|${r.position ?? '~'}`;
    const entry = map.get(key) ?? { survived: 0, total: 0 };
    entry.total += 1;
    if (r.actualSurvived) entry.survived += 1;
    map.set(key, entry);
  }
  return map;
}

/** Leave-one-draft-out empirical round/position survival-rate baseline: the bucket rates used to
 * score draft A's rows are estimated from every *other* draft alone, never from draft A's own rows. */
function leaveOneOutEmpiricalBaseline(byDraft: ReadonlyMap<string, CandidateRecord[]>): { predicted: number; actual: boolean }[] {
  const draftIds = [...byDraft.keys()];
  const scored: { predicted: number; actual: boolean }[] = [];
  for (const draftId of draftIds) {
    const own = byDraft.get(draftId) ?? [];
    const others = draftIds.filter((id) => id !== draftId).flatMap((id) => byDraft.get(id) ?? []);
    const bucketMap = empiricalBaselineMap(others);
    const overallRate = others.length ? others.filter((r) => r.actualSurvived).length / others.length : 0.5;
    for (const r of own) {
      const bucket = bucketMap.get(`${r.round}|${r.position ?? '~'}`);
      const predicted = bucket && bucket.total > 0 ? bucket.survived / bucket.total : overallRate;
      scored.push({ predicted, actual: r.actualSurvived });
    }
  }
  return scored;
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function formatCalibrationTable(report: CalibrationReport): string {
  const header = '| Bucket | n | Mean predicted | Observed rate |\n|---|---|---|---|\n';
  const rows = report.deciles
    .filter((d) => d.n > 0)
    .map((d) => `| ${d.bucket} | ${d.n} | ${d.meanPredicted.toFixed(3)} | ${d.observedRate.toFixed(3)} |`)
    .join('\n');
  return header + (rows || '| (no rows in any bucket) | | | |');
}

function formatStratifiedCalibrationTable(reports: Record<string, CalibrationReport>): string {
  const header = '| Stratum | n | Brier |\n|---|---|---|\n';
  const rows = Object.entries(reports)
    .map(([label, report]) => `| ${label} | ${report.n} | ${report.brier?.toFixed(4) ?? 'n/a'} |`)
    .join('\n');
  return header + (rows || '| (no prediction-eligible rows) | 0 | n/a |');
}

function formatMaeBiasTable(rows: { label: string; stats: MaeBias }[]): string {
  const header = '| Stratum | n | MAE | Bias |\n|---|---|---|---|\n';
  const body = rows.map((r) => `| ${r.label} | ${r.stats.n} | ${r.stats.mae.toFixed(2)} | ${r.stats.bias.toFixed(2)} |`).join('\n');
  return header + body;
}

function formatRankAgreementTable(rows: { label: string; report: RankAgreementReport }[]): string {
  const header = '| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |\n|---|---|---|---|---|---|---|\n';
  const fmt = (v: number | null) => (v == null ? 'n/a' : v.toFixed(3));
  const body = rows
    .map((r) => `| ${r.label} | ${r.report.decisionPointsConsidered} | ${fmt(r.report.vsAdp)} | ${fmt(r.report.vsRawProjection)} | ${fmt(r.report.vsStaticVor)} | ${fmt(r.report.vsDeterministicS2)} | ${fmt(r.report.vsEngine)} (${r.report.engineDecisionPointsConsidered}) |`)
    .join('\n');
  return header + body;
}

describe.skipIf(!process.env.BENCHMARK)('availability/VONA calibration (opt-in, PLAN.md S6 gate B)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSimulationCache();
  });

  it(
    'scores availableNextPickProbability/simulatedSurvivalProbability/vona/lookaheadValue against recorded Sleeper drafts',
    async () => {
      const manifest = loadJson<DataManifest>(join(dataDir, 'manifest.json'));
      const players = loadJson<PlayerMeta[]>(join(dataDir, 'players.json'));
      const projections = loadJson<SeasonProjection[]>(join(dataDir, 'projections-season.json'));
      const adp = loadJson<AdpEntry[]>(join(dataDir, 'adp-ppr.json'));

      const byDraft = new Map<string, CandidateRecord[]>();
      const decisionPointLogs: DecisionPointLog[] = [];
      const planDecisionLogs: PlanDecisionRecord[] = [];
      for (const draftId of RECORDED_DRAFT_IDS) {
        const { candidates, decisionPoints, planDecisions } = await replayDraft(draftId, players, projections, adp);
        byDraft.set(draftId, candidates);
        decisionPointLogs.push(...decisionPoints);
        planDecisionLogs.push(...planDecisions);
      }
      const allCandidates = [...byDraft.values()].flat();

      const summarizeRegret = (rows: PlanDecisionRecord[]) => {
        const mean = (field: 'engineRegret' | 'deterministicS2Regret' | 'adpRegret' | 'projectionRegret') =>
          rows.length ? rows.reduce((sum, row) => sum + row[field], 0) / rows.length : 0;
        const engine = mean('engineRegret');
        const s2 = mean('deterministicS2Regret');
        return {
          n: rows.length,
          meanEngineRegret: engine,
          meanDeterministicS2Regret: s2,
          meanAdpRegret: mean('adpRegret'),
          meanProjectionRegret: mean('projectionRegret'),
          relativeImprovementVsS2: s2 > 0 ? (s2 - engine) / s2 : null,
          topChoiceAgreement: rows.length
            ? rows.filter((row) => row.engineTopPlayerId === row.oracleTopPlayerId).length / rows.length
            : null,
        };
      };
      const planRegret = {
        all: summarizeRegret(planDecisionLogs),
        oneHole: summarizeRegret(planDecisionLogs.filter((row) => row.cohort === 'one-hole')),
        zeroHole: summarizeRegret(planDecisionLogs.filter((row) => row.cohort === 'zero-hole')),
        other: summarizeRegret(planDecisionLogs.filter((row) => row.cohort === 'other')),
      };
      const twoPickAbsoluteImprovementGate = 0.5;
      const twoPickRelativeImprovementGate = 0.05;
      // Regret cannot fall below zero. If even a perfect two-pick policy could not clear the
      // predeclared absolute gate, reject the extra horizon before paying its implementation and
      // latency cost. This is a stronger result than running a particular two-window policy.
      const maximumPossibleTwoPickAbsoluteImprovement = planRegret.zeroHole.meanEngineRegret;
      const twoPickGateRejectedAtPrescreen =
        maximumPossibleTwoPickAbsoluteImprovement < twoPickAbsoluteImprovementGate;
      const twoPickGate = {
        status: twoPickGateRejectedAtPrescreen ? 'rejected-at-prescreen' : 'requires-two-window-evaluation',
        cohort: 'zero-hole',
        thresholds: {
          relativeRegretImprovement: twoPickRelativeImprovementGate,
          absoluteRegretImprovement: twoPickAbsoluteImprovementGate,
          warmLatencyMs: 250,
          coldLatencyMs: 3_000,
        },
        currentOneHorizonMeanRegret: planRegret.zeroHole.meanEngineRegret,
        maximumPossibleAbsoluteImprovement: maximumPossibleTwoPickAbsoluteImprovement,
        reason: twoPickGateRejectedAtPrescreen
          ? 'Rejected at the regret-ceiling prescreen: even a perfect two-pick policy cannot clear the predeclared 0.5 utility-point absolute gate.'
          : 'A raw two-window evaluator is required before production enablement because the regret ceiling does not reject the mode by itself.',
      };
      const reportedDecisionSnapshots = planDecisionLogs.filter((row) =>
        (row.decisionPick >= 74 && row.decisionPick <= 79)
        || (row.decisionPick >= 97 && row.decisionPick <= 99));

      // ---------------------------------------------------------------------
      // Availability calibration (corrections 1+2; fixed-intersection amendment)
      // ---------------------------------------------------------------------
      const analyticFullCohort = allCandidates.filter((r) => r.predictedAvailable != null);
      // `cohort === 'analytic+simulated'` already requires both predictions non-null (see
      // `replayDraft`'s `inSimulatedCohort` guard) — this is a genuine subset of `analyticFullCohort`.
      const fixedIntersectionCohort = allCandidates.filter((r) => r.cohort === 'analytic+simulated');
      const analyticOnlyCount = analyticFullCohort.length - fixedIntersectionCohort.length;

      const toAvailabilityPrediction = (r: CandidateRecord) => ({ predicted: r.predictedAvailable, actual: r.actualSurvived });
      const availabilityFullByDraft = new Map(
        RECORDED_DRAFT_IDS.map((id) => [id, calibrationReport((byDraft.get(id) ?? []).map(toAvailabilityPrediction))]),
      );
      const availabilityFullPooled = calibrationReport(analyticFullCohort.map(toAvailabilityPrediction));

      const unconditionalByDraft = new Map(
        RECORDED_DRAFT_IDS.map((id) => [id, calibrationReport((byDraft.get(id) ?? []).map((r) => ({ predicted: r.unconditionalProbability, actual: r.actualSurvived })))]),
      );
      const unconditionalPooled = calibrationReport(allCandidates.map((r) => ({ predicted: r.unconditionalProbability, actual: r.actualSurvived })));

      const fixedAnalyticByDraft = new Map(
        RECORDED_DRAFT_IDS.map((id) => [id, calibrationReport((byDraft.get(id) ?? []).filter((r) => r.cohort === 'analytic+simulated').map((r) => ({ predicted: r.predictedAvailable, actual: r.actualSurvived })))]),
      );
      const fixedAnalyticPooled = calibrationReport(fixedIntersectionCohort.map((r) => ({ predicted: r.predictedAvailable, actual: r.actualSurvived })));
      const fixedSimulatedByDraft = new Map(
        RECORDED_DRAFT_IDS.map((id) => [id, calibrationReport((byDraft.get(id) ?? []).filter((r) => r.cohort === 'analytic+simulated').map((r) => ({ predicted: r.simulatedSurvival, actual: r.actualSurvived })))]),
      );
      const fixedSimulatedPooled = calibrationReport(fixedIntersectionCohort.map((r) => ({ predicted: r.simulatedSurvival, actual: r.actualSurvived })));

      // ---------------------------------------------------------------------
      // Leave-one-draft-out empirical round/position baseline
      // ---------------------------------------------------------------------
      // Use exactly the analytic prediction cohort. Including unmatched/no-ADP candidates would
      // make the analytic and empirical Brier scores incomparable.
      const analyticByDraft = new Map(
        RECORDED_DRAFT_IDS.map((id) => [id, (byDraft.get(id) ?? []).filter((r) => r.predictedAvailable != null)]),
      );
      const empiricalScored = leaveOneOutEmpiricalBaseline(analyticByDraft);
      const empiricalReport: CalibrationReport = {
        n: empiricalScored.length,
        brier: brierScore(empiricalScored),
        deciles: calibrationDeciles(empiricalScored),
      };

      // ---------------------------------------------------------------------
      // VONA / lookahead — correction 3, stratified by recommendationMode
      // ---------------------------------------------------------------------
      const simulatedCandidates = allCandidates.filter((r) => r.engineVona != null);
      const starterSimulated = simulatedCandidates.filter((r) => r.recommendationMode === 'starter');
      const benchSimulated = simulatedCandidates.filter((r) => r.recommendationMode === 'bench');

      const vonaMae = (rows: CandidateRecord[]) => maeAndBias(rows.map((r) => (r.engineVona as number) - r.oracleVona));
      const lookaheadMae = (rows: CandidateRecord[]) => maeAndBias(rows.filter((r) => r.engineLookahead != null).map((r) => (r.engineLookahead as number) - r.oracleLookahead));

      const vonaMaeTable = [
        { label: 'all simulated rows', stats: vonaMae(simulatedCandidates) },
        { label: 'starter mode', stats: vonaMae(starterSimulated) },
        { label: 'bench mode', stats: vonaMae(benchSimulated) },
      ];
      const lookaheadMaeTable = [
        { label: 'all simulated rows', stats: lookaheadMae(simulatedCandidates) },
        { label: 'starter mode', stats: lookaheadMae(starterSimulated) },
        { label: 'bench mode', stats: lookaheadMae(benchSimulated) },
      ];

      const vonaRankTable = [
        // Each candidate is excluded from its own substitute pool, so both the analytic estimate
        // and the real-history oracle are genuinely candidate-specific and rank-comparable.
        { label: 'all candidates', report: rankAgreementReport(allCandidates, 'oracleVona', 'engineVona') },
        { label: 'starter mode', report: rankAgreementReport(allCandidates.filter((r) => r.recommendationMode === 'starter'), 'oracleVona', 'engineVona') },
        { label: 'bench mode', report: rankAgreementReport(allCandidates.filter((r) => r.recommendationMode === 'bench'), 'oracleVona', 'engineVona') },
      ];
      const lookaheadRankTable = [
        { label: 'all candidates', report: rankAgreementReport(allCandidates, 'oracleLookahead', 'engineLookahead') },
        { label: 'starter mode', report: rankAgreementReport(allCandidates.filter((r) => r.recommendationMode === 'starter'), 'oracleLookahead', 'engineLookahead') },
        { label: 'bench mode', report: rankAgreementReport(allCandidates.filter((r) => r.recommendationMode === 'bench'), 'oracleLookahead', 'engineLookahead') },
      ];

      // ---------------------------------------------------------------------
      // Metadata amendment
      // ---------------------------------------------------------------------
      const gitCommit = (() => {
        try {
          return execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
        } catch {
          return 'unknown (git rev-parse failed)';
        }
      })();
      const activeAdpSource = manifest.sources.adp_active_ppr?.activeAdpSource ?? 'unknown';
      const projectionUpdatedAt = manifest.sources.fftoday_projections?.upstreamUpdatedAt ?? 'unknown';
      const reportDate = manifest.builtAt.slice(0, 10);

      const reportJson = {
        metadata: {
          generatedAt: new Date().toISOString(),
          manifestBuiltAt: manifest.builtAt,
          fftodayProjectionsUpstreamUpdatedAt: projectionUpdatedAt,
          activeAdpSource,
          recordedDraftIds: RECORDED_DRAFT_IDS,
          gitCommit,
          sampleCaveat: `N=${RECORDED_DRAFT_IDS.length} recorded drafts — within the plan's 5-10-draft directional-report target, but still not an independent historical draft-strategy backtest. Current committed data/ was applied retroactively against all drafts; this validates engine mechanism, not a dated-snapshot projection-accuracy backtest (that is PLAN.md Gate A/D, separate scope).`,
        },
        coverage: {
          decisionPoints: decisionPointLogs,
          unmatchedWindowPickCount: decisionPointLogs.reduce((s, d) => s + d.unmatchedWindowPickCount, 0),
          unmatchedWindowPickOverallsByDecisionPoint: decisionPointLogs
            .filter((d) => d.unmatchedWindowPickCount > 0)
            .map((d) => ({
              draftId: d.draftId,
              decisionPick: d.decisionPick,
              followUpPick: d.followUpPick,
              overalls: d.unmatchedWindowPickOveralls,
            })),
          analyticFullCohortCount: analyticFullCohort.length,
          fixedIntersectionCohortCount: fixedIntersectionCohort.length,
          analyticOnlyCount,
        },
        availability: {
          availableNextPickProbability: { byDraft: Object.fromEntries(availabilityFullByDraft), pooled: availabilityFullPooled },
          availableNextPickProbabilityByRound: calibrationBy(analyticFullCohort, (r) => `Round ${r.round}`),
          availableNextPickProbabilityByPosition: calibrationBy(analyticFullCohort, (r) => r.position ?? 'Unknown'),
          unconditionalProbability: { byDraft: Object.fromEntries(unconditionalByDraft), pooled: unconditionalPooled },
          fixedIntersection: {
            availableNextPickProbability: { byDraft: Object.fromEntries(fixedAnalyticByDraft), pooled: fixedAnalyticPooled },
            simulatedSurvivalProbability: { byDraft: Object.fromEntries(fixedSimulatedByDraft), pooled: fixedSimulatedPooled },
          },
          leaveOneDraftOutEmpiricalBaseline: empiricalReport,
        },
        vona: { maeBias: vonaMaeTable, rankAgreement: vonaRankTable },
        lookahead: { maeBias: lookaheadMaeTable, rankAgreement: lookaheadRankTable },
        planning: {
          objective: 'realized one-pick terminal rosterUtility on the fixed open-open historical opponent window',
          regret: planRegret,
          decisions: planDecisionLogs,
          reportedDecisionSnapshots,
          twoPickGate,
        },
        descoped: {
          scenarioCountConvergenceSweep: 'Explicitly descoped this round: Monte Carlo SE on a probability is analytic (sqrt(p(1-p)/n) ~= 0.177 at n=8,p=0.5); the sweep only earns its cost once rank-agreement (not raw probability noise) is the open question, and this directional sample cannot answer that reliably.',
        },
      };

      mkdirSync(reportsDir, { recursive: true });
      const jsonPath = join(reportsDir, `${reportDate}-availability-calibration.json`);
      const mdPath = join(reportsDir, `${reportDate}-availability-calibration.md`);
      writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2) + '\n');

      const md = `# Availability/VONA calibration report — ${reportDate}

## Metadata

- Generated at: ${reportJson.metadata.generatedAt}
- \`data/manifest.json\` builtAt: ${manifest.builtAt}
- FFToday projections upstream updated at: ${projectionUpdatedAt}
- Active ADP source (\`adp_active_ppr\`): ${activeAdpSource}
- Recorded draft IDs: ${RECORDED_DRAFT_IDS.join(', ')}
- Git commit: ${gitCommit}

> **Pilot caveat**: ${reportJson.metadata.sampleCaveat}

## Coverage

- Decision points replayed: ${decisionPointLogs.length} (${decisionPointLogs.filter((d) => d.skippedReason).length} skipped — see per-decision-point log in the JSON sibling of this report)
- In-window unmatched picks (crosswalk misses): ${reportJson.coverage.unmatchedWindowPickCount} — non-zero silently corrupts \`actualSurvived\` / VONA / lookahead oracles for those players (see per-decision-point \`unmatchedWindowPickOveralls\` / \`coverage.unmatchedWindowPickOverallsByDecisionPoint\`)
- Full analytic cohort (rows with an ADP-based prediction): ${analyticFullCohort.length}
- Fixed-intersection cohort (also has a simulated counterpart): ${fixedIntersectionCohort.length}
- Analytic-only rows (prediction available, no simulated counterpart): ${analyticOnlyCount}

## A. Availability calibration

### A.1 \`availableNextPickProbability\` — full analytic cohort

Pooled (N=${availabilityFullPooled.n}, Brier=${availabilityFullPooled.brier?.toFixed(4) ?? 'n/a'}):

${formatCalibrationTable(availabilityFullPooled)}

Per draft:
${RECORDED_DRAFT_IDS.map((id) => {
  const r = availabilityFullByDraft.get(id) as CalibrationReport;
  return `\n**${id}** (N=${r.n}, Brier=${r.brier?.toFixed(4) ?? 'n/a'})\n\n${formatCalibrationTable(r)}`;
}).join('\n')}

### A.1a Error by round and position (pooled analytic cohort)

These strata are descriptive only. They identify where more capture is needed rather
than supporting parameter retuning.

**By round**

${formatStratifiedCalibrationTable(reportJson.availability.availableNextPickProbabilityByRound)}

**By position**

${formatStratifiedCalibrationTable(reportJson.availability.availableNextPickProbabilityByPosition)}

### A.2 \`unconditionalProbability\` (baseline #1 — ignores survival-to-currentPick conditioning)

Pooled (N=${unconditionalPooled.n}, Brier=${unconditionalPooled.brier?.toFixed(4) ?? 'n/a'}):

${formatCalibrationTable(unconditionalPooled)}

### A.3 Fixed-intersection comparison: analytic vs. simulated

Rows where both \`availableNextPickProbability\` and \`simulatedSurvivalProbability\` exist (N=${fixedIntersectionCohort.length}).

**\`availableNextPickProbability\`** (pooled Brier=${fixedAnalyticPooled.brier?.toFixed(4) ?? 'n/a'}):

${formatCalibrationTable(fixedAnalyticPooled)}

**\`simulatedSurvivalProbability\`** (pooled Brier=${fixedSimulatedPooled.brier?.toFixed(4) ?? 'n/a'}):

${formatCalibrationTable(fixedSimulatedPooled)}

### A.4 Leave-one-draft-out empirical round/position baseline

Each draft's prediction-eligible rows are scored against a survival-rate table built from the *other*
draft alone. This uses the same N as the analytic score, making the Brier comparison like-for-like. Pooled
(N=${empiricalReport.n}, Brier=${empiricalReport.brier?.toFixed(4) ?? 'n/a'}):

${formatCalibrationTable(empiricalReport)}

## B. Analytic wait loss (VONA)

### B.1 MAE / bias vs. the real-history oracle

${formatMaeBiasTable(vonaMaeTable)}

### B.2 Rank agreement (mean per-decision-point Spearman correlation, oracle VONA vs. each baseline)

${formatRankAgreementTable(vonaRankTable)}

The engine estimate is the candidate's unified marginal roster utility minus the expected best
surviving substitute in the same eligibility group. The real-history oracle uses the best substitute
that actually survived the open-open opponent window. Rank agreement is therefore meaningful in
both starter and bench cohorts; n/a only means a stratum lacks enough non-constant decision points.

## Interpretation

This ${RECORDED_DRAFT_IDS.length}-draft directional report does **not** establish calibration. The conditioned analytic model's pooled
Brier score (${availabilityFullPooled.brier?.toFixed(4) ?? 'n/a'}) is modestly better than the
unconditional baseline (${unconditionalPooled.brier?.toFixed(4) ?? 'n/a'}), but the largest
high-probability bucket dominates the pooled score and the lower/middle buckets require additional
captured drafts and round/position review. The fixed-intersection simulation comparison is also
directional only (analytic Brier ${fixedAnalyticPooled.brier?.toFixed(4) ?? 'n/a'}, simulated
Brier ${fixedSimulatedPooled.brier?.toFixed(4) ?? 'n/a'}). Keep availability labeled experimental
until a larger, independent sample supports calibration or a correction.

## C. Unified roster-utility planning

The realized oracle forces each current candidate, removes opponents' actual open-open-window
picks, then takes the best surviving follow-up under the same starter-plus-depth roster utility.
Regret is oracle-best utility minus the utility of each policy's selected candidate.

| Cohort | n | Plan regret | Old S2 regret | ADP regret | Projection regret | Improvement vs S2 | Top-choice agreement |
|---|---:|---:|---:|---:|---:|---:|---:|
| All | ${planRegret.all.n} | ${planRegret.all.meanEngineRegret.toFixed(2)} | ${planRegret.all.meanDeterministicS2Regret.toFixed(2)} | ${planRegret.all.meanAdpRegret.toFixed(2)} | ${planRegret.all.meanProjectionRegret.toFixed(2)} | ${planRegret.all.relativeImprovementVsS2 == null ? 'n/a' : (planRegret.all.relativeImprovementVsS2 * 100).toFixed(1) + '%'} | ${planRegret.all.topChoiceAgreement == null ? 'n/a' : (planRegret.all.topChoiceAgreement * 100).toFixed(1) + '%'} |
| One core hole | ${planRegret.oneHole.n} | ${planRegret.oneHole.meanEngineRegret.toFixed(2)} | ${planRegret.oneHole.meanDeterministicS2Regret.toFixed(2)} | ${planRegret.oneHole.meanAdpRegret.toFixed(2)} | ${planRegret.oneHole.meanProjectionRegret.toFixed(2)} | ${planRegret.oneHole.relativeImprovementVsS2 == null ? 'n/a' : (planRegret.oneHole.relativeImprovementVsS2 * 100).toFixed(1) + '%'} | ${planRegret.oneHole.topChoiceAgreement == null ? 'n/a' : (planRegret.oneHole.topChoiceAgreement * 100).toFixed(1) + '%'} |
| Zero core holes | ${planRegret.zeroHole.n} | ${planRegret.zeroHole.meanEngineRegret.toFixed(2)} | ${planRegret.zeroHole.meanDeterministicS2Regret.toFixed(2)} | ${planRegret.zeroHole.meanAdpRegret.toFixed(2)} | ${planRegret.zeroHole.meanProjectionRegret.toFixed(2)} | ${planRegret.zeroHole.relativeImprovementVsS2 == null ? 'n/a' : (planRegret.zeroHole.relativeImprovementVsS2 * 100).toFixed(1) + '%'} | ${planRegret.zeroHole.topChoiceAgreement == null ? 'n/a' : (planRegret.zeroHole.topChoiceAgreement * 100).toFixed(1) + '%'} |

Reported-decision snapshots, including Kelce/Sutton and White/Pittman plan components when present,
are stored in the JSON sibling under planning.reportedDecisionSnapshots.

### Two-pick gate

Status: **${twoPickGate.status}**. Zero-hole one-horizon mean regret is
${twoPickGate.currentOneHorizonMeanRegret.toFixed(4)}, so the maximum possible absolute improvement
from any two-pick policy is also ${twoPickGate.maximumPossibleAbsoluteImprovement.toFixed(4)}. That
cannot clear the predeclared 0.5 utility-point gate. The production objective therefore remains
deterministic one-horizon planning; no analytic correction is added to the legacy rollout.

## D. Legacy rollout lookahead diagnostic (correction 3 — "take c" oracle)

### C.1 MAE / bias vs. the real-history oracle

${formatMaeBiasTable(lookaheadMaeTable)}

### C.2 Rank agreement (mean per-decision-point Spearman correlation, oracle lookahead vs. each baseline)

${formatRankAgreementTable(lookaheadRankTable)}

## Descoped this round

- ${reportJson.descoped.scenarioCountConvergenceSweep}
`;
      writeFileSync(mdPath, md);
      // eslint-disable-next-line no-console
      console.log(`Wrote ${jsonPath} and ${mdPath}`);

      // ---------------------------------------------------------------------
      // Sanity assertions (verification step 4) — written after the report so a failure here still
      // leaves the report on disk for inspection.
      // ---------------------------------------------------------------------
      expect(decisionPointLogs.length).toBeGreaterThan(0);
      expect(allCandidates.length).toBeGreaterThan(0);
      for (const report of [availabilityFullPooled, unconditionalPooled, fixedAnalyticPooled, fixedSimulatedPooled, empiricalReport]) {
        if (report.brier != null) {
          expect(report.brier).toBeGreaterThanOrEqual(0);
          expect(report.brier).toBeLessThanOrEqual(1);
        }
        const bucketSum = report.deciles.reduce((s, d) => s + d.n, 0);
        expect(bucketSum).toBe(report.n);
      }
      // Cohort consistency: simulated ⊆ analytic ⊆ deterministic, per decision point.
      for (const log of decisionPointLogs) {
        if (log.skippedReason) continue;
        expect(log.simulatedCandidateCount).toBeLessThanOrEqual(log.rolloutPoolSize);
        expect(log.rolloutPoolSize).toBeLessThanOrEqual(log.deterministicCandidateCount);
      }
      // Crosswalk miss inside an attrition window → invisible drafted player → false
      // actualSurvived. Fail loudly so extending RECORDED_DRAFT_IDS cannot ship corrupted
      // calibration; fix the crosswalk (or drop the draft) before trusting the report.
      const unmatchedWindowTotal = reportJson.coverage.unmatchedWindowPickCount;
      expect(
        unmatchedWindowTotal,
        unmatchedWindowTotal === 0
          ? undefined
          : `in-window crosswalk misses corrupt ground truth: ${JSON.stringify(reportJson.coverage.unmatchedWindowPickOverallsByDecisionPoint)}`,
      ).toBe(0);
      expect(fixedIntersectionCohort.length).toBeLessThanOrEqual(analyticFullCohort.length);
      expect(analyticOnlyCount).toBeGreaterThanOrEqual(0);
    },
    600_000,
  );
});
