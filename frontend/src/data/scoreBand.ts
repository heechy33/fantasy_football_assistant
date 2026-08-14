export type ScoreBand = 'elite' | 'good' | 'fair' | 'poor';

export type ScorePolarity = 'higher-better' | 'lower-better';

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** Presentation-only banding over a 0–100 value. Module-private: callers band via {@link axisBand}
 * (StatBar / role chips); the direct function was only ever consumed by the deleted Draft Score
 * surface. */
function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'elite';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/** Band a 0–100 axis for color. Risk uses `lower-better` so 80 risk reads poor, not elite. */
export function axisBand(value: number, polarity: ScorePolarity = 'higher-better'): ScoreBand {
  const clamped = clampScore(value);
  return scoreBand(polarity === 'lower-better' ? 100 - clamped : clamped);
}
