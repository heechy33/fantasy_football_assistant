/**
 * Historical 2025 draft-strategy backtest — pure, Node-testable functions (PLAN.md Edge Validation
 * Gate, evaluation layer A). The runner (`backtest.bench.ts`) loads the frozen fixtures and drives
 * `runBacktest`, then writes the report. No file I/O, no `process.env`, no React.
 *
 * Pre-declared gates: `fixtures/backtest/2025/gates.md`. In short: 12-team snake PPR, 16 rounds,
 * plain-PPR scoring (no TE bonus). Six arms share one field — the 11 non-subject seats always
 * draft via `opponentModel.ts` with `defaultOpponentModelConfig`, so only the subject seat's policy
 * varies. Common random numbers across arms via `rng.ts`'s `deriveStream` prefix property: a given
 * (slot, seedIndex) pair gives every arm the identical per-pick opponent shock stream, which turns
 * the engine-vs-baseline comparison into a paired one and removes essentially all between-draft
 * variance.
 *
 * Primary metric: per-draft mean **optimized weekly starter points**, weeks 1-17, where each week's
 * optimum is the exact lineup-DP value over that week's real 2025 points (`weekly-stats.json`'s
 * `pts` column = Sleeper `pts_ppr`). Week 18 is excluded (starter-rest risk). Primary gate vs
 * baseline 3 (static VOR): engine mean >= b3 mean - 0.25 AND the paired-difference 95% CI excludes
 * a loss worse than -0.25. Downside gate: engine 10th-percentile weekly team total >= b3's - 0.5.
 */

import type {
  AdpEntry,
  DraftType,
  LeagueSettings,
  Pick,
  PlayerId,
  PlayerMeta,
  PlayerWeeklyStatsArtifact,
  Position,
  RosterSlot,
  SeasonProjection,
} from '../../../shared/types';
import { slotForOverall, userPickBoundaries } from '../adapters/draftOrder';
import { buildGameLogRows } from '../data/weeklyGameLog';
import {
  addPlayerToLineup,
  optimizeLineupStarters,
  optimizeLineupValue,
  prepareLineup,
  type PreparedLineup,
} from './eligibility';
import {
  buildOpponentPool,
  computeScenarioPriorities,
  defaultOpponentModelConfig,
  needBonusFromLineup,
  pickForTeam,
  type OpponentModelConfig,
} from './opponentModel';
import {
  positionalDemand,
  replacementLevels,
  replacementPointsByPosition,
} from './replacement';
import {
  buildRecommendationBoard,
  DEFAULT_SCENARIOS,
  type Recommendation,
  type RecommendationInput,
} from './recommend';
import { createRng, deriveStream, hashStateSeed, type Rng, type Seed } from './rng';
import { scoreProjection } from './scoring';
import { simSortChoice } from './simSortProbe';

// ---------------------------------------------------------------------------
// Pre-declared league + seed config (fixtures/backtest/2025/gates.md)
// ---------------------------------------------------------------------------

export const BACKTEST_SEASON = '2025';
export const BACKTEST_TEAMS = 12;
export const BACKTEST_ROUNDS = 16;
export const BACKTEST_BASE_SEED = '20250825';
/** Weeks scored for the primary metric. Week 18 excluded (starter-rest risk). */
export const BACKTEST_WEEKS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
export const BACKTEST_PLAYOFF_START_WEEK = 15;
export const BACKTEST_H2H_SCHEDULE_SAMPLES = 200;

/** `c1` is a Stage-C engine variant under test (sorts by simulated `lookaheadValue` instead of the
 * production `planValue` — see `simSortProbe.ts`), not a fifth pre-declared baseline; it is
 * additive and reported-only (`fixtures/backtest/2025/gates.md`, `DECISIONS.md`'s 2026-08-22
 * "Sim-sort disagreement probe" entry). It is excluded from every gate predicate. */
export type BacktestArm = 'engine' | 'c1' | 'b4' | 'b3' | 'b2' | 'b1';
export const BACKTEST_ARMS: readonly BacktestArm[] = ['engine', 'c1', 'b4', 'b3', 'b2', 'b1'];

export const BACKTEST_STARTING_SLOTS: readonly RosterSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

/**
 * Plain PPR skill-position scoring (Sleeper `pts_ppr`-equivalent for offense), plus K/DEF weights
 * matching production's own default Sleeper PPR map (`adapters/sleeper.ts`'s `DEFAULT_SCORING.ppr`:
 * `fgm 3, xpm 1, sack 1, int 2, fum_rec 2, def_td 6, def_kr_td 6`).
 *
 * **Correction (2026-08-22, post-pilot):** the original snapshot omitted every K/DEF key. FFToday's
 * 2025 projections (`fixtures/backtest/2025/projections.json`) carry real K/DEF stat lines, and the
 * real 2025 outcome scoring (`data/weekly-stats.json`'s `pts` = Sleeper's own `pts_ppr`) credits
 * K/DEF normally — but with no K/DEF scoring keys, every arm that ranks by projected points
 * (`scoreProjection`) valued every kicker and defense at exactly 0, independent of any real
 * performance. Baseline 3 (static VOR) has no forcing mechanism and never drafted K/DEF as a
 * result (0.000 coverage in the pilot) — an artifact of this omission, not of the static-VOR
 * strategy itself, and it inflated the engine-vs-B3 gap. Deliberately still NOT
 * `fixtures/sleeper/scoring-ppr.json` unmodified — that fixture carries `bonus_rec_te: 0.5`, which
 * would disagree with the plain-PPR `pts` column and overvalue TEs in both the engine's objective
 * and the outcome score.
 */
export const BACKTEST_SCORING: Readonly<Record<string, number>> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
  fgm: 3, xpm: 1, sack: 1, int: 2, fum_rec: 2, def_td: 6, def_kr_td: 6,
};

/**
 * Pre-declared per-position roster caps for the naive BPA baselines (B1/B2). A player's position is
 * legal while the subject roster has fewer of that position than this cap; the caps sum to the
 * 16-round roster size, so a naive arm is always forced to fill a complete, legal 16-man roster
 * rather than the "16 QBs" straw man (B2's raw-points ranking is QB-heavy). The engine-based arms
 * (engine/B4/B3) are governed by the engine's own value logic, not these caps.
 */
export const BACKTEST_POSITION_CAPS: Readonly<Record<Position, number>> = {
  QB: 2, RB: 5, WR: 6, TE: 1, K: 1, DEF: 1,
};

/** FFC `player_id` -> Sleeper player id. FFC calls Marquise Brown "Hollywood Brown"; the snapshot's
 * identity gate left that one row unmatched (recorded by name, never dropped). The harness hand-maps
 * it so he stays draftable and scores his real 2025 outcomes (5848 has weekly rows). */
export const BACKTEST_HAND_MAP: Readonly<Record<string, string>> = { '3249': '5848' };

// ---------------------------------------------------------------------------
// Inputs / context
// ---------------------------------------------------------------------------

/** One verbatim FFC ADP board row as frozen by `pipeline/backtest_snapshot.py`. */
export interface FfcAdpRow {
  player_id: number;
  name: string;
  position: string;
  team: string | null;
  adp: number;
  adp_formatted?: string;
  times_drafted?: number | null;
  high?: number | null;
  low?: number | null;
  stdev?: number | null;
  bye?: number | null;
  /** Resolved sleeper id from the snapshot's identity gate; null only for recorded misses. */
  sleeperId: string | null;
}

export interface BacktestInputs {
  /** Full draftable player pool (`data/players.json`). */
  players: PlayerMeta[];
  /** Frozen 2025 FFToday projections (`fixtures/backtest/2025/projections.json`). */
  projections: SeasonProjection[];
  /** FFC 2025 PPR ADP board with resolved sleeper ids (`fixtures/backtest/2025/adp-ppr.json`). */
  adp: AdpEntry[];
  /** Real 2025 weekly outcomes (`data/weekly-stats.json`). */
  weekly: PlayerWeeklyStatsArtifact;
}

export interface BacktestContext {
  settings: LeagueSettings;
  players: PlayerMeta[];
  playersById: Map<PlayerId, PlayerMeta>;
  projections: SeasonProjection[];
  scores: Map<PlayerId, number>;
  adp: AdpEntry[];
  adpByPlayerId: Map<PlayerId, AdpEntry>;
  weekly: PlayerWeeklyStatsArtifact;
  slotToTeam: Record<number, string>;
  opponentConfig: OpponentModelConfig;
  /** Season-projection replacement baseline for one full starting lineup (see `replacementAdjustedPoints`). */
  replacementLineupBaseline: number;
}

export function buildBacktestLeagueSettings(): LeagueSettings {
  return {
    provider: 'manual',
    leagueId: 'backtest-2025',
    name: '2025 Historical Backtest',
    season: BACKTEST_SEASON,
    teams: BACKTEST_TEAMS,
    startingSlots: [...BACKTEST_STARTING_SLOTS],
    rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 7 },
    scoring: { ...BACKTEST_SCORING },
    format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    playoffStartWeek: BACKTEST_PLAYOFF_START_WEEK,
  };
}

/** Resolves an FFC row to a sleeper id: the snapshot's id when present, else the hand-map. */
export function resolveFfcRowSleeperId(row: FfcAdpRow): string | null {
  if (row.sleeperId) return row.sleeperId;
  return BACKTEST_HAND_MAP[String(row.player_id)] ?? null;
}

/** Converts verbatim FFC rows into `AdpEntry[]` (FFC semantics: observed stdev, `high` = earliest
 * draft position, `low` = latest). Null `sleeperId` rows that the hand-map cannot resolve become
 * `playerId: null` entries and are flagged by `verifyBacktestIntegrity`. */
export function ffcRowsToAdpEntries(rows: readonly FfcAdpRow[]): AdpEntry[] {
  return rows.map((row) => ({
    playerId: resolveFfcRowSleeperId(row),
    name: row.name,
    position: row.position,
    team: row.team,
    adp: row.adp,
    stdev: row.stdev ?? 0,
    high: row.high ?? null,
    low: row.low ?? null,
    timesDrafted: row.times_drafted ?? null,
    byeWeek: row.bye ?? null,
    adpSource: 'ffc',
    stdevSource: 'observed',
  }));
}

/** Builds the immutable per-run context from loaded inputs. `settings.scoring` drives B2 and the
 * engine's projection scoring exactly as `gates.md` mandates; `weekly` drives only outcomes.
 * `options.opponentConfig` lets an opt-in experiment (e.g. the 2026-08-24 shock-scale sweep,
 * `BACKTEST_OPPONENT_SHOCK_SCALE`) replace the default opponent-model config; the caller — never
 * this pure module — reads the environment. Unset/omitted ⇒ byte-identical behavior. */
export function buildBacktestContext(
  inputs: BacktestInputs,
  options: { opponentConfig?: OpponentModelConfig } = {},
): BacktestContext {
  const settings = buildBacktestLeagueSettings();
  const playersById = new Map(inputs.players.map((player) => [player.playerId, player]));
  const scores = new Map<PlayerId, number>();
  for (const projection of inputs.projections) {
    scores.set(projection.playerId, scoreProjection(
      projection, settings, playersById.get(projection.playerId)?.position,
    ).points);
  }
  const adpByPlayerId = new Map<PlayerId, AdpEntry>();
  for (const entry of inputs.adp) {
    if (entry.playerId != null) adpByPlayerId.set(entry.playerId, entry);
  }
  const slotToTeam: Record<number, string> = {};
  for (let slot = 1; slot <= BACKTEST_TEAMS; slot += 1) slotToTeam[slot] = `team-${slot}`;

  // Season-projection replacement baseline (zero consumed, mirroring computeValueAnchor) so the
  // backtest's replacement-adjusted number is on the same scale as the board's replacement levels.
  const demand = positionalDemand({
    settings,
    adp: inputs.adp,
    rosterSpotsPerTeam: BACKTEST_ROUNDS,
    scoredPlayerIds: new Set(scores.keys()),
  });
  const scoredPlayers = inputs.players.filter((player) => scores.has(player.playerId));
  const levels = replacementLevels(settings, scoredPlayers, scores, { demandByPosition: demand.byPosition });
  const replacement = replacementPointsByPosition(levels);
  const flexReplacement = Math.max(replacement.get('RB') ?? 0, replacement.get('WR') ?? 0, replacement.get('TE') ?? 0);
  const replacementLineupBaseline = (replacement.get('QB') ?? 0)
    + 2 * (replacement.get('RB') ?? 0)
    + 2 * (replacement.get('WR') ?? 0)
    + (replacement.get('TE') ?? 0)
    + flexReplacement
    + (replacement.get('K') ?? 0)
    + (replacement.get('DEF') ?? 0);

  return {
    settings,
    players: inputs.players,
    playersById,
    projections: inputs.projections,
    scores,
    adp: inputs.adp,
    adpByPlayerId,
    weekly: inputs.weekly,
    slotToTeam,
    opponentConfig: options.opponentConfig
      ?? defaultOpponentModelConfig(BACKTEST_TEAMS, BACKTEST_ROUNDS),
    replacementLineupBaseline,
  };
}

// ---------------------------------------------------------------------------
// Draft simulation (six arms over one shared opponent field)
// ---------------------------------------------------------------------------

export interface DraftResult {
  slot: number;
  seedIndex: number;
  arm: BacktestArm;
  subjectRoster: PlayerMeta[];
  rostersByTeam: Map<string, PlayerMeta[]>;
  /** Round of the subject's FIRST pick at each position (absent = never drafted there).
   * Diagnostics-only (2026-08-24 c1-attribution pre-declaration); feeds no gate. */
  subjectFirstPickRound: Partial<Record<Position, number>>;
}

export function draftSeedFor(slot: number, seedIndex: number): Seed {
  return hashStateSeed(['backtest-2025', BACKTEST_BASE_SEED, String(slot), String(seedIndex)]);
}

/** Simulates one complete 192-pick draft for a (slot, seedIndex, arm) cell. Opponent picks always
 * use `opponentModel.ts` with the context's config; only the subject seat runs `arm`. The per-pick
 * opponent shock stream derives from the same per-draft seed for every arm (common random numbers
 * across the paired comparison). */
export function simulateDraft(
  ctx: BacktestContext,
  slot: number,
  seedIndex: number,
  arm: BacktestArm,
  seed: Seed = draftSeedFor(slot, seedIndex),
): DraftResult {
  const myTeamId = ctx.slotToTeam[slot]!;
  // `c1` shares the `engine` arm's draftId (not its own) so Stage C's per-scenario RNG stream
  // (`hashStateSeed([draftId, ...])`, simulate.ts) is common-random-numbers-paired with `engine`'s
  // rollouts at the same (slot, seedIndex) — isolating the sort-key difference (planValue vs
  // lookaheadValue) as the only source of any outcome gap between the two arms.
  const rolloutArm = arm === 'c1' ? 'engine' : arm;
  const draftId = `backtest-2025-s${slot}-n${seedIndex}-${rolloutArm}`;
  const picks: Pick[] = [];
  const rostersByTeam = new Map<string, PlayerMeta[]>();
  const preparedByTeam = new Map<string, PreparedLineup>();
  let subjectRoster: PlayerMeta[] = [];
  const subjectFirstPickRound: Partial<Record<Position, number>> = {};

  for (let overall = 1; overall <= BACKTEST_TEAMS * BACKTEST_ROUNDS; overall += 1) {
    const slotOf = slotForOverall('snake', BACKTEST_TEAMS, overall);
    const teamId = ctx.slotToTeam[slotOf]!;
    const round = Math.ceil(overall / BACKTEST_TEAMS);
    const player = slotOf === slot
      ? pickSubject(ctx, arm, overall, picks, subjectRoster, myTeamId, draftId)
      : pickOpponent(ctx, teamId, overall, picks, preparedByTeam, rostersByTeam, seed);
    if (slotOf === slot) {
      subjectRoster = [...subjectRoster, player];
      if (!rostersByTeam.has(teamId)) rostersByTeam.set(teamId, []);
      rostersByTeam.get(teamId)!.push(player);
      if (player.position != null && subjectFirstPickRound[player.position] == null) {
        subjectFirstPickRound[player.position] = round;
      }
    }
    picks.push({
      overall, round, slot: slotOf, teamId,
      playerId: player.playerId,
      providerPlayerId: player.playerId,
      providerPlayerName: player.name,
    });
  }
  return { slot, seedIndex, arm, subjectRoster, rostersByTeam, subjectFirstPickRound };
}

/** Exported for `simSortProbe.ts`, which drives its own draft loop over the same opponent field
 * (`pickOpponent` below) so its trajectory matches the `engine` arm exactly — a duplicated copy of
 * this filter could silently drift from the real one. */
export function remainingPlayers(ctx: BacktestContext, picks: readonly Pick[]): PlayerMeta[] {
  const drafted = new Set(picks.filter((p) => p.playerId != null).map((p) => p.playerId as PlayerId));
  return ctx.players.filter((player) => !drafted.has(player.playerId));
}

/** Pre-declared naive-BPA roster-legality rule: a position is legal while the subject roster has
 * fewer of it than `BACKTEST_POSITION_CAPS[position]`, and the roster is not yet full (16 rounds). */
export function isLegalPick(player: PlayerMeta, subjectRoster: readonly PlayerMeta[]): boolean {
  if (player.position == null) return false;
  if (subjectRoster.length >= BACKTEST_ROUNDS) return false;
  const cap = BACKTEST_POSITION_CAPS[player.position];
  const count = subjectRoster.reduce((n, p) => n + (p.position === player.position ? 1 : 0), 0);
  return count < cap;
}

/** First player in `ordered` the subject can legally roster, or null. Used by B1/B2. */
export function pickBestLegal(ordered: readonly PlayerMeta[], subjectRoster: readonly PlayerMeta[]): PlayerMeta | null {
  return ordered.find((player) => isLegalPick(player, subjectRoster)) ?? null;
}

/** Canonical static-VOR re-sort key for baseline 3 (mirrors recommendPosition.test.ts's comparator). */
export function compareByReplacementAdjustedValue(a: Recommendation, b: Recommendation): number {
  return (b.replacementAdjustedValue - a.replacementAdjustedValue)
    || (b.vor - a.vor)
    || (b.projectedPoints - a.projectedPoints)
    || a.playerId.localeCompare(b.playerId);
}

function pickSubject(
  ctx: BacktestContext,
  arm: BacktestArm,
  overall: number,
  picks: readonly Pick[],
  subjectRoster: readonly PlayerMeta[],
  myTeamId: string,
  draftId: string,
): PlayerMeta {
  switch (arm) {
    case 'b1': return pickByB1(ctx, picks, subjectRoster);
    case 'b2': return pickByB2(ctx, picks, subjectRoster);
    case 'b3': return pickByB3(ctx, overall, picks, myTeamId, subjectRoster);
    case 'b4': return pickByEngineFamily(ctx, 'b4', overall, picks, myTeamId, draftId);
    case 'engine': return pickByEngineFamily(ctx, 'engine', overall, picks, myTeamId, draftId);
    case 'c1': return pickByEngineFamily(ctx, 'c1', overall, picks, myTeamId, draftId);
  }
}

/** B1: straight FFC 2025 ADP order, legality-capped. No engine call. */
function pickByB1(ctx: BacktestContext, picks: readonly Pick[], subjectRoster: readonly PlayerMeta[]): PlayerMeta {
  const ordered = remainingPlayers(ctx, picks)
    .filter((player) => ctx.adpByPlayerId.has(player.playerId))
    .sort((a, b) => {
      const adpA = ctx.adpByPlayerId.get(a.playerId)!.adp;
      const adpB = ctx.adpByPlayerId.get(b.playerId)!.adp;
      return adpA - adpB || a.playerId.localeCompare(b.playerId);
    });
  const pick = pickBestLegal(ordered, subjectRoster);
  if (!pick) throw new Error('B1 stalled: no legal FFC-board candidate remains');
  return pick;
}

/** B2: raw projected PPR points (scoreProjection over the 2025 projections), legality-capped. */
function pickByB2(ctx: BacktestContext, picks: readonly Pick[], subjectRoster: readonly PlayerMeta[]): PlayerMeta {
  const ordered = remainingPlayers(ctx, picks)
    .filter((player) => ctx.scores.has(player.playerId))
    .sort((a, b) => (ctx.scores.get(b.playerId)! - ctx.scores.get(a.playerId)!) || a.playerId.localeCompare(b.playerId));
  const pick = pickBestLegal(ordered, subjectRoster);
  if (!pick) throw new Error('B2 stalled: no legal scored candidate remains');
  return pick;
}

/** B3 — the gate baseline: static VOR without availability/lookahead. `nextPick` omitted and no
 * simulation -> planningActive is false (recommend.ts:856); the re-sort by replacementAdjustedValue
 * (recommend.ts:990) is required because rankingBasis 'rosterUtility' resolves to
 * marginalRosterUtility, not VOR. `includeAnalysisRows: true` exposes the full pre-slice pool.
 * `subjectRoster` feeds ONLY the defensive fallback below — B3's own policy deliberately has no
 * position caps (the engine-based arms are governed by value logic, not BACKTEST_POSITION_CAPS). */
function pickByB3(
  ctx: BacktestContext,
  overall: number,
  picks: readonly Pick[],
  myTeamId: string,
  subjectRoster: readonly PlayerMeta[],
): PlayerMeta {
  const input: RecommendationInput = {
    settings: ctx.settings,
    players: ctx.players,
    projections: ctx.projections,
    adp: ctx.adp,
    picks: picks as Pick[],
    myTeamId,
    nextPick: null,
    currentPick: overall,
    limit: 24,
    rolloutDisplayLimit: 5,
    includeAnalysisRows: true,
    displayPosition: null,
    includeRecommendationViews: false,
    includeMarketRecommendations: false,
    includeExpansion: false,
    rosterSpotsPerTeam: BACKTEST_ROUNDS,
    draftRounds: BACKTEST_ROUNDS,
  };
  const result = buildRecommendationBoard(input);
  const rows = result.analysis?.deterministicRows ?? [];
  const ordered = [...rows].sort(compareByReplacementAdjustedValue);
  const pick = ordered.find((recommendation) => ctx.playersById.has(recommendation.playerId));
  if (pick) return ctx.playersById.get(pick.playerId)!;
  // Defensive fallback (unreachable in practice): best remaining by raw points, still honoring
  // BACKTEST_POSITION_CAPS against the real roster state rather than an empty one.
  return pickByB2(ctx, picks, subjectRoster);
}

/** B4 / Engine / C1: the real `buildRecommendationBoard`. B4 sets `nextPick` with simulation
 * omitted (analytic planning, no Monte Carlo). Engine adds the Stage C simulation context;
 * `mode: 'fixed'` with DEFAULT_SCENARIOS (8) is used instead of production's wall-clock-budgeted
 * mode so the run is byte-identical across executions. C1 (added 2026-08-22 per the sim-sort
 * disagreement probe's pre-declared rule, `DECISIONS.md`) runs the identical simulation as `engine`
 * but picks by `simSortProbe.ts`'s `simSortChoice` — sorting by Stage C's simulated
 * `lookaheadValue` instead of the production `planValue` — via `includeAnalysisRows: true`. */
function pickByEngineFamily(
  ctx: BacktestContext,
  mode: 'engine' | 'b4' | 'c1',
  overall: number,
  picks: readonly Pick[],
  myTeamId: string,
  draftId: string,
): PlayerMeta {
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
    includeAnalysisRows: mode === 'c1',
    displayPosition: null,
    includeRecommendationViews: false,
    includeMarketRecommendations: false,
    includeExpansion: false,
    rosterSpotsPerTeam: BACKTEST_ROUNDS,
    draftRounds: BACKTEST_ROUNDS,
    ...(mode === 'engine' || mode === 'c1' ? {
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
    } : {}),
  };
  const result = buildRecommendationBoard(input);
  const topId = mode === 'c1'
    ? simSortChoice(result, ctx.playersById).playerId
    : result.recommendations[0]?.playerId;
  if (topId == null) throw new Error(`${mode} arm returned no recommendation at overall ${overall}`);
  const player = ctx.playersById.get(topId);
  if (!player) throw new Error(`${mode} arm recommended unknown player ${topId}`);
  return player;
}

/** One opponent pick: seeded ADP-noise priorities + the windowed argmin with roster-need bonus.
 * Roster state is maintained incrementally (`resolveAmbiguityExactly: false` — only per-dedicated-
 * slot fill state is read by needBonusFromLineup, never occupant identity). Exported for
 * `simSortProbe.ts` — see `remainingPlayers`'s doc above. */
export function pickOpponent(
  ctx: BacktestContext,
  teamId: string,
  overall: number,
  picks: readonly Pick[],
  preparedByTeam: Map<string, PreparedLineup>,
  rostersByTeam: Map<string, PlayerMeta[]>,
  seed: Seed,
): PlayerMeta {
  const remaining = remainingPlayers(ctx, picks);
  const pool = buildOpponentPool(remaining, ctx.scores, ctx.adp, ctx.opponentConfig, ctx.players);
  const priorities = computeScenarioPriorities(pool, createRng(deriveStream(seed, overall)), ctx.opponentConfig);
  const prepared = preparedByTeam.get(teamId) ?? prepareLineup(ctx.settings, [], new Map());
  const drafted = new Set(picks.filter((p) => p.playerId != null).map((p) => p.playerId as PlayerId));
  const pickId = pickForTeam(
    priorities, drafted, needBonusFromLineup(prepared, ctx.opponentConfig), ctx.opponentConfig.candidateWindow,
  );
  const player = pickId != null
    ? ctx.playersById.get(pickId)
    : remaining.filter((p) => ctx.scores.has(p.playerId)).sort(
      (a, b) => (ctx.scores.get(b.playerId)! - ctx.scores.get(a.playerId)!) || a.playerId.localeCompare(b.playerId),
    )[0];
  if (!player) throw new Error(`opponent pool exhausted at overall ${overall}`);
  const points = ctx.scores.get(player.playerId) ?? 0;
  preparedByTeam.set(teamId, addPlayerToLineup(prepared, player, points, false).state);
  if (!rostersByTeam.has(teamId)) rostersByTeam.set(teamId, []);
  rostersByTeam.get(teamId)!.push(player);
  return player;
}

// ---------------------------------------------------------------------------
// Task 4 — score finished rosters against real 2025 outcomes
// ---------------------------------------------------------------------------

export interface WeeklyScore {
  /** Weeks 1-17 (or the requested subset) exact optimal starter values from real 2025 pts. */
  perWeek: number[];
  /** Fraction of weeks with a full legal lineup fillable from players with a 'played' row. */
  coverage: number;
}

/** One team's real 2025 weekly optimum. `optimizeLineupValue` is the exact lineup-DP value (the
 * same optimum `optimizeLineup` computes) read at ~5x lower cost — the backtest scores ~185
 * (team, week) cells per draft. Zero-outcome players (drafted but with no 2025 weekly rows) are
 * scored 0 all season, never excluded. Coverage uses the 'played' row distinction from
 * `buildGameLogRows` ('played' | 'bye' | 'inactive' | 'nodata'). */
export function scoreRosterWeekly(
  settings: LeagueSettings,
  roster: readonly PlayerMeta[],
  weekly: PlayerWeeklyStatsArtifact,
  weeks: readonly number[] = BACKTEST_WEEKS,
): WeeklyScore {
  const startSlotCount = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR').length;
  const rowsByPlayer = roster.map((player) => ({
    player,
    byWeek: new Map(buildGameLogRows(weekly, player.playerId, player.position).map((row) => [row.week, row])),
  }));
  const perWeek: number[] = [];
  let covered = 0;
  for (const week of weeks) {
    const weekPts = new Map<PlayerId, number>();
    const coveragePts = new Map<PlayerId, number>();
    for (const { player, byWeek } of rowsByPlayer) {
      const row = byWeek.get(week);
      const played = row?.kind === 'played' && row.pts != null;
      weekPts.set(player.playerId, played && row.pts != null ? row.pts : 0);
      coveragePts.set(player.playerId, played ? 1 : 0);
    }
    perWeek.push(optimizeLineupValue(settings, roster, weekPts));
    if (optimizeLineupValue(settings, roster, coveragePts) >= startSlotCount) covered += 1;
  }
  return { perWeek, coverage: covered / weeks.length };
}

/** The six positions starter points are attributed to in the positional decomposition. FLEX points
 * land in the occupant's own position, so per-week values across these six sum exactly to that
 * week's `optimizeLineup*` optimum — no separate FLEX bucket, no reconciliation ambiguity. */
export const BACKTEST_BOX_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export interface WeeklyScoreByPosition extends WeeklyScore {
  /** Mean over the scored weeks of exact-optimal starter points attributed to each starter's own
   * position; the six values sum to `mean(perWeek)` up to float rounding. */
  meanByPosition: Record<Position, number>;
}

/** `scoreRosterWeekly` plus the positional decomposition of the same exact optimum, via
 * `optimizeLineupStarters`' bit-identical value + occupant identity. Used ONLY for the subject
 * seat (`runBacktest`) — the H2H field keeps the value-only path. Zero-outcome semantics are
 * inherited unchanged from `scoreRosterWeekly`: a drafted player with no weekly rows scores 0 and
 * simply never accumulates bucket points. */
export function scoreRosterWeeklyDetailed(
  settings: LeagueSettings,
  roster: readonly PlayerMeta[],
  weekly: PlayerWeeklyStatsArtifact,
  weeks: readonly number[] = BACKTEST_WEEKS,
): WeeklyScoreByPosition {
  const startSlotCount = settings.startingSlots.filter((slot) => slot !== 'BN' && slot !== 'IR').length;
  const rowsByPlayer = roster.map((player) => ({
    player,
    byWeek: new Map(buildGameLogRows(weekly, player.playerId, player.position).map((row) => [row.week, row])),
  }));
  const positionByPlayer = new Map(roster.map((player) => [player.playerId, player.position]));
  const perWeek: number[] = [];
  const sumsByPosition = Object.fromEntries(
    BACKTEST_BOX_POSITIONS.map((pos) => [pos, 0]),
  ) as Record<Position, number>;
  let covered = 0;
  for (const week of weeks) {
    const weekPts = new Map<PlayerId, number>();
    const coveragePts = new Map<PlayerId, number>();
    for (const { player, byWeek } of rowsByPlayer) {
      const row = byWeek.get(week);
      const played = row?.kind === 'played' && row.pts != null;
      weekPts.set(player.playerId, played && row.pts != null ? row.pts : 0);
      coveragePts.set(player.playerId, played ? 1 : 0);
    }
    const { value, starters } = optimizeLineupStarters(settings, roster, weekPts);
    perWeek.push(value);
    for (const starterId of starters) {
      if (starterId == null) continue;
      const pos = positionByPlayer.get(starterId);
      if (pos != null) sumsByPosition[pos] += weekPts.get(starterId) ?? 0;
    }
    if (optimizeLineupValue(settings, roster, coveragePts) >= startSlotCount) covered += 1;
  }
  const meanByPosition = Object.fromEntries(
    BACKTEST_BOX_POSITIONS.map((pos) => [pos, sumsByPosition[pos] / weeks.length]),
  ) as Record<Position, number>;
  return { perWeek, coverage: covered / weeks.length, meanByPosition };
}

/** Season total minus the positional replacement baseline for the 9 starting slots (the engine's
 * own replacement-level concept, zero-consumed season projections), so the number is comparable to
 * the board's replacement-adjusted values. `replacementLineupBaseline` is already a season-projection
 * total for one full lineup — it is subtracted once, not per week. FLEX is priced at the best
 * flex-eligible replacement. */
export function replacementAdjustedPoints(
  ctx: BacktestContext,
  weeklyValues: readonly number[],
): number {
  const seasonTotal = weeklyValues.reduce((sum, value) => sum + value, 0);
  return seasonTotal - ctx.replacementLineupBaseline;
}

function fisherYates<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

export interface ScheduleResult {
  /** Mean H2H win rate (win=1, tie=0.5) across the sampled schedules, weeks 1-14. */
  winRate: number;
  /** Fraction of sampled schedules where the subject finished top-6 (playoffStartWeek cutoff). */
  playoffRate: number;
}

/** H2H wins / playoff rate "across schedules": 12 teams, weeks 1-14 regular season, top-6 playoffs
 * (LeagueSettings.playoffStartWeek = 15), averaged over `samples` seeded schedule samples so a
 * single lucky schedule cannot decide the gate. Each sample is 14 weeks of random perfect matchings
 * (seeded Fisher-Yates); records are tie-broken by regular-season points, then team id, so the
 * top-6 cutoff is deterministic per sample. */
export function simulateSchedules(
  weeklyByTeam: ReadonlyMap<string, readonly number[]>,
  subjectTeamId: string,
  seed: Seed,
  samples: number = BACKTEST_H2H_SCHEDULE_SAMPLES,
): ScheduleResult {
  const teamIds = [...weeklyByTeam.keys()];
  const regularSeasonWeeks = BACKTEST_WEEKS.filter((week) => week < BACKTEST_PLAYOFF_START_WEEK);
  const playoffCutoff = Math.floor(teamIds.length / 2);
  let subjectWins = 0;
  let subjectGames = 0;
  let subjectPlayoff = 0;

  for (let sample = 0; sample < samples; sample += 1) {
    const rng = createRng(deriveStream(seed, sample));
    const records = new Map<string, number>(teamIds.map((id) => [id, 0]));
    const points = new Map<string, number>(teamIds.map((id) => [id, 0]));
    for (const week of regularSeasonWeeks) {
      const order = fisherYates(teamIds, rng);
      for (let i = 0; i < order.length; i += 2) {
        const a = order[i] as string;
        const b = order[i + 1] as string;
        const pa = weeklyByTeam.get(a)?.[week - 1] ?? 0;
        const pb = weeklyByTeam.get(b)?.[week - 1] ?? 0;
        const aResult = pa > pb ? 1 : pa < pb ? 0 : 0.5;
        records.set(a, (records.get(a) ?? 0) + aResult);
        records.set(b, (records.get(b) ?? 0) + (1 - aResult));
        points.set(a, (points.get(a) ?? 0) + pa);
        points.set(b, (points.get(b) ?? 0) + pb);
      }
    }
    const subjectRecord = records.get(subjectTeamId) ?? 0;
    subjectWins += subjectRecord;
    subjectGames += regularSeasonWeeks.length;
    const ranked = [...teamIds].sort((x, y) =>
      (records.get(y) ?? 0) - (records.get(x) ?? 0)
      || (points.get(y) ?? 0) - (points.get(x) ?? 0)
      || x.localeCompare(y));
    if (ranked.slice(0, playoffCutoff).includes(subjectTeamId)) subjectPlayoff += 1;
  }
  return { winRate: subjectWins / subjectGames, playoffRate: subjectPlayoff / samples };
}

// ---------------------------------------------------------------------------
// Integrity — never silently drop (mirrors the snapshot's convention)
// ---------------------------------------------------------------------------

export interface BacktestIntegrity {
  ffcRows: number;
  resolved: number;
  /** Rows resolved only through the hand-map (Hollywood Brown). */
  handMapped: { ffcPlayerId: string; ffcName: string; sleeperId: string; sleeperName: string }[];
  /** Resolved ids with no 2025 weekly rows — must be scored 0 all season, never excluded. */
  zeroOutcomeIds: string[];
  /** Resolved ids absent from data/players.json — must be empty (fail-closed). */
  missingFromPlayersJson: string[];
  /** FFC rows still unresolvable after the hand-map — must be empty (fail-closed). */
  unresolvedRows: string[];
}

export function verifyBacktestIntegrity(rows: readonly FfcAdpRow[], inputs: BacktestInputs): BacktestIntegrity {
  const playerIds = new Set(inputs.players.map((p) => p.playerId));
  const weeklyIds = new Set(Object.keys(inputs.weekly.players ?? {}));
  const resolvedIds: string[] = [];
  const handMapped: BacktestIntegrity['handMapped'] = [];
  const missingFromPlayersJson: string[] = [];
  const unresolvedRows: string[] = [];
  for (const row of rows) {
    const id = resolveFfcRowSleeperId(row);
    if (id == null) {
      unresolvedRows.push(`${row.name} (${row.position})`);
      continue;
    }
    resolvedIds.push(id);
    if (row.sleeperId == null) {
      handMapped.push({
        ffcPlayerId: String(row.player_id), ffcName: row.name, sleeperId: id,
        sleeperName: inputs.players.find((p) => p.playerId === id)?.name ?? 'unknown',
      });
    }
    if (!playerIds.has(id)) missingFromPlayersJson.push(id);
  }
  const zeroOutcomeIds = resolvedIds.filter((id) => !weeklyIds.has(id)).sort();
  return {
    ffcRows: rows.length,
    resolved: resolvedIds.length,
    handMapped,
    zeroOutcomeIds,
    missingFromPlayersJson: missingFromPlayersJson.sort(),
    unresolvedRows,
  };
}

// ---------------------------------------------------------------------------
// Aggregation + gates
// ---------------------------------------------------------------------------

export interface BacktestRunOptions {
  /** Distinct seed indices per slot. 20 = pilot (directional); 84+ = gating run (N >= 1000). */
  seedCount: number;
  /** When true the gate verdicts are applied and recorded; pilot runs report the numbers only. */
  gating: boolean;
  /** Optional per-slot progress hook for the multi-hour opt-in runs (a gating run is otherwise
   * silent inside one vitest `it` until it finishes). Pure-module contract preserved: this module
   * never logs on its own; only the runner (`backtest.bench.ts`) supplies a logger, and the value
   * reported is wall-clock elapsed time, which never influences any computed metric. */
  onSlotComplete?: (slot: number, totalSlots: number, elapsedMs: number) => void;
  /** Optional per-draft progress hook, fired after every (slot, seed) draft (all arms) completes —
   * finer-grained than `onSlotComplete` so the runner can log at fixed percent thresholds. */
  onDraftComplete?: (completed: number, total: number, elapsedMs: number) => void;
}

export interface ArmResult {
  arm: BacktestArm;
  drafts: number;
  /** Mean over drafts of the per-draft mean optimized weekly starter points (weeks 1-17). */
  meanWeeklyPoints: number;
  /** 10th-percentile weekly team total, pooled over all (draft, week) cells — the downside number. */
  p10WeeklyPoints: number;
  meanReplacementAdjustedPoints: number;
  meanCoverage: number;
  meanH2hWinRate: number;
  meanPlayoffRate: number;
  /** Per-draft mean weekly points — the paired-sample unit for the primary-gate CI. */
  perDraftMeanWeekly: readonly number[];
  /** Diagnostics-only (2026-08-24 c1-attribution pre-declaration): per-draft mean weekly starter
   * points attributed to each position (`BACKTEST_BOX_POSITIONS` order), slot-major like
   * `perDraftMeanWeekly`. Feeds no gate; sums to `perDraftMeanWeekly` up to float rounding. */
  perDraftStarterPointsByPosition: Record<Position, readonly number[]>;
  /** Diagnostics-only: round of the subject's first pick at each position, per draft (0 = never
   * drafted there), slot-major like `perDraftMeanWeekly`. Feeds no gate. */
  firstPickRoundByPosition: Record<Position, readonly number[]>;
}

export interface PairedStats {
  n: number;
  meanEngine: number;
  meanBaseline: number;
  meanDiff: number;
  stdErr: number;
  ciLower: number;
  ciUpper: number;
}

export interface GateVerdict {
  label: string;
  holds: boolean;
  detail: string;
}

export interface BacktestRunResult {
  gating: boolean;
  seedCount: number;
  draftsPerArm: number;
  arms: Record<BacktestArm, ArmResult>;
  pairedEngineVsB3: PairedStats;
  /** Informational only (2026-08-22, sim-sort disagreement probe) — never gating, never touches
   * `gates`. Compares `c1` (sorts by simulated `lookaheadValue`) against `engine` (production
   * `planValue`) on the same paired grid, with common-random-numbers Stage C rollouts. */
  pairedC1VsEngine: PairedStats;
  gates: GateVerdict[];
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** Nearest-rank percentile on an ascending-sorted array (same convention as simulate.ts). */
export function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.max(1, Math.ceil(fraction * sortedAscending.length));
  return sortedAscending[Math.min(index, sortedAscending.length) - 1] ?? 0;
}

/** Paired engine-vs-baseline stats: per-draft differences, mean, SE, and the 95% CI via the normal
 * approximation (df >= 240 in the pilot, so z = 1.96 is within ~0.01 of the t critical value). */
export function pairedEngineVsBaseline(
  engineMeans: readonly number[],
  baselineMeans: readonly number[],
): PairedStats {
  const n = Math.min(engineMeans.length, baselineMeans.length);
  const meanEngine = mean(engineMeans);
  const meanBaseline = mean(baselineMeans);
  const diffs = Array.from({ length: n }, (_, i) => (engineMeans[i] ?? 0) - (baselineMeans[i] ?? 0));
  const meanDiff = mean(diffs);
  const variance = n > 1 ? diffs.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / (n - 1) : 0;
  const stdErr = Math.sqrt(variance / n);
  return {
    n,
    meanEngine,
    meanBaseline,
    meanDiff,
    stdErr,
    ciLower: meanDiff - 1.96 * stdErr,
    ciUpper: meanDiff + 1.96 * stdErr,
  };
}

/** Applies the pre-declared gates (fixtures/backtest/2025/gates.md). Pilot runs report the numbers
 * without a verdict; the gating run applies: point floor, CI, and the downside 10th-percentile gate. */
export function evaluateGates(
  paired: PairedStats,
  engineP10: number,
  baselineP10: number,
  gating: boolean,
): GateVerdict[] {
  if (!gating) {
    return [{
      label: 'pilot',
      holds: true,
      detail: 'Directional pilot run (non-gating). All metrics and the paired CI are reported; gate '
        + 'verdicts are applied only in the gating run (BACKTEST_GATING=1, N >= 1000).',
    }];
  }
  const floorHold = paired.meanEngine >= paired.meanBaseline - 0.25;
  const ciHold = paired.ciLower > -0.25;
  const downsideHold = engineP10 >= baselineP10 - 0.5;
  return [
    {
      label: 'primary-point-floor',
      holds: floorHold,
      detail: `engine mean ${paired.meanEngine.toFixed(3)} >= baseline-3 mean ${paired.meanBaseline.toFixed(3)} - 0.25`,
    },
    {
      label: 'primary-ci',
      holds: ciHold,
      detail: `paired-diff 95% CI lower ${paired.ciLower.toFixed(3)} > -0.25 `
        + `(mean diff ${paired.meanDiff.toFixed(3)}, SE ${paired.stdErr.toFixed(3)}, n=${paired.n})`,
    },
    {
      label: 'downside',
      holds: downsideHold,
      detail: `engine 10th-percentile weekly total ${engineP10.toFixed(3)} `
        + `>= baseline-3 ${baselineP10.toFixed(3)} - 0.5`,
    },
  ];
}

/** Runs the full (slot x seed) grid for all six arms and aggregates the metrics + gates. */
export function runBacktest(ctx: BacktestContext, options: BacktestRunOptions): BacktestRunResult {
  const startedAtMs = Date.now();
  const rawByArm = new Map<BacktestArm, {
    perDraftMeanWeekly: number[];
    pooledWeekly: number[];
    replacementAdjusted: number[];
    coverage: number[];
    h2hWinRate: number[];
    playoffRate: number[];
    starterPointsByPos: Record<Position, number[]>;
    firstPickRoundByPos: Record<Position, number[]>;
  }>();
  for (const arm of BACKTEST_ARMS) {
    rawByArm.set(arm, {
      perDraftMeanWeekly: [], pooledWeekly: [], replacementAdjusted: [], coverage: [], h2hWinRate: [], playoffRate: [],
      starterPointsByPos: BACKTEST_BOX_POSITIONS.reduce(
        (acc, pos) => { acc[pos] = []; return acc; },
        {} as Record<Position, number[]>,
      ),
      firstPickRoundByPos: BACKTEST_BOX_POSITIONS.reduce(
        (acc, pos) => { acc[pos] = []; return acc; },
        {} as Record<Position, number[]>,
      ),
    });
  }

  for (let slot = 1; slot <= BACKTEST_TEAMS; slot += 1) {
    for (let seedIndex = 0; seedIndex < options.seedCount; seedIndex += 1) {
      const seed = draftSeedFor(slot, seedIndex);
      const myTeamId = ctx.slotToTeam[slot]!;
      for (const arm of BACKTEST_ARMS) {
        const draft = simulateDraft(ctx, slot, seedIndex, arm, seed);
        const raw = rawByArm.get(arm)!;
        // Subject seat only: the positional decomposition needs occupant identity. The H2H field
        // below stays on the value-only path.
        const subject = scoreRosterWeeklyDetailed(ctx.settings, draft.subjectRoster, ctx.weekly);
        raw.perDraftMeanWeekly.push(mean(subject.perWeek));
        raw.pooledWeekly.push(...subject.perWeek);
        raw.replacementAdjusted.push(replacementAdjustedPoints(ctx, subject.perWeek));
        raw.coverage.push(subject.coverage);
        for (const pos of BACKTEST_BOX_POSITIONS) {
          raw.starterPointsByPos[pos].push(subject.meanByPosition[pos]);
          raw.firstPickRoundByPos[pos].push(draft.subjectFirstPickRound[pos] ?? 0);
        }

        // H2H / playoff across schedules — every drafted league needs all 12 rosters' week 1-14 totals.
        const weeklyByTeam = new Map<string, readonly number[]>();
        for (const [teamId, roster] of draft.rostersByTeam) {
          weeklyByTeam.set(teamId, scoreRosterWeekly(ctx.settings, roster, ctx.weekly).perWeek);
        }
        const schedules = simulateSchedules(
          weeklyByTeam, myTeamId, deriveStream(seed, BACKTEST_TEAMS * BACKTEST_ROUNDS + 1),
        );
        raw.h2hWinRate.push(schedules.winRate);
        raw.playoffRate.push(schedules.playoffRate);
      }
      const completed = (slot - 1) * options.seedCount + seedIndex + 1;
      options.onDraftComplete?.(completed, BACKTEST_TEAMS * options.seedCount, Date.now() - startedAtMs);
    }
    options.onSlotComplete?.(slot, BACKTEST_TEAMS, Date.now() - startedAtMs);
  }

  const arms = {} as Record<BacktestArm, ArmResult>;
  for (const arm of BACKTEST_ARMS) {
    const raw = rawByArm.get(arm)!;
    const sortedPooled = [...raw.pooledWeekly].sort((a, b) => a - b);
    arms[arm] = {
      arm,
      drafts: raw.perDraftMeanWeekly.length,
      meanWeeklyPoints: mean(raw.perDraftMeanWeekly),
      p10WeeklyPoints: percentile(sortedPooled, 0.10),
      meanReplacementAdjustedPoints: mean(raw.replacementAdjusted),
      meanCoverage: mean(raw.coverage),
      meanH2hWinRate: mean(raw.h2hWinRate),
      meanPlayoffRate: mean(raw.playoffRate),
      perDraftMeanWeekly: raw.perDraftMeanWeekly,
      perDraftStarterPointsByPosition: BACKTEST_BOX_POSITIONS.reduce(
        (acc, pos) => { acc[pos] = raw.starterPointsByPos[pos]; return acc; },
        {} as Record<Position, readonly number[]>,
      ),
      firstPickRoundByPosition: BACKTEST_BOX_POSITIONS.reduce(
        (acc, pos) => { acc[pos] = raw.firstPickRoundByPos[pos]; return acc; },
        {} as Record<Position, readonly number[]>,
      ),
    };
  }

  const pairedEngineVsB3 = pairedEngineVsBaseline(arms.engine.perDraftMeanWeekly, arms.b3.perDraftMeanWeekly);
  const gates = evaluateGates(
    pairedEngineVsB3, arms.engine.p10WeeklyPoints, arms.b3.p10WeeklyPoints, options.gating,
  );
  // Informational only — never feeds `gates`. See BacktestRunResult.pairedC1VsEngine's doc.
  const pairedC1VsEngine = pairedEngineVsBaseline(arms.c1.perDraftMeanWeekly, arms.engine.perDraftMeanWeekly);

  return {
    gating: options.gating,
    seedCount: options.seedCount,
    draftsPerArm: BACKTEST_TEAMS * options.seedCount,
    arms,
    pairedEngineVsB3,
    pairedC1VsEngine,
    gates,
  };
}
