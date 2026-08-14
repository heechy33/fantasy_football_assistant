/**
 * Dev-only Performance Timeline marks/measures for the live draft hot path.
 *
 * These are the "which phase is actually slow" instrumentation from the live-draft responsiveness
 * pass: poll/network delay, the poll→effective-state relay, the log paint, and worker S2/Stage C
 * receipt all become separate entries in the Performance timeline (plus a few console lines in
 * DEV) so a mock draft identifies the blocking phase instead of guessing.
 *
 * Everything is a no-op outside `import.meta.env.DEV` — marks would otherwise accumulate in the
 * timeline in production — and every call is defensive so a missing/non-standard `performance`
 * (old jsdom, unusual global, vitest fake timers) can never take down the hot path.
 */

const MARK_PREFIX = 'ffa:';

/** Stable, per-response names prevent a later poll from overwriting the marks that belong to an
 * earlier worker or render update. */
export function draftPollMarkName(pollId: number, phase: string): string {
  return `poll-${pollId}-${phase}`;
}

export function draftMark(name: string): void {
  if (!import.meta.env.DEV) return;
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(`${MARK_PREFIX}${name}`);
    }
  } catch {
    // Best-effort diagnostics only — never let timing break the draft.
  }
}

/** Returns the measured duration in ms, or null when either mark is missing (e.g. the first
 * render before any poll has run, or a manual-mode override with no poll in flight). */
export function draftMeasure(name: string, from: string, to: string): number | null {
  if (!import.meta.env.DEV) return null;
  try {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return null;
    return performance.measure(`${MARK_PREFIX}${name}`, `${MARK_PREFIX}${from}`, `${MARK_PREFIX}${to}`).duration;
  } catch {
    return null;
  }
}

/** Runs `fn` and logs its wall time in DEV — for the small main-thread paths the plan says to
 * measure but not restructure (the ADP ordering fallback). Returns `fn()`'s result unchanged. */
export function draftMeasureSync<T>(name: string, fn: () => T): T {
  if (!import.meta.env.DEV) return fn();
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    const elapsedMs = performance.now() - startedAt;
    // eslint-disable-next-line no-console
    console.debug(`[draft-timing] ${name}: ${elapsedMs.toFixed(1)}ms`);
  }
}
