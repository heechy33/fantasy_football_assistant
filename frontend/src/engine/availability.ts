import type { AdpEntry } from '../../../shared/types';

/** The pick on the clock right now, and the user's next turn — both 1-indexed overall picks. */
export interface AvailabilityContext {
  currentPick: number;
  nextPick: number;
}

export interface AvailabilityEstimate {
  /** P(still available at nextPick | already survived to currentPick). What the UI should show. */
  probability: number;
  /** 1 - Φ((nextPick - adp) / stdev), ignoring that the player has already survived to currentPick.
   * Kept only for explanation/comparison — never the number shown as "chance to remain available". */
  unconditionalProbability: number;
  /** P(survived to currentPick) under the same normal model. The conditioning denominator. */
  survivalToCurrentPick: number;
  lowConfidence: boolean;
  /** The conditioning denominator was too small to trust (or the model already implies the player
   * is gone), so `probability` is a floor/guard value rather than a real estimate. */
  degenerate: boolean;
  sampleSize: number;
}

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** P(this player's draft slot is at or after `pick`) under the normal ADP model. */
function survivalProbability(adp: number, stdev: number, pick: number): number {
  return Math.max(0, Math.min(1, 1 - normalCdf((pick - adp) / stdev)));
}

/**
 * P(still on the board at the user's next pick | still on the board right now). The naive
 * unconditional model (`1 - Φ((nextPick - adp) / stdev)`) ignores that the player has already
 * survived every pick up to `currentPick`, so it never moves as he keeps surviving — this
 * divides by the survival-to-now probability so the estimate climbs as the pick clock advances.
 */
export function estimateAvailability(entry: AdpEntry | null | undefined, context: AvailabilityContext): AvailabilityEstimate | null {
  const { currentPick, nextPick } = context;
  if (!entry || !Number.isFinite(currentPick) || !Number.isFinite(nextPick) || !Number.isFinite(entry.adp) || entry.adp < 0) {
    return null;
  }
  const sampleSize = entry.timesDrafted ?? 0;

  // Nothing left to condition on: the "next" pick being evaluated isn't actually in the future.
  if (nextPick <= currentPick) {
    return { probability: 1, unconditionalProbability: 1, survivalToCurrentPick: 1, lowConfidence: sampleSize < 20, degenerate: false, sampleSize };
  }

  if (!Number.isFinite(entry.stdev) || entry.stdev <= 0) {
    // Degenerate model: treat ADP as a fixed pick number rather than a distribution. Strict `>`
    // is intentional — a player whose ADP equals the pick being evaluated goes at that pick.
    const probability = entry.adp > nextPick ? 1 : 0;
    return { probability, unconditionalProbability: probability, survivalToCurrentPick: entry.adp > currentPick ? 1 : 0, lowConfidence: true, degenerate: false, sampleSize };
  }

  const survivalToCurrentPick = survivalProbability(entry.adp, entry.stdev, currentPick);
  const unconditionalProbability = survivalProbability(entry.adp, entry.stdev, nextPick);

  // Below this floor, `normalCdf`'s Abramowitz-Stegun approximation error (~1.5e-7 absolute) swamps
  // the ratio — dividing by a near-zero denominator would otherwise produce noise or NaN.
  if (survivalToCurrentPick <= 1e-6) {
    return { probability: 0, unconditionalProbability, survivalToCurrentPick, lowConfidence: true, degenerate: true, sampleSize };
  }

  const probability = Math.max(0, Math.min(1, unconditionalProbability / survivalToCurrentPick));
  const degenerate = survivalToCurrentPick < 0.02; // model says he should already be gone
  return { probability, unconditionalProbability, survivalToCurrentPick, lowConfidence: sampleSize < 20 || degenerate, degenerate, sampleSize };
}
