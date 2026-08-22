# Design decisions

Append-only log of durable product/engine/data decisions and the reasoning behind them, in
chronological order. **Do not rewrite past entries** â€” if a decision changes, add a new dated entry
that says so and links back to the one it supersedes. This is the record of *why*, not *what to do
next* (that's `PLAN.md`) and not *how the repo is organized* (that's `CLAUDE.md`).

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

## Handoff note for future agents

When you make a decision that should outlive the current task â€” a rejected approach, a formula
change, a data-source or provider tradeoff, a scope exception â€” add a new dated entry here rather
than editing `PLAN.md` in place. `PLAN.md` should only ever describe *current* status and near-term
sequencing; this file is where the reasoning trail lives.
