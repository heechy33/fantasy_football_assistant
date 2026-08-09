import type { AdpEntry, LeagueSettings, Pick, PlayerId, PlayerMeta, RosterSlot, SeasonProjection } from '../../../shared/types';
import { estimateAvailability } from './availability';
import { addPlayerToLineup, coreStartingSlotsFilled, prepareLineup } from './eligibility';
import { positionalDemand, replacementLevels, replacementPointsByPosition, vorForPlayer, type PositionalDemand, type ReplacementLevel } from './replacement';
import { scoreProjection } from './scoring';
import type { ScoringDiagnosticSeverity } from './scoring';
import { buildTiers } from './tiers';

export interface Recommendation {
  playerId: PlayerId;
  rank: number;
  projectedPoints: number;
  /** optimizeLineup(roster + player) - optimizeLineup(roster). PLAN.md §2's MRV, unchanged meaning. */
  marginalRosterValue: number;
  /** optimizeLineup(roster + player) - optimizeLineup(roster + replacement-level alternative). The
   * sort key: reduces to VOR when the player's slot is open, to MRV when it's already filled by a
   * better incumbent. Fixes the old sort degenerating to raw projected points on an open slot. */
  replacementAdjustedValue: number;
  /** What the replacement baseline above was, for the explanation. */
  replacementLevelPoints: number;
  vor: number;
  vona: number | null;
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
  availabilityStdev: number | null;
  availabilitySampleSize: number | null;
  scoringDiagnosticSeverity: ScoringDiagnosticSeverity;
  missingScoringKeys: string[];
  confidence: 'low' | 'medium' | 'high';
  assignedRosterSlot: string | null;
  replacementPlayerId: PlayerId | null;
  reasons: string[];
  warnings: string[];
}

export interface RecommendationInput {
  settings: LeagueSettings;
  players: PlayerMeta[];
  projections: SeasonProjection[];
  adp: AdpEntry[];
  picks: Pick[];
  myTeamId: string | null;
  nextPick: number;
  /** The pick currently on the clock, for survival-conditioned availability. Defaults to
   * `picks.length + 1` so existing callers keep compiling with the old unconditional behavior. */
  currentPick?: number;
  limit?: number;
  /** Draftable spots per team, passed to `positionalDemand`. Defaults to
   * `rosterSpotsPerTeam(settings)`, which under-counts for Sleeper mock drafts (no `BN` entry in
   * `rosterSlots` — see `replacement.ts`'s doc). Pass `DraftInit.rounds` when available. */
  rosterSpotsPerTeam?: number;
  /** Actual selections per team. Used only for the late-draft K/DEF schedule; unlike
   * `rosterSpotsPerTeam`, there is intentionally no settings-derived fallback because a partial
   * provider roster cannot establish how many selections remain. Pass `DraftInit.rounds`. */
  draftRounds?: number;
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
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  diagnostics: RecommendationDiagnostics;
}

/** `${position}|${sorted eligiblePositions}` — players sharing this key compete for the same slots,
 * so they share one replacement-baseline `optimizeLineup` solve instead of each getting their own. */
function candidateGroupKey(player: PlayerMeta): string {
  const position = player.position ?? '';
  const eligible = player.eligiblePositions.length ? player.eligiblePositions : position ? [position] : [];
  return `${position}|${[...eligible].sort().join(',')}`;
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

export function buildRecommendationBoard(input: RecommendationInput): RecommendationResult {
  const limit = input.limit ?? 3;
  const currentPick = input.currentPick ?? input.picks.length + 1;

  const playersById = new Map(input.players.map((player) => [player.playerId, player]));
  const projectionById = new Map(input.projections.map((projection) => [projection.playerId, projection]));
  const scores = new Map<PlayerId, number>();
  const scoringDiagnosticsById = new Map<PlayerId, ReturnType<typeof scoreProjection>>();
  for (const [id, projection] of projectionById) {
    const diagnostic = scoreProjection(projection, input.settings, playersById.get(id)?.position);
    scores.set(id, diagnostic.points);
    scoringDiagnosticsById.set(id, diagnostic);
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

  const candidates = selectCandidates(remainingPlayers, scores, limit);

  const replacementBaselineCache = new Map<string, number>();
  function replacementBaselineValue(player: PlayerMeta): number {
    const groupKey = candidateGroupKey(player);
    const cached = replacementBaselineCache.get(groupKey);
    if (cached != null) return cached;
    const levelPoints = player.position ? replacementPoints.get(player.position) ?? 0 : 0;
    const synthetic = syntheticReplacementPlayer(groupKey, player);
    const value = addPlayerToLineup(preparedRoster, synthetic, levelPoints).result.value;
    replacementBaselineCache.set(groupKey, value);
    return value;
  }

  // Candidates with the same eligible-slot group and score are symmetric for a single addition to
  // this immutable base roster: their value and assigned slot are identical. Memoizing that pair
  // also avoids repeating a canonical fallback for common zero-projection K/DEF candidates.
  const candidateLineupCache = new Map<string, { value: number; addedPlayerSlot: RosterSlot | null }>();
  function candidateLineup(player: PlayerMeta, points: number): { value: number; addedPlayerSlot: RosterSlot | null } {
    const key = `${candidateGroupKey(player)}|${points}`;
    const cached = candidateLineupCache.get(key);
    if (cached) return cached;
    const incremental = addPlayerToLineup(preparedRoster, player, points);
    const result = { value: incremental.result.value, addedPlayerSlot: incremental.addedPlayerSlot };
    candidateLineupCache.set(key, result);
    return result;
  }

  const dispositionByPlayerId = new Map<PlayerId, SpecialTeamsDisposition>();
  const evaluated = candidates.map((player): Recommendation => {
    const points = scores.get(player.playerId) ?? 0;
    const afterValue = candidateLineup(player, points);

    const tier = tiers.get(player.playerId);
    const level = levels.find((entry) => entry.position === player.position);
    const vor = vorForPlayer(player, points, levels);
    const availability = estimateAvailability(adpById.get(player.playerId), { currentPick, nextPick: input.nextPick });
    const adpEntry = adpById.get(player.playerId);
    const marginalRosterValue = afterValue.value - currentValue;
    const replacementAdjustedValue = afterValue.value - replacementBaselineValue(player);

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
    if (availability?.lowConfidence) warnings.push('ADP sample is sparse; availability is approximate.');
    if (unmatchedPickCount > 0) {
      warnings.push(`${unmatchedPickCount} drafted pick${unmatchedPickCount === 1 ? '' : 's'} could not be matched to a player; someone shown here may already be gone.`);
    }

    const reasons = [`Provides ${replacementAdjustedValue.toFixed(1)} points over the last rosterable ${player.position ?? ''} option.`];
    const assignedSlot = afterValue.addedPlayerSlot;
    if (assignedSlot) reasons.push(`Projects for ${points.toFixed(1)} PPR points and currently fits ${assignedSlot}.`);
    else reasons.push(`Projects for ${points.toFixed(1)} PPR points and would currently be bench-only. S2 does not yet price bench depth.`);
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

    let confidence: Recommendation['confidence'] = 'high';
    if (scoringSeverity === 'minor' || availability?.lowConfidence) confidence = 'medium';
    if (scoringSeverity === 'material' || player.position === 'K' || player.position === 'DEF' || unmatchedPickCount > 0) confidence = 'low';

    return {
      playerId: player.playerId,
      rank: 0,
      projectedPoints: points,
      marginalRosterValue,
      replacementAdjustedValue,
      replacementLevelPoints: level?.points ?? 0,
      vor,
      vona: null,
      deprioritized,
      tier: tier?.tier ?? 0,
      tierGapAfter: tier?.gapAfter ?? 0,
      tierBoundaryGap: tier?.tierBoundaryGap ?? 0,
      tierUrgency: tier?.urgency ?? 0,
      availableNextPickProbability: availability?.probability ?? null,
      availabilityAdp: adpEntry?.adp ?? null,
      availabilityStdev: adpEntry?.stdev ?? null,
      availabilitySampleSize: availability?.sampleSize ?? null,
      scoringDiagnosticSeverity: scoringSeverity,
      missingScoringKeys: scoringDiagnostic?.unsupportedScoringKeys ?? [],
      confidence,
      assignedRosterSlot: assignedSlot,
      replacementPlayerId: level?.playerId ?? null,
      reasons,
      warnings,
    } satisfies Recommendation;
  }).filter((recommendation) => dispositionByPlayerId.get(recommendation.playerId) !== 'unavailable').sort((a, b) => {
    const aPosition = playersById.get(a.playerId)?.position;
    const bPosition = playersById.get(b.playerId)?.position;
    const aOverdueBy = aPosition === 'K' || aPosition === 'DEF' ? overdueBy(aPosition, specialTeamsDraft) : 0;
    const bOverdueBy = bPosition === 'K' || bPosition === 'DEF' ? overdueBy(bPosition, specialTeamsDraft) : 0;
    return dispositionSortClass(dispositionByPlayerId.get(a.playerId) ?? 'normal')
    - dispositionSortClass(dispositionByPlayerId.get(b.playerId) ?? 'normal')
    || bOverdueBy - aOverdueBy
    || b.replacementAdjustedValue - a.replacementAdjustedValue
    || b.vor - a.vor
    || b.projectedPoints - a.projectedPoints
    || a.playerId.localeCompare(b.playerId);
  });

  const recommendations = evaluated.slice(0, limit).map((recommendation, index) => {
    const alternative = evaluated[index + 1];
    const altPlayer = alternative && playersById.get(alternative.playerId);
    const reasons = alternative && altPlayer
      ? [
          ...recommendation.reasons,
          alternative.availableNextPickProbability != null
            ? `Next value-board option: ${altPlayer.name} (${altPlayer.position ?? ''}); the ADP model estimates ${Math.round(alternative.availableNextPickProbability * 100)}% next-pick availability.`
            : `Next value-board option: ${altPlayer.name} (${altPlayer.position ?? ''}).`,
        ]
      : recommendation.reasons;
    return { ...recommendation, reasons, rank: index + 1 };
  });

  return {
    recommendations,
    diagnostics: {
      unmatchedPickCount,
      unmatchedPickOveralls,
      candidatesEvaluated: candidates.length,
      replacementLevels: levels,
      positionalDemand: demand,
      coreStartingSlotsFilled: coreFilled,
      specialTeamsDraft,
    },
  };
}

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  return buildRecommendationBoard(input).recommendations;
}
