# Design decisions — full historical record (archived 2026-08-25)

This is the complete, unabridged decision log as it stood on 2026-08-25, before `DECISIONS.md` was
condensed to keep the active file readable. Every entry below is preserved verbatim — full
statistical tables, intermediate/superseded findings, and blow-by-blow instrumentation notes — for
audit trail. `DECISIONS.md` keeps a condensed version of each entry (decision + why + final result)
and points back here for detail; if the two ever disagree on a fact, this file is the primary
source since nothing here was rewritten, only summarized outward.

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
