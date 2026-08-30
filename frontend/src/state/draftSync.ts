import { useEffect, useMemo, useRef } from 'react';
import type { Provider, SavedDraft } from '../../../shared/types';
import { useAuth } from '../auth/AuthProvider';
import { createHttpRepository } from '../data/repositories/httpRepository';
import type { SavedLeaguesRepository } from '../data/savedLeaguesRepository';
import { useDraftSession } from '../session/DraftSessionProvider';
import { isDraftComplete } from '../session/completion';
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
 * Relocated to `session/completion.ts` (2026-08-28) so the SESSION layer, not just this sync
 * layer, can read completion — re-exported here (alongside the local import above, which this
 * module's own `syncNow` needs: `export { X } from 'module'` does not create a local binding) so
 * this module's existing callers/tests are unaffected. */
export { isDraftComplete } from '../session/completion';

/** Maps a session kind to `SavedDraft.mode` — mirrors `PersistedSessionMode`
 * (state/persistence.ts) without importing it (that type is keyed to the local-storage shape,
 * this one to the wire shape; kept as two call sites rather than one shared type since the two
 * evolve independently — see PersistedSessionMode's own doc).
 *
 * Takes every session kind — including `'complete'`, mapped via `from` (the kind it completed
 * FROM) — rather than the narrower `'connected' | 'manual' | 'bridge'` this used to accept behind
 * an unchecked `as` cast at the call site. That cast is exactly what let a `'complete'` session
 * silently fall through to the `'manual'` branch before this fix (2026-08-28) — an explicit
 * switch makes a future unhandled kind a type error instead of a silent misclassification. */
export function sessionKindToMode(
  kind: 'connected' | 'manual' | 'bridge' | 'complete',
  from?: 'connected' | 'manual' | 'bridge',
): SavedDraft['mode'] {
  const effective = kind === 'complete' ? from ?? 'manual' : kind;
  switch (effective) {
    case 'connected': return 'live';
    case 'bridge': return 'espn';
    case 'manual': return 'manual';
  }
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
  const { session, effectiveInit, board, picksSignature, reportSavedLeagueId, endDraftSeq = 0 } = useDraftSession();

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
      // Keyed on leagueId too (2026-08-28): draftId alone used to collide across every ESPN league
      // (they all shared MANUAL_DRAFT_ID before buildEspnDraftInit was made league-scoped), which
      // made this one-shot reconcile itself league-agnostic — league B's session would run the
      // reconcile exactly once, against league A's leftover match, and never again.
      const reconcileKey = `${effectiveInit.provider}:${effectiveInit.leagueId}:${effectiveInit.draftId}`;
      if (reconciledDraftKey.current === reconcileKey) return;

      const [remoteDrafts, leagues] = await Promise.all([repository.listDrafts(), repository.listLeagues()]);
      // Mark attempted only AFTER both fetches succeeded — a failed list must be retried by the
      // next debounced cycle, not silently skipped forever.
      reconciledDraftKey.current = reconcileKey;

      const leagueMatch = leagues.find(
        (l) => l.provider === mapProvider(effectiveInit.provider) && l.providerLeagueId === effectiveInit.leagueId,
      );
      // Match on providerDraftId AND the resolved SavedLeague doc id (`SavedDraft.leagueId` is the
      // FK to that doc, not the provider's raw league id) — a second, independent guard against a
      // cross-league draftId collision, on top of buildEspnDraftInit's league-scoped draftId fix.
      // When no SavedLeague exists yet, providerDraftId alone still gates (nothing to cross-check).
      const match = remoteDrafts.find((d) =>
        d.providerDraftId === effectiveInit.draftId
        && d.provider === mapProvider(effectiveInit.provider)
        && (leagueMatch == null || d.leagueId === leagueMatch.id));
      if (!match) {
        // No remote draft matches (a league saved from /leagues/connect before any draft ran, or
        // a completed Sleeper draft whose transcript was already deleted). Fall back to adopting
        // a matching saved LEAGUE so syncNow's upsert updates in place instead of creating a
        // second SavedLeague doc the hub would show twice. Runs inside the reconciledDraftKey-
        // guarded one-shot, so the hot path gains no per-tick request; the API also dedupes on
        // (userId, provider, providerLeagueId), making this an optimization rather than the fix.
        if (!leagueMatch) return;
        ids.current.savedLeagueId = leagueMatch.id;
        reportSavedLeagueId(leagueMatch.id);
        return;
      }

      ids.current.savedDraftId = match.id;
      ids.current.savedLeagueId = match.leagueId;
      // Feeds the session's `complete` transition (2026-08-28) — a Sleeper draft has no
      // SavedLeague in hand at connect time the way ESPN's `handleEspnStart` does, so this is the
      // only way a completion banner's "View league" ever finds out which league it was.
      reportSavedLeagueId(match.leagueId);

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
      // `draftIdentity` already excludes 'disconnected' at the gate above, but that guard runs on
      // a DIFFERENT read of `session` (the render-time one) than this timer-fire-time read off
      // `latest.current` — the type can't carry that narrowing across the closure, so this is a
      // real (if practically unreachable) runtime check, not just a cast.
      if (currentSession.kind === 'disconnected' || !effectiveInit || !board) return;
      // NEVER CREATE a SavedLeague here (2026-08-29 redesign — see DECISIONS.md): this sync only
      // ever UPDATES a league the user already saved from /leagues/connect. `reconcileOnce` just
      // ran and is the only place `ids.current.savedLeagueId` gets set from nothing — by a matching
      // remote SavedDraft, or by a matching SavedLeague found via `(provider, providerLeagueId)`.
      // Still null here means neither matched, i.e. the user never saved this league: a Sleeper
      // mock, an ESPN mock, a friend's draft tracked by pasted id, or a live-detected ESPN draft
      // with no saved counterpart. Writing nothing for all of those is the whole point of the
      // redesign — the Draft Room stopped being a place leagues silently appear from. (This also
      // subsumes the old "hold until ESPN's mSettings answer lands" guess-grid protection: a
      // live-detected league is never saved in the first place, so it never reaches this branch
      // with a real id to update.)
      if (ids.current.savedLeagueId == null) return;
      const provider = mapProvider(effectiveInit.provider);
      const league = await repository.upsertLeague({
        id: ids.current.savedLeagueId,
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
      reportSavedLeagueId(league.id);

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
        // `currentSession.kind === 'complete'` reaches here (not the delete branch above) only
        // for espn/manual — a completed Sleeper session always has `provider === 'sleeper'` and
        // returns early. Sync deliberately keeps running through completion rather than opting
        // out via draftIdentity (which stays non-null for 'complete') — the debounce means the
        // final picks of an espn/manual draft may not have synced yet when completion fires, and
        // letting one more cycle run is what actually persists them (see DECISIONS.md, 2026-08-28).
        mode: sessionKindToMode(currentSession.kind, currentSession.kind === 'complete' ? currentSession.from : undefined),
        frozenInit: currentSession.kind === 'manual' || currentSession.kind === 'bridge' || currentSession.kind === 'complete'
          ? effectiveInit
          : null,
        overrides: [...board.state.overrides.values()],
        // Picks persist only for providers with no upstream record to re-read (espn/manual) —
        // they're what /leagues/:id reconstructs the drafted team from. Sleeper is deliberately
        // excluded: its own API is the permanent record, and completed Sleeper transcripts are
        // deleted above (see DECISIONS.md's 2026-08-27 connect/start-split entry).
        picks: provider === 'sleeper' ? undefined : board.effectivePicks,
        status: complete ? 'complete' : 'active',
      });
      ids.current.savedDraftId = draft.id;
    }

    return () => clearTimeout(timer);
  }, [status, repository, draftIdentity, picksSignature, reportSavedLeagueId]);

  /** End-draft cleanup (2026-08-30): "End draft" on an ESPN/manual session used to leave its
   * `status: 'active'` SavedDraft transcript in Cosmos forever — only a completed SLEEPER draft's
   * transcript was ever deleted (the `complete && provider === 'sleeper'` branch in syncNow) — so
   * every ended/abandoned mock accumulated a permanent "in progress / Resume" ghost tile in the
   * Draft Room. draftSync is the layer that knows the transcript's server id (`ids.current
   * .savedDraftId`, set by reconcile), so the session provider signals an intentional end with a
   * monotonic `endDraftSeq` bump (NOT a boolean — back-to-back ends must each fire) and this
   * effect drops the row. Deliberately not gated on `draftIdentity` (which is already null by the
   * time this fires — the session is disconnected) and not debounced: it must run exactly once
   * per bump. A failed delete is logged, never fatal — the tile stays and the user can delete it
   * from the launcher's Resume section instead. */
  useEffect(() => {
    if (endDraftSeq === 0) return;
    const endedDraftId = ids.current.savedDraftId;
    ids.current = { leagueId: null, savedLeagueId: null, savedDraftId: null };
    reconciledDraftKey.current = null;
    if (endedDraftId != null) {
      void repository.deleteDraft(endedDraftId).catch((error: unknown) => {
        console.error('[draftSync] failed to delete the ended draft transcript', error);
      });
    }
  }, [endDraftSeq, repository]);
}
