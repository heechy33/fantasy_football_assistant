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
