# Design decisions — full historical record (archived 2026-08-25, extended 2026-08-30)

This is the complete, unabridged decision log, condensed out of `DECISIONS.md` in two passes
(2026-08-25, then 2026-08-30) to keep the active file readable. Every entry below is preserved
verbatim — full statistical tables, intermediate/superseded findings, and blow-by-blow
instrumentation notes — for audit trail. `DECISIONS.md` keeps a condensed version of each entry
(decision + why + final result) and points back here for detail; if the two ever disagree on a
fact, this file is the primary source since nothing here was rewritten, only summarized outward.

---

## 2026-08-06 â€” Role-separated multi-source data stack

**Decision:** for the private Sleeper PPR edge test, use a role-separated stack rather than one
source or a blended average:

| Data role | Selected source | Engine use | Decision/constraint |
|---|---|---|---|
| Live draft truth and identity | Documented Sleeper API | League settings, player pool, picks, drafted state | A ranking/projection source can never mark a player drafted |
| Primary performance forecast | Official FantasyPros API preseason consensus | Component stats scored with league rules; `points_ppr` as a validation check only | Private/non-production edge test only, under approved API access |
| Projection challenger/fallback | Rotowire-derived projection exposed by Sleeper | Separate board, disagreement, coverage fallback, last-known-good | Endpoint is undocumented; do not assume redistribution rights |
| Consensus rank/tier guard | Official FantasyPros PPR ECR | Candidate-union coverage, tier comparison, disagreement warning | Never convert rank into fake points or double-count in MRV |
| Market availability | FFC 12-team PPR ADP distribution | `adp`, `stdev`, `high`, `low`, `times_drafted`; survival calibration | Not a performance projection; cache daily, attribute FFC |
| Historical outcomes | nflverse weekly/season stats | Score reconstruction, out-of-sample evaluation | Attribute nflverse; preserve season cutoffs |
| ID fallback | DynastyProcess `db_playerids` | Sleeper/FantasyPros/other ID matching | Preserve GPL-3.0 notices |
| User override | Imported projection/ranking CSV | Private alternative, manual corrections | Must use the same normalized source interface |

**Why:** Fantasy Football Analytics' 2014-2025 evaluation found aggregation more stable than any
single source (simple average beat individual projections in 69% of head-to-head comparisons;
FantasyPros had the most top-three finishes; simple average slightly beat historically-weighted
averaging). FantasyPros now exposes an official consensus API, making it a better accuracy
candidate than promoting one undocumented single-source projection or adding more scrapers.

**Combining-source policy:** do not average every available number. FantasyPros is already a
consensus â€” don't equal-weight it with Rotowire until source overlap is known (risk of double-
counting the same opinion). Keep projected production, expert rank, and market ADP in separate
fields. Retain every raw source row before deriving a consensus; never overwrite source data with a
blended value. A future independent second projection set should start as a simple position-specific
mean, promoted to a blend only after beating FantasyPros alone on defined accuracy/roster-value
metrics against past-season cutoffs and 2026 mocks.

**No-lost-player contract:** the draft board is built with unions and left joins, never an inner
join across sources. Candidate universe = active Sleeper players âˆª FantasyPros projections âˆª
FantasyPros ECR âˆª Rotowire projections âˆª FFC ADP âˆª user imports. Players are removed only by a live
Sleeper pick or an explicit manual correction. Missing projection/ECR/ADP is `null` plus a visible
source-status flag â€” never zero, never "drafted." Coverage gate: artifact generation fails if any
top-200 PPR ECR/ADP player can't map to a Sleeper ID; the FFToday top-300 board needs â‰¥90%
projection coverage with every uncovered row emitted in a review report (99% is the long-term
multi-source target once licensed).

**Status as of this entry (carried in `PLAN.md` "What exists today"):** the implemented pipeline has
one performance-projection source, FFToday season-projection tables â€” not yet the FantasyPros API or
the Rotowire-via-Sleeper endpoint originally scoped here. FantasyPros API access has not been
pursued. This is a sequencing gap, not a reversal of the decision above.

**Access/provenance requirements:** every generated artifact/source record must declare `sourceId`,
role, upstream URL, terms/license URL, season/scoring, upstream update time, fetch time, schema
version, row count, content hash, source health, stale reason. Fetch FantasyPros only in the offline
pipeline via `FANTASYPROS_API_KEY`, never exposed client-side. FantasyPros' free API tier is
personal/non-production-prototype only and prohibits building a directly competing product â€” any
public deployment using FantasyPros data is blocked without explicit permission. `ffanalytics`'s GPL
code is implementation reference only, not permission to redistribute its scraped data.

---

## 2026-08-06 â€” Degraded-mode behavior when data is missing/stale

1. Projection + ADP available â†’ full engine.
2. Projection available, usable ADP coverage <50% of roster universe â†’ projected-value board with
   default-mix replacement demand, no board-wide availability claim.
3. ADP available, projection missing â†’ labeled market-rank board, no "best roster" claim.
4. Both missing/stale â†’ manual board only, blocking data-health warning.

Never silently substitute one signal for another.

---

## 2026-08-08 â€” Rejected the multiplicative recommendation formula

**Rejected:** `VOR Ã— need Ã— (1 / tier_gap) / P_available`.

**Why:** `1 / tier_gap` reverses tier urgency (a bigger cliff should raise urgency, not lower it).
Dividing by `P_available` is unbounded â€” a 1% survival estimate creates a 100Ã— multiplier that can
overwhelm player quality and roster construction entirely.

**Replaced by:** slot-aware marginal roster value (MRV), bounded/non-inverted tier urgency, and
VONA-style opponent-pick rollouts. See `PLAN.md`'s "Recommendation engine" section for the current
spec, and the 2026-08-10 entry below for the production ranking formula actually shipped.

---

## 2026-08-08 â€” Research corrections

Corrections to over-confident claims from an earlier plan revision, established before S1-S3 build:

- **Paid-service benchmark:** the relevant bar isn't "pages in a bundle" â€” it's league-specific
  scoring, live/manual pick tracking, personal cheat sheets, tiers/scarcity, team-construction and
  opponent-need awareness, availability/"can I wait" guidance, rapid clock-driven updates, manual
  correction, and transparent explanations. Do not claim "85% of the premium bundle" or "paid-service
  parity" before the Edge Validation Gate passes â€” feature resemblance isn't evidence of
  recommendation quality.
- **Custom scoring:** the correct claim is "exact for supported linear scoring categories;
  approximate/unsupported for threshold, range, and other nonlinear rules" (100-yard bonuses,
  once-per-game thresholds, DST point-allowed ranges, position overrides). `ffscrapr`'s `each`/`once`
  scoring distinction is useful implementation knowledge here.
- **Projection source:** single-source projection error is the highest engine-quality risk while
  only FFToday is implemented. The UI must surface source and data age. Do not use DynastyProcess's
  scraped FantasyPros ECR as a production feed, and do not blend FantasyPros+Rotowire until overlap
  and out-of-sample results justify it.
- **Availability model:** `P(available at next pick) = 1 âˆ’ Î¦((next_pick âˆ’ adp) / stdev)` is a
  reasonable initial baseline built from FFC's `adp`/`stdev`/`high`/`low`/`times_drafted`, but it's
  only a model input and explanation signal â€” it ignores current-room roster needs, positional runs,
  and survival-to-date, and it must never be used as an unbounded score divisor. It needs calibration
  before being trusted (see S6 in `PLAN.md`).
- **Architecture:** the client-side pure-function engine remains correct (low latency, no cold
  start on the draft clock, deterministic tests, instant recompute). Auth/Cosmos/Azure Functions
  aren't required for the Sleeper hot path â€” Sleeper is unauthenticated/read-only and its documented
  guideline is to stay under 1,000 calls/minute (docs.sleeper.com).
- **Azure specifics:** Static Web Apps Free is 250 MB per environment (500 MB total across
  environments), 100 GB/month bandwidth. Node.js 22 is supported via `apiRuntime: node:22`. Managed
  Functions are HTTP-trigger only â€” scheduled refresh stays a GitHub Actions job. Cosmos free tier is
  1,000 RU/s + 25 GB, one account per subscription, unavailable on serverless accounts;
  `enableFreeTier` can only be set at account creation. When Cosmos becomes active, cap account
  throughput at 1,000 RU/s so later config can't silently create a bill.

**Open-source implementation references** (research/porting knowledge, not runtime dependencies):

| Project | What to learn/reuse | License/status note |
|---|---|---|
| `cwendt94/espn-api` | ESPN views, integer position/team maps, cookie shapes, retry/fallback endpoints, draft parsing | MIT; provider-roadmap reference |
| `ffverse/ffscrapr` | Normalized provider contracts, ESPN/Sleeper scoring maps, threshold scoring, starter min/max, FLEX edge cases | Open-source R package; port concepts/tests to TS |
| `ffverse/ffsimulator` | Positional-rank bootstrap outcomes, games-played/injury modeling, replacement players, lineup optimization, season simulation, wins added | MIT; primary engine research reference |
| `FantasyFootballAnalytics/ffanalytics` | Multi-source adapter shape, league scoring, simple/robust averages, uncertainty, VOR, source-comparison methods | GPL code; implementation reference only, not permission to redistribute scraped data |
| `DynastyProcess/data` | Player-ID crosswalk; potentially ECR/rank history after terms review | Weekly automated data; GPL-3.0 |
| `nflverse`/`nflreadr` | Historical weekly stats/rosters for scoring reconstruction and out-of-sample testing | Historical-data/backtest foundation |

From `espn-api`: a full league fetch includes league/settings, player pool, teams/schedule, draft
results â€” same data needed eventually, cadence differs (init once, poll every 2-3s targeted picks
only, weekly batch). Preserve `POSITION_MAP`, `PRO_TEAM_MAP`, the 401 alternate-endpoint retry, and
`mPositionalRatings` as provider-adapter knowledge for when ESPN's in-season track opens.

---

## 2026-08-10 â€” Unified-utility timing revision (production ranking formula)

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
intrinsic player quality. VONA is explanation-only â€” its timing effect is already inside
`planValue`, so it's not added a second time. Missing ADP uses fixed-seed simulated survival when
available and demotes confidence; if neither source exists, VONA is null and the planner doesn't
credit the player as a future option. `lookaheadValue`, rollout VONA, downside, and simulated
survival remain diagnostics/benchmark fields â€” they don't sort the production board.

**Why one-turn, not two-turn:** the zero-hole two-future-pick policy was rejected at a nine-draft
regret-ceiling prescreen â€” one-horizon mean regret was already below the predeclared 0.5
utility-point absolute-improvement gate, so even a perfect two-pick policy couldn't have qualified.
Production stays at one deterministic future pick; the second-pick boundary remains available to a
future analysis harness if revisited.

---

## 2026-08-11 â€” Draft Score: a residual tie-break, not a primary sort

**Decision:** add a published, auditable 0-100 composite (`Value`/`Edge`/`Risk` axes) for card
display and residual tie-breaking only:

```text
Value = 100 Ã— clamp01(marginalRosterUtility / VALUE_ANCHOR)
Edge  = 100 Ã— clamp01(1 - availableNextPickProbability)   // 0 with no future pick or no ADP
Risk  = 100 Ã— clamp01(
  0.50 Ã— (100 - resolvedDurabilityScore) / 100
  + 0.30 Ã— injuryPenalty
  + 0.20 Ã— clamp01(availabilityStdev / dispersionAnchorPicks)
)
draftScore = clamp(0, 100, (0.65 Ã— Value + 0.35 Ã— Edge) Ã— (1 - 0.25 Ã— Risk / 100))
```

**Naming:** the product name is "Draft Score," not "3D Value" â€” FFToday supplies one point estimate
per player, not a floor/ceiling/consensus distribution, so a third projection axis would be
fabricated. Value/Edge/Risk are the three axes actually supported by data on hand.

**It does not become the primary sort.** `planValue` (2026-08-10 entry above) remains the
production ranking objective, including the survival â†’ ADP â†’ planValue â†’ id within-band near-tie
order. Draft Score enters only as a residual tie-break at the third comparator position, strictly
after survival and ADP â€” a scarcer/less-likely-to-survive player still outranks a prettier
composite. Promotion to full primary sort requires a written decision after the Edge Validation
Gate's benchmark harness reports paired regret/agreement numbers for the current policy versus the
residual-breaker policy.

**Edge excludes VONA/`tierUrgency`** â€” both are already timing signals folded into `planValue`;
adding them to Edge would double-count scarcity and fight the validated near-tie order. **Risk
excludes engine `confidence`** â€” that's data-quality (scoring severity, ADP sample size, K/DEF
disposition), not player-medical risk; K/DEF rows are always `confidence: 'low'`, so folding it into
Risk would silently discount every special-teams card. **Missing data resolves to unknown, never to
safe** â€” a player with no `player-usage.json` row (most rookies) gets the league-median observed
durability score (pipeline-measured; `context.risk_defaults_report`/`manifest.riskDefaults`), not
zero, and the card renders visibly hatched, never a green low-risk state built from an absent
signal.

**2026-08-11 A/B result** (`benchmarks/reports/2026-08-11-draft-score-tie-break-ab.md`): ran the
9-recorded-draft availability/VONA harness with the residual breaker enabled and disabled. Sections
A and B reproduced exactly (neither reads `draftScore`). Section C's regret/top-choice-agreement
numbers were also identical â€” on this sample, no near-tie band containing the eventual top choice
was also tied on survival and ADP, so the breaker never fired at rank 1. This is not evidence for or
against promoting to full primary sort; that remains a separate future decision.

**Implementation note:** the full FIFA-card/`draftScore.ts`/`HeroRecommendation` rebuild scoped in
`archive/cursor-plans/DRAFT_SCORE_WAR_ROOM_REVISED_PLAN.md` did not ship as written â€” only the
simpler formula above (living directly in `recommend.ts`) and the Phase 1 data contracts
(`weekly-ppr.json`, the local-only FantasyPros stars parser) landed. Treat that archived plan as
historical context, not a current spec.

---

## 2026-08-14 â€” Authorized exception: ESPN draft-day project ahead of the Edge Validation Gate

**Decision:** authorize a narrow, draft-day-only ESPN project (`archive/cursor-plans/
espn_provider_chrome_extension_2026-08-14.plan.md`: manual takeover, an ESPN reconnaissance Chrome
extension, a draft-only `DraftProviderAdapter`, draft-day packaging) to proceed **ahead of** the
Edge Validation Gate, for a real private-league ESPN draft on August 15, 2026.

**Why:** a real deadline (a specific draft on a specific date) took priority over the Sleeper-first
sequencing rule for this one narrow, additive slice. The exception was scoped tightly on purpose:
strictly additive to the Sleeper path (no changes to `ProviderAdapter`, `adapters/sleeper.ts`,
Sleeper fixtures, or the engine's public surface), draft-day scope only, no ESPN cookie/raw-traffic
storage, no change to the gate or its passing criteria, and no opening of the in-season ESPN feature
track.

**Status:** the August 15, 2026 ESPN draft has completed. This exception is now closed â€” see
`PLAN.md`'s "Status and decision" for current active scope. Any further ESPN work (in-season
features, a second draft, hardening beyond draft-day scope) needs its own decision, not a
continuation of this one.

---

## 2026-08-20 â€” Phase 2a: FFC survival-curve diagnosis (H1/H2) and FFC field semantics

**Decision:** commit the FFC PPR board as a pinned fixture (`fixtures/ffc/adp-ppr-observed.json`,
verbatim upstream payload) and diagnose the survival-curve assumptions with
`pipeline/survival_diagnose.py` (`benchmarks/reports/2026-08-20-ffc-survival-diagnosis.*`).

**FFC field semantics (verified live, all 264 rows):** `high` is the **earliest** pick number
observed (smallest number), `low` the latest (largest); `high <= adp <= low` always. Left tail =
`adp - high`, right tail = `low - adp`. Any code reading FFC `high/low` as "latest/earliest" is
inverted.

**Findings (fit on FFC only, per the Phase 2c plan):**
- H1 kernel skew is real and **band-dependent**: `(adp-high)` vs `(low-adp)` is right-skewed in the
  <=12/<=24/<=48 bands (players fall further than the normal kernel implies -> Phi understates
  survival where the clock decides) and left-skewed in the deep tail (reaches dominate). The pooled
  near-zero number is a Simpson's-paradox artifact of the 215-player deep tail.
- H1 range-vs-normality is mild: observed `(low-high)` ~ 0.92x `d2(times_drafted)*stdev` - does not
  reject the model by itself, but agrees the normal kernel is the wrong shape.
- H2 within-band CV heterogeneity is real, strongest at the top (p90/p10 = 2.14 in the <=12 band);
  the band CVs remain good central estimates and the 0.7 floor still protects the top of the board.

**Consequence for Phase 2c:** the H1 repair must be band-aware (a single global skew parameter
fights half the board); the H2 per-player-CV transfer is the simpler band-local alternative; the
one-parameter monotone recalibration is the weakest fallback. The two all-human ESPN drafts
(Phase 2b) arbitrate via the predeclared gates.

---

## 2026-08-21 â€” Phase 2a correction (right-censoring) and Phase 2c H2 result: rejected

**Supersedes** the 2026-08-20 entry's H1 finding above, which is superseded, not deleted â€” see it
for the original (now-corrected) reading.

**Correction:** the 2026-08-20 entry's deep-tail "left-skewed (reaches dominate)" reading does not
survive a right-censoring check added after the fact
(`right_censoring`/`h1_tail_asymmetry_excluding_censored` in `survival_diagnose.py`). FFC's feed is
a fixed 15-round mock (max pick 180); 58% of deep-tail players have `low` within 10 picks of that
ceiling, mechanically truncating the observed right tail. Excluding those rows flips the deep-tail
asymmetry from +3.96 (left-longer) to -0.26 (essentially symmetric, mildly right-longer),
**consistent with the other three bands.** Corrected reading: H1 skew is right-tail-dominant
**across the board**, not band-dependent â€” a band-flipping kernel would have encoded a measurement
artifact into the model and made bench/late-round availability worse. Full detail and the corrected
tables are in `benchmarks/reports/2026-08-20-ffc-survival-diagnosis-interpretation.md`'s
2026-08-21 correction note.

**H2 implemented and gate-checked â€” does not ship.** Built `transform.build_ffc_cv_index` /
`per_player_cv` (empirical-Bayes shrinkage of a player's FFC-observed CV toward the flat band
constant, weighted by `times_drafted`, clamped to 0.5x-2x the band constant) /
`fitted_stdev_for_player`, wired (then reverted) into `build_sleeper_adp_entries` and
`build_espn_adp_entries`. Validated against the pre-declared Phase 2c gates
(`benchmarks/reports/2026-08-18-availability-calibration-baseline-phase2c.md`) by applying H2 to the
currently-committed `data/adp-ppr.json`/`data/adp-espn-ppr.json` (held-out FFC bands unchanged, so
only the per-player CV mechanism differs) and rerunning the benchmark:

| Cohort | Metric | Baseline | With H2 | Delta | Gate |
|---|---|---|---|---|---|
| Bot | analytic Brier | 0.020665 | 0.020214 | -0.000451 | pass (gate: <= +0.0005) |
| Bot | all-seat Brier | 0.004334 | 0.004246 | -0.000088 | pass |
| Human | analytic Brier | 0.021999 | 0.022271 | **+0.000272** | **fail (must strictly improve)** |
| Human | all-seat Brier | 0.005395 | 0.005421 | **+0.000025** | **fail** |
| Both | Section C regret/agreement | â€” | â€” | ~unchanged | pass (not the deciding gate) |

H2 improved the bot (mechanism) cohort and left Section C planning quality unchanged, but regressed
the human (held-out shape) cohort's calibration on both metrics â€” the opposite of what it needs to
do to ship. Per the predeclared Phase 2c decision rule, **it does not ship**: the flat-band
`fitted_stdev` remains production. `build_data.py`'s call sites were reverted to omit
`ffc_cv_index` (defaults to `None`, reproducing pre-Phase-2c behavior exactly); the tested mechanism
stays in `transform.py`/`espn_adp.py` as optional, currently-unused parameters for a future attempt.

**Why it likely failed:** the held-out human sample is only 2 drafts (~6,483 analytic rows), and the
per-player FFC CV â€” even shrunk â€” is estimated from a *different* population (FFC's public mock
pool) than either Sleeper's or ESPN's own board. The interpretation doc's original framing already
flagged H2 as "simpler and band-local... does not fix the skew by itself" relative to H1; this result
is consistent with H2 not being the dominant lever, not with the shrinkage/tolerance implementation
being wrong (all 25+10+9 unit tests pass and independently verify the arithmetic).

**Status:** H1 (the corrected, non-band-flipping right-skew kernel) has not been attempted. Given H2
â€” the lower-risk option in the interpretation doc's own ordering â€” failed its gate, attempting H1
without an explicit go-ahead risks the same outcome for more implementation risk (no established
closed-form kernel was pinned down here). Availability stays labeled experimental pending that
decision.

---

## 2026-08-21 â€” ESPN-sprint work landed undocumented; the benchmark bot cohort is an autodraft-modeled sample

**Record:** the August 2026 ESPN draft-day sprint (2026-08-14 exception entry above) and the
recorded Sleeper mocks that feed the availability/VONA harness shipped without a dated landing entry
of their own. This entry logs that landing so the benchmark is never misread as human validation:
the 9 recorded Sleeper mocks in `fixtures/sleeper/recorded/` carry `autodraftShare` 0.90-0.92 in the
benchmark registry (`benchmarks/reports/2026-08-18-availability-calibration.json`) â€” they exercise
synchronization, latency, and market-shaped opponent drafting, not human behavioral signal. The two
all-human ESPN drafts (`fixtures/real-drafts/`, `espn_draft1.txt`/`espn_draft2.txt`) are the only
held-out human cohort, and every Phase 2c gate is pre-declared against them
(`benchmarks/reports/2026-08-18-availability-calibration-baseline-phase2c.md`).

## 2026-08-21 â€” FFCâ†’Sleeper/ESPN shape transfer: a logged existing design, not a provider added to hide a result

**Decision:** the fitted-dispersion mechanism â€” Sleeper and ESPN board means with `stdev`
synthesized from FFC's coefficient-of-variation curve (`transform.fitted_stdev`/`fit_adp_cv_bands`;
`data/adp-espn-ppr.json` is additive, never a replacement) â€” is the 2026-08-06 data stack's
"Market availability | FFC 12-team PPR ADP distribution" role extended from the FFC board to
non-FFC means. Phase 2c scoped one shape transfer (H2 per-player CV,
`build_ffc_cv_index`/`fitted_stdev_for_player`) and gate-checked it; it was rejected on the held-out
human cohort and the flat-band transfer stays production. Recorded so the rejected H2 can never read
as "hiding results by adding providers": the ESPN board exists for ESPN-session drafts, predates the
Phase 2c gate outcome, and the negative result was written down rather than papered over
(`PLAN.md`'s edge-gate rule â€” if the engine does not beat the baseline, improve it, do not hide the
result by adding providers).

---

## 2026-08-21 â€” Historical out-of-sample backtest: pre-declared gates (evaluation layer A)

**Decision:** run PLAN.md evaluation layer A â€” the historical 2025 draft-strategy backtest â€” as
the next Edge Validation Gate item, and pre-declare its gates **before** the harness runs so a
negative result is credible. The preseason inputs are frozen by `pipeline/backtest_snapshot.py`
into committed `fixtures/backtest/2025/` (FFC 2025 PPR ADP + FFToday 2025 projections +
provenance audit; leakage gate verified preseason, FFToday `Updated: 8/31/2025`). The full gate
spec is committed at `fixtures/backtest/2025/gates.md`; the primary numbers:

- **League config:** 12-team snake PPR, 1QB/2RB/2WR/1TE/1FLEX/1K/1DEF, 16 rounds, plain PPR
  scoring (no TE bonus â€” `fixtures/sleeper/scoring-ppr.json`'s `bonus_rec_te: 0.5` must not be
  reused unmodified).
- **Primary metric:** mean optimized weekly starter points, weeks 1-17, paired per draft,
  N â‰¥ 1,000 simulated drafts, fixed seed `20250825`.
- **Primary gate vs baseline 3 (static VOR, PLAN.md's baseline list):** engine mean â‰¥ baseline-3
  mean âˆ’ 0.25 pts/week AND the paired-difference 95% CI excludes a loss worse than âˆ’0.25 pts/week.
- **Downside gate:** engine 10th-percentile weekly team total â‰¥ baseline-3's âˆ’ 0.5 pts.
- **Secondary (reported, non-gating):** replacement-adjusted points, simulated H2H win rate,
  playoff rate (weeks 15-17), starter-week coverage; baselines 1/2/4 also reported.
- **Decision rule (PLAN.md:334-335):** a failed gate is written down and the engine improved â€”
  never buried, never hidden by adding providers or in-season features.

**Why:** the gate's hardest criterion is evaluation layer A â€” "the rollout engine beats or ties
the static-VOR baseline across the selected out-of-sample test set without a material increase in
downside" (PLAN.md:328-329) â€” and nothing in the repo does it: the availability harness states it
"remains a calibration sample rather than a historical draft-strategy backtest"
(benchmarkAvailability.bench.ts:51). Pre-declaring the numbers in this committed entry (and in
`fixtures/backtest/2025/gates.md`) before any harness run is what makes the eventual verdict â€”
positive or negative â€” credible, following the Phase 2c precedent
(benchmarks/reports/2026-08-18-availability-calibration-baseline-phase2c.md). Note on
convention: gate *thresholds* normally live in the gitignored report directory; committing them
here is a deliberate exception because a pre-declaration only counts if it is timestamped and
committed before the run.

---

## 2026-08-22 â€” Historical 2025 backtest: harness built, pilot run (directional), gating run pending

**Decision:** implement evaluation layer A's harness (`frontend/src/engine/backtest.ts` + opt-in
runner `npm run backtest`) and run the pre-declared 20-seed pilot from
`fixtures/backtest/2025/gates.md`. The pilot is **directional/non-gating** â€” verdicts are applied
only in the N â‰¥ 1,000 gating run (`$env:BACKTEST_SEEDS='84'; $env:BACKTEST_GATING='1'; npm run
backtest`), which is **pending review of this entry** per the plan's pilot-then-gate sequencing.

**Superseded by the post-correction re-run (2026-08-22, same day) - the table below is pre-K/DEF-scoring-fix and is kept only for the audit trail.** `BACKTEST_SCORING` originally omitted every K/DEF key (see the correction note in `fixtures/backtest/2025/gates.md`), which left B3 unable to draft K/DEF at all (0.000 coverage) and inflated the engine-vs-B3 gap by an estimated 10-15 pts/week. The corrected numbers, from the same 240-draft grid after the scoring fix, are: engine/B4 mean weekly 129.588 (10th-pct 99.400, repl-adj +1108.1, coverage 0.614, H2H 0.705, playoff 0.925); B3 mean weekly 112.634 (10th-pct 83.200, repl-adj +819.9, coverage **0.298**, H2H 0.537, playoff 0.612); B2 124.025; B1 130.502 - full table in `benchmarks/reports/2026-08-22-historical-backtest-2025-pilot.md`. Paired engine vs B3 (corrected): mean diff **+16.954** pts/week, SE 0.522, 95% CI **[15.931, 17.977]**.

**Pilot (N = 240 paired drafts, 12 slots Ã— 20 seeds, seed base `20250825`):**
`benchmarks/reports/2026-08-22-historical-backtest-2025-pilot.{json,md}`.

| Arm (pre-fix, superseded) | Mean weekly pts | 10th-pct | Repl-adj | Coverage | H2H win rate | Playoff rate |
|---|---|---|---|---|---|---|---|
| Engine (Stage C on) | 125.06 | 95.26 | +1250.1 | 0.211 | 0.644 | 0.839 |
| B4 (MRV + tiers, no sim) | 125.06 | 95.26 | +1250.1 | 0.211 | 0.644 | 0.839 |
| B3 (static VOR, gate baseline) | 100.53 | 74.50 | +833.1 | 0.000 | 0.367 | 0.119 |
| B2 (raw projected points) | 117.74 | 91.00 | +1125.6 | 0.251 | 0.594 | 0.762 |
| B1 (FFC ADP) | 130.46 | 99.30 | +1341.9 | 0.504 | 0.694 | 0.911 |

**Paired engine vs B3 (pre-fix, superseded):** mean diff **+24.53 pts/week**, SE 0.541, 95% CI **[23.47, 25.59]** â€” far
above the Â±0.25 pre-declared tolerance, directionally.

**Findings that must inform the gating run:**

1. **Arms `engine` and `b4` are the same policy in practice.** Stage C's rollout fields
   (`lookaheadValue`/`vona`/`simulatedSurvivalProbability`/`downside`) are display-only â€” they don't
   sort the production board (2026-08-13 entry; `survivalFor` in `recommend.ts` prefers analytic
   availability), so `buildRecommendationBoard` with simulation on vs off produced **byte-identical
   picks across all 240 paired drafts**. The engine-vs-B4 comparison is ~0 by construction; the
   engine arm's Monte Carlo cost is a fidelity choice, not a policy difference.
2. **B3 (static VOR) never drafts K or DEF under plain PPR.** K/DEF project 0 points under the
   plain-PPR map (no kicking/defense weights), so their VOR/replacementAdjustedValue is ~0 and the
   re-sorted B3 board drafts skill players into every bench slot. Its coverage is 0 and it forfeits
   ~10-15 pts/week. This is the literal pre-declared recipe (`gates.md` caps are B1/B2-only), so the
   engine-vs-B3 gap is partly "the engine drafts K/DEF at all" rather than draft-strategy quality.
   **Decision needed before the gating run:** keep B3 as-specified, or amend `gates.md` to force
   K/DEF (e.g., apply the caps to B3 too) and re-declare.
3. **B1 (FFC ADP) outscored the engine in the pilot** (130.46 vs 125.06 mean weekly) â€” directional,
   N = 240, but it means the gate could be decided by the B3 baseline's degeneracy, not by a real
   engine edge. The gating run's verdict must be read in that light.
4. **Coverage is low for every arm (0.21-0.50)** because 2025 kicker injuries (e.g., Jake Moody
   inactive most of the season) left the K slot unfillable most weeks â€” a genuine fragility signal
   of the 2025 season, not a harness bug.
5. **Integrity held:** all 248 snapshot-resolved ids resolved in `data/players.json` (0 missing);
   Hollywood Brown hand-mapped to Sleeper 5848 (Marquise Brown); the 5 drafted-but-zero-outcome
   players (2309, 4018, 6803, 7042, 7437) were scored 0 all season, never excluded.

**Harness correctness notes:** weekly scoring reuses the exact lineup DP
(`eligibility.ts`'s `optimizeLineupValue`, property-tested against `optimizeLineup`), reuses
`data/weeklyGameLog.ts`'s `played|bye|inactive|nodata` distinction for coverage, and
`data/dataInvariants.ts`'s `validateWeeklyStats` + the snapshot's SHA-256 pins as the leakage
assertion. `meanReplacementAdjustedPoints` subtracts the season-projection replacement baseline
**once** (a per-week Ã—17 double-count found in the first pilot report was fixed before the final
pilot run).

---

## 2026-08-22 — Redundant-QB display gate: fixed in RecommendationBoard.tsx, not the engine

**Problem:** in a Sleeper PPR one-QB redraft, once the user has a starting QB, the "All"
recommendation board still surfaces additional QBs in later rounds — bad advice with 7 bench
spots (stream the bye, don't roster a backup).

**Root cause:** `eligibility.ts`'s `DEPTH_POSITIONS` includes `QB` unconditionally (no
`format.qb` check), so `depthPortfolioValue` matches a QB2 one-to-one against the occupied QB
starter slot and pays it `max(0, points − qbReplacement) × expectedUnavailableFraction`. That
term lands in `marginalRosterUtility`, the board's actual sort key. `replacement.ts`'s
`flexShare = 0` for one-QB leagues compounds this — it lowers the QB replacement baseline, which
raises every QB's production gap. `eligibility.ts`'s doc comment on `benchDepthValue` claims this
is already handled ("don't draft a QB2 in a 1-QB league" derives from the value function); that
claim is stale — `benchDepthValue` isn't the ranking input, `depthPortfolioValue` is, and it has
no QB carve-out.

**Decision:** fix this in `RecommendationBoard.tsx` presentation only — filter QB rows out of the
"All" tab once `format.qb === 'one-qb'` and the user's starting QB slot(s) are filled (same
mechanism the component already uses to exclude K/DEF from "All"), not in `recommend.ts` or
`eligibility.ts`. Two reasons:

1. **The backtest is structurally blind to this symptom.** The engine/B4 arms read
   `recommendations[0]` (`backtest.ts`) — the reported problem is QBs appearing at ranks 2-24,
   which the harness never reads. Changing the engine would alter the exact artifact the pending
   Edge Validation Gate gating run measures, for a defect the gating run can't see.
2. **The harness has no waiver wire**, so it cannot fairly price a QB-gating policy anyway: a
   real QB1 bye scores 0 in the QB slot with no QB2 rostered, so the backtest structurally
   *rewards* drafting one (worst case ≈1.05 pts/week once in 17 weeks, against the gate's −0.25
   pts/week floor vs B3).

`buildRecommendationBoard`'s output is unchanged by this work — guarded by a new test in
`recommendBenchMode.test.ts` asserting a QB2 can still legitimately appear in
`result.recommendations`. The pending 84-seed gating run therefore needs no re-run because of
this change. `depthPortfolioValue`'s missing `format.qb` carve-out is left as a known, documented
engine wart — real but out of scope while the Edge Validation Gate is still open — for whenever
the engine itself is next revisited.

**Scope:** display-only, guarded by `format.qb === 'one-qb'` and the absence of a `SUPER_FLEX`
slot; two-QB/superflex leagues are unaffected. Position tabs (including QB) are never filtered —
only the "All" tab, in both Engine and ADP board modes. Manual QB picks are unaffected.

---

## 2026-08-22 — Sim-sort disagreement probe: pre-declared gate (before the run)

**Decision:** before running the new opt-in probe (`frontend/src/engine/simSortProbe.ts` +
`simSortProbe.bench.ts`, `npm run probe:simsort`), pre-declare the rule that decides whether the
`c1` backtest arm (sorting by Stage C's simulated `lookaheadValue` instead of the production
`planValue`) gets built at all. Same pre-declare-before-running convention as the 2026-08-21 backtest
gates entry above, applied to a cheaper question first.

**Why this probe exists:** the 2026-08-22 backtest-pilot entry above found `engine` and `b4` produce
byte-identical picks across 240 paired drafts — Stage C's rollout fields are display-only and don't
sort the board (`recommend.ts`'s `rankingValue`/`compareWithinBand` have no `lookaheadValue` branch,
deliberate per the 2026-08-10 entry). That result says the analytic-vs-simulated-off comparison is
null by construction; it says nothing about whether *sorting by the simulated value itself* would
ever disagree with the analytic sort. Building a sixth, fully-scored backtest arm to answer that
would cost another ~15-20 min per pilot run for a question that can be screened much more cheaply:
walk a normal `engine` draft trajectory (subject always advances on the real production pick) and at
every subject turn ask whether a pure lookahead sort would have chosen someone else. Same shape as
the nine-draft regret-ceiling prescreen that killed two-turn rollouts before they were built (the
2026-08-10 entry, "Why one-turn, not two-turn").

**Pre-declared rule — build the `c1` arm if ANY of the following hold** (grid: 12 slots x
`PROBE_SEEDS` seeds, default 3 = 36 drafts / 576 subject-turn observations; thresholds live in code
at `simSortProbe.ts`'s `SIM_SORT_BUILD_ARM_THRESHOLDS`):

1. Overall top-1 disagreement rate ≥ **5%**.
2. Any round band (1-3 / 4-8 / 9-12 / 13-16) disagreement rate ≥ **10%**.
3. The no-ADP-coverage subset (engine pick or sim pick has no ADP row) disagreement rate ≥ **10%**.

If none hold, the result is written down as "Stage C sorting is not a distinct policy under 2025
conditions" and no arm is built — a real, reportable answer, not a failure needing a workaround.

**Selection rule under test** (`simSortProbe.ts`'s `simSortChoice`, shared by the probe and any
future `c1` arm so they can never measure different policies): if the production top pick is K/DEF,
defer to it unchanged (matches the engine's special-teams overdue class, which sorts before the value
term — skipping this would reproduce B3's degeneracy, 0 coverage, ~10-15 pts/week forfeited, per the
2026-08-21 gates entry, and measure "never drafts a kicker" instead of "sorts differently"). Otherwise
take the max-`lookaheadValue` non-K/DEF row from the production's own pre-sort pool
(`result.analysis.simulatedRows`), tie-broken by `planValue` desc then `playerId` asc. If no row has
a `lookaheadValue` (Stage C's own all-or-nothing contract), defer to the production pick.

**Scope:** if built, `c1` would be additive and non-gating — a `Record`-keyed report row plus an
informational paired comparison against `engine`, never touching `evaluateGates`/`pairedEngineVsB3`
or the pre-declared B3 gate thresholds in `fixtures/backtest/2025/gates.md`.

**Result (same day, `npm run probe:simsort`, 12 slots × 3 seeds, 576 subject-turn observations,
`benchmarks/reports/2026-08-22-simsort-disagreement-probe.{json,md}`): rule fires decisively — build
the `c1` arm.** Overall top-1 disagreement 37.8% (218/576), far above the 5% threshold; every round
band clears the 10% band threshold too (1-3: 23.1%, 4-8: 48.9%, 9-12: 46.5%, 13-16: 26.4%). The
no-ADP-coverage subset had zero picks in this run (every candidate in the pilot's 2025 FFC board has
ADP coverage), so that predicate is vacuous here, not a counterpoint. Mean Δrank when the two sorts
disagree is small (0.94 — the sim-preferred player is typically one slot below the production pick on
its own displayed board, not a wild swing), and mean Spearman correlation between the `planValue` and
`lookaheadValue` orderings is moderate (0.54 overall, 0.94 in rounds 1-3, dropping to slightly
negative in rounds 9-12) — so this is a real, persistent divergence in *sort order*, concentrated in
the middle rounds, not simulation noise on an otherwise-agreeing ranking. Per the pre-declared rule,
next step is building the `c1` backtest arm (below) to see whether this sort-order divergence changes
drafted-roster outcomes, not just which single player ranks first.

## 2026-08-22 — `c1` backtest arm: added per the sim-sort probe's pre-declared rule

**Decision:** the probe result above cleared the pre-declared threshold, so add the `c1` arm to
`frontend/src/engine/backtest.ts`/`backtest.bench.ts` — sorts by `simSortProbe.ts`'s `simSortChoice`
(Stage C's simulated `lookaheadValue`) instead of `pickByEngineFamily`'s production `planValue`.
Reuses the same `simulation` context and `DEFAULT_SCENARIOS` as the `engine` arm, with
`includeAnalysisRows: true` added so `simSortChoice` has a pool to choose from. `draftId` uses the
`engine` arm's own id (not a `c1`-specific one) so Stage C's per-scenario RNG stream
(`hashStateSeed([draftId, ...])`, `simulate.ts`) is common-random-numbers-paired with `engine`'s
rollouts at the same (slot, seed) — the two arms' Monte Carlo noise is then identical, isolating the
sort-key difference as the only source of any outcome gap.

**Scope, unchanged from the pre-declaration:** additive and reported-only. `BACKTEST_ARMS` gained
`'c1'`; `evaluateGates`/`pairedEngineVsB3`/the B3 gate thresholds in `gates.md` are untouched. A new
`pairedC1VsEngine` (via the existing `pairedEngineVsBaseline`) is informational, not gating. Running
`npm run backtest` grows the pilot to ~50-65 min (6 arms instead of 5, `c1` costing about what
`engine` costs) and the gating run to ~80 min.

**Result (same day, `npm run backtest`, 12 slots × 20 seeds = 240 paired drafts, seed base
`20250825`): C1 directionally ahead of engine, not yet significant at N = 240, with a notably higher
coverage rate.** `benchmarks/reports/2026-08-22-historical-backtest-2025-pilot.{json,md}`:

| Arm | Mean weekly pts | 10th-pct | Repl-adj | Coverage | H2H win rate | Playoff rate |
|---|---|---|---|---|---|---|
| Engine (Stage C on) | 129.588 | 99.400 | 1108.1 | 0.614 | 0.705 | 0.925 |
| C1 (Stage C lookahead sort) | 130.590 | 102.060 | 1125.1 | **0.750** | 0.729 | 0.968 |

Paired C1 vs engine: mean diff **+1.002 pts/week**, SE 0.588, 95% CI **[-0.151, 2.155]** — positive
but the interval crosses zero, so not distinguishable from noise at this pilot size (`engine`/`b4`
remain exactly byte-identical at 129.588, confirming the harness change didn't perturb the existing
arms). Every reported secondary metric moved the same direction (10th-pct, replacement-adjusted,
H2H, playoff rate), and coverage jumped 0.614 → 0.750 — a larger, more consistent gap than the mean
points difference alone suggests, and worth a specific look before drawing conclusions: does sorting
by simulated lookahead systematically draft K/DEF (or bench depth generally) earlier/more reliably
than `planValue`, independent of skill-position value? That's a plausible, checkable mechanism (not
yet checked) rather than a settled explanation. Given the probe already showed disagreement
concentrated in the middle rounds (rounds 4-12, the 2026-08-22 probe entry above) where roster
construction and special-teams timing interact, this is consistent with but not proof of that
account.

**Not a decision to promote C1 or change production sorting** — that would need the N ≥ 1,000 gating
run (same threshold discipline as the B3 gate) plus an explanation of the coverage gap, neither of
which exists yet. Recorded here so the pilot result isn't lost before a gating run is scoped; next
step if this is pursued is pre-declaring gate numbers for C1 the same way `gates.md` did for B3,
not silently promoting it.

---

## 2026-08-23 â€” Early-window opponent-FPA ("SOS") measured and cut

**Decision:** do not build the proposed 3-week trailing opponent-FPA tie-breaker, and treat
SOS as settled-negative rather than something to redesign. The displayed FantasyPros SOS
stars are also measured as ≈ null and should not gain any engine role.

**Evidence:** `pipeline/measure_sos.py` (`npm run measure:sos`, network-free) against real
2025 weekly outcomes (`data/weekly-stats.json`), with a rule pre-declared in the report
header before results were computed (`benchmarks/reports/2026-08-23-sos-validation.{json,md}`):

| Signal | n | partial r (given player form) | 95% CI | top-12 hit-rate delta | share pairs positive |
|---|---|---|---|---|---|
| sos_1w | 3109 | 0.073 | [0.031, 0.111] | -0.065 | 0.17 |
| **sos_3w (primary)** | 3329 | 0.094 | [0.058, 0.132] | **-0.063** | **0.13** |
| sos_5w | 3116 | 0.119 | [0.079, 0.160] | -0.066 | 0.14 |
| sos_std (season-to-date) | 3116 | 0.127 | [0.094, 0.163] | -0.049 | 0.24 |

The keep gate required both halves to pass. The primary signal's correlation half passed
(CI excludes zero), but the rank-utility half failed decisively: adding the signal to a
form-only ranking *lowered* next-week top-12 hit rates in ~87% of position-week pools, and
mean within-pool Spearman dropped from 0.393 (form alone) to 0.312 at best. Verdict: CUT.

Two findings worth keeping beyond the binary verdict:

1. **The "less stale" claim runs backwards here.** Predictive partial correlation rises
   monotonically with window length (1w < 3w < 5w < season-to-date). Nothing about the
   early window makes FPA more useful; if anything it is noisier. This directly refutes
   the hypothesis that motivated the feature.
2. **Small r still hurts rankings at equal weight.** A real-but-tiny matchup signal,
   z-added to form at parity, drowns out a much stronger form signal. Any future proposal
   must specify a shrinkage weight and beat the same rank-utility gate, not just show
   r > 0.

FantasyPros preseason SOS stars (n=343, controlling for their own overall rank): partial r
vs realized season PPG = -0.05 — indistinguishable from zero, consistent with the literature.

**Why cut rather than redesign:** the burden of proof was on SOS; it showed a trace of raw
signal but zero ranking value in its proposed use, on one clean season, with the specific
early-window rationale empirically inverted. Limitations recorded in the report: single
season (~14 independent prediction weeks), FPA derived from the same feed it predicts.

---

## 2026-08-23 — Projection-blend ladder step 0: no 2025 provider projections pass the vintage gate; retrospective screen cut, pivot to prospective 2026

**Decision:** the proposed Phase C offline screen (blend of Sleeper/ESPN/CBS vs FFToday-only,
scored against 2025 actuals) is **cut** — it cannot be run cleanly. Step 0's pre-declared rule
(fixed before probing: PASS = rows retrievable AND vintage verifiably ≤ 2025-09-04 from source
provenance or an independent archive capture) fails for every provider:

| Provider | Blocker |
|---|---|
| Sleeper | 637 season rows retrievable, but all bulk re-synced `last_modified` = **2026-01-04T09:21Z** — cannot distinguish frozen-August values from mid-season revisions |
| ESPN | 1,052 season-projection entries retrievable, payload carries **no as-of field at all** |
| CBS | 2025 restofseason pages render zero table rows; URL construction is post-season by design |
| Wayback | 0 captures of the CBS 2025 URLs in the Jun–Sep 2025 window |

Evidence and diagnostics: `benchmarks/reports/2026-08-23-projection-vintage-audit.{md,json}`.
Notable content signals (recorded as observations, not gate evidence): both retrievable sources
carry projection-grade values (Sleeper r=0.786 vs 2025 actuals, n=567; ESPN r=0.794 vs half-PPR
actuals, n=478; FFToday fixture control r=0.732, n=380), Sleeper rows embed 2025 rosters
(Kyler Murray team=ARI in-row vs MIN live) and `gp=18`. Content looks preseason-genuine; provenance
is unverifiable, and unverifiable provenance is exactly what the FFToday leakage gate exists to
exclude — running the screen anyway would compare a leakage-audited FFToday board against boards
whose vintage we cannot swear to.

**Standing convention (extends the fftodayLeakage precedent):** any projection source used in an
evaluation must carry verifiable as-of provenance ≤ the season's first kickoff. "Retrievable now"
is not "vintage-clean". This applies to future retrospective tests of any kind.

**Pivot:** the blend-vs-FFToday ladder proceeds **prospectively on 2026**, riding a frozen pre-kickoff
snapshot — all four sources (FFToday 414 rows, Sleeper 637, ESPN 551, CBS 404) copied with SHA-256
pins to `fixtures/projection-freeze/2026-preseason/` (`provenance.json` carries hashes + git commit;
the nightly data refresh must never overwrite this directory). The original live artifact
`data/projections-providers.json` (`fetchedAt` 2026-08-22, before the 2026 first game)
SHA-pinnable like the backtest fixtures). Ladder shape is unchanged (rank-utility primary gate per
the 2026-08-23 SOS entry → disagreement probe mirroring `simSortProbe` thresholds → CRN-paired
pilot → gated run with pre-declared numbers in `gates.md`); only the outcome feed changes to
accumulating 2026 weekly actuals. Composite ADP still gets its own availability-calibration (Brier)
screen, not the points/rank ladder.

**Exploratory carve-out, explicitly non-gating:** an unverified advisory screen on the Sleeper+ESPN
2025 data is permissible if labeled exploratory-only and never cited alone; any build decision
still requires the prospective 2026 ladder. Default is to skip it — the prospective path is cheap
and clean, and the 2026 draft window makes it timely regardless.

---

## 2026-08-23 — Blend ladder reopened: 2025 backtest track authorized under an asymmetric decision rule

**Decision:** the blend-vs-FFToday question is re-opened **retrospectively** through the existing
2025 backtest harness, alongside (not instead of) the prospective 2026 pivot recorded earlier
today. This entry **supersedes** the earlier same-day carve-out that set "default is skip" for the
exploratory 2025 screen. Pre-declared rules live in
`fixtures/backtest/2025/gates-blend-addendum.md` (written before any pavg construction, screen,
probe, or run); source bytes are frozen once in `fixtures/projection-freeze/2025-retrievable/`
(`pipeline/freeze_2025_retrievable.py`; SHA-256 pinned; never re-fetched silently).

**Why reopen what step 0 cut:** step 0 ruled the sources vintage-unverifiable, which makes any
retrospective comparison *asymmetric*, not useless. If Sleeper/ESPN values were revised toward
actuals mid-season, the blend gets an unfair advantage — so a blend **loss is conclusive**
(permanent cut), while a win can only ever be **provisional**, requiring mandatory in-season 2026
confirmation before any production switch. Either way an answer arrives before drafts.

**Corrections adopted during validation (recorded so they are not re-made):**

- Outcome coverage must be widened to the candidate pool before any run — `data/weekly-stats.json`'s
  649-player scope plus `gates.md`'s scored-0 rule would systematically punish wider-coverage arms.
- A projection swap cannot be an in-run additive arm like `c1`: it changes `scores`, replacement
  levels, and opponent-pool membership via `buildBacktestContext`. Pavg comparisons run as separate
  CRN-paired runs (seeds are input-independent); the integrity gate is byte-reproduction of the
  committed FFToday reports.
- Union pool is primary (real blending widens coverage); intersection-pool diagnostic is mandatory
  to attribute quality vs coverage.
- All results are labeled **2025-conditional**: CIs quantify draft-level variance only; one season,
  one outcome draw.

**Status:** steps A/A2 complete (freeze committed). Ladder next rungs: pavg build → offline screen
(exploratory) → disagreement probe → CRN-paired pilot → gated run, all per the addendum.

---

## 2026-08-24 — Blend pilot run: AMBIGUOUS verdict, FFToday kept; blending stays open only via the prospective 2026 ladder

**Decision:** the pre-declared pilot (gates-blend-addendum.md section 6) returned an **ambiguous**
verdict for both tested arms, so **FFToday is kept as the production projection source and the
burden of proof stays on the blend.** This is not a permanent cut (the loss branch did not fire),
but no promotion, provisional or otherwise, is earned.

**Setup:** two CRN-paired runs under identical current code — FFToday context vs pavg context
(`BLENDED_PROJECTIONS`/`BLENDED_WEEKLY` input swap; extended outcomes artifact from the frozen
full weekly feed). N = 240 paired drafts/context (12 slots × 20 seeds). Amendment noted: the
addendum declared a 144-draft minimum; the actual run used the runner's default 20 seeds
(larger N only tightens the same direction-only gate).

| Comparison | Mean diff (pts/wk) | 95% CI | Verdict inputs |
|---|---|---|---|
| **b2**: pavg board vs FFToday board | **+2.926** | [+1.731, +4.121] | blend board clearly better raw |
| **engine**: pavg context vs FFToday context | **+0.898** | [−0.651, +2.447] | positive, crosses zero |

Downside gate **failed**: engine 10th-pct pooled weekly 97.660 (pavg) vs 99.600 (FFToday) —
−1.94 pts, far outside the −0.5 non-inferiority band, despite higher starter coverage (0.666 vs
0.614).

**Reading (2025-conditional, per the standing caveat):**

1. The blend's *ranking* is real (+2.9 for B2, CI well above zero) — consistent with the offline
   screen (pavg ρ=0.733 vs fftoday 0.709 on the common pool).
2. The engine captures most of that value itself: only +0.9 reaches the engine arm, CI crosses
   zero. Availability modeling already harvests what better projections would offer.
3. The engine+pavg tail got *worse* (p10 −1.94). A plausible mechanism — the wider union pool
   raises coverage but deep-board picks under the blend scored worse in the tail — matches the
   union-vs-intersection attribution question, which was NOT run (deviation below).

**Deviations from the addendum, recorded:**

- Intersection-pool diagnostic skipped: the verdict is ambiguous either way (no promotion is on
  the table), so the quality-vs-coverage attribution has no decision relevance this season. It
  becomes mandatory again if blending is ever re-tabled.
- Integrity gate adapted: the committed gating JSON predates per-draft arrays, so byte-level cell
  reproduction was impossible. b1/b2/b3 reproduced the recorded corrected re-run means exactly
  (112.634 / 124.025 / 130.502); engine/c1 drifted +0.078/+0.088 vs the prose record
  (129.588/130.590) — attributed to unreconstructable 08-22 working-tree deltas, disclosed rather
  than hidden. Internal validity of the paired comparison is unaffected (identical code both
  sides).
- Section 3's blend rule was amended (point-level → key-level averaging) BEFORE any pavg bytes
  existed; both variants were computed in the screen and their rankings agree at Spearman 0.991
  on the common pool — measured, as required, not assumed.

**Consequences:** do not build blend features into production; do not spend the ~4 h gating run on
this question for 2025 data. The blend hypothesis survives only through the prospective 2026
ladder on the frozen 2026-preseason snapshot, where clean vintage provenance exists. Artifacts:
`benchmarks/reports/2026-08-23-blend-screen.{json,md}` (steps C/D),
`benchmarks/reports/2026-08-23-blend-pilot-analysis.json` (paired stats + verdict),
`benchmarks/reports/2026-08-{23,24}-historical-backtest-2025-pilot*.json` (raw runs).

---

## 2026-08-24 — N=1008 gating run recorded (ran 2026-08-23 but was left unrecorded); all three gates PASS; C1 stratified; engine-vs-B1 deficit logged

**Recordkeeping correction:** the gating backtest (`BACKTEST_GATING=1`, 84 seeds/slot × 12 slots =
1008 drafts/arm, seed base `20250825`, commit `ec69271`) ran at 2026-08-23T03:19Z and its
report/artifact were committed, but nothing recorded it and `PLAN.md` still listed the gating run
as pending until now. Recorded unchanged:

- **All three pre-declared gates vs B3 PASS**: primary-point-floor (129.390 ≥ 112.719 − 0.25);
  primary-ci (+16.671 pts/wk, 95% CI [16.155, 17.187]); downside non-inferiority (p10 weekly 98.300
  vs B3 83.200 − 0.5). Artifacts: `benchmarks/reports/2026-08-23-historical-backtest-2025.{md,json}`.
  Layer-A evidence now exists; any roadmap expansion still waits on the plan's user-review step.
- **C1 vs engine (informational, non-gating): +0.768 pts/wk, 95% CI [+0.231, +1.305]** — significant,
  unlike both 240-draft pilots.
- **Engine vs B1 (plain FFC ADP): −0.830 pts/wk, 95% CI [−1.539, −0.121]** — the production engine
  sorts significantly *worse* than plain best-available-by-ADP on this 2025 grid; **C1 vs B1:
  −0.062 [−0.721, +0.597] (statistical tie)** — C1 repairs the deficit rather than beating naive
  ADP. Recorded as a standing finding that demands either a fix or a documented reason it does not
  matter (candidate explanation, unchecked: B1 is flattered because the opponent-model field shares
  FFC ADP priors). Not yet investigated; do not market an "edge" while it stands.

**C1 stratification diagnostics** (offline from committed `perDraftMeanWeekly`;
`pipeline/analyze_c1_gating.py` → `benchmarks/reports/2026-08-24-c1-gating-stratification.json`;
self-check: overall c1−engine reproduces the committed gating report exactly):

- Per-slot c1−engine is **strongly bimodal, not smoothly declining**: slots 1–6 positive and each
  individually significant (+1.975 … +7.233); slots 7–12 negative with 8/10/11/12 individually
  significant (−1.661 … −3.500). Spearman(slot, meanDiff) = −0.951.
- Per-slot engine−B1 is mixed, not uniformly bad: engine significantly worse than ADP at slots 1–3
  and 11, significantly better at slots 5 and 7 (+2.168 / +7.099).
- **Still open and blocking any C1 promotion:** position-level (cap-1 K/TE/DEF) attribution of C1's
  coverage gain — per-pick data is not in the committed artifact, so this needs an instrumented
  rerun recording per-position starter points. Per the 2026-08-22 c1 entry, promotion additionally
  requires pre-declared gate numbers for C1 (including vs B1 and a downside band). Neither exists;
  C1 stays reported-only.

---

## 2026-08-24 — C1-attribution diagnostics: instrumentation added and interpretation rules pre-declared (before any rerun)

**Question being instrumented** (open since the 2026-08-22 c1 entry): does C1's gating-run edge
(+0.768 pts/wk over engine, significant) live in its cap-1 K/TE/DEF starter points
(`BACKTEST_POSITION_CAPS` TE/K/DEF are each 1), and does it draft those positions earlier — or is
there a real sorting-skill component outside them?

**Instrumentation (additive; picking code and every existing metric untouched):**
`eligibility.ts` gains `optimizeLineupStarters` (the int-memo value DP extended with occupant
identity, bit-identical values, documented tie-break divergence on exact ties, property-tested
against both sibling solvers); `backtest.ts` gains `scoreRosterWeeklyDetailed` (subject seat only;
per-week starter points attributed to each starter's own position — FLEX points land in the
occupant's position, so the six buckets sum exactly to the weekly optimum) plus two per-arm
slot-major arrays (`perDraftStarterPointsByPosition`, `firstPickRoundByPosition`, 0 = never
drafted) and `DraftResult.subjectFirstPickRound`. The runner writes both arrays under a distinct
report stem (`BACKTEST_DIAGNOSTICS='1'` appends `-c1-diagnostics`) so an instrumented rerun can
never overwrite a committed report. Nothing here feeds `evaluateGates`; the committed gates stay
exactly as committed.

**Run plan:** pilot size first (20 seeds × 12 slots = 240 paired drafts, ~50–65 min measured),
escalating N only if a verdict-relevant comparison lands borderline. Diagnostics never require the
gating-size grid.

**Pre-declared interpretation rules (fixed before the rerun runs):**

1. **Flip rule:** recompute the paired c1−engine difference using QB+RB+WR starter buckets only
   ("skill-position-only"). If that excluded diff's sign flips against the inclusive +0.768, or its
   95% CI crosses zero while the inclusive CI excludes zero → **C1's edge is a cap-slot artifact**
   → cut from consideration on 2025 data; no further gating work.
2. **Shippability rule:** even a significant positive edge that lives entirely inside K+TE+DEF is
   **not promotable**: the backtest has no waiver wire, so streaming makes those points recoverable
   in a real league regardless of who drafted them. Only a material skill-position gap survives
   this rule and would justify scoping a real promotion gate (vs engine *and* vs B1, downside band
   included).
3. **Timing read:** mean/median first-pick round per position, c1 vs engine — significantly
   earlier K/DEF/TE picks combined with no surviving skill-position gain confirms the
   coverage-timing mechanism from the 2026-08-22 open question.
4. **Integrity:** deterministic arms' (b1/b2/b3) `perDraftMeanWeekly` cells must reproduce the
   committed 240-draft FFToday-context pilot JSON byte-for-byte at equal seeds; engine/c1 drift, if
   any, is disclosed rather than hidden (precedent: the blend-pilot integrity gate).

---

## 2026-08-24 — C1-attribution diagnostics RESULT: the edge is cap-slot-only and TE-driven; C1 not promotable on 2025 data

**Run:** instrumented pilot-size rerun (`BACKTEST_DIAGNOSTICS='1'`, 20 seeds × 12 slots = 240 paired
drafts, FFToday context, log `benchmarks/reports/c1-diagnostics-run.log`). **Integrity gate:
perfect** — all six arms' `perDraftMeanWeekly` cells byte-reproduce the committed 240-draft pilot
JSON, proving the instrumentation perturbed nothing; every paired comparison below is over exactly
the committed run's drafts.

**Disclosure:** the first analysis pass computed `engine − c1` labeled as `c1 − engine`; caught
because the "inclusive" composite printed −1.012 against the committed record's +1.012. Fixed in
`pipeline/analyze_c1_positions.py` before any conclusion was drawn; the corrected inclusive value
reproduces the committed +1.012 exactly.

**Paired c1 − engine by position bucket (pts/wk, n=240):**

| Bucket | Diff | 95% CI | |
|---|---|---|---|
| QB | −0.377 | [−0.909, +0.156] | |
| RB | +2.700 | [+1.907, +3.494] | * |
| WR | **−5.424** | [−6.429, −4.418] | * |
| TE | **+3.916** | [+3.404, +4.428] | * |
| K | +0.161 | [−0.022, +0.344] | |
| DEF | +0.035 | [−0.140, +0.209] | |
| **K+TE+DEF** | **+4.112** | [+3.549, +4.675] | * |
| skill-only (QB+RB+WR) | **−3.100** | [−4.205, −1.994] | * |
| all (inclusive) | +1.012 | [−0.140, +2.165] | |

**Timing:** c1 drafts TE 1.12 rounds earlier (6.51 vs 7.64) and QB 0.90 rounds earlier (3.15 vs
4.06), both significant; WR slightly later (+0.25); **K/DEF timing is byte-identical between arms**
(both always take DEF round 15, K round 16).

**Rule application (pre-declared above):**
1. Flip rule: skill-only is significantly NEGATIVE while the inclusive diff is positive — the sign
   flip fires directionally at this N (the inclusive CI does not yet exclude zero at n=240, where
   the gating run's did at n=1008).
2. Shippability rule: dispositive. The entire positive edge lives in cap-1 slots, and specifically
   in **TE** (+3.92 of +4.11); K and DEF contribute ~zero. An edge that trades away 5.4 pts/wk of
   WR production for early-TE construction is exactly what a no-waiver backtest cannot price and a
   real league can stream around. **C1 is NOT promotable on 2025 data.**
3. No escalation to larger N: ARTIFACT and CAP-SLOT-ONLY lead to the same decision, so the extra
   hours would sharpen a label, not a choice.
4. The 2026-08-22 open question ("does sorting by lookahead systematically draft K/DEF earlier?")
   is answered: NO — K/DEF are drafted at identical fixed rounds. The mechanism is a roster-
   construction shift: earlier TE/QB, later WR, more TE starter points, fewer WR starter points.

**Consequences:** C1 stays reported-only and is closed for 2025 data (same standing as the blend).
The engine-vs-B1 deficit (2026-08-24 gating-record entry) remains the open item worth attention.
Artifacts: `benchmarks/reports/2026-08-24-historical-backtest-2025-pilot-c1-diagnostics.{json,md}`,
`benchmarks/reports/2026-08-24-c1-attribution-analysis.json`, `pipeline/analyze_c1_positions.py`.

---

## 2026-08-24 — Engine-vs-B1 deficit LOCALIZED: skill-position (WR/QB) construction shift, not cap-slot noise; saturation dose-response sweep pre-declared

**Step 1 — offline positional attribution (no rerun).** The already-committed instrumented
diagnostics artifact (`2026-08-24-historical-backtest-2025-pilot-c1-diagnostics.json`, whose
`starterPointsByPosition`/`firstPickRoundByPosition` arrays cover b1 too) sufficed; new script
`pipeline/analyze_engine_b1_positions.py` computes paired engine−b1 diffs offline. Interpretation
rules were fixed in the script docstring BEFORE it ran (shippability-symmetry rule, skill-deficit
rule, timing read, exploratory-only slot cross-tab). **Integrity self-checks passed**: paired
c1−engine reproduces the committed +1.012 exactly (the check itself first FAILED on a sign error —
the same label-flip the C1 entry disclosed — and was fixed before conclusions were drawn);
engine−b1 matches the arm-summary delta (−0.836221); six-bucket sums reconcile with
`perDraftMeanWeekly` (max gap 5.7e-14).

**Paired engine−b1 by position bucket (pts/wk, n=240, FFToday context):**

| Bucket | Diff | 95% CI | |
|---|---|---|---|
| QB | −0.982 | [−1.478, −0.487] | * |
| RB | +3.210 | [+2.093, +4.327] | * |
| WR | **−5.255** | [−6.298, −4.212] | * |
| TE | −0.742 | [−1.263, −0.221] | * |
| K | +2.501 | [+2.153, +2.850] | * |
| DEF | +0.432 | [+0.239, +0.624] | * |
| skill-only (QB+RB+WR) | **−3.027** | [−4.324, −1.731] | * |
| K+TE+DEF | +2.191 | [+1.519, +2.863] | * |
| all (inclusive) | −0.836 | [−2.253, +0.581] | |

The inclusive diff is NOT significant at pilot size (consistent with the N=1008 record's
−0.830 [−1.539, −0.121]; same mean, wider CI — disclosed).

**Verdict: SKILL-DEFICIT (pre-declared rule 2 fired).** The deficit survives the streaming rule —
it lives in WR/QB starter points, offset by RB and cap-slot gains. Timing read names the mechanism:
the engine reaches for QB (mean first-pick round 4.06 vs b1's 9.57) and TE (7.64 vs 13.24) and lets
WR slide (3.28 vs 1.59) relative to plain ADP order — i.e., its value logic deviates from the market
exactly where the realized 2025 outcome punished it. The WR deficit is DIFFUSE: negative in all 12
slots (−1.48 … −8.94), so it is not a slot artifact; per-slot inclusive diffs are mixed (slot 7
+9.35*, slot 1 −7.59*) because RB/K offsets vary by seat.

**2025-conditionality caveat (recorded to prevent over-reading):** "WR-heavy early order wins" is
one season, one outcome draw — the TE bucket alone shows non-monotonic timing value (b1's
round-13.2 TE beat engine's 7.64 by +0.74, while c1's round-6.5 TE beat engine's by +3.92), which
smells like player-specific outcomes rather than a stable law. The mechanism is therefore
localized but NOT yet a fix candidate: whether deviating from market ordering is ever *good* is
exactly the open question.

**Step 2 — saturation dose-response sweep (rules fixed BEFORE any run):** test the standing
hypothesis (2026-08-24 gating-record entry) that B1 is flattered because the opponent field shares
FFC ADP priors. New opt-in knob `BACKTEST_OPPONENT_SHOCK_SCALE` (env → `buildBacktestContext`
optional `opponentConfig` override; unset ⇒ byte-identical behavior; distinct report stem
`-shockscale{S}` when set ≠ 1). Sweep `shockScale ∈ {0, 2, 4}` as fresh pilot-size runs (20 seeds ×
12 slots; identical seed base, so scenarios stay comparable across scales); scale 1 comes from the
committed diagnostics artifact (same code, same seeds). Paired engine−b1 meanDiff computed per
scale; pairing holds WITHIN a scale only — cross-scale comparisons are means-level, never paired.

**Pre-declared verdict rules:**
1. **SATURATION-SUPPORT:** meanDiff(4) CI lower bound > 0 AND the four means are monotonically
   non-decreasing in scale ⇒ the engine's edge is exploitation of field deviation; reframe claims
   accordingly (engine ≈ ADP only in saturated fields).
2. **DAMNING:** meanDiff CI upper < 0 at BOTH scale 2 and scale 4 ⇒ the deficit survives field
   noise; the honest conclusion is that the production sort is worse than naive ADP here, period.
3. **DIRECTIONAL-ONLY:** monotone improvement but scale-4 CI crosses zero ⇒ escalate the scale-4
   cell to a larger-N run ONCE before concluding.
4. **AMBIGUOUS:** anything else; no further 2025 spend.

Layer C/D remain the human-containing tests regardless of outcome; layer D snapshot retention
starts now (before the 2026 season) so the accuracy baseline exists.

Artifacts: `pipeline/analyze_engine_b1_positions.py`,
`benchmarks/reports/2026-08-24-engine-b1-attribution-analysis.json`.

---

## 2026-08-24 — Shock-scale sweep RESULT: mechanical verdict AMBIGUOUS per pre-declared rules; engine beats naive ADP at every scale except the default field

**Runs:** three fresh pilot-size runs (`BACKTEST_OPPONENT_SHOCK_SCALE` ∈ {0, 2, 4}, 20 seeds × 12
slots = 240 paired drafts/arm, FFToday context; scale 1 taken from the committed diagnostics
artifact, same code and seeds). Scale 0 = deterministic ADP-order field (saturation limit); higher
scales = progressively less ADP-like opponent priorities. Pairing holds within scale only.

| shockScale | engine−B1 (pts/wk) | 95% CI | |
|---|---|---|---|
| 0 | **+1.784** | [+0.347, +3.221] | * |
| 1 (default) | −0.836 | [−2.253, +0.581] | |
| 2 | **+6.562** | [+4.973, +8.152] | * |
| 4 | **+8.237** | [+7.686, +8.789] | * |

Integrity: every artifact self-reports its shockScale/draftsPerArm (metadata added to reports);
the scale-1 anchor reproduces the committed arm-means delta exactly; Spearman(scale, meanDiff)
= 0.80.

**Mechanical verdict: AMBIGUOUS** — rule 1 (SATURATION-SUPPORT) required monotonically
non-decreasing means and the scale-1 dip breaks it; rules 2 and 3 do not fire either. Per the
pre-declared consequence: no further 2025 sweep spend under these rules. Recorded as-is; no
post-hoc rule bending.

**Exploratory reading (NOT the verdict, labeled as such):**
- The standing hypothesis ("B1 is flattered because the opponent field shares FFC ADP priors") is
  REFUTED as stated: at true saturation — a deterministic ADP field — the engine significantly
  BEATS B1, and at elevated noise it wins by +6.6 to +8.2 pts/wk. The only negative cell is the
  default calibrated-noise level itself.
- The default-field deficit is therefore real-but-small (significant only via the N=1008 gating
  run, −0.830) and specific to that noise level, not a saturation artifact. Combined with the same
  day's localization entry: its mechanism is the WR/QB construction shift under realistic noise.
- Practical shape of the claim the evidence now supports: "engine vs naive ADP depends dramatically
  on field character; on this 2025 grid the engine loses ~0.8 pts/wk only in the exact default
  simulated field and wins elsewhere." Neither direction may be marketed from 2025 sims alone;
  layers C/D (live mocks, projection tracking) remain the human-containing tests.

**Incident disclosure:** an in-session smoke test left `BENCHMARK=1`, `BACKTEST_SEEDS=1`,
`BACKTEST_OPPONENT_SHOCK_SCALE=0` ambient in the shell, so a later `npm test` executed the opt-in
bench file (normally excluded) and overwrote the full scale-0 artifact with a 12-draft run. Caught
immediately; the full run was re-executed solo (51 min) and deterministically reproduced the
original numbers exactly (+1.784 [+0.347, +3.221]). Standing lesson: clear `BENCHMARK`/`BACKTEST_*`
env before running `npm test`; the bench's BENCHMARK guard assumes a clean environment.

Artifacts: `pipeline/analyze_shock_scale_sweep.py`,
`benchmarks/reports/2026-08-24-shock-scale-sweep-analysis.json`,
`benchmarks/reports/2026-08-24-historical-backtest-2025-pilot-shockscale{0,2,4}.{json,md}`.

---

## 2026-08-24 — Layer D stood up as git-vintage snapshots; no database

**Decision:** satisfy evaluation layer D (dated projection/ADP retention for scoring engine
recommendations against actual 2026 outcomes) with git history plus annotated tags rather than a
database, and defer all persistence decisions until a real consumer exists.

**Why:** the retention problem was already ~solved by accident — `.github/workflows/refresh-data.yml`
commits the entire `data/` directory daily (FFC/Sleeper/ESPN ADP boards, FFToday/provider
projections, weekly stats) with full provenance manifests and SHA-256 pins, so every daily commit is
a dated vintage. What was missing was findability and failure-loudness, not storage. A database adds
nothing for append-only JSON blobs; migrating dated files into any future DB is trivially reversible,
while vintages not captured are unrecoverable — but the genuinely unrecoverable pre-kickoff 2026
vintage was already frozen separately (`data/projections-providers.json`, `fetchedAt` 2026-08-22,
per the projection-vintage audit), which removed the time-pressure argument for heavier machinery.

**Implementation (all additive):**
1. `refresh-data.yml`: successful data-changing Monday refreshes (and every manual dispatch) now
   create an annotated `data-snapshots/YYYY-MM-DD` tag on the refresh commit; idempotent per day.
   Weekly cadence chosen to keep the tag namespace readable while still capturing waiver-window
   movement; daily granularity remains available in plain git history regardless.
2. A failing refresh opens a GitHub issue (one per day, comments on repeats), because a silent cron
   failure would punch permanent holes into the vintage record.
3. `pipeline/retrieve_vintage.py` (`npm run snapshot:vintage`) lists or materializes any tagged
   vintage into a directory and prints its manifest summary + manifest SHA-256; pure functions tested
   in `pipeline/test_retrieve_vintage.py` against fixtures and the real committed manifest.

**Scope note:** this stands up *retention* only. The layer D analysis (MAE/bias/rank correlation of
projections vs actuals by position) stays open until in-season outcomes accumulate, and layer C
(live mocks) is unchanged.

Artifacts: `.github/workflows/refresh-data.yml`, `pipeline/retrieve_vintage.py`,
`pipeline/test_retrieve_vintage.py`, `package.json`, `PLAN.md` layer D section, `CLAUDE.md` commands.

---

## 2026-08-24 — Underdog best-ball ADP re-sourced to a third-party republication

**Decision:** the Underdog best-ball lane (`data/adp-underdog-bestball.json`, display-only) now
parses Sharp Football Analysis's server-rendered Underdog ADP table
(`/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/`, ~250 rows, clears the
UNDERDOG_ADP_MIN_ROWS = 150 gate) instead of Underdog's own API.

**Why:** the configured endpoint `api.underdogfantasy.com/beta/draft_boards/nfl-best-ball` is dead
(404), and it is not a UA block: Underdog's host serves its pick'em props API unauthenticated while
every candidate ADP / draft-boards path 404s. Best-ball draft boards sit behind login; there is no
public Underdog ADP API to point at. DraftSharks was evaluated and rejected (client-rendered Vue
SPA — no data in the HTML).

**Constraint — third-party attribution is load-bearing:** this is a republication of Underdog ADP,
not Underdog's own feed, and the repo says so wherever the number appears: the pipeline URL/comment
block names the source, the PlayerMarketComparison tile reads "Underdog best ball (via Sharp
Football)" with an explicit third-party note, matching the honesty convention behind the per-player
`adpSource` badge. Freshness (`upstreamUpdatedAt`) is taken verbatim from the page prose
("Updated August 21") — the publisher prints no year, so none is invented. If the scrape proves
unstable, `_build_underdog_adp_board` fails open exactly as before: the tile hides, nothing breaks.
Parsing moved from a JSON payload to the shared stdlib `html_table.TableParser` (same reader the
FFToday/CBS scrapers use); the fail-open wrapper, min-rows gate, manifest wiring, and frontend path
are unchanged. This entry also records that the Underdog lane itself landed in b78b851 without a
DECISIONS.md entry — rectified here.

---

## 2026-08-25 — Market ADP tile simplification + Role tab STACKED percentile rankings

**Decision (Market ADP):** the PlayerMarketComparison readout is now tiles-only. The
`Current pick · Range · Std. dev · Sample` caption line, the engine tile's positional-rank
suffix ("WR54"), and the Underdog third-party prose note are removed; `BoardAdpAnchor` shrinks
to `{ adp, source }` (the population-shape fields had no remaining reader). The Underdog tile is
labeled just "Underdog" with a committed `frontend/src/assets/providers/underdog.svg` badge; the
FFC lane label drops "(mock drafts)".

**Constraint update:** the 2026-08-24 "third-party attribution is load-bearing" rule still holds,
but its surface moves off the visible note into the Underdog tile's `title`/aria text (which
still names Sharp Football Analysis and the never-blended-into-the-board rule). The pipeline-side
attribution (URL/comment block, `underdog_adp.py` doc) is unchanged.

**Decision (Role tab):** RB/WR/TE now render STACKED-style (fantasyplaybook.ai-style) grouped
percentile rankings instead of the 2x2 role cards: per-metric per-game (AVG) values percent-ranked
0-100 within the same-position cohort of `player-usage.json` (new pure frontend helper
`frontend/src/data/percentileRankings.ts`; min cohort 5, ties read at-or-below, thin/missing data
degrades to n/a or the legacy columns — never a fabricated rank). QB/K/DEF keep the weekly
game-log columns. To source the efficiency metrics the pipeline now sums nflverse `stats_player`'s
`rushing_epa`/`receiving_epa` into `OpportunityPeriod.rushingEpa[PerGame]`/`receivingEpa[PerGame]`
(additive, optional in `shared/types.d.ts`; committed artifacts gain the fields on the next
`npm run pipeline` run, and the UI fails open until then).

**Deliberate omission:** Routes Run / Targets Per Route Run / Yards Per Route Run and ESPN's
Open/Catch/YAC receiver scores are NOT replicated — no free source carries per-player routes
(FTN charting via nflverse is play-context only) and the ESPN scores are proprietary. Showing
hatched placeholders for them would imply data we do not have; the honesty convention wins over
layout parity.

Artifacts: `frontend/src/components/PlayerMarketComparison.tsx`, `PlayerDetailDrawer.tsx`,
`RecommendationBoard.tsx`, `PlayerRolePanel.tsx`, `frontend/src/data/percentileRankings.ts`,
`frontend/src/hooks/useProviderAdpBoards.ts`, `frontend/src/assets/providers/underdog.svg`,
`shared/types.d.ts`, `pipeline/context.py`, `App.css`.

---

## 2026-08-25 — Engine ADP tile gets a provider logo; EPA artifact regenerated with a
zero-vs-unknown gate; Role tab receiving-efficiency group filled in; percentile bands re-colored

**Decision (Market ADP):** the engine tile in `PlayerMarketComparison.tsx` (the bold,
`data-role="engine"` tile — the board's own committed ADP number) was the one tile in the grid
rendering no `ProviderBadge`, even though every lane/projection tile beside it does. `BoardAdpAnchor`
gains a `brandKey: ProviderBrandKey` field alongside the existing `source` display string (kept
separately because it carries nuance a brand key can't, e.g. "Sleeper (ESPN board tail)");
`PlayerDetailDrawer.tsx` derives it from the same `adpSource`/`adpDisclosure.source` switch already
building `source`. The Underdog SVG placeholder (`frontend/src/assets/providers/underdog.svg`,
committed 2026-08-24, a hand-drawn purple "U" that is not Underdog's real black/gold mark) is left
for the user to replace directly with the official asset — no redraw attempted here.

**Root cause found and fixed (EPA):** the 2026-08-24 entry above already flagged that
`rushingEpa[PerGame]`/`receivingEpa[PerGame]` were computed but not yet in the committed artifact.
Confirmed: `data/player-usage.json` was last built ~10 hours before `pipeline/context.py`'s EPA
code landed — 0 of 671 `opportunity` records carried the keys. Fixed by running `npm run pipeline`
(regenerates all of `data/`, the normal refresh shape). While fixing, closed a real hazard:
`_number()` coerces a missing/non-numeric value to `0.0`, so if nflverse ever drops or renames
`rushing_epa`/`receiving_epa`, every player would silently report an observed `0.0` EPA rather than
"unknown" — indistinguishable from genuine replacement-level play. Added `epa_available` (mirrors
the existing `pbp_available` gate on the red-zone fields two lines below) so an absent source column
now nulls the field instead of zeroing it; regression test in `pipeline/test_context.py`.

**Decision (Role tab, WR/TE sparseness):** WR/TE's "Receiving Efficiency" group was one metric
(Receiving EPA) once EPA was dead, versus RB's five-group spread. Added four metrics computable
from fields already in `data/player-usage.json` — no new source: aDOT (`airYards/targets`), Catch
Rate (`receptions/targets`), Yards/Reception, YAC/Reception (`receivingYardsAfterCatch/receptions`).
Put in the shared `RECEIVING_EFFICIENCY_METRICS` list so RB and WR/TE rank the same shape (divergent
group membership between positions was judged not worth the drift). Each is season-long ratio, not
a per-game average, so `PercentileStat` gained a `ratio?: boolean` flag (`METRICS[...].ratio`) that
drops the "per game" wording from the row's aria-label; extractors return `null` on a zero/missing
denominator, never `NaN`/`Infinity` (`ratioOf()` helper). `buildPercentileRankings` now returns
`{ cohortSize, groups }` instead of a bare array so the panel caption can read "vs. NNN
same-position players" instead of an unqualified rank.

**Decision (Role tab, flat-looking percentile bars — a real bug, not requested scope):** found
while comparing against app.fantasyplaybook.ai (STACKED) — `.percentile-fill` only styled
`[data-band="elite"]` and `.percentile-badge` hardcoded `--score-fair`, so every non-elite row (the
large majority) rendered identically regardless of actual rank. Added the missing
good/fair/poor rules (same shape as the working `.stat-bar-fill[data-band]` block two hundred lines
up) and made the badge border/color band-driven too; the band is computed once in
`PlayerRolePanel.tsx` and passed to both fill and badge so they cannot disagree. Also added a
full-width `.percentile-track::before` rail so a short/poor bar reads against the 0-100 scale
instead of floating in empty space, and moved the missing-data hatch from the 1rem track onto the
.28rem rail.

**Scope explicitly declined (user call):** no drawer/layout restructure, no game-log column next to
the percentile rail, no AVG/TOTAL toggle, no WOPR/RACR, no snap%/red-zone group, no last-5-game form
group — STACKED-inspired polish only, not a rebuild.

Artifacts: `frontend/src/components/PlayerMarketComparison.tsx`, `PlayerDetailDrawer.tsx`,
`PlayerRolePanel.tsx`, `frontend/src/data/percentileRankings.ts`, `pipeline/context.py`,
`pipeline/test_context.py`, `App.css` (percentile-fill/badge/track rules), `data/*.json`
(regenerated).

---

## 2026-08-25 — Official Underdog logo replaces the placeholder SVG; Role tab groups diverge
per position; efficiency EPAs re-unit'd to per-attempt

**Decision (Underdog logo):** the user supplied Underdog's official mark as an AVIF
(`assets/providers/underdog.avif`); the hand-drawn purple-"U" placeholder `underdog.svg`
(2026-08-24) is deleted. `ProviderBadge` gains a raster branch — `import.meta.glob('*.{png,avif}',
{ query: '?url' })` rendered as an `<img>` under the renamed `provider-badge-img` class
(was `provider-badge-png`) — with precedence still SVG → raster → monogram. No conversion tooling
exists on this machine (no ImageMagick/ffmpeg/Pillow) and Vite emits `.avif` natively, so the
AVIF ships as-is; all evergreen browsers decode it. The Sharp Football Analysis attribution
title/aria on the Market ADP tile is untouched.

**Decision (Role tab groups):** RB/WR/TE now render deliberately **divergent** percentile group
sets — this reverses the 2026-08-25 "shared receiving shape" rule that judged divergence not
worth the drift (user call: identical data across positions hides what matters). All three draw
from fields already committed in `player-usage.json`; no pipeline change:
- **RB**: Fantasy · Backfield Volume (Carries, Carry Share, Rush Yds, Snap %) · Rushing
  Efficiency (Yards/Carry, Rush EPA/Carry) · Receiving Workload (Targets, Target Share,
  Receptions) · Goal Line & Red Zone (Goal-Line Carries, Red-Zone Targets, Rush TDs).
- **WR**: Fantasy · Target Earners (Targets, Target Share, Air-Yard Share, Snap %) · Receiving
  Production (Rec/Yds/TDs per game) · Ball Winning (Catch Rate, Y/R, YAC/R, aDOT,
  Rec EPA/Target) · Red Zone (Red-Zone + End-Zone Targets).
- **TE**: WR skeleton, re-weighted — snaps join Volume (TE route participation lives there),
  deep-ball aDOT drops out of Reliability (TE targets skew short), EPA/target stays.
QB/K/DEF remain on the weekly game-log columns.

**Decision (EPA units) + accuracy research:** the user questioned Rushing EPA's accuracy.
Findings: the pipeline reads nflreadpy `load_player_stats(summary_level='week')`, which hits the
*current* `stats_player` release (the legacy `player_stats` release was deprecated 2025-08-01);
`rushing_epa` sums nflfastR play-by-play rushing EPA, and the committed values pass sanity checks
(mean −0.034 EPA/carry over 36 RBs with ≥140 carries, matching the league baseline; Jonathan
Taylor elite, Jeanty worst — both plausible). So the *data* is sound; the problem was the old
presentation: raw EPA **per game** inside an "Efficiency" group lets a bellcow's volume
out-percentile a more efficient back. Rushing EPA is now ranked per carry and Receiving EPA per
target (`ratioOf` guards zero/missing denominators; the old per-game EPA metrics are gone from
the panel). Residual caveat kept honest: `_number()` coerces row-level blanks to 0.0 (the
column-level `epa_available` gate only catches a dropped column); only 3 of 327 ball-carriers
show exact-zero EPA, so no systemic poisoning is visible today.

Artifacts: `frontend/src/assets/providers/underdog.avif` (added), `underdog.svg` (deleted),
`ProviderBadge.tsx`, `providerBrand.ts`, `App.css`, `percentileRankings.ts`,
`percentileRankings.test.ts`, `PlayerRolePanel.test.tsx`, `ProviderBadge.test.tsx`.

---

## 2026-08-25 — Card-bottom slot stats deduplicated and rendered as percentile bars

**Decision:** the card-bottom slot (shipped earlier the same day — the on-clock/next-up 4-state
rule in `PlayerCard.tsx`) was showing two picks per position that were the same measurement
twice: RB showed Carry Share + Touches/g (both raw backfield volume), WR/TE showed Target Share +
Targets/g (the same target count expressed two ways). Fixed with a one-production /
one-opportunity-or-differentiator / one-more rule, no two picks algebraically derivable from each
other:

| Pos | 1 (production) | 2               | 3           |
|-----|-----------------|-----------------|-------------|
| QB  | Fantasy Pts/g   | Pass Yd/g       | Rush Yd/g   |
| RB  | Fantasy Pts/g   | YPC             | Targets/g   |
| WR  | Fantasy Pts/g   | Targets/g       | Yds/Rec     |
| TE  | Fantasy Pts/g   | Targets/g       | Snap %      |
| K   | FGM/g           | FG%             | 50+ FGM     |
| DEF | Sacks/g         | Takeaways/g     | Pts allow/g |

QB drops the old third pick (Pass TD/g, collinear with Pass Yd/g) for Rush Yd/g — the actual
week-to-week differentiator between starting QBs. The 2-stat states (on-clock, or a next-up chip
present) take the first two of the three.

**Decision (percentile bars):** every stat now carries a 0-100 cohort percentile and renders as
the Role page's percentile rail (`percentile-track`/`-fill`/`-badge`, extracted into a shared
`PercentileBar` component so the Role page and the card render byte-identical markup at different
CSS-scoped sizes), not a bare number. RB/WR/TE rank against the same `METRICS` extractors
`percentileRankings.ts` already exports for the Role page; QB against `qbPercentileRankings.ts`'s
weekly-game-log cohort. **K/DEF previously had no percentile at all** (`percentile: null` always)
— they now rank against their own weekly-artifact cohort (K on made/attempted/50+, DEF on
sacks/takeaways/points-allowed-inverted), the same honesty rule as everywhere else: a cohort
thinner than `MIN_COHORT` (5) or a missing self-value degrades to `percentile: null`, rendered as
a raw value on a hatched empty rail — never a fabricated rank. Percentiles remain display-only:
nothing here feeds `planValue` or any sort comparator.

**Why an index, not a per-player function:** the old `buildCardRoleStats(single player)` was fine
called once per drawer, but `buildPercentileRankings` rebuilds its cohort array per metric per
player — too slow to call once per card on a full board. `buildCardRoleStatsIndex` builds each
`(position, metric)` cohort once and ranks every player against it in one pass; `RecommendationBoard.tsx`
calls it once per board render instead of looping `buildCardRoleStats` per player.

Artifacts: `frontend/src/data/cardRoleStats.ts` (rewritten: `buildCardRoleStatsIndex` replaces
`buildCardRoleStats`), `percentileRankings.ts` (`METRICS`/`MetricKey`/`MIN_COHORT` exported),
`frontend/src/components/PercentileBar.tsx` (new, extracted out of `PlayerRolePanel.tsx`'s
formerly-inline percentile-row JSX), `PlayerRolePanel.tsx`, `PlayerCard.tsx`,
`RecommendationBoard.tsx`, `App.css`, `cardRoleStats.test.ts`, `PlayerCard.test.tsx`.

---

## 2026-08-25 — Fourth card stat for the no-next-up state (fill the empty middle, no duplicates)

**Decision:** with a 4th pick per position added, the off-clock/no-next-up card state now renders
**4** role stats (was 3) — the user pointed at the dead space the 3-row block left in the card's
middle. Each new pick passes the same no-duplicate rule (not algebraically derivable from the
other three shown): QB +Pass TD/g, K +XPM/g (weekly `xpm` column), DEF +PD/g (weekly
`def_pass_def` column). The 2-stat states (on-clock, or a next-up chip present) still take the
first two picks — unchanged.

**Decision (same-day pick swap):** the user then reshaped the skill-position picks — RB drops
Targets/g + Snap % for **Goal-Line Carries + Rush TD/g**; WR/TE drop Yds/Rec + Snap % for
**YAC/Rec + Red-Zone Targets**. Final card table (every pick mutually non-derivable):

| Pos | 1 (production) | 2               | 3            | 4               |
|-----|-----------------|-----------------|--------------|-----------------|
| QB  | Fantasy Pts/g   | Pass Yd/g       | Rush Yd/g    | Pass TD/g       |
| RB  | Fantasy Pts/g   | YPC             | GL Carries/g | Rush TD/g       |
| WR  | Fantasy Pts/g   | Targets/g       | YAC/Rec      | RZ Tgt/g        |
| TE  | Fantasy Pts/g   | Targets/g       | YAC/Rec      | RZ Tgt/g        |
| K   | FGM/g           | FG%             | 50+ FGM      | XPM/g           |
| DEF | Sacks/g         | Takeaways/g     | Pts allow/g  | PD/g            |

All four skill picks reuse `percentileRankings.ts`'s existing `METRICS` extractors
(`goalLineCarries`/`rushingTds`/`yacPerReception`/`redZoneTargets` — per-game averages, YAC as a
per-reception ratio) against the same cohort as before; no new metric plumbing was needed.

**Spacing:** the 4-stat block grows into the card's leftover room (`flex: 1` +
`align-content: space-evenly` in `App.css`, `data-count='4'`), so the slack spreads *between*
the rows instead of pooling as one lump above the stats or below them. The 3-row fallback (a
player missing the 4th metric) keeps the earlier `margin-top: auto` floor-anchor treatment.

Artifacts: `frontend/src/data/cardRoleStats.ts`, `frontend/src/components/PlayerCard.tsx`,
`App.css`, `cardRoleStats.test.ts`, `PlayerCard.test.tsx`.

---

## Handoff note for future agents

When you make a decision that should outlive the current task â€” a rejected approach, a formula
change, a data-source or provider tradeoff, a scope exception â€” add a new dated entry here rather
than editing `PLAN.md` in place. `PLAN.md` should only ever describe *current* status and near-term
sequencing; this file is where the reasoning trail lives.

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

## 2026-08-30 — Provider chooser reverted to horizontal pills; draft-grid cells widened to real headshots

**Reported:** the 2026-09-01-dated `.provider-chooser` rewrite (see the 2026-08-29 (3) entry above
— its date is later than today's but it shipped earlier in this repo's history) turned the
connect-page chooser into a vertical stack of full-width rows; the user wanted the original
horizontal row of oval chips back, on both `/leagues/connect` and the Draft Room launcher.

- **`styles/leagues.css`:** `.provider-chooser`/`.provider-chip` restored to `display: flex` +
  `--radius-pill` chips (recovered verbatim from a pre-`fee4a3b` checkpoint) — a container
  `display`/`gap`/`max-width` and a chip `display`/`grid-template-columns`/`gap`/`width`/`padding`/
  `border-radius`/`text-align` delta only. The hover, `[aria-selected="true"]` solid-fill, and
  `:disabled` rules from the 2026-08-29 (3) entry are untouched.
- **`DraftLauncher.tsx`:** gained the same `.provider-chooser` (Sleeper / ESPN / disabled Yahoo)
  above its Sleeper/ESPN sections, which dropped their bare `<h3>` headings. Defaults to Sleeper;
  auto-switches to ESPN the first time a live draft is detected (tracked via a ref so a manual
  switch back to Sleeper isn't fought on the next bridge poll) so a detected draft is never hidden
  behind an unclicked tab. The ESPN panel shows `ESPN_STATUS_COPY[status]` instead of going blank
  when nothing is live-detected yet.
- **Nav labels shortened:** "Connect a league" → "Connect" (`LeaguesRoute.tsx`'s header CTA,
  `DraftLauncher.tsx`'s "Nothing connected yet?" link) and "Back to My Leagues" → "Back"
  (`ConnectLeagueRoute.tsx`, `LeagueDetailRoute.tsx`). The empty-state hero CTA ("Connect your first
  league", `LeaguesRoute.tsx`) was left alone — `LeaguesRoute.test.tsx` pins that exact name.
- **Draft Guide grid — supersedes the 2026-08-26 entry's "`DraftGuideBoard` deliberately keeps the
  smaller `PlayerAvatar` monogram — its ~118px cells don't have room for a 40px portrait":** the
  user asked for the same headshot/logo/pos-pill face `DraftGuideTable` already uses, just denser.
  `.guide-grid-cell` widened 118px → 160px and gained a `PlayerPortrait` (32px) in place of
  `PlayerAvatar`, a `.guide-grid-team` row (self-hosted `/team-logos/*.png` + abbreviation) under
  the name, and the shared `.guide-pos-pill.guide-pos-pill-inline` in place of the old
  `PositionBadge` + `.guide-grid-posrank` pair — so the grid and table views read the same. Also
  added a low-opacity team-logo watermark on each cell (`--team-logo` custom property via the same
  `teamChromeStyle` helper `PlayerCard`/`PlayerBoardRow` already define, `.guide-grid-cell::after` at
  `--team-watermark-opacity`, mirroring `.my-team-slot::after`). `PlayerAvatar` remains the fallback
  for a row with no `player` record.
- **Tests:** `DraftGuideBoard.test.tsx`'s "shows monogram avatars…" case was rewritten to assert the
  headshot/team/pos-pill face instead of `.player-avatar` text. `DraftLauncher.test.tsx` needed no
  changes — its ESPN suite already mocks a live snapshot before rendering, which now exercises the
  auto-select-ESPN-tab path instead of an always-visible section.

## 2026-08-30 (2) — Draft Room simplified: less copy, ESPN card hides until fully detected, boxed tiles dropped for flat rows

**Reported:** a stale/disconnected ESPN snapshot (the tab closed, an old mock's residue) still
rendered a "Live draft detected" card whose own status line read "ESPN draft tab disconnected." —
looking broken rather than simply not-connected — and the Sleeper section's copy ("Track a Sleeper
mock or a friend's draft — first, your username", "Have a draft ID from someone else, or a mock?")
was far wordier than the connect page's plain "Sleeper username" labels. Both sections also used
the bordered/shadowed `.league-tile` card for every row, which read heavier than the user wanted.

- **`EspnLiveDetectedCard` (`DraftLauncher.tsx`) now returns `null` until `fullyDetected`** (real
  teams+rounds known, which requires `status === 'live'`) — previously it rendered a "pending" strip
  for any non-null live snapshot regardless of status. `ResumeSection` already covers getting back
  into a saved league's in-progress draft with no live detection required, so hiding this card
  entirely in between costs nothing. The remaining fully-detected render dropped the "Live draft
  detected" badge, the separate ESPN_STATUS_COPY status line, and the "Team N detected" sentence
  (folded into a `Team N` meta chip) — one less-crowded row instead of four stacked lines.
- **Sleeper copy simplified** to match `ConnectSleeper.tsx`'s plain style: `TrackByDraftId`'s labels
  became "Sleeper username" / "Draft ID" (from "Track a Sleeper mock or a friend's draft — first,
  your username" / "Have a draft ID from someone else, or a mock?"), its button "Continue" / "Track"
  (from "Look up user, then track" / "Track this draft ID"), and the "No Sleeper account connected
  yet — paste a draft ID below…" paragraph was dropped entirely — the form's own username field
  already says what to do next.
- **Both sections dropped the boxed `.league-tile` card** for a new flat `.draft-pick-list`/
  `.draft-pick-row` (leagues.css): no border/shadow/radius, just a hairline `border-bottom` between
  rows — `SleeperDraftRow` and `EspnLiveDetectedCard` both moved onto it. `.league-tile` itself is
  untouched (still used by `/leagues`, `/leagues/connect`, and `ResumeSection`) — this was scoped to
  the two rows the user named, not a global restyle. The now-unused `.espn-live-tile`/
  `.espn-live-badge`/`.espn-live-pending` rules were deleted from `leagues.css`.
- **Tests:** `DraftLauncher.test.tsx`'s two ESPN "pending card" tests were rewritten to assert the
  card renders nothing (`queryByTestId('espn-live-detected-card')` is null) for a stale/disconnected
  snapshot; the "never renders a card for a saved ESPN league" test's live fixture gained
  `leagueTeams`/`leagueRounds` so it still exercises "exactly one card" rather than "zero cards";
  the Sleeper copy tests' `/first, your username/i` markers became `/Sleeper username/i`, and the
  seat-input label query became `/Position/`. Full suite green (`npm test` still has the one
  pre-existing unrelated `recommendAnalysisRows.test.ts` snapshot failure, confirmed present on
  `main` before this session's changes).

## 2026-08-30 (3) — Landing's data-sources wire animation: comets were queuing up in the shared hub trunk

**Reported:** the animated comets on the landing page's "03 · Data sources" hub illustration
(`IntegrationsMap.tsx`) looked "stuck at the beginning like a queue" — multiple bright pulses
visibly bunched together rather than one comet flowing at a time.

**Root cause, verified live via the Web Animations API (sampling `getAnimations()[0].currentTime`
across ~24 samples over a full cycle):** all five branch paths share the exact same trunk pixels on
their final approach into the hub (`BRANCH_PATHS`'s common `H 400 V 0` / `V 0` tail — a hub-and-
spoke layout necessarily converges). The old `BRANCH_DELAYS` (`0/1.4/2.6/3.5/5.1s` on a 10s loop)
gave each comet a ~3s travel window (0%–30% of the keyframe), and several of those 3s windows
overlapped (e.g. branches at 2.6s and 3.5s delay are both mid-flight from 3.5–4.4s) — so two or
three comets were routinely in the shared trunk simultaneously, reading as cars queued nose-to-tail
rather than a single comet.

**Fix:** stretched the loop to 20s and re-spaced `BRANCH_DELAYS` to `0/3.8/8.2/12.1/16.4s` — every
consecutive gap (3.8/4.4/3.9/4.3/3.6s wrapping) now exceeds the ~3s travel window, so at most one
comet is ever in flight (confirmed empirically: no sample across a full cycle showed two branches
both inside their travel window). The travel window itself is unchanged in absolute terms (still
~3s, matching the 2026-08-2x "STACKED reference" finding that a faster dash felt rushed) — only its
percentage of the keyframe moved from 30%/30.1% to 15%/15.1% to match the longer 20s duration
(`App.css`'s `.integrations-pulse-head`/`-tail` `animation-duration` and `@keyframes`). Delays stay
irregular on purpose (not evenly spaced) so the loop still doesn't read as a metronome — the fix is
the minimum-gap constraint, not uniform spacing. No test coupled to this (grepped for
`BRANCH_DELAYS`/`integrations-pulse`/`IntegrationsMap` across test files — none).

**Follow-up same day: a second, distinct bug in the same illustration** — every branch with a
nonzero `animation-delay` (four of five) showed a static lit stub right where its wire meets the
horizontal rail, for its ENTIRE delay period on every page load (reported via screenshot: "all four
still lit in the beginning... becomes fine after initially"). Root cause, confirmed by reading
`getComputedStyle(path).strokeDashoffset` during the pre-reveal/pre-delay window: neither
`.integrations-pulse-head path` nor `-tail path` declared a static `stroke-dashoffset`, so before an
animation's delay elapses (when the animation applies no value at all, fill-mode being the default
`none`), the property fell back to its true CSS-initial value of `0` — which happens to coincide
with the keyframes' 0% "just departing the tile" pose, not the parked/invisible one, so the delay
period rendered as a frozen, lit "about to depart" dot instead of nothing. Fixed by adding a static
`stroke-dashoffset: 150` (head) / `174` (tail) to those same rules — the exact park values the
keyframes already jump to at 15.1% — so the pre-delay fallback now renders the invisible park pose
instead of the lit departure one. Verified live: `getComputedStyle` on the four delayed branches
now reads `150px`/`174px` throughout their delay window (was `0px`/`24px`), and a fresh scroll-
triggered reveal shows no lit stubs on any branch until each one's own delay elapses.
