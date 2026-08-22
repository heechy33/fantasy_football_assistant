# Execution history — completed phases

Detailed build records and exit-criteria evidence for phases marked complete in `PLAN.md`. Kept for
audit trail; `PLAN.md` keeps only a one-line status pointer to this file per phase. Nothing here is
current guidance — if a completed phase's decision still matters going forward, it should also be in
`DECISIONS.md`.

---

## S0 — Blocking fixes and deployable artifact — complete

Exit criteria met:

- Every Gate 0 (P0.1-P0.6) item resolved or explicitly deferred with user approval.
- Production artifact includes config and all required data (`npm run verify:artifact`).
- Deployed `/data/manifest.json` and `/api/health` work.
- League format dimensions corrected to independent `reception`/`qb`/`draft` fields.
- First fixtures/tests exist; `--passWithNoTests` removed so "no tests" can't pass silently.

### P0.1 — Static Web Apps packaging

The original audit build output only `index.html` and JS assets, omitting `staticwebapp.config.json`
and `data/*.json`. Fixed: `frontend/public/staticwebapp.config.json` is the single config source
(Vite copies `public/` into `dist/`, verified reaching `frontend/dist/staticwebapp.config.json`), a
deterministic staging step copies generated root `data/` into the frontend build, root `data/`
remains the uncommitted-duplicate-free generated source of truth, and `npm run verify:artifact`
asserts `dist/staticwebapp.config.json` and the four core `dist/data/*.json` files exist.

### P0.2 — League-format model

Replaced the mutually-exclusive `scoringFormat: 'standard' | 'half-ppr' | 'ppr' | '2qb'` with
independent `LeagueFormat { reception, qb, draft }` fields (see `CLAUDE.md`'s "Core conventions").
Raw scoring map and roster slots remain authoritative; `format` only selects ADP/UI defaults.

### P0.3 — Recommendation formula

See `DECISIONS.md`'s 2026-08-08 entry — the old `VOR × need × (1/tier_gap) / P_available` formula
was rejected and replaced by the MRV/tier/VONA design.

### P0.4 — Tests and fixtures

Added recorded Sleeper league/draft/picks fixtures, committed scoring/projections/ADP/partial-draft
fixtures, data-invariant tests (unique player IDs, monotonic picks, no duplicate drafted players,
finite projected scores, source freshness), and removed `--passWithNoTests`.

### P0.5 — Draft-data strategy, provenance, top-player coverage

Full source-role decision, no-lost-player contract, and provenance requirements are in
`DECISIONS.md`'s 2026-08-06 entry. Blocking-fix checklist as originally written (tracked here for
audit, not all items pursued — see "what's actually implemented" below):

- Obtain/approve FantasyPros API access for the private prototype, or record it blocked and keep
  Rotowire as the explicitly labeled temporary primary.
- Add normalized multi-projection/ECR source interfaces; store raw source values independently.
- Add FantasyPros projection/ECR pipeline adapters, recorded fixtures, schema validation, secret
  handling, last-known-good behavior, provenance fields.
- Implement the no-lost-player union, matching report, hard coverage gates, null handling, fallback
  labels, and a test for a high-ECR player missing from every other source.
- Generate a source-comparison artifact (FantasyPros-vs-Rotowire ranks/points/positional
  differences/missing/disagreement) without creating an unvalidated blend.
- Add FFC/FantasyPros/Sleeper/DynastyProcess/nflverse/user-import attribution/access status to the
  data manifest, machine-readable for public-release blockers.
- Verify the app runs from every P0.6 degraded state without losing live drafted state or
  relabeling one signal as another.

**What's actually implemented (as of S2):** FFToday season-projection tables are the sole
performance-projection source (`pipeline/fftoday.py`). FantasyPros API access was never pursued.
This is a real, currently-open gap versus the original P0.5 target architecture, not a completed
item — do not treat this section as done.

### P0.6 — Degraded behavior

See `DECISIONS.md`'s 2026-08-06 "Degraded-mode behavior" entry.

---

## S1 — Sleeper connection and live/manual board — complete

Built: connect by username/user ID, list 2026 leagues/drafts, load league settings/roster
slots/draft order/teams/picks, poll `/v1/draft/{draft_id}/picks` every 2-3s with backoff and
stale-state display, universal manual mode with undo/correction, unmatched-player surfacing instead
of silent availability.

Exit criteria met, verified against a real Sleeper mock draft (commit `674c7e5`, "sleeper mock draft
connection"): a real mock draft updates within one poll interval; refresh/reconnect reconstructs the
complete board; manual correction recovers from a bad/missing match without corrupting availability.

`fixtures/sleeper/` is still hand-authored, not a recording of that mock — swapping in a real
recorded fixture set remains an open item (see `PLAN.md`'s "Not implemented").

---

## S2 — Deterministic PPR engine — complete

The active source is FFToday's public season-projection tables, fetched only by the offline Python
pipeline and normalized into `SeasonProjection` behind the `SeasonProjectionProvider` boundary, so a
permitted licensed feed can replace FFToday later without changing the engine. The browser makes no
FFToday request during a live draft. FFToday is prototype-only, redistribution permission is legally
unverified — the prototype must stay unmonetized, carry source attribution/update age, use
`noindex`, and retain the last successful artifact on refresh failure. FFToday's fantasy-point column
is never used as the league score; points are always recomputed from components.

Built (`frontend/src/engine/`):

- Linear scoring with diagnostics (`scoring.ts`) — unsupported/missing keys classified
  minor/material, never silently "unknown means zero" without a visible warning.
- Slot-aware lineup optimizer (`eligibility.ts`) — exact bitmask-DP solver over (slot, remaining
  players), correctly handles FLEX/SUPER_FLEX counterexamples instead of a positional cutoff.
- MRV and draining-pool replacement/VOR (`replacement.ts`) — replacement rank shrinks as a position
  is consumed rather than staying fixed to the static full-pool level. ADP-derived replacement demand
  uses full scored-ADP counts at complete coverage, extrapolates at ≥50% usable coverage, and uses a
  frozen default positional mix below 50%. Starter demand is a floor; K/DEF demand is capped at named
  starting capacity.
- Leader-anchored tiers with bounded, non-inverted urgency (`tiers.ts`).
- Survival-conditioned availability (`availability.ts`) — climbs monotonically as the player keeps
  surviving picks, guarded against near-zero-denominator noise.
- Ranked recommendation board with explanations (`recommend.ts`) — sorts on
  `replacementAdjustedValue` (fixing the old open-slot degeneracy), populates Stage C lookahead/VONA
  fields when simulation is active with deterministic S2 fallback. K/DEF stay below the displayed
  skill-player board until every non-K/DEF core starter slot (including FLEX) is filled and the
  settings-aware late-draft window arrives — D/ST due at the penultimate selection, kicker at the
  final selection in the standard one-D/ST-one-K format, adapting to total rounds and slot
  configuration, never recommending a backup beyond configured capacity.

Exit criteria met, verified August 8, 2026: 308/308 frontend tests and 1/1 API test passing,
including draining-pool replacement invariants, tier-boundary vs. adjacent-gap distinctions, and
survival-conditioned availability monotonicity. Five real committed `data/` player totals reconcile
exactly (±1e-6) under standard PPR scoring. Recommendations verified deterministic: identical input
produces identical output including tie order, re-ranks correctly after an opponent pick, MRV
degenerates to raw points only on a genuinely open slot.

### Phase 1 context coverage snapshot — August 8, 2026

Draft season 2026, usage season 2025, durability/injury window 2023-2025. FFC PPR population: 5,187
twelve-team PPR mock drafts, 256 returned rows. Report-only cohort: 190 top-ADP PPR QB/RB/WR/TE
veterans in the 256-row feed. Crosswalks: PFR 190/190, GSIS 190/190. Covered 190, verified known
absent 2, missing 0, match rate 100.0%. Weekly-roster diagnostics reported 2 rows with unknown status
`E01` without guessing. This was a report, not a blocking threshold — usage/availability/injury
history don't affect recommendation math and produce no injury-risk label.

---

## S3 — VONA rollout engine — implemented (main thread); calibration/two-turn deferred

> Current ranking revision: Stage C rollout fields are diagnostics and a missing-ADP fallback. Skill
> cards sort on deterministic one-pick `planValue` (see `DECISIONS.md`'s 2026-08-10 entry). The notes
> below are the historical record of the rollout subsystem, not the current production sort
> contract.

Opponent pick model (`opponentModel.ts`): per-scenario ADP noise plus a bounded roster-need bonus,
deliberately not "every opponent blindly follows ADP." `defaultOpponentModelConfig(teams, rounds)`
supplies uncalibrated starting values (documented "Uncalibrated pending S6" on every field) — S6
calibrates them against a recorded Sleeper mock; nothing was tuned at this point.

Seeded, Node-testable rollout (`rng.ts`, `simulate.ts`): PCG32 + Box-Muller RNG with a prefix
property (`deriveStream`), one opponent-pick window simulated per scenario
(`simulateOpponentWindow`), an exact branch-and-bound best-follow-up search (`bestFollowUpValue`).
Next-turn only — the two-turn rollout originally scoped is deferred; one-turn lookahead is what's
built and tested.

Stage C wiring (`recommend.ts`):

- Rollout pool (`buildRolloutPool`) unions three terms in deterministic S2 order: the global top
  `max(3 * limit, 15)`; up to two positive-MRV, non-deprioritized leaders per QB/RB/WR/TE; and each
  of QB/RB/WR/TE's own top `limit` regardless of MRV — the third term guarantees a position tab
  always returns a full board even when global leaders concentrate elsewhere (e.g. a due K/DEF
  pick). K/DEF are excluded only from the simulated candidate set, not from `remainingPlayers` or the
  final displayed sort.
- All-or-nothing lookahead sort: ranks on `lookaheadValue` only when every displayed skill candidate
  has one; any other case falls back wholesale to the S2 `replacementAdjustedValue` sort, never a
  partial mix. A null-follow-up (the user's final pick) isn't a fallback case — `simulate.ts`
  collapses it cleanly to deterministic MRV.
- Stage C only runs while `decisionPick === currentPick` — only during the user's own turn, a known
  permanent boundary, not a bug.
- Reapplies the full S2 special-teams policy on the final sort.
- Two caches cleared together by `clearSimulationCache()`: a single-entry simulation-result cache,
  and an incrementally-extended `teamRosterCache`.

MRV/VOR fallback if simulation misses its deadline: the `'budgeted'` execution mode and `timedOut`
diagnostic exist and are tested, but the shipped default is `'fixed'` (see performance note below).

### Performance — two engine-level fixes, not just a scenario-count choice

Measuring Stage C's real cost surfaced two defects in shared engine code that a naive scenario-count
sweep would have misdiagnosed as "simulation is inherently slow":

1. **`addPlayerToLineup`'s exact-tie fallback was the dominant cost, not scenario count.** On an
   ambiguous tie (~11% of calls on real committed data, deep in a draft) it re-ran the full
   exponential `solveIndexed` DP (~37ms each) to resolve which tied assignment matches the reference
   DP's canonical choice — needed for display (`assignedRosterSlot`), but every Stage C hot-path
   caller (`bestFollowUpValue`, `simulateOpponentWindow`, the per-candidate MRV pass in
   `runSimulation`) only reads `.result.value`, never occupant identity, which is exact regardless of
   which tied option is taken. A `resolveAmbiguityExactly` parameter (default `true`, preserving
   exact behavior for the displayed S2 board) lets Stage C's three hot-path calls skip the fallback —
   cutting a single scenario's cost from ~7.3s to ~44ms, roughly 150x.
2. **`buildTeamRosters` re-solved all opponent lineups from scratch on every call.** A live draft
   mostly appends picks between polls, so `recommend.ts` maintains `teamRosterCache`: extends
   incrementally on a clean append via the same value-safe fast path; any non-append change (manual
   correction, settings change) falls back to a full rebuild — never wrong, only sometimes not
   faster. The same deferred-identity principle applies to `recommend.ts`'s widened deterministic
   prefilter (`patchExactAssignment`): exact identity resolved only for cards that end up displayed.

`DEFAULT_SCENARIOS = 8`, selected 2026-08-10 against real committed `data/` at Stage C's worst-case
fixture (12 teams, 16 rounds, slot 1). Warm case (the realistic steady state — `teamRosterCache`
extends rather than rebuilds): ~75-90ms fixed overhead plus ~23ms/scenario, roughly linear, ~233ms at
8 scenarios. Cold case (only the first Stage C-eligible turn of a session): dominated by fixed
one-time cost, ~950-1150ms at 8 scenarios — rare in practice, well inside the 3s clock test, but
deliberately not what the default was tuned against. The 250ms internal target (tighter than the 3s
product-level clock test) exists because the 2.5-3s live poll interval already consumes most of that
budget on its own.

Exit criteria met: same seed/state produces the same recommendation (`'fixed'` mode is the shipped
default; `deriveStream` plus cache-key fingerprinting guarantee this, tested directly). Candidate
comparisons use common scenarios and remain stable at real-data scenario counts (not yet validated
against a recorded mock — S6). UI stays responsive well inside the pick clock for the warm case; the
cold case and the still-unbuilt Web Worker remain open because the cold case hasn't been
stress-tested against the live poll loop end-to-end, not because measured cost has demanded a worker.

Deferred, not built: the Web Worker (main-thread cost turned out to be a fixable engine defect, not
an inherent scenario-count problem — revisit if real usage still shows main-thread jank), the
two-turn rollout, and opponent-model calibration (S6).

> **Correction (2026-08-21): the Web Worker did ship.** Commit `f821318` ("frontend: card-board
> layout, worker latency fixes, and DataHealth polish") landed `frontend/src/workers/
> recommendation.worker.ts`, `frontend/src/hooks/useRecommendationRefinement.ts`, and
> `frontend/src/engine/recommendationWorkerProtocol.ts`: a long-lived worker created at pool load,
> cooperative cancel of superseded requests instead of terminate, and a main-thread fallback board.
> The deferral above was written when measured main-thread cost was the binding constraint; the
> latency follow-up ended up needing the worker on the live clock path regardless. Two-turn rollouts
> and opponent-model calibration (S6) remain deferred.
