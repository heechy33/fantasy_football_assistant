import { useEffect, useMemo, useRef } from 'react';
import type { DraftInit, Pick as DraftPick, Provider, SavedDraft } from '../../../shared/types';
import { picksMade } from '../adapters/draftOrder';
import { useAuth } from '../auth/AuthProvider';
import { createHttpRepository } from '../data/repositories/httpRepository';
import type { SavedLeaguesRepository } from '../data/savedLeaguesRepository';
import { useDraftSession } from '../session/DraftSessionProvider';
import { clearPersistedSession } from './persistence';
import type { PickOverride } from './draftBoardState';

/** Sleeper synthesizes `leagueId: mock:${draftId}` for standalone mocks with no league record
 * (adapters/sleeper.ts) — the one signal needed to tell a mock from a real league draft. */
export function isMockLeagueId(leagueId: string): boolean {
  return leagueId.startsWith('mock:');
}

/** `SavedLeague`/`SavedDraft.provider` has no `'yahoo'` arm (roadmap-only, no adapter wired into
 * the session provider yet) — mapped defensively to `'manual'` so a future stray value degrades
 * to "durable, no upstream to reconcile with" rather than crashing sync. */
export function mapProvider(provider: Provider): 'sleeper' | 'espn' | 'manual' {
  return provider === 'sleeper' || provider === 'espn' ? provider : 'manual';
}

/**
 * The retention policy from DECISIONS.md's 2026-08-26 entry, as one pure predicate: a Sleeper
 * mock draft is never written server-side, active or complete — no roster survives it and there's
 * nothing worth reconnecting to. Every other draft (a real Sleeper league, or a manual/ESPN
 * session with no upstream API at all) is a sync candidate.
 */
export function shouldSyncDraft(provider: Provider, leagueId: string): boolean {
  return !(mapProvider(provider) === 'sleeper' && isMockLeagueId(leagueId));
}

/** A real Sleeper league's transcript is disposable once the draft finishes — the `SavedLeague`
 * pointer is what survives, and any future feature re-fetches the roster live via
 * `sleeperAdapter.rosters()` rather than from a stored copy that could drift. Manual/ESPN drafts
 * have no such live source, so they're kept durably regardless of completion (see `provider`
 * check at the call site in `useDraftSync`).
 *
 * Count-based completion (`picksMade >= teams * rounds`) assumes snake/linear ordering. An
 * `auction` session has no per-pick count to compare against, so it reports never-complete —
 * deliberate: an auction draft stays `status: 'active'` and is never auto-deleted by the
 * retention policy, erring toward keeping data rather than destroying it early. */
export function isDraftComplete(init: DraftInit, effectivePicks: DraftPick[]): boolean {
  if (init.draftType === 'auction') return false;
  return picksMade(effectivePicks) >= init.teams * init.rounds;
}

/** Maps a session kind to `SavedDraft.mode` — mirrors `PersistedSessionMode`
 * (state/persistence.ts) without importing it (that type is keyed to the local-storage shape,
 * this one to the wire shape; kept as two call sites rather than one shared type since the two
 * evolve independently — see PersistedSessionMode's own doc). */
export function sessionKindToMode(kind: 'connected' | 'manual' | 'bridge'): SavedDraft['mode'] {
  return kind === 'connected' ? 'live' : kind === 'bridge' ? 'espn' : 'manual';
}

/** Union of two override arrays, keyed by `overall`, keeping whichever side's `correctedAt` is
 * later per key — the merge rule for the one-shot sign-in reconcile below. Never drops a
 * hand-typed correction that only exists on one side. */
export function mergeOverrides(local: PickOverride[], remote: PickOverride[]): PickOverride[] {
  const byOverall = new Map<number, PickOverride>();
  for (const override of [...remote, ...local]) {
    const existing = byOverall.get(override.overall);
    if (!existing || override.correctedAt >= existing.correctedAt) byOverall.set(override.overall, override);
  }
  return [...byOverall.values()];
}

const SYNC_DEBOUNCE_MS = 5000;

/**
 * Mirrors the live draft session into Cosmos via `/api/leagues` + `/api/drafts`, active only while
 * signed in — see the module-level functions above for the retention policy this enforces. Mount
 * once, high in the tree (AppLayout, alongside `useDraftSession`/`useAuth`), not per-route: it must
 * keep running across navigation exactly like `DraftSessionProvider`'s poll.
 *
 * Simplification, stated plainly rather than hidden: the sign-in reconcile below merges overrides
 * for the CURRENT draft (matched by `providerDraftId`) if one already exists server-side from
 * another device — the realistic "resumed on a second device" case. It does not attempt a
 * cross-league conflict chooser UI; a full reconciliation surface is future work if multi-device
 * conflicts turn out to be common in practice.
 */
export function useDraftSync(repositoryOverride?: SavedLeaguesRepository): void {
  const { status, getToken } = useAuth();
  const { session, effectiveInit, board, picksSignature } = useDraftSession();

  const repository = useMemo(
    () => repositoryOverride ?? createHttpRepository(getToken),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repositoryOverride],
  );

  // Latest session values, read at timer-fire time rather than captured per effect run.
  // Deliberately NOT effect dependencies: `board` is a fresh object literal on every render of
  // DraftSessionProvider, so depending on these objects directly reset the debounce on every
  // unrelated render — a burst of picks or corrections landing <5s apart could starve sync
  // indefinitely. Gating happens via `draftIdentity` + `picksSignature` instead: those change
  // exactly when the underlying draft or its transcript changes, never for unrelated renders.
  const latest = useRef({ session, effectiveInit, board });
  latest.current = { session, effectiveInit, board };

  const ids = useRef<{ leagueId: string | null; savedLeagueId: string | null; savedDraftId: string | null }>({
    leagueId: null,
    savedLeagueId: null,
    savedDraftId: null,
  });
  const reconciledDraftKey = useRef<string | null>(null);

  /** Which draft this effect instance syncs — changes only when the underlying draft does. */
  const draftIdentity = session.kind !== 'disconnected' && effectiveInit
    ? `${session.kind}:${effectiveInit.provider}:${effectiveInit.leagueId}:${effectiveInit.draftId}`
    : null;

  useEffect(() => {
    if (status !== 'signed-in' || draftIdentity == null) return;
    const initAtGate = latest.current.effectiveInit;
    if (!initAtGate) return;
    if (!shouldSyncDraft(initAtGate.provider, initAtGate.leagueId)) return;

    // Reset the adopted-id cache when the underlying league changes, so a switched draft doesn't
    // upsert on top of a previous league's saved id.
    if (ids.current.leagueId !== initAtGate.leagueId) {
      ids.current = { leagueId: initAtGate.leagueId, savedLeagueId: null, savedDraftId: null };
    }

    const timer = setTimeout(() => {
      void syncNow().catch((error) => {
        // A failed cycle must not vanish as an unhandled rejection — but it also must not take
        // the page down. The next content change re-runs this effect and re-arms the debounce.
        console.error('[draftSync] sync failed; will retry on next change', error);
      });
    }, SYNC_DEBOUNCE_MS);

    async function reconcileOnce(): Promise<void> {
      const { effectiveInit, board } = latest.current;
      if (!effectiveInit || !board) return;
      const reconcileKey = `${effectiveInit.provider}:${effectiveInit.draftId}`;
      if (reconciledDraftKey.current === reconcileKey) return;

      const remoteDrafts = await repository.listDrafts();
      // Mark attempted only AFTER the fetch succeeded — a failed list must be retried by the
      // next debounced cycle, not silently skipped forever.
      reconciledDraftKey.current = reconcileKey;

      const match = remoteDrafts.find((d) => d.providerDraftId === effectiveInit.draftId && d.provider === mapProvider(effectiveInit.provider));
      if (!match) {
        // No remote draft matches (a league saved from /leagues/connect before any draft ran, or
        // a completed Sleeper draft whose transcript was already deleted). Fall back to adopting
        // a matching saved LEAGUE so syncNow's upsert updates in place instead of creating a
        // second SavedLeague doc the hub would show twice. Runs inside the reconciledDraftKey-
        // guarded one-shot, so the hot path gains no per-tick request; the API also dedupes on
        // (userId, provider, providerLeagueId), making this an optimization rather than the fix.
        const leagues = await repository.listLeagues();
        const leagueMatch = leagues.find(
          (l) => l.provider === mapProvider(effectiveInit.provider) && l.providerLeagueId === effectiveInit.leagueId,
        );
        if (!leagueMatch) return;
        ids.current.savedLeagueId = leagueMatch.id;
        return;
      }

      ids.current.savedDraftId = match.id;
      ids.current.savedLeagueId = match.leagueId;

      const localOverrides = [...board.state.overrides.values()];
      const merged = mergeOverrides(localOverrides, match.overrides);
      // Apply only overrides the local board doesn't already carry — applyOverride is a plain
      // upsert-by-overall, so re-applying an identical local override is a harmless no-op.
      // Applying a remote-only override changes the board (and thus `picksSignature`), which
      // re-arms this effect's debounce so the merged state is persisted on the following tick.
      for (const override of merged) board.applyOverride(override);
    }

    async function syncNow(): Promise<void> {
      await reconcileOnce();

      const { session: currentSession, effectiveInit, board } = latest.current;
      if (!effectiveInit || !board) return;
      const provider = mapProvider(effectiveInit.provider);
      const league = await repository.upsertLeague({
        id: ids.current.savedLeagueId ?? undefined,
        provider,
        providerLeagueId: effectiveInit.leagueId,
        name: effectiveInit.settings.name,
        teams: effectiveInit.teams,
        rounds: effectiveInit.rounds,
        mySlot: effectiveInit.mySlot,
        settings: effectiveInit.settings,
        // Keep the hub's per-league "Track draft" usable after a transcript is deleted — real
        // Sleeper drafts carry their upstream id in `draftId`; manual/ESPN sessions don't get one.
        latestDraftId: provider === 'sleeper' ? effectiveInit.draftId : null,
        // `season` is intentionally not sent — DraftInit carries no season today, so the stored
        // SavedLeague.season stays whatever it was (the league-connect path now supplies a real
        // one; see DECISIONS.md, 2026-08-26).
      });
      ids.current.savedLeagueId = league.id;

      const complete = isDraftComplete(effectiveInit, board.effectivePicks);
      if (complete && provider === 'sleeper') {
        // The transcript is disposable now — Sleeper's own rosters() is the permanent record.
        if (ids.current.savedDraftId) {
          await repository.deleteDraft(ids.current.savedDraftId);
          ids.current.savedDraftId = null;
        }
        // And the localStorage resume record has nothing left to offer once we've SEEN the draft
        // complete live: clear it rather than leaving a stale finished session behind. Gated on
        // still being connected — a user who already took over manually may be mid-review, and
        // their overrides must survive until they intentionally leave via "Choose another draft"
        // (which clears the record itself).
        if (latest.current.session.kind === 'connected') clearPersistedSession();
        return;
      }

      const draft = await repository.upsertDraft({
        id: ids.current.savedDraftId ?? undefined,
        leagueId: league.id,
        provider,
        providerDraftId: effectiveInit.draftId,
        mode: sessionKindToMode(currentSession.kind as 'connected' | 'manual' | 'bridge'),
        frozenInit: currentSession.kind === 'manual' || currentSession.kind === 'bridge' ? effectiveInit : null,
        overrides: [...board.state.overrides.values()],
        status: complete ? 'complete' : 'active',
      });
      ids.current.savedDraftId = draft.id;
    }

    return () => clearTimeout(timer);
  }, [status, repository, draftIdentity, picksSignature]);
}
