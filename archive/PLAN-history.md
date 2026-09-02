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

---

## S4 — Draft experience and explanations — complete (with named leftovers)

Shipped: engine/ADP board modes with position tabs and cards/rows presentation (`BoardFilters.tsx`),
roster/open-slot rail (`MyTeamRail`), the top-three recommendation panel, tier/availability/value/
confidence fields (`NextPickSurvivalMeter.tsx`, `PlayerDetailDrawer.tsx`), the card's next-up tier
chip (`NextUpChip`, 2026-08-23 — consumes `tierBoundaryGap`/`nearTierGap`), and data-health status
(`DataHealth.tsx`). Exit criteria met: every recommendation explains immediate roster value and
waiting risk; low-confidence/stale data cannot appear as high-confidence advice; a user can complete
a full mock without opening developer tools (verified across the 2026-08-28/29/30 live mocks).

Deferred to `PLAN.md`'s backlog (still unbuilt as of 2026-08-30): board player search, manual
pin/avoid/custom-rank override, a fuller tier-cliff view (text-only today), a consolidated source/
freshness panel, and a wired reconnect path.

---

## S5 — Reliability and clock testing — closed 2026-08-30 on operational evidence

**Why closure is operational, not instrumented:** the original acceptance was the DEV clock test
(`benchmarks/reports/2026-08-20-clock-test.md`, `frontend/src/lib/perf.ts` marks + `DraftTimingPanel`).
That instrumentation was deliberately removed in `ec69271` (dev-only chrome on the live surface), so
the report's "already shipped" instrumentation line is stale — the file now carries a superseded
header. In its place, before S5 closed, five distinct live-draft bugs were found by the user's own
mock drafts and fixed with regression tests — which is the substance S5 existed to produce. The
five, all logged in `DECISIONS.md`'s 2026-08-28/29 entries (see those dated headers for the
blow-by-blow).

Production mechanics shipped and tested: poll backoff honoring `Retry-After`
(`hooks/useDraftPoll.ts:244-247`), visibility/tab-suspension handling (`:283-294`, `:381-389`),
staleness display (`:300-308`), duplicate-pick detection (`components/DataHealth.tsx:46-55`),
unmatched players surfaced end-to-end (`adapters/sleeper.ts:315-317` →
`RecommendationBoard.tsx:519-521`, forcing `confidence='low'` at `engine/recommend.ts:1076`), and
draft-completion detection (`session/completion.ts` — a real `{ kind: 'complete' }` session state
with an explicit-exit banner instead of polling a finished draft forever).

Latency: the leg the project controls is CI-gated — `engine/recommendPerformance.test.ts:250-292`
pins median Stage C latency < 3000 ms against real committed `data/`. Live end-to-end: the ESPN
bridge reflects picks in under 1s; Sleeper adds 5-15s of upstream publish lag that no poll interval
can fix. Per the owner's call, S5 closed flat without recording the Sleeper figure (upstream lag is
not the product's clock). The reconnect handler in `useDraftPoll.ts:327-329` is implemented but has
no call sites yet — carried in the backlog, not a defect.

---

## S6 — Edge Validation Gate — closed and authorized 2026-08-30

### Phase 2 (survival curve) — closed 2026-08-21; the current model ships unchanged

Phase 2a diagnosed the survival-curve assumptions with `pipeline/survival_diagnose.py` against the
pinned FFC fixture `fixtures/ffc/adp-ppr-observed.json` (2026-08-13→20, 6,978 mocks, 264 players);
per the 2026-08-21 correction in
`benchmarks/reports/2026-08-20-ffc-survival-diagnosis-interpretation.md`, the original deep-tail
"left-skewed" reading was a right-censoring artifact (58% of deep-tail rows sit within 10 picks of
the 180-pick mock ceiling), and the corrected skew is right-tail-dominant across all bands — a
single right-skew kernel, not the band-flipping one originally guided.

Phase 2b transcribed the two all-human ESPN drafts (`espn_draft1.txt` 10-team/14-round,
`espn_draft2.txt` 10-team/16-round) into `fixtures/real-drafts/` and extended
`benchmarkAvailability.bench.ts` to the 11-draft registry (9 recorded Sleeper mocks + 2 human) with
cohort labels (`humanSeats`/`autodraftShare`/`marketShare`), all-seat seat-independent availability
scoring (section A.5), and cohort stratification throughout (2d).

Phase 2c implemented the H2 per-player CV transfer (`build_ffc_cv_index`/
`fitted_stdev_for_player`), gate-checked it
(`benchmarks/reports/2026-08-18-availability-calibration-baseline-phase2c.md`), and **it did not
ship**: it improved the bot cohort but regressed the held-out human Brier on both metrics
(`DECISIONS.md`, 2026-08-21), so the `build_data.py` wiring was reverted and the flat-band
`fitted_stdev` remains production. H1 is unattempted and deferred — no kernel work until more real
human drafts make the strict-improvement gate meaningful. Availability stays labeled experimental
per the Phase 2c decision rule.

### Priority change (2026-08-25) — public surface ahead of the gate

The user explicitly changed priority (`DECISIONS.md`, 2026-08-25): the product restructured into a
public/gated split — 0 docs → 1 react-router migration with the session provider lifted above the
routes → 2 the public `/draft-guide` page → 3 landing becomes illustration-only with the real
connect flow moving to post-signup `/onboarding` → 4 Clerk auth seam (`RequireAuth`, mock adapter
default) → 5 saved leagues/drafts on Cosmos via authenticated Functions. **Phases 0-5 all shipped**
(2026-08-26), plus the follow-up league-first connect split and `/leagues` hub replacing `/teams`.
This was an explicit priority call under the expansion rule, not a gate pass, and it authorized no
in-season ESPN/Yahoo work.

### Evaluation layer A — historical out-of-sample draft strategy: PASS

The 2025 backtest freezes preseason inputs through `pipeline/backtest_snapshot.py` into committed
`fixtures/backtest/2025/` (FFC 2025 PPR ADP + FFToday 2025 projections; leakage/identity/outcome
gates passed) and runs six arms over a paired (slot × seed) grid sharing one opponent field
(`npm run backtest`, `frontend/src/engine/backtest.ts`): mean optimized weekly starter points
(weeks 1-17, exact lineup DP over real 2025 `pts`), replacement-adjusted points, simulated H2H
wins / playoff rate, downside/fragility — against the pre-declared gates in
`fixtures/backtest/2025/gates.md`. The 20-seed pilot was directional/non-gating; the N = 1,008
gating run completed 2026-08-23 with **all three pre-declared gates PASS** vs baseline 3 (static
VOR) (`benchmarks/reports/2026-08-23-historical-backtest-2025.md`, `DECISIONS.md`, 2026-08-24).

**Sim-sort probe and C1 spinoff (closed, reported-only):** the probe (`npm run probe:simsort`) found
37.8% top-1 disagreement between sorting on Stage C's `lookaheadValue` vs `planValue`, so the `c1`
arm was built and run. In the gating run C1 beat the engine (+0.768 [0.231, 1.305]) but the
2026-08-24 instrumented attribution run (`pipeline/analyze_c1_positions.py`) settled the mechanism:
the entire edge lives in cap-1 slots (TE +3.92 of a +4.11 K+TE+DEF total) while WR starter points
are −5.42 — not promotable per the pre-declared shippability rule, so **C1 is closed for 2025
data**. The engine-vs-B1 question closed out the same day: the deficit is a diffuse
skill-position construction shift specific to the default simulated field — at any other tested
opponent-noise level the engine beats naive ADP (+1.8 to +8.2 pts/wk). Mechanical sweep verdict:
**AMBIGUOUS** per pre-declared rules; no further 2025 simulation work.

### Evaluation layer B — availability calibration: measured; labeled experimental

Measured on recorded drafts/mocks (Brier, calibration buckets, error by round/position; latest run
`benchmarks/reports/2026-08-25-availability-calibration.md`). Finding: the model under-predicts
survival in the decision-relevant 0-0.5 buckets; the pooled Brier (0.0217) is flattered by ~90% of
rows sitting in the 0.9-1.0 bucket. The gate's passing criterion is "demonstrably calibrated **or
explicitly labeled experimental**" — the disposition is the label, which ships in the UI
(`components/PlayerContextBody.tsx:118`). Replacement/correction remains backlog-class work, not a
blocker.

### Closure

Layers C/D became standing in-season tracking (see `PLAN.md`); S5 closed as recorded above; the
owner reviewed the evidence and authorized roadmap expansion on 2026-08-30
(`DECISIONS.md`, 2026-08-30 (6)).




