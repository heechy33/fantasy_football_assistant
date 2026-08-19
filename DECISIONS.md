# Design decisions

Append-only log of durable product/engine/data decisions and the reasoning behind them, in
chronological order. **Do not rewrite past entries** — if a decision changes, add a new dated entry
that says so and links back to the one it supersedes. This is the record of *why*, not *what to do
next* (that's `PLAN.md`) and not *how the repo is organized* (that's `CLAUDE.md`).

---

## 2026-08-06 — Role-separated multi-source data stack

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
consensus — don't equal-weight it with Rotowire until source overlap is known (risk of double-
counting the same opinion). Keep projected production, expert rank, and market ADP in separate
fields. Retain every raw source row before deriving a consensus; never overwrite source data with a
blended value. A future independent second projection set should start as a simple position-specific
mean, promoted to a blend only after beating FantasyPros alone on defined accuracy/roster-value
metrics against past-season cutoffs and 2026 mocks.

**No-lost-player contract:** the draft board is built with unions and left joins, never an inner
join across sources. Candidate universe = active Sleeper players ∪ FantasyPros projections ∪
FantasyPros ECR ∪ Rotowire projections ∪ FFC ADP ∪ user imports. Players are removed only by a live
Sleeper pick or an explicit manual correction. Missing projection/ECR/ADP is `null` plus a visible
source-status flag — never zero, never "drafted." Coverage gate: artifact generation fails if any
top-200 PPR ECR/ADP player can't map to a Sleeper ID; the FFToday top-300 board needs ≥90%
projection coverage with every uncovered row emitted in a review report (99% is the long-term
multi-source target once licensed).

**Status as of this entry (carried in `PLAN.md` "What exists today"):** the implemented pipeline has
one performance-projection source, FFToday season-projection tables — not yet the FantasyPros API or
the Rotowire-via-Sleeper endpoint originally scoped here. FantasyPros API access has not been
pursued. This is a sequencing gap, not a reversal of the decision above.

**Access/provenance requirements:** every generated artifact/source record must declare `sourceId`,
role, upstream URL, terms/license URL, season/scoring, upstream update time, fetch time, schema
version, row count, content hash, source health, stale reason. Fetch FantasyPros only in the offline
pipeline via `FANTASYPROS_API_KEY`, never exposed client-side. FantasyPros' free API tier is
personal/non-production-prototype only and prohibits building a directly competing product — any
public deployment using FantasyPros data is blocked without explicit permission. `ffanalytics`'s GPL
code is implementation reference only, not permission to redistribute its scraped data.

---

## 2026-08-06 — Degraded-mode behavior when data is missing/stale

1. Projection + ADP available → full engine.
2. Projection available, usable ADP coverage <50% of roster universe → projected-value board with
   default-mix replacement demand, no board-wide availability claim.
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

- **Paid-service benchmark:** the relevant bar isn't "pages in a bundle" — it's league-specific
  scoring, live/manual pick tracking, personal cheat sheets, tiers/scarcity, team-construction and
  opponent-need awareness, availability/"can I wait" guidance, rapid clock-driven updates, manual
  correction, and transparent explanations. Do not claim "85% of the premium bundle" or "paid-service
  parity" before the Edge Validation Gate passes — feature resemblance isn't evidence of
  recommendation quality.
- **Custom scoring:** the correct claim is "exact for supported linear scoring categories;
  approximate/unsupported for threshold, range, and other nonlinear rules" (100-yard bonuses,
  once-per-game thresholds, DST point-allowed ranges, position overrides). `ffscrapr`'s `each`/`once`
  scoring distinction is useful implementation knowledge here.
- **Projection source:** single-source projection error is the highest engine-quality risk while
  only FFToday is implemented. The UI must surface source and data age. Do not use DynastyProcess's
  scraped FantasyPros ECR as a production feed, and do not blend FantasyPros+Rotowire until overlap
  and out-of-sample results justify it.
- **Availability model:** `P(available at next pick) = 1 − Φ((next_pick − adp) / stdev)` is a
  reasonable initial baseline built from FFC's `adp`/`stdev`/`high`/`low`/`times_drafted`, but it's
  only a model input and explanation signal — it ignores current-room roster needs, positional runs,
  and survival-to-date, and it must never be used as an unbounded score divisor. It needs calibration
  before being trusted (see S6 in `PLAN.md`).
- **Architecture:** the client-side pure-function engine remains correct (low latency, no cold
  start on the draft clock, deterministic tests, instant recompute). Auth/Cosmos/Azure Functions
  aren't required for the Sleeper hot path — Sleeper is unauthenticated/read-only and its documented
  guideline is to stay under 1,000 calls/minute (docs.sleeper.com).
- **Azure specifics:** Static Web Apps Free is 250 MB per environment (500 MB total across
  environments), 100 GB/month bandwidth. Node.js 22 is supported via `apiRuntime: node:22`. Managed
  Functions are HTTP-trigger only — scheduled refresh stays a GitHub Actions job. Cosmos free tier is
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
results — same data needed eventually, cadence differs (init once, poll every 2-3s targeted picks
only, weekly batch). Preserve `POSITION_MAP`, `PRO_TEAM_MAP`, the 401 alternate-endpoint retry, and
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
available and demotes confidence; if neither source exists, VONA is null and the planner doesn't
credit the player as a future option. `lookaheadValue`, rollout VONA, downside, and simulated
survival remain diagnostics/benchmark fields — they don't sort the production board.

**Why one-turn, not two-turn:** the zero-hole two-future-pick policy was rejected at a nine-draft
regret-ceiling prescreen — one-horizon mean regret was already below the predeclared 0.5
utility-point absolute-improvement gate, so even a perfect two-pick policy couldn't have qualified.
Production stays at one deterministic future pick; the second-pick boundary remains available to a
future analysis harness if revisited.

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

**Naming:** the product name is "Draft Score," not "3D Value" — FFToday supplies one point estimate
per player, not a floor/ceiling/consensus distribution, so a third projection axis would be
fabricated. Value/Edge/Risk are the three axes actually supported by data on hand.

**It does not become the primary sort.** `planValue` (2026-08-10 entry above) remains the
production ranking objective, including the survival → ADP → planValue → id within-band near-tie
order. Draft Score enters only as a residual tie-break at the third comparator position, strictly
after survival and ADP — a scarcer/less-likely-to-survive player still outranks a prettier
composite. Promotion to full primary sort requires a written decision after the Edge Validation
Gate's benchmark harness reports paired regret/agreement numbers for the current policy versus the
residual-breaker policy.

**Edge excludes VONA/`tierUrgency`** — both are already timing signals folded into `planValue`;
adding them to Edge would double-count scarcity and fight the validated near-tie order. **Risk
excludes engine `confidence`** — that's data-quality (scoring severity, ADP sample size, K/DEF
disposition), not player-medical risk; K/DEF rows are always `confidence: 'low'`, so folding it into
Risk would silently discount every special-teams card. **Missing data resolves to unknown, never to
safe** — a player with no `player-usage.json` row (most rookies) gets the league-median observed
durability score (pipeline-measured; `context.risk_defaults_report`/`manifest.riskDefaults`), not
zero, and the card renders visibly hatched, never a green low-risk state built from an absent
signal.

**2026-08-11 A/B result** (`benchmarks/reports/2026-08-11-draft-score-tie-break-ab.md`): ran the
9-recorded-draft availability/VONA harness with the residual breaker enabled and disabled. Sections
A and B reproduced exactly (neither reads `draftScore`). Section C's regret/top-choice-agreement
numbers were also identical — on this sample, no near-tie band containing the eventual top choice
was also tied on survival and ADP, so the breaker never fired at rank 1. This is not evidence for or
against promoting to full primary sort; that remains a separate future decision.

**Implementation note:** the full FIFA-card/`draftScore.ts`/`HeroRecommendation` rebuild scoped in
`archive/cursor-plans/DRAFT_SCORE_WAR_ROOM_REVISED_PLAN.md` did not ship as written — only the
simpler formula above (living directly in `recommend.ts`) and the Phase 1 data contracts
(`weekly-ppr.json`, the local-only FantasyPros stars parser) landed. Treat that archived plan as
historical context, not a current spec.

---

## 2026-08-14 — Authorized exception: ESPN draft-day project ahead of the Edge Validation Gate

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

**Status:** the August 15, 2026 ESPN draft has completed. This exception is now closed — see
`PLAN.md`'s "Status and decision" for current active scope. Any further ESPN work (in-season
features, a second draft, hardening beyond draft-day scope) needs its own decision, not a
continuation of this one.

---

## Handoff note for future agents

When you make a decision that should outlive the current task — a rejected approach, a formula
change, a data-source or provider tradeoff, a scope exception — add a new dated entry here rather
than editing `PLAN.md` in place. `PLAN.md` should only ever describe *current* status and near-term
sequencing; this file is where the reasoning trail lives.
