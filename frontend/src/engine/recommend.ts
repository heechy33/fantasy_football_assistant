import type { AdpEntry, LeagueSettings, Pick, PlayerId, PlayerMeta, SeasonProjection } from '../../../shared/types';
import { estimateAvailability } from './availability';
import { optimizeLineup } from './eligibility';
import { replacementLevels, replacementPointsByPosition, vorForPlayer, type ReplacementLevel } from './replacement';
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
}

export interface RecommendationDiagnostics {
  /** Drafted picks the crosswalk could not match to a player — they stay recommendable because
   * they're absent from `drafted`, so the board may be showing someone who is already gone. */
  unmatchedPickCount: number;
  unmatchedPickOveralls: number[];
  candidatesEvaluated: number;
  replacementLevels: ReplacementLevel[];
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

  const levels = replacementLevels(input.settings, remainingPlayers, scores, consumedByPosition);
  const replacementPoints = replacementPointsByPosition(levels);
  const tiers = buildTiers(remainingPlayers, scores);
  const adpById = new Map(input.adp.filter((entry) => entry.playerId != null).map((entry) => [entry.playerId as PlayerId, entry]));

  const myRosterIds = input.picks
    .filter((pick) => input.myTeamId != null && pick.teamId === input.myTeamId && pick.playerId != null)
    .map((pick) => pick.playerId as PlayerId);
  const myRoster = myRosterIds.map((id) => playersById.get(id)).filter((player): player is PlayerMeta => player != null);
  const rosterPoints = new Map<PlayerId, number>(myRoster.map((player) => [player.playerId, scores.get(player.playerId) ?? 0]));
  const currentValue = optimizeLineup(input.settings, myRoster, rosterPoints).value;

  const candidates = selectCandidates(remainingPlayers, scores, limit);

  const replacementBaselineCache = new Map<string, number>();
  function replacementBaselineValue(player: PlayerMeta): number {
    const groupKey = candidateGroupKey(player);
    const cached = replacementBaselineCache.get(groupKey);
    if (cached != null) return cached;
    const levelPoints = player.position ? replacementPoints.get(player.position) ?? 0 : 0;
    const synthetic = syntheticReplacementPlayer(groupKey, player);
    const points = new Map(rosterPoints);
    points.set(synthetic.playerId, levelPoints);
    const value = optimizeLineup(input.settings, [...myRoster, synthetic], points).value;
    replacementBaselineCache.set(groupKey, value);
    return value;
  }

  const evaluated = candidates.map((player) => {
    const points = scores.get(player.playerId) ?? 0;
    const withPlayerPoints = new Map(rosterPoints);
    withPlayerPoints.set(player.playerId, points);
    const afterValue = optimizeLineup(input.settings, [...myRoster, player], withPlayerPoints);

    const tier = tiers.get(player.playerId);
    const level = levels.find((entry) => entry.position === player.position);
    const vor = vorForPlayer(player, points, levels);
    const availability = estimateAvailability(adpById.get(player.playerId), { currentPick, nextPick: input.nextPick });
    const adpEntry = adpById.get(player.playerId);
    const marginalRosterValue = afterValue.value - currentValue;
    const replacementAdjustedValue = afterValue.value - replacementBaselineValue(player);

    const scoringDiagnostic = scoringDiagnosticsById.get(player.playerId);
    const scoringSeverity = scoringDiagnostic?.severity ?? 'none';
    const warnings: string[] = [];
    if (scoringSeverity === 'minor') warnings.push('Medium confidence: FFToday omits minor projected scoring components.');
    if (scoringSeverity === 'material') warnings.push('Low confidence: FFToday lacks material components used by this league.');
    if (player.position === 'K' || player.position === 'DEF') warnings.push('Low-confidence custom-scoring recommendation: FFToday does not expose every distance/range component.');
    if (availability?.lowConfidence) warnings.push('ADP sample is sparse; availability is approximate.');
    if (unmatchedPickCount > 0) {
      warnings.push(`${unmatchedPickCount} drafted pick${unmatchedPickCount === 1 ? '' : 's'} could not be matched to a player; someone shown here may already be gone.`);
    }

    const reasons = [`Provides ${replacementAdjustedValue.toFixed(1)} points over the modeled ${player.position ?? ''} replacement option.`];
    const assignedSlot = afterValue.assignments.find((assignment) => assignment.playerId === player.playerId)?.slot ?? null;
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
  }).sort((a, b) =>
    b.replacementAdjustedValue - a.replacementAdjustedValue
    || b.vor - a.vor
    || b.projectedPoints - a.projectedPoints
    || a.playerId.localeCompare(b.playerId));

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
    },
  };
}

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  return buildRecommendationBoard(input).recommendations;
}
