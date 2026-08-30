import type { DraftInit, DraftStatus, Pick as DraftPick } from '../../../shared/types';
import { picksMade } from '../adapters/draftOrder';

/**
 * The retention policy from DECISIONS.md's 2026-08-26 entry, as one pure predicate: a Sleeper
 * mock draft is never written server-side, active or complete — no roster survives it and there's
 * nothing worth reconnecting to. Every other draft (a real Sleeper league, or a manual/ESPN
 * session with no upstream API at all) is a sync candidate.
 *
 * Count-based completion (`picksMade >= teams * rounds`) assumes snake/linear ordering. An
 * `auction` session has no per-pick count to compare against, so it reports never-complete —
 * deliberate: an auction draft stays `status: 'active'` and is never auto-deleted by the
 * retention policy, erring toward keeping data rather than destroying it early.
 *
 * Relocated from `state/draftSync.ts` (2026-08-28) so the SESSION layer — not just the sync
 * layer — can read completion. `draftSync.ts` re-exports this rather than duplicating it.
 */
export function isDraftComplete(init: DraftInit, effectivePicks: DraftPick[]): boolean {
  if (init.draftType === 'auction') return false;
  return picksMade(effectivePicks) >= init.teams * init.rounds;
}

export interface SessionCompletionInput {
  init: DraftInit;
  effectivePicks: DraftPick[];
  /**
   * The live poll's adapter-reported status, when one exists. Only a Sleeper `connected` session
   * has this (its poll fetches `DraftPicks.status` every tick — see `adapters/sleeper.ts`'s
   * `picks()`). Bridge and manual sessions have no poll at all (`draftId` is null for them), so
   * this is always undefined for them — for ESPN/manual the count rule above is the ONLY possible
   * completion signal (ESPN's adapter hard-codes `rawStatus: 'pre'` at `adapters/espn.ts`'s
   * `picks()`, since it has no upstream status of its own to report).
   */
  pollStatus?: DraftStatus;
}

/**
 * Whether a live SESSION (not just a sync candidate) should be considered finished. True when the
 * count rule holds, OR the adapter itself reports `'complete'` — the adapter status is a
 * corroborator, not the primary signal: `DraftInit`'s cached `rawStatus` is frozen at `init()` by
 * design (that is what keeps `picks()` down to one GET per poll — see `adapters/sleeper.ts`), so it
 * cannot observe Sleeper flipping a draft to complete mid-session on its own. The count rule is
 * always live; the flag only ever adds confidence when it agrees.
 */
export function isSessionComplete({ init, effectivePicks, pollStatus }: SessionCompletionInput): boolean {
  return isDraftComplete(init, effectivePicks) || pollStatus === 'complete';
}
