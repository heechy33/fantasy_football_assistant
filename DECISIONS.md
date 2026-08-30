# Design decisions

Append-only log of durable product/engine/data decisions and the reasoning behind them, in
chronological order. **Do not rewrite past entries** — if a decision changes, add a new dated entry
that says so and links back to the one it supersedes. This is the record of *why*, not *what to do
next* (that's `PLAN.md`) and not *how the repo is organized* (that's `CLAUDE.md`).

**This file was condensed on 2026-08-25** — each entry below keeps the decision, why, and final
result; full statistical tables, intermediate/superseded findings, and instrumentation blow-by-blow
live unabridged in `archive/DECISIONS-history.md`, indexed by the same dated headers. If a number
here and in the archive ever disagree, the archive is primary — nothing there was rewritten, only
summarized outward into here.

---

## 2026-08-06 — Role-separated multi-source data stack

**Decision:** use a role-separated data stack rather than one source or a blended average — live
draft truth (Sleeper), performance forecast, projection challenger/fallback, consensus rank/tier
guard, market ADP (FFC), historical outcomes (nflverse), ID crosswalk (DynastyProcess), user
override CSV — each in its own field, never averaged together silently.

**Why:** aggregation research found simple averaging more stable than any single source, but
FantasyPros is already a consensus, so equal-weighting it with a second source risks double-
counting the same opinion. Keep projected production, expert rank, and market ADP separate; derive
a consensus later only after it beats the single best source on defined metrics.

**No-lost-player contract:** the board is built with unions/left joins, never an inner join.
Missing projection/ECR/ADP is `null` plus a visible source-status flag — never zero, never
"drafted." Coverage gate: pipeline fails if a top-200 ADP/ECR player can't map to a Sleeper ID.

**Status:** only one performance-projection source (FFToday) was ever implemented; the FantasyPros
API and Rotowire-via-Sleeper paths scoped here were never pursued, and the FantasyPros lane (stars +
SOS) was later cut entirely (2026-08-23/24 entries below) after measuring near-zero predictive
value. This is a sequencing/measurement outcome, not a reversal of the role-separation principle.

---

## 2026-08-06 — Degraded-mode behavior when data is missing/stale

1. Projection + ADP available → full engine.
2. Projection available, ADP coverage <50% → projected-value board, no board-wide availability
   claim.
3. ADP available, projection missing → labeled market-rank board, no "best roster" claim.
4. Both missing/stale → manual board only, blocking data-health warning.

Never silently substitute one signal for another.

---

## 2026-08-08 — Rejected the multiplicative recommendation formula

**Rejected:** `VOR × need × (1 / tier_gap) / P_available`.

**Why:** `1 / tier_gap` reverses tier urgency (a bigger cliff should raise urgency, not lower it).
Dividing by `P_available` is unbounded — a 1% survival estimate creates a 100× multiplier that can
overwhelm player quality and roster construction entirely.

**Replaced by:** slot-aware marginal roster value (MRV), bounded/non-inverted tier urgency, and
VONA-style opponent-pick rollouts. See `PLAN.md`'s "Recommendation engine" section for the current
spec, and the 2026-08-10 entry below for the production ranking formula actually shipped.

---

## 2026-08-08 — Research corrections

Corrections to over-confident claims from an earlier plan revision, established before S1-S3 build:

- **Paid-service benchmark:** don't claim "paid-service parity" before the Edge Validation Gate
  passes — feature resemblance isn't evidence of recommendation quality.
- **Custom scoring:** claim "exact for supported linear scoring categories; approximate/unsupported
  for threshold/range/nonlinear rules" (100-yard bonuses, once-per-game thresholds, DST point-
  allowed ranges).
- **Projection source:** single-source projection error is the highest engine-quality risk while
  only FFToday is implemented; surface source and data age in the UI.
- **Availability model:** `P(available) = 1 − Φ((next_pick − adp) / stdev)` is a reasonable initial
  baseline from FFC's `adp`/`stdev`/`high`/`low`/`times_drafted`, but ignores room needs and
  positional runs, and needs calibration before being trusted (S6).
- **Architecture:** client-side pure-function engine is correct; Sleeper is unauthenticated/read-
  only, docs suggest staying under 1,000 calls/minute.
- **Azure specifics:** SWA Free is 250 MB/environment, 100 GB/month bandwidth; Node 22 via
  `apiRuntime: node:22`; Functions are HTTP-trigger only; Cosmos free tier is 1,000 RU/s + 25 GB,
  `enableFreeTier` set-only-at-creation — cap throughput at 1,000 RU/s when it's provisioned.

**Open-source implementation references** (research/porting knowledge, not runtime dependencies):

| Project | What to learn/reuse | License/status note |
|---|---|---|
| `cwendt94/espn-api` | ESPN views, integer position/team maps, cookie shapes, retry/fallback endpoints, draft parsing | MIT; provider-roadmap reference |
| `ffverse/ffscrapr` | Normalized provider contracts, ESPN/Sleeper scoring maps, threshold scoring, starter min/max, FLEX edge cases | Open-source R package; port concepts/tests to TS |
| `ffverse/ffsimulator` | Positional-rank bootstrap outcomes, games-played/injury modeling, replacement players, lineup optimization, season simulation | MIT; primary engine research reference |
| `FantasyFootballAnalytics/ffanalytics` | Multi-source adapter shape, league scoring, simple/robust averages, uncertainty, VOR | GPL code; implementation reference only, not permission to redistribute scraped data |
| `DynastyProcess/data` | Player-ID crosswalk | Weekly automated data; GPL-3.0 |
| `nflverse`/`nflreadr` | Historical weekly stats/rosters for scoring reconstruction and out-of-sample testing | Historical-data/backtest foundation |

From `espn-api`: preserve `POSITION_MAP`, `PRO_TEAM_MAP`, the 401 alternate-endpoint retry, and
`mPositionalRatings` as provider-adapter knowledge for when ESPN's in-season track opens.

---

## 2026-08-10 — Unified-utility timing revision (production ranking formula)

**Supersedes** the original S3 rollout-diagnostic sort. Production ranking is:

```text
planValue(c) =
  marginalRosterUtility(c now)
  + E(best conditional marginalRosterUtility at the next user pick)

VONA(c) =
  max(0, marginalRosterUtility(c)
    - E(best surviving marginalRosterUtility in c's eligibility group))
```

The follow-up expectation orders candidates by conditional utility after `c` and uses ADP-based
survival plus the probability every higher-utility option is gone. ADP affects timing only, never
intrinsic player quality. VONA is explanation-only — its timing effect is already inside
`planValue`, so it's not added a second time. Missing ADP uses fixed-seed simulated survival when
available and demotes confidence; if neither source exists, VONA is null. `lookaheadValue`, rollout
VONA, downside, and simulated survival remain diagnostics/benchmark fields — they don't sort the
production board (confirmed empirically by the 2026-08-22 backtest pilot: `engine`/`b4` produce
byte-identical picks).

**Why one-turn, not two-turn:** a nine-draft regret-ceiling prescreen found one-horizon mean regret
already below the predeclared 0.5 utility-point gate, so even a perfect two-pick policy couldn't
have qualified. Production stays at one deterministic future pick.

---

## 2026-08-11 — Draft Score: a residual tie-break, not a primary sort

**Decision:** add a published, auditable 0-100 composite (`Value`/`Edge`/`Risk` axes) for card
display and residual tie-breaking only:

```text
Value = 100 × clamp01(marginalRosterUtility / VALUE_ANCHOR)
Edge  = 100 × clamp01(1 - availableNextPickProbability)   // 0 with no future pick or no ADP
Risk  = 100 × clamp01(
  0.50 × (100 - resolvedDurabilityScore) / 100
  + 0.30 × injuryPenalty
  + 0.20 × clamp01(availabilityStdev / dispersionAnchorPicks)
)
draftScore = clamp(0, 100, (0.65 × Value + 0.35 × Edge) × (1 - 0.25 × Risk / 100))
```

**Naming:** "Draft Score," not "3D Value" — FFToday supplies one point estimate per player, not a
floor/ceiling/consensus distribution, so a third projection axis would be fabricated.

**It does not become the primary sort.** `planValue` (2026-08-10 entry) remains the production
ranking objective — survival → ADP → planValue → id within-band near-tie order. Draft Score enters
only as a residual tie-break at the third comparator position. **Edge excludes VONA/`tierUrgency`**
(already folded into `planValue` — would double-count scarcity). **Risk excludes engine
`confidence`** (that's data-quality, not player-medical risk — K/DEF rows are always
`confidence: 'low'`, so folding it in would silently discount every special-teams card). **Missing
data resolves to unknown, never to safe** — no `player-usage.json` row gets the league-median
observed durability score, not zero, and renders visibly hatched.

**2026-08-11 A/B result:** ran the 9-recorded-draft harness with the residual breaker on/off —
Sections A/B/C reproduced identically (the breaker never fired at rank 1 on this sample). Not
evidence for or against promoting to full primary sort; that remains a separate future decision.

**Implementation note:** only the formula above (living in `recommend.ts`) and the Phase 1 data
contracts (`weekly-ppr.json`, the now-removed FantasyPros stars parser) shipped from the archived
`archive/cursor-plans/DRAFT_SCORE_WAR_ROOM_REVISED_PLAN.md` — treat that plan as historical context.

---

## 2026-08-14 — Authorized exception: ESPN draft-day project ahead of the Edge Validation Gate

**Decision:** authorized a narrow, draft-day-only ESPN project (manual takeover, an ESPN
reconnaissance Chrome extension, a draft-only `DraftProviderAdapter`, draft-day packaging) to
proceed ahead of the Edge Validation Gate, for a real private-league draft on August 15, 2026.

**Why:** a real deadline took priority for this one narrow, additive slice — strictly additive to
the Sleeper path, draft-day scope only, no ESPN cookie/raw-traffic storage, no change to the gate.

**Status:** the draft completed; this exception is closed. Any further ESPN work needs its own
decision — see `PLAN.md`'s "Status and decision" for current active scope.

---

## 2026-08-20/21 — FFC survival-curve diagnosis (Phase 2a/2c): H2 rejected, H1 unattempted

**FFC field semantics (verified live, all 264 rows) — a standing gotcha:** `high` is the
**earliest** pick observed (smallest number), `low` the **latest** (largest); `high <= adp <= low`
always. Code reading FFC `high/low` as "latest/earliest" is inverted.

**Diagnosis, corrected:** an initial reading (2026-08-20) found the kernel skew band-dependent
(right-skewed near the top, left-skewed in the deep tail). A right-censoring check found the deep-
tail "left-skewed" reading was an artifact of FFC's fixed 180-pick mock ceiling (58% of deep-tail
rows sit within 10 picks of it); excluding censored rows flips it to mildly right-longer,
**consistent with the other three bands.** Corrected reading: H1 skew is right-tail-dominant across
the whole board, not band-dependent — a band-flipping kernel would have encoded a measurement
artifact into the model.

**H2 (per-player CV transfer) implemented and gate-checked — does not ship.** Empirical-Bayes
shrinkage of a player's FFC-observed CV toward the flat band constant improved the bot cohort's
Brier score but regressed the held-out 2-draft human cohort on both metrics (analytic +0.000272,
all-seat +0.000025 — both fail the "must strictly improve" gate). Per the pre-declared decision
rule, **it does not ship**: `build_data.py`'s wiring was reverted to omit `ffc_cv_index` (defaults
to `None`), and the flat-band `fitted_stdev` remains production. The tested mechanism stays in
`transform.py`/`espn_adp.py` as unused optional parameters for a future attempt. Likely cause: the
held-out human sample is only 2 drafts, and FFC's per-player CV is estimated from a different
population than either Sleeper's or ESPN's own board.

**Status:** H1 (the corrected kernel) has not been attempted — given H2 (the lower-risk option)
failed its gate, H1 needs an explicit go-ahead before more implementation risk. Availability stays
labeled experimental pending that decision. Full diagnostic tables:
`benchmarks/reports/2026-08-20-ffc-survival-diagnosis-interpretation.md`.

**Related administrative notes (same window):** the recorded Sleeper mocks that feed the
availability/VONA harness carry `autodraftShare` 0.90-0.92 — they're a market-shaped bot cohort, not
a human behavioral signal; the two all-human ESPN drafts (`fixtures/real-drafts/`) are the only held-
out human cohort. The Sleeper/ESPN fitted-dispersion shape transfer (FFC's CV curve → non-FFC board
means, `transform.fitted_stdev`) is a pre-existing extension of the 2026-08-06 data-stack design, not
a provider added to hide the H2 result.

---

## 2026-08-21 — Historical out-of-sample backtest: pre-declared gates (evaluation layer A)

**Decision:** run the Edge Validation Gate's evaluation layer A (2025 historical draft-strategy
backtest) with gates pre-declared **before** the harness runs, so a negative result is credible.
Preseason inputs frozen via `pipeline/backtest_snapshot.py` into `fixtures/backtest/2025/` (FFC 2025
PPR ADP + FFToday 2025 projections; leakage/identity/outcome gates verified). Full spec committed at
`fixtures/backtest/2025/gates.md`:

- **League config:** 12-team snake PPR, 1QB/2RB/2WR/1TE/1FLEX/1K/1DEF, 16 rounds, plain PPR scoring.
- **Primary metric:** mean optimized weekly starter points, weeks 1-17, paired per draft, N ≥ 1,000,
  fixed seed `20250825`.
- **Primary gate vs baseline 3 (static VOR):** engine mean ≥ baseline-3 mean − 0.25 pts/week AND the
  paired 95% CI excludes a loss worse than −0.25 pts/week.
- **Downside gate:** engine 10th-percentile weekly total ≥ baseline-3's − 0.5 pts.
- **Decision rule:** a failed gate is written down and the engine improved — never buried.

---

## 2026-08-22 — Backtest harness built; K/DEF scoring bug found and fixed; pilot run (directional)

**Decision:** implemented `frontend/src/engine/backtest.ts` + `npm run backtest` and ran the pre-
declared 20-seed pilot (240 paired drafts). Directional/non-gating by design — verdicts apply only
at the N ≥ 1,000 gating run.

**Correction mid-pilot:** `BACKTEST_SCORING` originally omitted every K/DEF key, leaving baseline B3
(static VOR) unable to draft K/DEF at all (0 coverage) and inflating the engine-vs-B3 gap by an
est. 10-15 pts/week. Fixed and re-run same day.

**Corrected pilot (N=240, 12 slots × 20 seeds):** engine/B4 mean weekly 129.588 (10th-pct 99.400,
coverage 0.614); B3 112.634 (10th-pct 83.200, coverage 0.298); B2 124.025; B1 (FFC ADP) 130.502.
Paired engine vs B3: **+16.954 pts/week, 95% CI [15.931, 17.977]** — directionally far above the
±0.25 tolerance. Full arm table and findings: `benchmarks/reports/2026-08-22-historical-backtest-
2025-pilot.md`.

**Findings that shaped later work:** (1) `engine` and `b4` produce byte-identical picks — Stage C's
rollout fields are display-only, confirming the 2026-08-10 design note. (2) B1 (plain FFC ADP)
outscored the engine in this pilot (130.5 vs 129.6) — flagged the engine-vs-B1 question investigated
in the 2026-08-24 entries below. (3) Coverage is low for every arm (0.21-0.50) because 2025 kicker
injuries left the K slot unfillable most weeks — a real 2025 fragility signal, not a harness bug.

---

## 2026-08-22 — Redundant-QB display gate: fixed in RecommendationBoard.tsx, not the engine

**Problem:** in a Sleeper PPR one-QB redraft, once the user has a starting QB, the "All"
recommendation board still surfaces additional QBs in later rounds.

**Root cause:** `eligibility.ts`'s `DEPTH_POSITIONS` includes `QB` unconditionally, so
`depthPortfolioValue` matches a QB2 against the occupied starter slot and pays it a bench-depth
value that lands in `marginalRosterUtility` — the board's actual sort key. One-QB leagues'
`flexShare = 0` compounds this by lowering the QB replacement baseline.

**Decision:** fix in `RecommendationBoard.tsx` presentation only — filter QB rows out of the "All"
tab once `format.qb === 'one-qb'` and the starting QB slot is filled (same mechanism already used to
exclude K/DEF from "All"), not in `recommend.ts`/`eligibility.ts`. Two reasons: (1) the backtest
only reads `recommendations[0]`, so it's structurally blind to rank 2-24 symptoms and changing the
engine would perturb the artifact the pending gating run measures, for a defect it can't see; (2)
the harness has no waiver wire, so it can't fairly price a QB-gating policy — a real QB1 bye scores
0 with no QB2 rostered, so the backtest structurally *rewards* drafting one.

**Scope:** display-only, guarded by `format.qb === 'one-qb'` and no `SUPER_FLEX` slot; position tabs
are never filtered, only "All," in both Engine and ADP modes. `depthPortfolioValue`'s missing
`format.qb` carve-out is left as a known, documented engine wart for whenever the engine is next
revisited — guarded by `recommendBenchMode.test.ts` asserting a QB2 can still appear in
`result.recommendations`.

---

## 2026-08-22 — Sim-sort disagreement probe → C1 backtest arm added

**Decision:** before building a sixth, fully-scored backtest arm, pre-declare a cheap screening
rule: walk a normal `engine` draft trajectory and at every subject turn ask whether sorting by Stage
C's simulated `lookaheadValue` instead of `planValue` would have chosen someone else
(`npm run probe:simsort`). **Build the `c1` arm if** overall top-1 disagreement ≥ 5%, any round band
disagreement ≥ 10%, or the no-ADP-coverage subset disagreement ≥ 10%.

**Result:** rule fired decisively — 37.8% overall top-1 disagreement (every round band cleared 10%
too), concentrated in the middle rounds, moderate rank correlation (0.54 overall, dropping to
slightly negative in rounds 9-12). Real, persistent sort-order divergence, not simulation noise.
`c1` arm added: sorts by `simSortChoice` (defers to K/DEF picks unchanged; otherwise the max-
`lookaheadValue` non-K/DEF row), sharing the `engine` arm's RNG stream so Monte Carlo noise is
identical and the sort-key difference is the only isolated variable. Additive/reported-only —
`evaluateGates`/`pairedEngineVsB3`/the B3 gate thresholds are untouched.

**Pilot (N=240):** C1 130.590 vs engine 129.588 — **+1.002 pts/week, 95% CI [-0.151, 2.155]**, not
yet significant, but every secondary metric moved the same direction and coverage jumped 0.614 →
0.750. See the 2026-08-24 gating-run and attribution entries below for the resolved verdict.

---

## 2026-08-23 — Early-window opponent-FPA ("SOS") measured and cut

**Decision:** do not build the proposed 3-week trailing opponent-FPA tie-breaker; treat it as
settled-negative. The displayed FantasyPros SOS stars are also ≈ null and gain no engine role.

**Evidence** (`pipeline/measure_sos.py`, rule pre-declared before results): the primary signal
(sos_3w) had a real partial correlation (r=0.094, 95% CI [0.058, 0.132], n=3329) but **failed the
rank-utility half decisively** — adding it to a form-only ranking *lowered* next-week top-12 hit
rates in ~87% of position-week pools. Verdict: CUT. Predictive correlation rose with window length
(1w < 3w < 5w < season-to-date) — the "less stale, more useful" rationale behind the early-window
proposal runs backwards. FantasyPros preseason SOS stars: partial r ≈ -0.05, indistinguishable from
zero.

**Why cut rather than redesign:** the signal showed a trace of raw correlation but zero ranking
value in its proposed use, on one clean season, with its own motivating rationale empirically
inverted.

---

## 2026-08-23/24 — Projection-blend research ladder: retrospective screen cut, reopened, AMBIGUOUS

**Step 0 cut:** a retrospective 2025 blend-vs-FFToday screen (Sleeper/ESPN/CBS projections vs
FFToday-only, scored against 2025 actuals) failed its own pre-declared vintage gate for every
provider — none could be verified as frozen pre-kickoff (Sleeper's `last_modified` reflects a 2026
resync; ESPN carries no as-of field; CBS/Wayback have no retrievable 2025-window data). Unverifiable
provenance is exactly what the FFToday leakage gate exists to exclude. **Standing convention:**
"retrievable now" is not "vintage-clean" for any future evaluation. Pivoted to a prospective 2026
ladder riding a frozen pre-kickoff snapshot (`fixtures/projection-freeze/2026-preseason/`, SHA-256
pinned).

**Reopened, asymmetrically:** the retrospective 2025 question was re-opened through the existing
backtest harness under an explicit asymmetric rule (`fixtures/backtest/2025/gates-blend-
addendum.md`): since vintage is unverifiable, a mid-season-revision advantage can only help the
blend, so a **loss is conclusive** (permanent cut) while a **win is only provisional**, requiring
2026 in-season confirmation. Source bytes frozen once (`fixtures/projection-freeze/2025-
retrievable/`, SHA-256 pinned).

**Pilot result: AMBIGUOUS — FFToday kept, blend hypothesis stays open only via the prospective 2026
ladder.** Two CRN-paired 240-draft runs: raw blend board vs FFToday board **+2.926 pts/wk, 95% CI
[+1.731, +4.121]** (real ranking improvement), but the full engine context's pavg-vs-FFToday
comparison was **+0.898, 95% CI [-0.651, +2.447]** (crosses zero — the engine already captures most
of the projection-quality gain via availability modeling) and the **downside gate failed**
(10th-pct −1.94 pts, far outside the −0.5 non-inferiority band). Consequence: no blend features in
production; the 2025 track is closed. Reports: `benchmarks/reports/2026-08-23-blend-screen.*`,
`2026-08-23-blend-pilot-analysis.json`.

---

## 2026-08-24 — N=1008 gating run: all three gates PASS; C1 not promotable; engine-vs-B1 deficit logged

**Recordkeeping correction:** the gating run (84 seeds × 12 slots = 1008 drafts/arm) ran 2026-08-23
but went unrecorded until this entry.

**Result — all three pre-declared gates vs B3 PASS:** primary-point-floor (129.390 ≥ 112.719 −
0.25); primary-CI (+16.671 pts/wk, 95% CI [16.155, 17.187]); downside non-inferiority (p10 98.300 vs
83.200 − 0.5). Layer-A evidence now exists; roadmap expansion still awaits the plan's user-review
step. Artifacts: `benchmarks/reports/2026-08-23-historical-backtest-2025.{md,json}`.

**C1 vs engine: +0.768 pts/wk, 95% CI [+0.231, +1.305]** — significant at this N, unlike the pilot.
**Engine vs B1 (plain FFC ADP): −0.830 pts/wk, 95% CI [−1.539, −0.121]** — the production engine
sorts significantly *worse* than naive best-available-by-ADP on this grid; **C1 vs B1: statistical
tie** — C1 repairs the deficit rather than beating ADP outright. Flagged as a standing finding
needing investigation before marketing any "edge" (resolved below, same day).

**C1 attribution result: the edge is cap-slot-only and TE-driven — C1 not promotable on 2025 data.**
Instrumented rerun (`BACKTEST_DIAGNOSTICS`) attributing starter points by position: **K+TE+DEF
+4.112 pts/wk** (TE alone +3.916) vs **skill-only (QB+RB+WR) −3.100 pts/wk** (WR −5.424). The
backtest has no waiver wire, so cap-slot points are recoverable in a real league regardless of who
drafted them — per the pre-declared shippability rule, an edge that trades away 5.4 pts/wk of WR
production for early-TE construction is not promotable. K/DEF are drafted at identical fixed rounds
by both arms (rules out "C1 drafts special teams earlier"). Reported-only, closed for 2025 data.
Full tables: `benchmarks/reports/2026-08-24-c1-attribution-analysis.json`.

---

## 2026-08-24 — Engine-vs-B1 deficit localized; shock-scale sweep AMBIGUOUS

**Localization (offline attribution, no rerun):** the engine-vs-B1 deficit is a **skill-position
(WR/QB) construction shift**, not cap-slot noise — **skill-only −3.027 pts/wk** (significant),
offset by RB/K/DEF gains, netting the non-significant −0.836 inclusive figure. Mechanism: the engine
reaches for QB (mean first-pick round 4.06 vs B1's 9.57) and TE (7.64 vs 13.24), letting WR slide
(3.28 vs 1.59) relative to plain ADP order — its value logic deviates from market order exactly
where 2025's realized outcome punished it. Diffuse across all 12 slots, not a slot artifact.
**2025-conditionality caveat:** one season, one outcome draw — TE timing value is non-monotonic
(B1's much-later TE picks also beat engine's in one comparison), which smells player-specific rather
than a stable law.

**Shock-scale sweep (tests "B1 is flattered by a shared-ADP-prior opponent field"):** swept a fresh
`BACKTEST_OPPONENT_SHOCK_SCALE` knob ∈ {0, 2, 4} (240-draft pilots each) against the standing scale-1
default. Result: engine beats B1 at every tested scale except the calibrated default (scale 0:
+1.784*; scale 1 (default): −0.836; scale 2: +6.562*; scale 4: +8.237*). **Mechanical verdict per
pre-declared rules: AMBIGUOUS** (the scale-1 dip breaks the required monotonic ordering for a
saturation verdict) — no further 2025 sweep spend. **Exploratory reading (not the verdict):** the
"shared ADP prior" hypothesis is refuted as stated (engine actually beats B1 at true saturation and
at elevated noise); the deficit is real-but-small and specific to the exact default noise level.
Practical shape of the claim: engine-vs-ADP performance depends heavily on field character; on this
2025 grid it loses ~0.8 pts/wk only in the default simulated field. Neither direction may be
marketed from 2025 sims alone — layers C/D (live mocks, projection tracking) are the human-
containing tests that matter. Full tables: `benchmarks/reports/2026-08-24-engine-b1-attribution-
analysis.json`, `2026-08-24-shock-scale-sweep-analysis.json`.

---

## 2026-08-24 — Layer D stood up as git-vintage snapshots; no database

**Decision:** satisfy evaluation layer D (dated projection/ADP retention, for scoring recommendations
against 2026 actuals later) with git history + annotated tags rather than a database.

**Why:** `refresh-data.yml` already commits the full `data/` directory daily with provenance
manifests — every commit was already a dated vintage. What was missing was findability and failure-
loudness. A database adds nothing for append-only JSON blobs; migrating into a future DB later is
trivially reversible, while an uncaptured vintage is not — but the genuinely time-pressured pre-
kickoff 2026 vintage was already frozen separately, removing the urgency for heavier machinery.

**Implementation:** successful Monday refreshes (and manual dispatches) now tag
`data-snapshots/YYYY-MM-DD`; a failing refresh opens a tracking issue so missed days are loud, not
silent; `npm run snapshot:vintage -- --date YYYY-MM-DD [--dest DIR]` lists/materializes a vintage
with a manifest SHA-256 summary. Layer D's actual analysis (MAE/bias/rank correlation vs actuals)
stays open until in-season outcomes accumulate.

---

## 2026-08-24 — Underdog best-ball ADP re-sourced to a third-party republication

**Decision:** the Underdog best-ball lane (`data/adp-underdog-bestball.json`, display-only) parses
Sharp Football Analysis's server-rendered Underdog ADP table instead of Underdog's own API.

**Why:** Underdog's configured ADP/draft-boards endpoints all 404 (not a UA block — their pick'em
props API serves unauthenticated fine); best-ball draft boards sit behind login, so there's no
public Underdog ADP API. DraftSharks was evaluated and rejected (client-rendered SPA, no data in the
HTML).

**Constraint — third-party attribution is load-bearing:** this is a republication, not Underdog's
own feed, and the repo says so wherever it appears (pipeline source comment, UI badge/tooltip
text — see the 2026-08-25 Market ADP tile entry for where that note now lives). Freshness is taken
verbatim from the publisher's prose (no year printed, none invented). Fails open like every other
scraper in the pipeline: the tile hides if parsing breaks, nothing else does.

---

## 2026-08-25 — Market ADP tile simplification + Role tab STACKED percentile rankings

**Decision (Market ADP):** the `PlayerMarketComparison` readout is now tiles-only — the
`Current pick · Range · Std. dev · Sample` caption line, the engine tile's positional-rank suffix,
and the visible Underdog third-party prose note are removed (the attribution constraint moves into
the tile's `title`/aria text instead — see the entry below). `BoardAdpAnchor` shrinks to
`{ adp, source }`.

**Decision (Role tab):** RB/WR/TE render STACKED-style (fantasyplaybook.ai-inspired) grouped
percentile rankings instead of 2×2 role cards — per-metric values percent-ranked 0-100 within the
same-position cohort of `player-usage.json` (`frontend/src/data/percentileRankings.ts`; min cohort
5, ties read at-or-below, thin/missing data degrades to n/a, never a fabricated rank). QB/K/DEF keep
the weekly game-log columns. Pipeline sums nflverse's `rushing_epa`/`receiving_epa` into new
`OpportunityPeriod` fields to source the efficiency metrics (additive, optional in
`shared/types.d.ts`).

**Deliberate omission:** Routes Run / Targets Per Route Run / ESPN's proprietary receiver scores are
not replicated — no free source carries per-player routes, and showing hatched placeholders would
imply data that doesn't exist.

---

## 2026-08-25 — Engine ADP tile gets a provider logo; EPA zero-vs-unknown bug fixed; Role tab receiving-efficiency filled in; percentile bands re-colored

**Decision (provider logo):** the engine tile in `PlayerMarketComparison.tsx` was the only tile
rendering no `ProviderBadge`; `BoardAdpAnchor` gains a `brandKey` field to drive it.

**Root cause found and fixed (EPA):** `data/player-usage.json` was last built before
`pipeline/context.py`'s EPA code landed, so 0 of 671 records carried the new EPA fields — fixed by
re-running the pipeline. While fixing, closed a real hazard: `_number()` coerced a missing/renamed
nflverse EPA column to `0.0`, indistinguishable from genuine replacement-level play. Added
`epa_available` (mirrors the existing `pbp_available` gate) so an absent source column nulls the
field instead of zeroing it, with a regression test.

**Decision (Role tab, WR/TE sparseness):** WR/TE's "Receiving Efficiency" group had only one metric
once EPA was dead; added four metrics computable from existing `player-usage.json` fields (aDOT,
Catch Rate, Yards/Reception, YAC/Reception) via a shared `RECEIVING_EFFICIENCY_METRICS` list so RB
and WR/TE ranked the same shape (later reversed — see the entry below). `PercentileStat` gained a
`ratio?: boolean` flag for season-long-ratio metrics (vs per-game averages); extractors return
`null` on a zero/missing denominator, never `NaN`/`Infinity`.

**Decision (percentile bars — a real bug, not requested scope):** found while comparing against a
reference site — `.percentile-fill` only styled the `elite` band and the badge hardcoded one color,
so every non-elite row (the majority) rendered identically regardless of actual rank. Added the
missing good/fair/poor rules and made the badge band-driven too, computed once and passed to both so
they can't disagree.

---

## 2026-08-25 — Official Underdog logo; Role tab groups diverge per position; EPA re-unit'd to per-attempt

**Decision (logo):** the user's official Underdog AVIF mark replaces the hand-drawn placeholder SVG
(deleted). `ProviderBadge` gains a raster-image branch (SVG → raster → monogram precedence).

**Decision (Role tab groups):** RB/WR/TE now render deliberately **divergent** percentile group
sets — reversing the prior day's "shared receiving shape" call (user judgment: identical data across
positions hides what matters). All groups draw from fields already in `player-usage.json`:
- **RB:** Fantasy · Backfield Volume · Rushing Efficiency (Y/C, Rush EPA/Carry) · Receiving Workload
  · Goal Line & Red Zone.
- **WR:** Fantasy · Target Earners · Receiving Production · Ball Winning (Catch Rate, Y/R, YAC/R,
  aDOT, Rec EPA/Target) · Red Zone.
- **TE:** WR skeleton, re-weighted (snaps join Volume; aDOT drops from Reliability — TE targets skew
  short).

**Decision (EPA units):** raw per-game EPA let a bellcow's volume out-percentile a more efficient
back, so Rushing EPA now ranks per carry and Receiving EPA per target instead of per game (the old
per-game EPA metrics are removed from the panel). The underlying data was already validated sound
(sanity-checked against known efficient/inefficient backs); this was a presentation fix, not a data
fix.

---

## 2026-08-25 — Card-bottom slot stats deduplicated + rendered as percentile bars; 4th stat added for the off-clock state

**Decision (dedup):** the card-bottom stat slot was showing two picks per position measuring the
same thing twice (RB: Carry Share + Touches/g; WR/TE: Target Share + Targets/g). Fixed with a rule —
one production stat, one opportunity/differentiator stat, one more, no pick algebraically derivable
from another. Card table (as of the same-day pick reshape below):

| Pos | 1 (production) | 2 | 3 | 4 (off-clock only) |
|-----|-----------------|-----------------|--------------|-----------------|
| QB  | Fantasy Pts/g   | Pass Yd/g       | Rush Yd/g    | Pass TD/g |
| RB  | Fantasy Pts/g   | YPC             | GL Carries/g | Rush TD/g |
| WR  | Fantasy Pts/g   | Targets/g       | YAC/Rec      | RZ Tgt/g |
| TE  | Fantasy Pts/g   | Targets/g       | YAC/Rec      | RZ Tgt/g |
| K   | FGM/g           | FG%             | 50+ FGM      | XPM/g |
| DEF | Sacks/g         | Takeaways/g     | Pts allow/g  | PD/g |

The 2-stat states (on-clock, or a next-up chip present) take the first two columns; the off-clock/no-
next-up state renders all four, filling dead space in the card's middle (`data-count='4'` spacing in
`App.css`).

**Decision (percentile bars):** every card stat now renders the Role page's percentile rail
(extracted into a shared `PercentileBar` component so both surfaces render byte-identical markup at
different sizes) instead of a bare number. **K/DEF previously had no percentile at all** — they now
rank against their own weekly-artifact cohort, the same honesty rule as everywhere else (a cohort
thinner than 5 or a missing self-value degrades to `percentile: null`, never a fabricated rank).
Percentiles remain display-only — nothing here feeds `planValue` or any sort comparator.

**Why an index, not a per-player function:** `buildCardRoleStatsIndex` builds each
`(position, metric)` cohort once and ranks every player against it in one pass, since the board
renders every card at once (the old `buildCardRoleStats(single player)` shape would have rebuilt a
cohort per metric per card).

---

## 2026-08-25 — Priority change: public Draft Guide + accounts ahead of the Edge Validation Gate

**Decision:** the user explicitly changed priority (the expansion rule allows this without a gate
pass). The product restructures into a **public/gated split**, modeled on app.fantasyplaybook.ai:

- **Public, no account** — a Draft Guide page (`/draft-guide`): the player pool in rank order with
  league-format selectors (scoring / QB / teams / rounds) and a ranking-source selector spanning
  the engine and every ADP lane the repo actually ships (Sleeper per-format, ESPN PPR-only, FFC
  per-format, Underdog best-ball; no Yahoo/FantasyPros — omitted, not stubbed). This is the
  "try it before you sign up" surface.
- **Account required** — the live Draft Assistant (today's single screen) and later Teams.
- Provider connection leaves the landing page entirely: the landing shows inert illustrations;
  the real connect flow lives in post-signup `/onboarding`.

Sequencing, each phase shippable alone: 0 docs → 1 react-router migration (session provider
lifted above the routes so the live poll survives navigation) → 2 the Draft Guide (table →
provider columns → draft grid → drawer) → 3 landing rework + onboarding → 4 Clerk auth seam → 5
saved leagues/drafts on Cosmos via authenticated Azure Functions.

**Stack changes:** SWA built-in auth is abandoned — verified against Microsoft's plan comparison,
SWA Free offers only preconfigured providers (GitHub + Microsoft Entra ID); Google needs a custom
OIDC provider, which is Standard-plan-only (~$9/mo), and GitHub/Microsoft sign-in fits this
audience poorly. **Clerk** enters the stack instead (Google + email, free ≤10k MAU; publishable
key frontend, secret key Function-app-setting only). Cosmos DB stays the data plane (authenticated
Functions; `@azure/cosmos` and `infra/main.bicep` scaffolding reused; new `leagues`/`drafts`
containers partitioned by `/userId`). Reversibility is structural: an `AuthAdapter` seam (mock
adapter is the default, so tests and fresh clones need no vendor SDK) and a
`savedLeaguesRepository` seam mean no code outside those adapters knows which vendor is in use.
The prior design review's Supabase recommendation was considered and declined — see the
handoff-recorded rationale: keeping the data plane on Azure reuses existing scaffolding.

**Precedent being set:** this is the first feature tiering into anonymous vs account-required.
Anonymous users write nothing — guide selectors live in the URL query string, localStorage remains
the only draft-session store, and server writes exist only behind auth.

**Scope boundary:** this change does **not** authorize an in-season ESPN/Yahoo track. That stays
gated per the closed 2026-08-14 exception; `espn*.ts` remain draft-day-only.

**Marketing constraint (binding on all guide copy):** per the 2026-08-23/24 backtest entries
above, the engine measured −0.830 pts/wk, 95% CI [−1.539, −0.121] vs plain FFC ADP on the 2025
grid and the shock-scale sweep verdict is AMBIGUOUS — neither direction may be marketed from 2025
sims alone. Permitted: methodology description ("Ranked by projected roster value — marginal
roster utility over an empty roster, computed from FFToday season projections scored in your
league's format") plus a link to the methodology. Forbidden: "beats ADP", any accuracy percentage,
any "edge"/"wins leagues" claim. Any engine-vs-ADP delta column describes *disagreement*, never
superiority. Availability stays labeled experimental.

**Licensing guard:** FFToday redistribution permission is unverified, so the public guide ships
noindex (robots.txt already `Disallow: /`; add `<meta name="robots">` since robots.txt blocks
crawling, not indexing) and unmonetized, per the S2 constraint in `archive/PLAN-history.md`. An
indexed public guide would be a separate decision requiring licensed projections or an ADP-only
public surface with the engine's columns behind sign-in.

---

## 2026-08-26 — SavedLeague.season ships as an accepted placeholder (`''`)

**Decision:** Phase 5's saved-league writes store `season: ''` for now. Neither `DraftInit` nor
the draft session carries a season value today, so there is nothing honest to write; populating
the field properly means threading each provider's season through the adapter boundary, which is
deferred until a feature actually reads it.

**Why:** no consumer reads `SavedLeague.season` yet, and writing a guessed year would look
authoritative while being unverifiable. The placeholder is documented at both write sites
(`frontend/src/state/draftSync.ts` — the field is deliberately not sent — and
`api/src/functions/leagues.ts` — the `?? ''` default).

**Result:** when a season source lands (adapter passthrough or onboarding input), populate both
write paths in one change and remove these placeholder comments.

---

## 2026-08-26 — Landing hero: team-logo CDN dependency accepted; Seahawks `.glb` rejected

**Decision:** the landing hero's 32-team orbit (`LandingHeroCanvas.tsx`) fetches team logos at
runtime from Sleeper's keyless team-logo CDN (`data/playerPortrait.ts`'s existing `teamLogoUrl()`)
and bakes them into one shared canvas atlas, rather than shipping any committed team-logo assets.

**Why:** the app already depends on this CDN for player/DEF portraits, the 32 images are ~5-12 KB
each with `Access-Control-Allow-Origin: *` (verified against production, not just docs), and every
atlas cell independently falls back to a colored abbreviation chip (that team's own
`--team-XX`/`--team-XX-ink` from `styles/teamColors.css`) if its fetch fails — a CDN outage
degrades the hero, it never breaks it. This is a new external network dependency on a public page,
which is why it's recorded here rather than left implicit.

**Rejected:** a user-supplied Seahawks Sketchfab `.glb` (`seahawks_preview.glb`) as the basis for
real 3D team models in the orbit. It measured 39.3 MB / 559 meshes / ~383k triangles for one team;
×32 teams is roughly 1.2 GB and ~18,000 draw calls, non-viable regardless of decimation effort for
a $0-hosting landing page. Not imported anywhere in the repo — don't revisit without a real
low-poly, Draco-compressed source for all 32 teams.

**Also fixed in the same change:** the trophy's NFL-shield question turned out to be a non-issue —
`public/models/trophy.glb` has zero image textures (2 chrome meshes only), so there was never a
logo to see. Decision was to leave the trophy bare (matching the real Lombardi Trophy) rather than
add a shield decal, and instead fix the mirror-flat material clamp
(`roughness = Math.min(roughness, 0.13)` forced near-perfect-mirror finish) and add a real stepped
plinth in place of the near-invisible flat slab.

---

## 2026-08-26 — Team-logo CDN dependency reversed: self-hosted instead (supersedes same-day entry above)

**Decision:** the landing hero's 32 team-logo medallions are now served from
`frontend/public/team-logos/*.png` (self-hosted, same-origin), not fetched from Sleeper's CDN at
runtime. This reverses the "CDN dependency accepted" decision recorded earlier the same day, above.

**Why:** in production every medallion silently fell back to its degraded state (a colored
abbreviation chip, never the real logo) — not intermittently, every single one. Root cause:
`LandingHeroCanvas.tsx`'s atlas builder was the **only** place in the app fetching the Sleeper
team-logo URL in CORS mode (`img.crossOrigin = 'anonymous'`, required so the resulting canvas can
be uploaded as a WebGL texture without tainting). Every other consumer of the identical URL
(`PlayerCard`'s watermark/header logo, `PlayerBoardRow`'s watermark and `--team-logo` background,
`MyTeamRail`'s `--team-logo` background) fetches it in plain no-CORS mode. Sleeper's CDN only
sends `Access-Control-Allow-Origin` when the request carries an `Origin` header, and sends no
`Vary` header on the plain response — so Chrome's (request-mode-unpartitioned) HTTP cache serves
a previously-cached no-CORS response to the later CORS-mode request, which then fails the CORS
check and errors out. This is sticky (a 31-day cache lifetime) and triggers from literally any
prior visit to `/draft` or `/draft-guide` in the same browser profile, or even from the landing
page's own two demo cards — explaining why it was universal, not occasional.

**Result:** self-hosting removes the whole bug class — a same-origin image can never trigger this
collision regardless of request mode — and also drops a runtime dependency on an external CDN from
a public marketing page. `loadTeamLogo` no longer sets `crossOrigin` (unnecessary for a same-origin
image). `data/playerPortrait.ts`'s `teamLogoUrl()` and its other (no-CORS) consumers are unchanged
and unaffected.

**Also fixed in the same pass:** the medallions had a chrome `TorusGeometry` "medal ring" around
each logo and a hard `CircleGeometry` clip, both removed — the atlas canvas is now transparent
outside each drawn logo (was opaque-filled), each logo's own PNG alpha defines its real
silhouette, and the material is unlit (`MeshBasicMaterial`, `toneMapped: false`) instead of a lit
`MeshStandardMaterial`, so real logo colors show clean instead of being crushed by the scene's dim
stadium lighting and ACES tone-mapping rolloff.

---

## 2026-08-26 — Team-logo source swapped: ESPN's static logo CDN, not Sleeper's

**Decision:** `frontend/public/team-logos/*.png` now pulls from
`https://a.espncdn.com/i/teamlogos/nfl/500/{abbr}.png` (500x500, RGBA) instead of Sleeper's
`.../images/team_logos/nfl/{abbr}.png` (only 150x150, some as small as 100x100). Both are the
same self-hosted-at-build-time approach from the entry above; only the source changed.

**Why:** the Sleeper-sourced images looked visibly soft/blurry once scaled up in the 3D scene —
they were being upscaled from a genuinely low-resolution source, not a rendering bug. ESPN's
static team-logo CDN serves the same 32 marks at roughly 3-15x the file size and consistently
500x500, confirmed by fetching and inspecting all 32 (correct team, real alpha channel, no
placeholder/error images) before replacing the committed files. All 32 abbreviations resolve
under the same codes Sleeper uses — no alias mapping needed despite `adapters/espnTeams.ts`
documenting alias mismatches elsewhere for ESPN's *live scoreboard* API; this static asset CDN is
consistent.

**Not pursued:** literal 3D team-logo models (one per team). The Seahawks Sketchfab `.glb` supplied
earlier this session was already rejected on exactly this basis (39 MB / 559 meshes / ~383k
triangles for one team; ×32 is non-viable) — see the entry above. Nothing changed that math; this
entry just records that higher-resolution 2D art was the fix actually shipped instead.

---

## 2026-08-26 — Landing scene: stadium bowl removed, trophy pinned to the camera orbit, plinth rebuilt (supersedes the two entries above)

**Decision:** in `LandingHeroCanvas.tsx`, three changes to the cinematic landing scene, all on the
user's direct call after seeing the live page:

1. **The "stadium bowl" mesh (a 24-30 unit `CylinderGeometry` ring, canvas-gradient-mapped,
   intended to be fog-swallowed) is deleted outright**, and `scene.fog` density raised from
   `0.016` to `0.045`. The bowl's own comment claimed fog would hide it, but the arithmetic doesn't
   support that: `FogExp2` density at distance `d` is `1 - exp(-(density·d)²)`, so at the old
   `0.016` and the bowl's ~25-unit radius that's only ~15% — nowhere near hidden. In production
   this rendered as a large gray panel with a hard diagonal edge behind the trophy (the user's exact
   complaint: "what is that white shit in the back?"). At the new `0.045` the room falls off to
   ~72% fog at 25 units and true black by 40 — genuinely black, no visible wall, no mesh required.
   The crowd twinkle-point field (unaffected by fog, unlit shader points) is now the only horizon
   cue. `0.045` isn't a guess: a subagent tore down `lastdanceforglory.world` (the reference site
   that prompted this whole pass) and it independently ships `FogExp2(0x040404, 0.045)` at a
   near-identical 38° lens — good confirmation the number is in the right neighborhood, not just
   internally self-consistent.
2. **The trophy no longer moves in world space.** The prior `trophyTrack` translated the `holder`
   group across the frame mid-scroll (e.g. to `x=2.4, z=-1.4` at 32% scroll) while the plinth,
   floor slab, and contact-shadow disc all stayed fixed at the origin — the trophy visibly
   detached from its own stand ("the trophy is floating weirdly" on scroll). `trophyTrack` is
   deleted; `holder` stays at the origin permanently, `CAMERA_KEYS` is now an orbit-parameter
   track (`angle`/`radius`/`height`/`lookY` around the fixed trophy) instead of independent
   camera-position/look-at keys, and raw `window.scrollY` is now damped into an eased `scrollP`
   (frame-rate-independent exponential ease) rather than driving the camera 1:1 — the snap-to-wheel
   feel was part of what read as "weird."
3. **The plinth is rebuilt.** The old lathe profile spanned radius 1.55 over height 0.55 (2.8x
   wider than tall — reads as a dark ellipse, not a pedestal) and carried an emissive blue
   `TorusGeometry` ring, which is the single element that most read as "ugly"/cheap. New profile is
   tall and slim (radius 0.62 tapering to 0.44, height 1.5 — `PLINTH_HEIGHT` raised from 0.55), the
   torus ring is deleted, and the two circular ground accents under it (mirror slab, contact
   shadow) are shrunk to match the new, much narrower foot. Also: the medallion material
   (`toneMapped: false`, full opacity) is switched to `toneMapped: true, opacity: 0.28, fog: true`
   and the three orbit rings in `landingTeamOrbit.ts` are widened (outer 8.6→13.0, mid 6.2→10.5,
   inner 4.3→8.0, `GLOBAL_MIN_RADIUS` 3.2→5.8) so the rings clear the camera's own new orbit radius
   (5.4-8.2) instead of the camera passing through them.

**This reverses two same-day 2026-08-26 decisions above:** the plinth design from "Landing hero:
team-logo CDN dependency accepted; Seahawks `.glb` rejected" (the stepped-disc profile + blue
torus), and the unlit/full-opacity medallion material from "Team-logo CDN dependency reversed:
self-hosted instead." Both were reasonable calls at the time (the plinth was a real fix over an
"invisible slab," and the unlit material was a real fix over crushed logo colors); this entry
records why they're being changed again rather than treating it as if the earlier reasoning was
wrong.

**Result:** `PLINTH_HEIGHT`/`FLOOR_Y`/`TROPHY_STAND_Y` are unchanged in relationship to each other
(the GLB and fallback trophy paths both already derive their stand height from `TROPHY_STAND_Y`,
so raising `PLINTH_HEIGHT` moves the trophy up automatically, no separate trophy-position edit
needed). `2D` CSS layer also tightened in the same pass: `.top-nav-immersive`'s scrim (App.css) was
fully transparent by 60% down its own box, letting scrolled-up section headings show through
sharp and legible right behind the nav text — it now holds higher opacity longer and adds a blur;
`.landing-beat` moved from a near-opaque flat slab to the same frosted (`backdrop-filter: blur`)
treatment already used by `.landing-board-feed`, so it reads as part of the scene rather than a box
pasted over a render.

---

## 2026-08-26 — Landing hero: stray floor/haze glow removed, trophy given its own attached halo, team medallions enlarged with per-team glow (supersedes floor/slab and medallion-opacity values from earlier same-day entries)

**Decision:** in `LandingHeroCanvas.tsx` and `App.css`, every glow in the landing scene must now
emanate from an object — nothing floats free of the trophy, the plinth, or a team medallion. This
reverses the floor/slab material values tuned in "Landing scene: stadium bowl removed, trophy
pinned to the camera orbit, plinth rebuilt" above, and the `opacity: 0.34` medallion value from
"Team-logo CDN dependency reversed" above.

**Why:** a user comparison against a reference cinematic trophy site (`lastdanceforglory.world`)
found the *opposite* problem from what that site has: its only glow visibly emanates from the
trophy itself, while ours had two light sources with no visible source — a bright white ellipse
pooling at the plinth base (the `slab` mesh still mirroring the env map's overhead flood strip even
after the earlier `metalness .8/envMapIntensity 1.4` → `.25/.5` pass) and a bluish haze offset to
one side of the trophy (`.landing-scene-glow`'s three radial washes were pinned to the *viewport
bottom* at x = 24%/78%/50%, never actually aligned with the trophy). The trophy itself read
comparatively dark next to its own floor. Note: the trophy stays silver — the reference site's gold
is that trophy's own color, not something being copied; the principle borrowed is "glow comes from
an object," not the hue.

**Changes:**
- `slab` and `floor` materials zeroed/near-zeroed to matte (`metalness`/`envMapIntensity` ~0,
  `roughness` 0.85-0.95) — they no longer mirror the flood strip at all.
- The `soft frontal fill` env bank shrunk and dimmed (`[14,6]`/boost 0.8 → `[8,4]`/boost 0.25) so
  the trophy's shape comes from the streak banks again, not a flat wash to the lens.
- `rim` light neutralized from cool blue (`0xbcd2ff`) to near-neutral (`0xdfe6ef`) — `key` stays warm
  so the warm/cool split still reads as photographed metal, but the shadow side no longer casts blue.
- `.landing-scene-glow` (also the documented no-WebGL fallback) replaced with one neutral silver
  wash centered on the trophy's actual position, instead of three washes pinned to viewport corners.
- New `trophyHalo`: a billboarded additive plane reusing the existing `bankGradient` texture,
  recomputed every frame to sit just behind the trophy along the camera's current view direction
  (not parented at a fixed offset — the camera orbits a trophy fixed at the origin, so "behind" is a
  different world position every frame; a fixed offset is exactly how the earlier "trophy floating
  weirdly" bug happened, see the entry above).
- Bloom bumped back up (`strength` 0.14→0.28, `threshold` 0.88→0.78) *after* the floor/slab fix —
  with the ground no longer hot, bloom now amplifies the trophy's own specular streaks and halo
  instead of the stray pool that used to sit next to it.
- Team medallions enlarged (`0.3`→`0.55` plane) and boosted (`opacity` 0.34→0.6), each paired with a
  second, larger additive glow plane tinted with that team's own `--team-XX-ink` color (not
  `-primary` — several primaries are near-black, e.g. `--team-chi`, `--team-cle`, and would produce
  no visible glow), plus a small deterministic (not random) off-billboard yaw/pitch so the ring
  doesn't read as perfectly flat to the lens. No ring/frame added back — the medal `TorusGeometry`
  and circular clip stay removed per the entry above; the glow is a soft halo behind the logo's own
  alpha shape.

**Result:** verified in the browser across the full scroll range (hero, chapter I pull-back,
chapter II close angle) — the halo stays attached and behind the trophy at every camera angle, the
floor/plinth base show no bright pool, and the team ring reads as glowing colored emblems rather
than faint stickers.

---

## 2026-08-26 — Landing hero: no glow shape of any kind, only the trophy's own tone-mapped highlights (supersedes the halo/medallion-glow entry above)

**Decision:** removed everything from the previous entry's fix that was itself a discrete glow
*shape* — the `trophyHalo` backdrop plane, the per-team medallion glow planes, and (in this pass)
also the `.landing-scene-glow` CSS radial-gradient div. The only light in the frame now comes from
the trophy's own PBR material (env-map reflections + a warm key light + ACES tone mapping), rolled
off very slightly by `UnrealBloomPass` at `strength 0.12 / radius 0.35 / threshold 0.92`.

**Why:** after the previous entry's fix, the user flagged (with an annotated screenshot) that the
`trophyHalo` plane still read as "a white circle" floating behind the trophy — the same complaint
as the original stray-slab-glow issue, just from a different mechanism. The `trophyHalo` was removed
in favor of leaning on `UnrealBloomPass` alone (bumped to `0.7/0.7/0.62` to compensate), but that
bloom setting was strong/loose enough to balloon the ball's bright specular pixel cluster into
exactly the same soft circular dome from most orbit angles — a post-process artifact standing in
for the removed mesh. The user's reference comparison (`lastdanceforglory.world`'s gold trophy) has
no separate glow shape at all: its light reads as coming from the object's own lit surface. The
`.landing-scene-glow` CSS div (a radial-gradient ellipse, independent of the WebGL canvas) was also
still present and contributing the same "circle" impression regardless of what three.js did.

**Result:** `UnrealBloomPass` cut to `0.12/0.35/0.92` — only the single hottest specular pixel
cluster rolls off softly; there is no dome at any camera angle. `.landing-scene-glow` no longer
paints any gradient — it stays only as the no-WebGL fallback's mount point, and that fallback now
degrades to a flat dark scene (vignette + grain only) rather than trying to fake trophy light in
CSS. Verified in the browser (via a `document.hidden` override — this dev-tooling browser session
keeps automated tabs in `visibilityState: 'hidden'`, which the render loop's existing visibility
guard, working as designed, pauses on) at both the hero angle and after scrolling into the chapter I
pull-back: a crisp highlight sits on the ball's own surface, no circular glow shape anywhere in
frame. If a discretely-shaped glow effect is ever wanted again, do not reach for a billboarded plane
or a CSS radial-gradient — both read as a separate light source rather than light on the object.

---

## 2026-08-26 — Landing + Draft Guide visual redesign ("Broadcast Neon")

**Decision:** de-boxed the landing page and `/draft-guide` (user feedback: "white outline grid
boxes", a wall of explanation above the guide table, an unstyled/uncentered top nav) and moved the
palette from the navy `--chrome-*`/`--accent-cool` pair to a near-black canvas with a single
saturated neon-blue identity accent. Scope: `/`, `/draft-guide`, `TopNav` were redesigned;
`/draft`, `/onboarding`, `/teams` were left at their current layout and only inherit the retuned
tokens.

**Accent split preserved, not reopened:** `--accent` (`#f97316`) stays urgency-only (on-clock,
take-now, survival marker — all draft-room chrome untouched). `--accent-cool` — already documented
as the *structural identity* color (nav marker, eyebrows, live dot) — is what got saturated, to
`#35a7ff`. This is why the token change is safe to cascade app-wide: urgency semantics didn't move.

**Border split — decorative vs. functional, not touched uniformly:** `--border-1/2/3` are WCAG
2.2 1.4.11-gated functional borders (tokens.css's header records a rejected 1.57:1 pass); this
redesign left them exactly as solved. Only `--border-divider` (already documented as the
decorative row/panel separator) darkened, from `#525252` to `#1e242b`, plus a new
`--hairline-strong` (`#2a323c`) for places that need slightly more weight (sticky thead rule). The
global `section { border: 1px solid var(--border-1) }` rule that boxes every untouched page now
uses `--border-divider` instead so it reads as an edge, not a frame — `.draft-guide` and the
landing's sections opt out of it entirely (`border: 0`).

**Draft Guide's marketing constraint (2026-08-25 entry above) still holds:** the methodology
paragraph and the four per-lane data-source notes were moved out of the above-the-fold flow into a
collapsed `<details className="guide-methodology-note">` at the bottom of the page, rather than
deleted — the constraint requires the copy stay reachable, not that it sit above the table. The
`DELTA_TITLE` tooltip (disagreement-vs-Sleeper-ADP wording) is unchanged on every lane cell.

**Player cell now uses real headshots:** `DraftGuideTable`'s row swapped `PlayerAvatar` (monogram)
for the existing `PlayerPortrait` component (Sleeper CDN headshot, deterministic-initials
fallback) plus the self-hosted `/team-logos/*.png`, both already built for other parts of the app
but unused here. `DraftGuideBoard`'s dense draft-grid view deliberately keeps the smaller
`PlayerAvatar` monogram — its ~118px cells don't have room for a 40px portrait. The old separate
`PositionBadge` ("RB") + `guide-grid-posrank` ("RB1") pair in the table view merged into one
outlined `.guide-pos-pill` chip.

**Scope trims made during implementation** (both to avoid breaking the URL-state test suite,
`routes/DraftGuideRoute.test.tsx`, which asserts `getByRole('combobox', { name: 'Position' })` /
`'Ranked by'` etc.): the six filter controls stayed native `<select>`s with their labels intact —
not converted to segmented chip buttons — and the disabled-grid explanatory line stayed visible
(not title-only), since a test asserts on its visible text. Both are cosmetic-only deltas from the
original plan; no test was weakened to accommodate them.

**Landing:** `.landing-beat` (the three feature cards) dropped its `rgb(255 255 255 / .08)` border
in favor of a ghosted index numeral (`01`/`02`/`03`, `-webkit-text-stroke` on transparent fill) over
a hairline top rule — the `lastdanceforglory.world` editorial-list pattern. `.landing-board-feed`,
`.integrations-hub-mark`, and the landing's own `.provider-panel` instances lost their
box/backdrop-blur treatment; the shared `.provider-panel` rule itself was left alone since
`/onboarding/league`'s real connect flow also uses it and is out of this redesign's scope (see the
`.landing-integrations .provider-panel` scoped override in `App.css`). The shared `.player-card`'s
white diagonal sheen and inset top-edge highlight are nulled out only for the landing's two demo
cards (`.landing-demo-card .player-card`), not the shared rule the draft room's real cards use.

**Nav underline root cause:** `App.css` had no `a { text-decoration: none }` reset anywhere — every
`<Link>` (brand, nav tabs, Sign in/Sign up) was rendering the browser default underline, a
regression from Phase 3's button→Link conversion. One rule fixed it globally. The active-tab
marker changed from a `border-bottom` underline to a raised segmented-pill background
(`.nav-link[aria-current='page']`), and `.top-nav-identity` changed from a left-packed flex row to
a three-cell grid (`1fr auto 1fr`) so the nav sits dead center regardless of brand/auth width.

**Gotcha hit and fixed:** `.nav-auth-signup` and `.landing-hero-cta` are both always combined with
`.primary-button` in JSX, and `.primary-button`'s own rule is defined later in `App.css` — an
equal-specificity single-class override lost that source-order tie (Sign up rendered navy instead
of neon-blue until caught in browser verification). Fixed by writing the overrides as
`.primary-button.nav-auth-signup` / `.primary-button.landing-hero-cta`.

---

## 2026-08-26 — League-first connect: save-league vs track-draft split

**Decision:** connecting a platform now has two independent halves. *Save league* writes a durable
`SavedLeague` pointer immediately from `/leagues/connect` (real season via `LeagueRef.season`,
which `DraftInit` lacks) without starting any session; *Track draft* starts a live session without
requiring a saved league. `useDraftSync` reconciles both: `reconcileOnce` adopts a matching saved
LEAGUE when no remote draft exists, and `/api/leagues` upsert is idempotent on
`(userId, provider, providerLeagueId)` so no writer can duplicate a league doc. This partially
retires the `season: ''` placeholder — true for the league-connect path; the draft-sync path still
cannot supply one (see also the sibling 2026-08-26 retention entry).

**Why:** leagues were previously materialized only as a side effect of tracking a draft, so the
product had no honest league surface (`TeamsPage` was a hard-coded empty state with stale copy).

**Also:** `/teams` → `/leagues` (hub cards carry name/season/teams/provider, plus Track draft /
Remove using stored `providerUserId`/`latestDraftId` identity — explicitly NO roster/waiver/lineup
affordances per this file's 2026-08-25 scope boundary); exactly one connect surface renders both
`/leagues/connect` and `/onboarding/league`; localStorage `ffa.draftSession.v2` remains
refresh-resume-only and is now cleared when a session ends or a Sleeper draft completes while
still connected — it never held league data.

**Precedent being set:** two routes sharing one component (`ConnectLeagueRoute`) rather than two
connect flows that drift.

---

## 2026-08-27 — Landing 03: data-source claim, not league-connect claim; animated wires

**Decision:** the landing's 03 section moved from "One hub for all your leagues." (a league-connect
claim `/leagues/connect` doesn't back for four of its six spokes) to "Every source. One board." —
the honest claim of what `/draft-guide` already does: pull ADP/rankings/projections from multiple
platforms and reconcile them into one ranked board. The spoke set narrowed from
`espn/sleeper/cbs/rtsports/fantrax/fftoday` to five: `sleeper/espn/cbs/underdog/yahoo`. `yahoo`
joined `ProviderBrandKey` (`frontend/src/data/providerBrand.ts`) with a new hand-authored
`frontend/src/assets/providers/yahoo.svg` in the same house style as the existing placeholder marks
(32×32, `rx=7` rounded square, white `<text>` wordmark) — `ProviderBadge`'s `import.meta.glob`
convention picked it up with no code change.

**Why:** modeled on `app.fantasyplaybook.ai`'s hub-and-wires animation, which the user asked to be
mimicked. Its actual mechanism (inspected live via DOM/computed-style probing, not guessed): a
static elbow-path trace per branch plus an overlay path stroked with an animated `<linearGradient>`
that slides from tile to hub over ~1s, with 1-2 branches lit at a time on an irregular stagger. That
technique needs a rAF loop (CSS cannot animate a gradient `<stop offset>`), which conflicts with the
repo's zero-animation-library / no-rAF-outside-the-three.js-scene baseline
(`useRevealOnScroll.ts`'s explicit "no GSAP" comment). The visual substitute:
`frontend/src/components/IntegrationsMap.tsx` draws each branch as an SVG path with
`pathLength={100}` and `vectorEffect="non-scaling-stroke"`, and `App.css`'s
`.integrations-pulse-tail`/`-head` layers animate `stroke-dashoffset` to fake the same
comet-travels-into-the-hub effect with pure CSS, gated paused until `useRevealOnScroll` marks the
section `.revealed`.

**Bug hit and fixed during browser verification:** the first cut used `stroke-dasharray` values
that summed to exactly 100 (matching `pathLength`), e.g. `24 76`. That's a live layout invariant to
avoid, not just a cosmetic mistake — when dash+gap equals the total path length, every
`stroke-dashoffset` value places the dash *somewhere* on the path (one dash per pattern period, and
the period exactly matches the path), so there is no "off-path" park state; every idle branch showed
a permanently lit sliver at the tile end (confirmed by comparing two zoomed screenshots ~2s apart —
identical unmoving blue nub at every tile). Fixed by making the gap far larger than the path
(`24 276` / `5 295`, total period 300) and adding a park-value keyframe stop (150/174) chosen so its
dash interval falls entirely outside `[0, 100]` — a genuinely dark idle state, confirmed live after
the fix (same two-screenshot comparison showed fully dark wires between hits). Kept as a code
comment on the keyframes so the invariant survives future edits (don't let dash+gap equal
`pathLength` again).

**Removed:** `.integrations-stem`/`.integrations-rail`/`.integrations-spokes` divs and the
`calc(100% - 100% / 6)` rail math hard-wired to a 6-column row — both replaced by the SVG wire
geometry above, authored for the new 5-tile grid.

---

## Handoff note for future agents

When you make a decision that should outlive the current task — a rejected approach, a formula
change, a data-source or provider tradeoff, a scope exception — add a new dated entry here rather
than editing `PLAN.md` in place. `PLAN.md` should only ever describe *current* status and near-term
sequencing; this file is where the reasoning trail lives. Keep new entries proportionate: a
decision's full statistical/instrumentation detail belongs in a linked `benchmarks/reports/` or
`archive/` artifact, with only the decision, why, and final result recorded here — that's what keeps
this file readable as it grows. If this file gets long again, condense old entries into
`archive/DECISIONS-history.md` the same way this 2026-08-25 pass did, preserving every dated header
so existing cross-references from `PLAN.md`/`CLAUDE.md` keep resolving.

---

## 2026-08-27 — Connect split from start: /leagues connects, /draft starts

**Decision:** connecting a platform and starting a draft are now two separate acts on two separate
surfaces. `/leagues/connect` (and the `/onboarding/league` alias) is SAVE-ONLY: it writes durable
`SavedLeague` pointers (Sleeper via the account, ESPN via the extension's league-page capture) and
navigates to `/leagues` — it never starts a session and never lands on `/draft` (asserted in
`routes.test.tsx`). Drafts start only from the Draft Room launcher (`DraftLauncher`, rendered on
`/draft` while disconnected): Sleeper cards track via the saved credential, ESPN cards start via
`handleEspnStart(league, seat)` — the seat is the one typed input, because ESPN reveals the snake
order only at draft time. My Leagues cards are links to the new `/leagues/:leagueId` detail page.

**Why:** the two ideas were fused — every connect success path jumped straight into the draft room,
ESPN league details were hand-typed constants (`'manual-session'`, retyped every draft), and every
ESPN draft collapsed onto one SavedLeague row because `leagueId` was that literal.

**Sub-decisions:**
1. ESPN league details come from EXTENDING THE EXTENSION to the ESPN league page (`/football/league*`),
   not a manual form. The MAIN-world hook already allowed the leagues API tree; the raw (redacted)
   league JSON is captured verbatim under its own storage key (`ffa.espn.league.snapshot.v1`, its own
   `ffa.espn.league.request/response` message pair — the live snapshot's `version: 3` shape is pinned
   and not overloaded) and parsed ONLY in `frontend/src/adapters/espnLeague.ts`, the one place ESPN's
   slot ids/scoringItems may be translated. Unmapped values surface as diagnostics, never dropped.
   There is deliberately NO manual-entry fallback on the connect panel: the hand-typed form was the
   problem. A timeout means "extension or league page not present", and says so. PROVISIONAL: the
   parser maps are validated against a synthetic fixture (`fixtures/espn-contract/league-*.json`)
   pending a real recon slice (payload sizes vs the extension's JSON cap, redact bounds, `?view=` set).
2. `SavedDraft.picks` (new, optional): picks persist ONLY for providers with no upstream record to
   re-read (`espn`/`manual`). Sleeper is deliberately excluded — its own API is the permanent record,
   which is exactly why completed Sleeper transcripts are deleted. `/leagues/:id` reconstructs the
   drafted team from `frozenInit` + `picks` via the existing `MyTeamRail` (ESPN/manual) or live
   `sleeperAdapter.rosters()` (Sleeper). This NARROWLY WIDENS the 2026-08-25 "no roster/waiver/lineup
   affordances" boundary: the drafted roster is shown; no waiver or lineup management exists.
3. My Leagues cards open league detail; drafts start only from the Draft Room. The hub card is a
   link — it has no Track button and cannot navigate to `/draft`.

**Also:** the launcher keeps a standalone paste-a-draft-id escape hatch (with username resolution)
so a mock-only user with zero saved leagues is never stranded by the split. Previously saved
ESPN rows keyed on `'manual-session'` stay broken/stale — the fix applies to leagues saved through
the new ESPN connect path; no migration was added.

---

## 2026-08-28 — Remembered Sleeper identity, a real draft-end state, and the leagues/connect redesign

Four related decisions, all shipped in one pass following user feedback that the leagues/connect
surfaces looked unfinished and that a finished draft never stopped polling.

**1. Sleeper identity lives on `SavedLeague`, not a new profile container.** `providerUsername`
(alongside the existing `providerUserId`) now persists on every Sleeper `SavedLeague`, populated
from `resolveUser()`'s canonical `username` (previously fetched and discarded) and read back by
`data/useSleeperAccount.ts` as "the account" — the most recently updated Sleeper league carrying
a `providerUserId`. Rejected alternative: a new `/api/profile` container implementing the
already-declared-but-unused `UserRecord` type. Simpler wins here — no new container, no new
endpoint, no `infra/main.bicep` change — and a league is exactly where a Sleeper identity already
lived (just without a name attached). Consumers (`ConnectSleeper`, the Draft Room launcher,
`LeagueDetailRoute`) now show "Connected as {username}" and never re-prompt for a username once
one Sleeper league has been saved.

**Bug fixed alongside:** `api/src/functions/leagues.ts`'s `upsertLeague` used to rebuild the whole
document from the request body with `body.X ?? null` on every field. `state/draftSync.ts`'s
periodic upsert never sends `providerUserId`/`providerUsername`/`season`/`providerTeamId`/
`providerTeamName` — so every debounced sync tick during a live draft was silently **nulling the
stored Sleeper identity**. Fixed at the API layer (writer-agnostic, so no future partial writer can
reintroduce it): the handler now point-reads the existing document and merges — `undefined` on the
wire means "keep what's stored," an explicit `null` means "clear it." `userId` still only ever
comes from the verified token.

**2. Draft Room entry page auto-lists Sleeper drafts; ESPN is hard-gated on the extension.**
`adapters/sleeper.ts`'s `listSleeperDrafts` was written and unit-tested back when Sleeper drafts
were first built, then never called from the app. `DraftLauncher` now calls it for the remembered
account (`data/season.ts`'s `CURRENT_SEASON`) and lists live/finished drafts as cards, with a
paste-a-draft-id fallback (username resolution kept only for the zero-saved-leagues escape hatch).
ESPN cards' Start button is disabled until `useEspnBridge`'s `extensionPresent` is true — a
draft with no extension has no picks to track, so a soft warning that lets Start through anyway
would just relocate the failure into the workspace.

**3. A real `{ kind: 'complete' }` session state, not just a sync-layer predicate.** Both
adapters have always computed `DraftPicks.status`, and nothing consumed it — the one real
completion predicate (`isDraftComplete`, relocated `state/draftSync.ts` → `session/completion.ts`
so the SESSION layer can read it too) lived behind four sync-only gates (signed-in, non-mock,
Sleeper-only, `connected`-only) and, even when it fired, only cleared localStorage without
touching the session — so `DraftSessionProvider`'s unconditional persistence-save effect wrote the
"cleared" record straight back on the next render. `DraftRoomRoute` could never fall back to the
launcher, and the 1s poll ran against a finished draft forever.

Fix: `session/completion.ts`'s `isSessionComplete` (count rule OR adapter status — the count rule
is authoritative since `DraftInit`'s cached `rawStatus` is frozen at `init()` by design, and bridge/
manual sessions have no poll at all, so the count rule is their *only* signal) drives one effect in
`DraftSessionProvider` that freezes the board (same atomic freeze as manual takeover — nothing
typed/streamed is lost) and transitions to a new `{ kind: 'complete' }` session, carrying `from`
(which kind it completed FROM, for `draftSync`'s SavedDraft-mode mapping) and a separately-captured
`provider` field (`activeProvider` as it stood the instant before completion — NOT re-derived from
`from`, since a manual session's kind alone can't distinguish a Sleeper takeover from an ESPN one;
that's `reconnectCred`, which the completed variant doesn't carry). Because `draftId`/the bridge
init both derive from `session.kind`, the poll and bridge stop on their own. The Draft Room shows a
dedicated `.draft-complete-banner` (not a `SessionAlert` severity — that component's contract is
"renders nothing when healthy, only ever an honest-failure surface," and a success state doesn't
belong there) with two actions: **View league** (to `/leagues/:id` when a SavedLeague id is known —
captured directly at ESPN start, or reported asynchronously by `useDraftSync` via a new
`reportSavedLeagueId` context callback for Sleeper, since draftSync resolves that id server-side
and nothing else in the app tracks it) and **Start another draft**. Exit is always explicit, never
automatic.

**`draftSync` keeps syncing through completion, deliberately.** `draftIdentity` stays non-null for
a `complete` session (by design — opting out via `draftIdentity` was considered and rejected: the
sync is debounced 5s, so the final picks of an ESPN/manual draft — the providers whose picks
actually persist — might not have synced yet when completion fires; one more cycle is what writes
them). This exposed a real bug in `sessionKindToMode`: its call site cast `currentSession.kind as
'connected' | 'manual' | 'bridge'`, which let a `'complete'` session fall through the cast to the
`'manual'` SavedDraft mode silently. Fixed by widening the function to take every session kind
(mapping `'complete'` via `from`) and replacing the cast with an explicit switch, so a future
unhandled kind is a type error, not a silent misclassification.

**`ffa.draftSession.v2` → `v3`.** The persisted-session write effect was unconditional (no
`disconnected` guard, no completion gate) — before this fix, "Choose another draft"'s own
`clearPersistedSession()` call never stayed cleared, because the effect immediately re-ran on the
resulting re-render and wrote the empty-but-present record straight back. That is the actual
mechanism behind "stuck on local storage." Fixed by gating the effect (`disconnected` writes
nothing and clears; every other kind, including the new `complete`, persists deliberately) and
bumping the storage key — which, as a side effect, drops every already-stale v2 record on a user's
machine in one move rather than needing a migration path for a shape with no completion field to
migrate from.

**4. The leagues/connect UI rebuild drops the "confirm every field" pattern.** `.leagues-page`,
`.league-card`, `.espn-connect`, `.espn-confirm-card`, `.espn-confirm-row`, and
`.connect-sleeper-connected` had zero CSS rules and fell through to `section {}` /
`.draft-list li`, both outlined in `--border-2` — a light-gray token solved to WCAG 1.4.11 3:1 for
*focusable controls*, not decoration. New `frontend/src/styles/leagues.css` follows the two idioms
already proven elsewhere instead: the Draft Room panel recipe (border-divider edge + shadow-panel
elevation + hover lift) for anything holding content, and the landing's editorial recipe (no box,
a hairline, Archivo display type) for page scaffolding. `ConnectLeagueRoute` gained a provider
chooser (Sleeper/ESPN/Yahoo-disabled tiles, echoing `IntegrationsMap`) with Sleeper active by
default, and drops its own page heading when mounted inside the onboarding wizard (`OnboardingLayout`
already supplies one — the duplication, and a "Back to My Leagues" link that made no sense
mid-wizard, were a rebuild-introduced regression caught and fixed live during browser verification).

The ESPN confirm card's `Provenance` component — a "read from your ESPN league page" tag repeated
on all six rows, verified and fallback fields rendered identically — is deleted entirely. One
caption now labels the whole summary card; only DERIVED or DEFAULTED fields (not verified ones)
get a `.field-derived` dotted-underline marker with a tooltip explaining why. The bare `<select>`
"which team is yours" (there was no `select {}` rule at all — only `input`) becomes a
`.team-tile-grid` of selectable tiles below ~16 teams, falling back to the `<select>` above that.
Diagnostics collapse behind a native `<details>` (closed by default) instead of always-expanded.
Verified live against a real captured ESPN league during browser testing (10 teams, 14 rounds, PPR,
1 unmapped scoring category) — the redesign renders correctly end to end, including team-tile
selection state and the enabled/disabled button hierarchy.

**Also fixed while touched:** `frontend/src/routes/onboarding/onboarding.test.tsx`'s ESPN
session-routing regression suite targeted a "Set up ESPN draft" trigger that only ever existed,
disabled, on the landing illustration — a pre-existing stale test left over from before the
2026-08-27 connect/start split, unrelated to this pass but blocking a clean `npm test`. Re-pointed
at the current entry point (`/draft` → "Set up a draft manually"); the regression the suite guards
(a bridge session rendering no alert explaining why nothing streams) is unchanged, only the entry
point moved.

---

## 2026-08-28 — ESPN manual-start fallback removed; connect-only with readable bonus tags

**Decision:** the Draft Room's "Set up a draft manually" launcher entry is removed. ESPN drafts
start ONLY from a saved league via the launcher card; `ManualDraftSetup` is demoted to an
edit-only seat-correction dialog (league name/teams/rounds read-only, `mySlot` editable), and the
launcher card applies the bridge's JOINED/TOKEN-detected seat over a stale persisted
`league.mySlot` whenever the user hasn't hand-edited the field this session (typed input always
wins afterward). In the same change, the confirm card's unmodeled-scoring disclosure became a
structured tag group (`unmodeledScoringItems` on the snapshot + `espnBonusCatalog` labels) with
an honest "not reflected in player projections" footer; the old prose diagnostic stays as the
full-disclosure fallback behind the closed `<details>`.

**Why:** the extension already scrapes teams/rounds/roster and auto-detects the seat from the
draft-room socket, so a manual form was a strictly less-accurate duplicate path (and its PPR
preset rebuild once overwrote a bridge session's real scoring map — the edit dialog now spreads
the session's own init). And 22 unmodeled rules buried in one sentence of raw statIds was
unreadable; chips like `Rush TD 40+ yd +2` are not.

**Label provenance (the important caveat):** the catalog is verified against espn-api's
`PLAYER_STATS_MAP`, cross-checked in-repo by `pipeline/espn_projections.py`'s
`_RAW_STAT_WEIGHTS` (agreement on 24/25, 42/43, 74/77/80/85). The first cut guessed 45/46 as
rushing yardage-game bonuses and 56/57 as receiving long-TDs — upstream says the reverse
(45/46 = receiving TD 40+/50+, 56/57 = receiving yardage games; 37/38 = rushing yardage games),
and 58/59 have no confident meaning so they render generically. A wrong label is worse than a
plain one; every "confident" label is now either upstream-verified or absent. Duplicate statIds
merge with the same sum rule the scoring map uses, and bridge sessions no longer show the
"PPR preset applied" diagnostic (they carry the league's real scoring map — that claim is now
scoped to Sleeper takeover sessions only, where it is true).

---

## 2026-08-28 — ESPN draft-room capture: wrong extraction path, fail-open league gates, undrafted-slate padding, cross-league draftId collision

**Symptom:** tracking a live ESPN mock draft (10 teams) showed the board at pick 97 while ESPN was
paused at pick 14, and teams/rounds/seat/league-name never corrected off their launcher guesses —
the previous round's `applyLeagueFacts`/precedence-chain/`draftSync` gate (2026-08-28, same day)
built the right plumbing but was fed a value that was always `undefined`.

**Root cause A — wrong field path.** `espn-content.js`'s `reconcileDetailPicks` read
`payload.draftSettings.{rounds,teams}`. ESPN never populates that path — the real path is
`payload.settings.draftSettings.rounds` (and on the real 2026 API, often absent entirely; the
authoritative read is `draftDetail.picks.length / teams`), and `teams` is not a `draftSettings`
field at all (`payload.teams.length` / `settings.teams`). This file's own debug logging, and
`espnLeague.ts`'s already-proven connect-league parser, had the correct paths the whole time.
`leagueRounds`/`leagueTeams` were therefore permanently `null` (write-once-first-value-wins), which
silently kept `draftSync`'s hold-until-stamped gate closed forever for every live-detected league —
nothing was ever written to the hub, with no alert saying why.

**Root cause B — fail-open league gate.** `applyDomPicks`'s foreign-tab guard
(`normalize.js`) only rejected a NAMED mismatched league (`incoming && base.leagueId && incoming
!== base.leagueId`); a tab that hadn't yet identified its own league (a second mock lobby, a
leftover page) read as `incoming === null` and fell straight through, free to write into an
already-active draft's `domMaxSeen`/`currentPickNumber` — the primary inputs to the absolute-
offset estimate. `applyDetailPicks`/`applyLeagueFacts` had no league gate at all.

**Root cause C — undrafted-slate padding.** ESPN's `draftDetail.picks` pre-assigns `teamId` to
picks that haven't happened yet (the full snake slate is generated up front), and a mock
autopick's sentinel row (`playerId: -1`, no name) is structurally identical to that padding — both
carry only a `teamId`. `applyDetailPicks` had no bound on this, so the padding could inflate
`detailPicks` past the real pick count, and `bridgePicksToNormalized`'s `detailContiguous` branch
then treated the padded list as authoritative for both numbering and identity.

**Root cause D — cross-league draft collision.** Every ESPN bridge session shared the literal
`draftId: 'manual-session'` (`buildEspnDraftInit`), and `draftSync.ts`'s one-shot reconcile matched
`providerDraftId` across ALL leagues (`listDrafts()` takes no league argument) — starting a draft
in league B could match league A's stored draft, apply league A's overrides onto league B's board,
and overwrite league A's transcript with league B's picks.

**Fix:** (A) extraction consolidated into one function, `normalize.js`'s `leagueFactsFromPayload`
(mirrors `espnLeague.ts`'s precedence; also now stamps `leagueName` from `settings.name`, and the
reconcile queries the league's own stamped season instead of `new Date().getFullYear()`, and uses
repeated `?view=` params matching the proven league-page fetch). (B) `applyDomPicks`'s guard
tightened to `base.leagueId && incoming !== base.leagueId` (an unknown-league write is now refused
once a league is stamped); `applyDetailPicks`/`applyLeagueFacts` gained the same guard. (C)
`applyDetailPicks` tags each row `identified` and truncates the merged list to the longest prefix
ending at the last identified row (or the live-signal bound when nothing is identified yet);
`espnOffset.ts`'s detail-alignment additionally requires a non-zero alignment to be corroborated by
history beyond the aligned window itself (`MIN_ALIGNMENT_MARGIN`), not just be the only offset that
happened to fit. (D) `buildEspnDraftInit` mints a league-scoped `draftId` (`espn-<leagueId>`)
instead of the shared constant; `draftSync.ts`'s reconcile independently cross-checks the resolved
SavedLeague doc id as a second guard against the same collision class. A new `sync-held`
session alert makes a still-closed `draftSync` gate visible instead of silent.

**Verification status:** `node extension/test/normalize.test.mjs`, the targeted vitest suites
(`espnOffset`, `espn`, `draftSync`, `useEspnBridge`, `DraftLauncher`, `ManualDraftSetup`), and the
full `npm test` (1346 passed, 6 pre-existing skips) all pass, each new defect pinned by a test
against the real `fixtures/espn-contract/league-2026-08-27.json` shape or a constructed repro. **Not
yet empirically confirmed against a live ESPN mock draft**: whether root cause B or C (or both) was
the specific mechanism behind the observed "pick 97 at ESPN's pick 14" — both are real, fixed, and
covered by regression tests, but no live console capture was taken to attribute the exact
arithmetic. Next live/mock draft test should reload the unpacked extension and confirm the board's
on-the-clock pick matches ESPN's own reading.

---

## 2026-08-28 — ESPN draft-room capture: backgrounded tab hijacking the shared snapshot (third mechanism)

**This resolves the prior entry's open question.** The user's own account pins the exact
mechanism: they left an ESPN mock draft mid-way (~pick 14) without finishing it — the tab stayed
open and ESPN kept autopicking it server-side in the background — then started a genuinely new
mock draft (a different league) in another tab. The board stayed stuck on the **abandoned**
draft's picks until that old draft's background autopicking reached its own final pick (~97), at
which point the new draft's picks suddenly caught up, landing several at once. This is a third,
independent mechanism from root causes A-D above, and the prior visibility-check work never
touched it: that fix (`document.visibilityState === 'hidden'`, plus `pagehide`) only gated the
30s `mDraftDetail` reconcile — never the socket-frame path that actually drives the board.

**Root cause.** `normalize.js`'s `applyFrameToLive` league-change reset was unconditional
last-write-wins: any socket frame naming a different league than currently stamped wiped the
whole shared snapshot and started fresh, with no cooldown, no recency check, no concept of which
tab the user was actually watching. With both tabs' sockets alive, each tab's frame that
disagreed with the currently-stamped league immediately reset the snapshot to its own league — a
ping-pong that the more frequently-emitting tab (the old one, autopicking continuously) won
almost every time. `useEspnBridge.ts`'s "clean switch" check treated any epoch-bumped reset as
legitimate and silently followed it, clearing `relayWarning` — the app had no way to tell this
hijack apart from a real old-mock-finished/new-mock-started transition.

**Fix.** `applyFrameToLive` gained an `isVisible` parameter (default `true`, so every existing
caller/test is unaffected): the league-mismatch branch now refuses the write (mirrors
`applyDomPicks`'s existing "refuse, don't reset" convention) instead of resetting when the calling
tab is hidden. `espn-content.js`'s `applyLiveFrame` reads `document.visibilityState` at write
time (inside the serialized `queue` callback, not at call time, since a backlog could otherwise
apply a stale verdict) and passes it through. Establishing a league for the first time, and
same-league accumulation while hidden, are both visibility-independent by construction (the guard
only fires on an actual league mismatch) — the normal workflow of alternating focus between the
draft tab and the app tab while tracking one draft is untouched; only a *different* league's reset
is gated. `applyDomPicks`, `reconcileDetailPicks`, and `useEspnBridge.ts` needed no change (see
`extension/src/normalize.js`'s updated doc comment on `applyFrameToLive` for the full reasoning).

**Accepted limitation:** two draft tabs both foregrounded at once (e.g. two side-by-side windows)
can still ping-pong — visibility alone can't distinguish them. Out of scope.

---

## 2026-08-29 — Dead-draft snapshot ownership: the visibility fix needed an expiry, and the launcher must not trust a stale snapshot

**Reported:** the user started a NEW practice draft and the launcher showed the OLD finished
draft — "Team 1 detected", draft position 8 "detected from the live draft order", the status line
reading "ESPN draft tab disconnected" — and entering the draft room loaded the past completed
draft's picks. No old tab was open anywhere.

**Root cause (a chain, not a single bug):**

1. The shared live key (`ffa.espn.live.snapshot.v1`) is never cleared when a draft completes or
   its tab closes. The finished draft — leagueId, full stream, mySlot, dead heartbeat — sat in
   `chrome.storage.local` indefinitely. This is why a draft nobody had open was "detected".
2. The 2026-08-28 visibility fix refuses a hidden tab's foreign-league frames outright, judging
   "foreign" against whatever league currently owns the key — the corpse draft. So the REAL new
   draft's frames were refused whenever its tab was backgrounded: the corpse became
   undisplaceable. The previous fix's own success created this deadlock.
3. `EspnLiveDetectedCard` (DraftLauncher) computed `derivedPosition` and swapped its button to
   "Enter draft room" with NO relay-status gate — `EspnLauncherCard`'s one-click card already
   gated on `status === 'live'`, this card did not. It prefilled the seat from the corpse's
   order while its own status line said the tab was disconnected.
4. Entering the room seeded the session from the corpse's `streamPicks` — the past draft.

**Fix.** Three layers, one per mechanism:

- `normalize.js`: refusal is ownership, and ownership EXPIRES. The hidden foreign-league refusal
  in `applyFrameToLive` now only applies while the snapshot's heartbeat is younger than
  `LIVE_OWNERSHIP_EXPIRY_MS` (60s). An actively autopicking abandoned tab heartbeats ~1Hz, so it
  keeps full protection (the 2026-08-28 hijack fix is intact); a heartbeat older than 60s is proof
  the owner is dead, and a hidden tab's takeover is allowed (through the normal league-change
  reset path — epoch bump, `resetReason: 'league-change'`, stream cleared).
- `DraftLauncher.tsx`: `EspnLiveDetectedCard` gates seat detection AND the
  `leagueTeams`/`leagueRounds` stamps on `status === 'live'`. A stale snapshot leaves the
  card in typed-input mode.
- `DraftSessionProvider.tsx`: the seat/teams/rounds auto-correction effects early-return on
  `bridge.isStale` — a corpse's order must never rewrite a live session either.

**Tests:** `extension/test/normalize.test.mjs` §15d (expired-heartbeat takeover works from a
hidden tab via the normal reset path; a fresh-heartbeat snapshot still refuses); a
`DraftLauncher.test.tsx` case (a disconnected snapshot with a full stream prefills no seat and
offers no "Enter draft room"). Full suite green; frontend typecheck clean.

**Still open, unchanged:** two draft tabs both foregrounded at once can still race (visibility
alone can't distinguish them), and the key still survives a finished draft by design (it is what
makes the room resilient to a tab refresh mid-draft) — the expiry makes that survivable instead
of disqualifying.

---

## 2026-08-29 (2) — Same-league draft restart: practice drafts share a league id, so league-change could never fire

**Reported:** starting a new ESPN practice draft kept showing the previous finished draft (repeated
starts needed); once in the new draft, the log was garbage — picks missing, players unrecorded, a
player duplicated at picks #1 and #10.

**Root cause.** ESPN practice drafts run INSIDE the user's league, so every practice draft reuses
the SAME league id and none of the league-change reset machinery ever fires. The finished draft's
stream stayed in the shared key, and the new draft's frames fed into it: new picks appended at
overall 161+, the (slot, playerId) resend dedupe silently dropped every pick the previous draft
also made (a practice draft reuses the same player pool), and the offset derivation read the
mixture as a mid-draft resume. The garbage log was the direct product of that dedupe + offset
poisoning. Frames carry no draft id or pick number (parseFrameLine is recon-verified), so the
socket alone cannot name "this is a different draft".

**Fix — same-league draft-restart checkpoint** (normalize.js applyFrameToLive). JOINED and TOKEN
are the authoritative "I entered a draft room" signals; when either arrives for the league ALREADY
stamped on the snapshot while the snapshot still holds picks, the held draft is residue rather
than a resume if it is either COMPLETE (leagueTeams x leagueRounds picks on record) or QUIET (no
heartbeat for LIVE_RESTART_QUIET_MS = 30s — an active draft heartbeats ~1Hz, and the detail
reconcile that stamps facts only runs while a draft-room tab is open). Either way the stream is
reset through the normal epoch-bump path with resetReason 'draft-restart' (new union member in
shared/types.d.ts; useEspnBridge's materialKey already keys on resetReason, and the epoch bump is
the existing clean-switch signal). A mid-draft tab refresh has a fresh heartbeat and an
incomplete stream, so the resume path keeps its picks untouched; any picks missed during a long
disconnect are backfilled by the mDraftDetail reconcile regardless.

**Tests:** extension normalize.test.mjs section 15e — complete-stream JOINED resets, complete-stream
TOKEN resets, fresh mid-draft rejoin does NOT reset (resume), quiet incomplete draft resets.
Full suite green; frontend typecheck clean.

**On "why not read draft history":** the mDraftDetail reconcile already backfills authoritative
picks (detailPicks) every 30s from the league API, but it merges INTO the poisoned stream — it
fixes missing players, never a wrong set of overalls. The restart checkpoint fixes the stream
itself; the reconcile then fills any early picks the socket missed.

---

## 2026-08-29 (3) — Connect-page simplification, landing hero CTA removal, `--accent-cool` brightened

**Reported:** `/leagues/connect`'s ESPN panel buried its one real decision ("which team is yours?")
under two collapsed disclosures, two competing save buttons, and long ledes; the page was boxed in
`--border-1/2` outlines used decoratively (those tokens are reserved for focusable controls,
`tokens.css:103-110`) plus a landing-page-style blurred-glass panel that read low-contrast against
the near-black app surface. Separately, the landing hero's two CTAs duplicated TopNav (which
already carries Draft Guide + Sign up), and `--accent-cool` read dark in the draft room, where it
only ever appears as hairlines/a micro-label/one numeral — never a fill.

**Connect page (`EspnSetupTabs.tsx`, `ConnectLeagueRoute.tsx`, `ConnectSleeper.tsx`):**
- Removed the "N bonus rules not reflected in player projections" disclosure
  (`UnmodeledBonusTags`, deleted) and the "Parsing details (N unmapped categories)" disclosure.
  `snapshot.unmodeledScoringItems`/`diagnostics` stay on the type — still worth surfacing on
  `/leagues/:id` later, just not on this confirm card.
- Merged "Save league + import drafted roster" / "Save league only" into one `Save league` button;
  it imports the drafted roster automatically when the capture shows the league already drafted
  (`canImport`), and only saves the league pointer otherwise.
- "Not my league — scan again" → "Scan again"; "Sleeper username or user ID" → "Sleeper username"
  (the field still accepts a raw user id via `resolveUser`, it just isn't advertised).
- Replaced the fixed-width `.team-tile` grid (with its `<select>` fallback above 16 teams) with a
  wrapping `.team-pill` list sized to each name — no team-count ceiling needed.
- Dropped the two provider-panel lede paragraphs in `ConnectLeagueRoute.tsx`; the selected provider
  chip already labels the panel. `SetupRail` now hides once a league is found (three stacked status
  layers said the same thing).
- `.provider-panel` (App.css) dropped its blurred-glass background and `--border-2` box for the
  Draft Room panel recipe (`border-divider` + `--surface-2` + `shadow-panel`); `.provider-subtabs`
  and `.onboarding-step` moved off `--border-1/2` onto `--border-divider`; `.setup-diagnostic` and
  the old `.team-tile`/`.unmodeled-bonus-tags` rules were deleted from App.css/leagues.css.
  `.provider-chip`'s selected state and the new `.team-pill` selected state are now a solid
  `--accent-cool` fill instead of a border/wash combination.

**Landing hero (`LandingPage.tsx`):** removed "Browse the Draft Guide — no account needed" and
"Create free account" — TopNav already carries both destinations. `.landing-hero-cta*` rules
deleted from App.css; `landing-rise` keyframes kept (still used by the pill/title/sub-line).

**`--accent-cool` brightened** (`tokens.css`): `#35a7ff` → `#5bb8ff`, `--accent-cool-bright`
`#7cc8ff` → `#8ed0ff`, `--accent-cool-glow` re-derived. New ratios: 9.2:1 on `--surface-0` (was
6.0:1), 8.5:1 on `--surface-2` (was 5.3:1), ink-on-accent 9.4:1 (was 15.9:1 — still clear of
4.5:1). Added `--accent-cool-wash` (a named 14%-alpha wash) so `leagues.css` no longer carries raw
`rgb(53 167 255 / …)` literals. `clerkAppearance.ts`'s raw-hex mirror of this token (its own file
header explains why it can't reach the CSS variable) was updated to match.

**Tests:** `ConnectSleeper.test.tsx` (label text), `LandingPage.test.tsx` (asserts no hero CTA
links), `espnBonusCatalog.test.tsx` (dropped the `UnmodeledBonusTags` cases), `routes.test.tsx`
(swapped the deleted lede text for a `Sleeper username` marker). Full suite green.
