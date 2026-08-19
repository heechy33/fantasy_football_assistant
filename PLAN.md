# Fantasy Football Co-Pilot — Sleeper-First Build Plan

This file is the **current status and forward-looking sequencing plan** only. Durable design
decisions and their reasoning live in `DECISIONS.md`. Completed-phase build detail and historical
implementation notes live in `archive/PLAN-history.md`. Repo conventions/commands live in
`CLAUDE.md`.

## Status and decision

**Plan last revised:** August 18, 2026
**Active objective:** prove that the recommendation engine creates a measurable drafting edge in
**PPR redraft snake drafts on Sleeper** before expanding the product.

**Progress:** Gate 0, S0, S1, S2, Phase 1 player context, and the Stage C VONA rollout integration
are implemented and locally verified — see `archive/PLAN-history.md` for the phase-by-phase build
record and measured results. Stage C currently runs on the main thread under the existing budgeted
mode; the Web Worker and calibration work remain open S3/S6 items.

The **ESPN draft-day exception** (see `DECISIONS.md`'s 2026-08-14 entry) is closed — that August 15
draft has completed. Active work is Sleeper-first again; the two remaining leagues' drafts continue
under this plan.

The long-term product is still a season-long assistant for Sleeper, ESPN, and Yahoo:

1. Live draft assistant
2. Post-draft grades
3. Weekly lineup/start-sit optimizer
4. Waiver assistant
5. Trade analyzer

Those features and providers have **not been deleted**. They are preserved in the roadmap below,
but they are no longer allowed to compete with the first goal: ship and validate an excellent
Sleeper draft assistant.

### Current product promise

For the first release, the product promise is deliberately narrow:

> During a Sleeper PPR redraft snake draft, track the board live and recommend the pick most likely
> to improve the user's finished roster, with an understandable explanation and an honest measure
> of uncertainty.

The first release targets standard offensive-player, **one-QB PPR redraft** leagues. The data model
must represent reception scoring and QB format independently so PPR superflex/two-QB can be added
without another schema rewrite, but those formats are not part of the first edge gate. Auction,
IDP, dynasty, and full keeper support are roadmap items.

### Expansion rule

Do not begin Yahoo, ESPN, multi-user credential storage, or the in-season feature track merely
because the Sleeper UI appears complete. Expansion starts only when the **Edge Validation Gate** in
this document passes, or when the user explicitly changes the priority. See `DECISIONS.md` for the
one-time, now-closed exception granted for the August 15, 2026 ESPN draft.

---

## What exists today

This is a working live-draft assistant for one narrow case (Sleeper PPR one-QB snake), not a
scaffold. See `archive/PLAN-history.md` for the phase-by-phase build record and measured results.

### Implemented

- Sleeper connection, league/draft init, 2-3s poll with backoff/stale display, and manual
  mode with undo/correction (S1)
- Deterministic PPR engine: linear scoring with diagnostics, slot-aware lineup optimizer (exact
  bitmask-DP solver, handles FLEX correctly), MRV, draining-pool replacement/VOR, leader-anchored
  tiers, survival-conditioned availability, and a ranked recommendation board with explanations
  (S2, `frontend/src/engine/`)
- `DraftWorkspace` wired into the live-Sleeper session with deterministic S2 and Stage C lookahead
  recommendations (manual-mode recommendation UI remains an S4 gap)
- Seeded Stage C opponent-pick rollouts with VONA, lookahead value, survival, downside, caching, and
  deterministic S2 fallback; the rollout pool follows the global-leaders plus positive-MRV
  positional-extension contract in `archive/PLAN-history.md`'s S3 entry
- FFToday-sourced season projections via the offline Python pipeline (`pipeline/fftoday.py`),
  normalized into `SeasonProjection`, behind the `SeasonProjectionProvider` boundary
- Draft Score (`recommend.ts`) as a residual near-tie breaker and card-display composite — see
  `DECISIONS.md`'s 2026-08-11 entry; it is not the primary sort
- Weekly PPR history artifact (`data/weekly-ppr.json`) and a local-only FantasyPros stars/context
  decoration pipeline (display-only, never an engine input)
- ESPN draft-day path (manual takeover, reconnaissance Chrome extension, draft-only
  `DraftProviderAdapter`) used for the completed August 15, 2026 private-league draft — draft-day
  scope only, per the now-closed exception in `DECISIONS.md`
- Azure Static Web Apps deploy with staged `data/`, `staticwebapp.config.json`, and artifact
  verification (`npm run verify:artifact`); Node 22 Azure Functions scaffold with a health endpoint
- Python pipeline for Sleeper players, FFToday projections, FFC ADP, and the DynastyProcess
  player-ID crosswalk, with a top-300 coverage gate
- Fail-open nflverse player context: prior-season snap/target/carry shares, three-season
  availability history, specific recurring-injury episodes, current Sleeper depth/injury/practice
  metadata, separate source provenance, durability score (display-only, not injury probability),
  opportunity evolution/profile context, and a non-predictive recommendation-card details modal
- Azure Static Web Apps and Cosmos DB Bicep scaffold (roadmap, unprovisioned)

### Not implemented

- Web Worker execution for Stage C (deferred, not currently required by measured cost — see S3 in
  `archive/PLAN-history.md`), two-turn rollouts, empirical opponent-model calibration, and real
  clock testing against a live mock (S3/S5/S6)
- Draft-experience polish: filters/search, tier-cliff visualization, manual pin/avoid, data
  freshness panel (S4)
- Reliability/clock testing under real conditions, edge validation against baselines (S5-S6)
- Provider adapters beyond Sleeper and the ESPN draft-day-only path, Cosmos DB, SWA auth (roadmap,
  gated by the Edge Validation Gate)
- Real recorded Sleeper mock-draft fixtures — `fixtures/sleeper/` is still hand-authored
- The official FantasyPros projection/ECR API integration scoped in `DECISIONS.md`'s 2026-08-06
  entry — FFToday remains the sole performance-projection source

---

## Gate 0 — blocking fixes (complete)

All P0.1-P0.6 items are resolved. Full detail, exit criteria, and what's actually implemented versus
originally scoped (notably P0.5's FantasyPros API gap) are in `archive/PLAN-history.md`'s S0 entry.
Do not move into new recommendation-engine features while any P0 item would be reopened by a change
you're making — re-read that entry before touching scoring, league format, or data provenance.

---

## Recommendation engine

### Design principles

1. All engine modules are pure functions of settings, draft state, and versioned data.
2. Provider-specific data is normalized before it reaches the engine.
3. The engine optimizes roster outcomes, not a hand-tuned multiplication of unrelated signals.
4. Availability and uncertainty are modeled and explained, not presented as certainty.
5. Recommendations remain useful if simulation is slow or unavailable.

Do **not** implement the old `VOR × need × (1/tier_gap) / P_available` formula — see `DECISIONS.md`'s
2026-08-08 entry for why it's rejected.

### 1. Scoring

```text
projected_points(player) = Σ projected_stat[k] × league_scoring[k]
```

Unknown scoring keys must be surfaced in diagnostics. "Unknown means zero" may be the computational
fallback, but it must not silently support an "exact scoring" claim.

### 2. Eligibility and slot-aware marginal roster value

```text
MRV(player, roster) =
  optimized_projected_starter_value(roster + player)
  − optimized_projected_starter_value(roster)
```

Implemented objective: `rosterUtility = optimizedStarterValue + maximumWeightDepthMatching`. Bench
QB/RB/WR/TE players are matched one-to-one to occupied eligible core slots. Edge value is production
over positional replacement multiplied by the incumbent's expected unavailable fraction. FLEX uses
the starter solver's eligibility rules; starter upgrades remain on the starter path and cannot also
receive a depth edge.

### 3. Replacement and VOR

Replacement derives from league size, roster slots, FLEX competition, and the available/drafted
player pool — not a fixed `teams × (named starters + arbitrary flex share)`. See
`archive/PLAN-history.md`'s S2 entry for the implemented draining-pool rule.

### 4. Tiers

Build positional tiers from meaningful drops in projected points or MRV/VOR. Store the raw gap and
a bounded normalized urgency; never invert the gap accidentally.

### 5. Availability

Provide an estimated probability the player reaches the user's next pick, expected draft range,
source/sample size, and a low-confidence flag for sparse/noisy ADP. Recondition after every pick.
The initial normal-CDF model (see `DECISIONS.md`'s 2026-08-08 entry) is acceptable only until an
empirical/calibrated model proves better (S6).

### 6. VONA and the production ranking formula

The production ranking formula (`planValue`/`VONA`) is recorded in `DECISIONS.md`'s 2026-08-10
entry — this section only states the design constraint: do not hard-code that every opponent blindly
follows ADP. `opponentModel.ts` starts with a simple documented model, to be calibrated against
recorded Sleeper mocks/drafts (S6).

### 7. Candidate evaluation

For each reasonable candidate at the current pick: force it onto the user's roster, run opponent
scenarios until the user's next pick, optimize the likely follow-up, compare expected finished-roster
value and downside. Seed simulations for reproducibility, reuse the same scenarios for candidate
comparisons, cache results until draft state changes (all implemented — `rng.ts`,
`recommend.ts`'s caches). The engine must have a fast fallback board based on MRV + VOR + bounded
tier/availability context so the UI never freezes under the draft clock.

### 8. Recommendation output

Return a shortlist, not a false single-player certainty. The shipped `Recommendation`
(`recommend.ts`) carries `planValue`, `marginalRosterUtility`, `vona`/`vonaSource`, `tier`,
availability range/sample size, `confidence`, `reasons`/`warnings`, plus Draft Score fields
(`draftScore`, `scoreValue`/`scoreEdge`/`scoreRisk`, coverage flags, `pickAction`) — see
`DECISIONS.md`'s 2026-08-10 and 2026-08-11 entries for what each field means and how it's ordered.

Example rationale:

> Take RB X: he adds 24 projected points to your optimal starters, has a 68% chance of being gone
> by your next turn, and the next RB tier is 13 points lower. WR Y is the best alternative and is
> more likely to survive.

Runs and byes remain context/warnings. Bye overlap is a late tie-breaker, not a strong early-round
penalty.

### 9. Outcome distributions — after the deterministic engine works

Use `ffsimulator` (see `DECISIONS.md`'s 2026-08-08 entry) as the reference for mapping historical
positional rank to weekly outcome distributions, games played, replacement players, and optimized
lineups. Do not block the first live Sleeper board on a full season simulator — add distributions in
a measured step and prove they improve historical results.

---

## Active execution plan — Sleeper edge track

Time estimates are planning aids, not permission to skip exit criteria. S0-S3 are complete — see
`archive/PLAN-history.md` for their full build record, exit criteria, and measured results.

### S4 — Draft experience and explanations (2 days)

Build:

- Available-player board with filters/search
- My roster and open-slot state
- Top-three recommendation panel
- Tier cliffs, availability, value vs ADP, runs, byes, injuries, and confidence
- Data freshness/source panel
- Manual pin/avoid/custom-rank override

Exit criteria:

- Every recommendation explains immediate roster value and waiting risk.
- Low-confidence/stale data cannot appear as high-confidence advice.
- A user can complete a full mock without opening developer tools.

### S5 — Reliability and clock testing (1-2 days)

Exit criteria:

- Pick landing upstream → updated recommendation in under three seconds under normal conditions.
- Poll backoff, reconnect, stale data, duplicate picks, unknown players, tab suspension, and draft
  completion are tested.
- Production deploy passes artifact/data/config smoke checks.
- At least three full Sleeper mocks complete without board corruption.

### S6 — Edge validation (2-4 days initially, then ongoing)

The UI being polished is not proof of an edge. Run the validation program below and record results
in a versioned report/artifact. Expansion is permitted only after the user reviews the results and
accepts the gate.

---

## Edge Validation Gate

### Baselines

Compare the engine against at least:

1. Best available by FFC ADP
2. Best available by raw projected PPR points
3. Static VOR without availability/lookahead
4. Corrected MRV + tiers without simulation

### Evaluation layers

#### A. Historical out-of-sample draft strategy

Use historical preseason rankings/ADP available before each season and actual weekly outcomes from
later in that season. Do not allow future information into the draft decision.

Measure: optimized weekly starter points, replacement-adjusted points, simulated head-to-head
wins/playoff rate across schedules, downside/roster fragility.

Start with recent seasons for which reliable preseason inputs can be reconstructed. `ffsimulator`,
DynastyProcess rank history, and nflverse weekly data are the starting references.

#### B. Availability calibration

On recorded drafts/mocks, measure Brier score for "available at next pick" predictions, calibration
buckets (predicted 70% should occur roughly 70%), and error by round and position. If the normal-CDF
model is poorly calibrated, replace or correct it before marketing the feature.

#### C. 2026 live mock validation

Mocks validate synchronization, latency, robustness, and whether recommendations make contextual
sense. They do **not** by themselves prove real-season performance. Record each state and
recommendation so failures can become fixtures.

#### D. Projection accuracy tracking

During the 2026 season, retain each dated projection snapshot and compare it with actuals by
position. Track MAE, bias, rank correlation, and calibration of ranges once distributions exist.

### Passing criteria

The initial gate passes when:

- Sync/recommendation latency is under three seconds.
- Availability predictions are demonstrably calibrated or explicitly labeled experimental.
- The rollout engine beats or ties the static-VOR baseline across the selected out-of-sample test
  set without a material increase in downside.
- No improvement depends only on evaluation assumptions copied from the same projection inputs.
- Recommendation explanations accurately describe the engine's real inputs.
- The user reviews the evidence and authorizes roadmap expansion.

If the engine does not beat the baseline, improve/calibrate it; do not hide the result by adding
providers or in-season features.

---

## Roadmap after the Sleeper edge gate

Everything below is preserved scope, not abandoned work.

### Roadmap A — Provider expansion

#### A1. Universal manual mode hardening

Manual draft tracking is the immediate fallback for ESPN, Yahoo, offline drafts, and provider
outages. Add import/export, custom draft order, keepers, and traded picks before taking on risky
credential work.

#### A2. Yahoo adapter and OAuth

See `CLAUDE.md`'s "Provider-specific gotchas" for the preserved Yahoo findings (OAuth2 scope,
`?format=json`, token lifetime/rotation, callback requirements, the untested live `draftresults`
question).

Exit criteria: Yahoo mock draft tracked live; token rotation/revocation/reconnect paths tested; the
live `draftresults` question answered with a recorded fixture.

Reference: https://developer.yahoo.com/oauth2/guide/flows_authcode/

#### A3. ESPN in-season adapter (beyond the completed draft-day exception)

The August 15, 2026 draft-day project (`DECISIONS.md`'s 2026-08-14 entry) covered draft-day
synchronization only, under an explicit gate exception that is now closed. Opening the in-season
ESPN feature track (weekly rosters, free agents, etc.) is a new decision, not a continuation, and
still requires either passing the Edge Validation Gate or a fresh explicit priority change.

See `CLAUDE.md`'s "Provider-specific gotchas" for the preserved ESPN findings (no supported public
API, `mDraftDetail` observation, `SWID`/`espn_s2` cookie requirements, no programmatic login, the
extension-first decision, `HttpOnly` cookie caveat). Port the relevant `espn-api`/`ffscrapr` maps and
fixture knowledge into TypeScript behind the provider adapter when this reopens. The poll method
must remain exactly one targeted upstream read.

### Roadmap B — Draft formats and premium-depth features

- PPR superflex/two-QB, using the already-corrected independent format dimensions
- Half-PPR and standard scoring
- Keepers, custom/traded draft orders, third-round reversal
- Auction/salary-cap values and inflation — a separate engine, not a flag on snake logic
- Dynasty/rookie and IDP only after new data/valuation models are defined
- Custom CSV projection/ranking import and source weighting
- League-mate draft tendencies from past drafts
- Mock draft simulator for reproducible strategy testing and user practice

### Roadmap C — Post-draft and in-season product

#### C1. Post-draft grades

Do not grade by summing full VOR over every roster spot. Grade via optimized starters, discounted
bench/replacement value, roster fragility, and—once validated—season outcome simulations. Outputs:
projected starter strength and depth, best value/reach relative to market, positional/tier
construction, simulated range of finish (clearly labeled).

#### C2. Weekly data layer

Add scheduled pipeline artifacts: weekly projections, weekly actual stats, NFL opponents/schedule,
injury/practice status, trending adds/drops, defense vs position/matchup features, rest-of-season
snapshots with provenance. GitHub Actions remains the scheduler because managed SWA Functions are
HTTP-only.

#### C3. Lineup/start-sit optimizer

Reuse the slot optimizer introduced for draft MRV. Optimize the legal lineup under FLEX/SUPER_FLEX,
then show alternatives and point deltas. Add matchup context only after proving it improves weekly
accuracy.

#### C4. Waiver assistant

Inputs: provider free agents, weekly and rest-of-season projections, the user's current roster and
replacement options, Sleeper trending adds/drops, recent actual opportunity/production. Outputs:
ranked adds and corresponding drops, starter/depth impact, calibrated FAAB range (not an unexplained
single bid), breakout signal with source/confidence.

#### C5. Trade analyzer

Use rest-of-season outcome distributions, optimized weekly starters, replacement effects, roster
depth, and playoff weeks. A point-estimate VOR sum is only a baseline. Outputs: impact on both teams,
expected points/wins and downside, positional and bye/playoff effects, explicit assumptions.

#### C6. Season accuracy and hardening

Retain dated recommendations and projections. Measure projection and recommendation error honestly.
Add provider health, manual recovery, and source fallbacks. Recalibrate waiver/trade/lineup models
from actual outcomes.

---

## Long-term provider/API architecture

After roadmap expansion, restore the broader architecture behind the same pure engine:

```text
Frontend / client-side engine
        │
        ├── static versioned data from CDN
        │
        └── normalized ProviderAdapter
                 ├── Sleeper
                 ├── Yahoo OAuth
                 └── ESPN extension/API bridge

Managed HTTP Functions
  leagues · init · picks · rosters · free-agents · OAuth callbacks

Cosmos DB free tier
  per-user preferences and sealed provider credentials only where unavoidable

GitHub Actions
  scheduled projection/stat/trending refresh
```

The init/poll split remains load-bearing (see `CLAUDE.md`'s "Core conventions"): `init()` may fetch
settings, roster slots, teams, and identity data; `picks()` is the live hot path and must be one
targeted request with minimal transformation; engine computation stays client-side and
provider-independent.

### Credential safety

- Sleeper requires no credential.
- Yahoo refresh tokens must be encrypted, rotated atomically, and revocable.
- Avoid storing ESPN session cookies when an extension can operate in the user's session.
- AES-GCM in Cosmos protects a database-only leak but does not protect against an application plus
  key compromise. Do not describe it as complete credential security.

---

## Product-wide risks

| Risk | Mitigation |
|---|---|
| One implemented undocumented projection source | P0.5 official-consensus adapter, raw-source retention, versioned snapshots, health checks, visible source age, degraded modes, user import |
| Projection quality creates a ceiling on engine quality | Historical out-of-sample tests and ongoing 2026 accuracy tracking |
| ADP availability model is miscalibrated | Brier/calibration tests; bounded use; empirical replacement |
| Simulation creates false precision | Seeded reproducibility, confidence labels, comparison with simple baselines, explanations |
| Crosswalk gaps, especially rookies | Coverage gate, name/position/team fallback, visible unmatched picks, manual correction |
| Sleeper endpoint/schema changes | Recorded fixtures, runtime schema checks, cached committed snapshot |
| Draft clock latency | Direct Sleeper polling, Web Worker, cached rollouts, deterministic fallback board |
| Scope expands before the engine is proven | Edge gate controls roadmap entry |
| Projection/data redistribution terms | Provenance registry, attribution, terms review, user import fallback |
| SWA configuration/data missing from build | Artifact assertions and deployed smoke test in S0 |
| No tests despite green test command | Remove pass-with-no-tests behavior and require fixtures in S0 |
| ESPN fragility/security | Extension-first, manual fallback, no programmatic login, avoid cookie storage |
| Yahoo draft/live-token uncertainty | Test risky assumptions first and preserve recorded fixtures |
| Accidental Azure cost | Free SKUs, Cosmos 1,000 RU/s cap, explicit review before paid resources |

---

## Cost target

The target remains **$0/month**: Azure Static Web Apps Free, managed HTTP Functions included with
SWA, GitHub Actions within the repository's free allowance, Cosmos free tier only when the roadmap
needs persistence. The active Sleeper track does not require Cosmos or provider credential storage.
Any change that introduces a paid resource must be explicitly called out and approved.

---

## Handoff rules for future agents

1. This file is the source of truth for *current* sequencing only. `DECISIONS.md` holds the
   reasoning trail; `archive/PLAN-history.md` holds completed-phase detail; `CLAUDE.md` holds repo
   conventions/commands. Sleeper edge work is active; other providers and in-season features are
   roadmap work.
2. Gate 0 is complete; do not reopen a P0 item without recording why in `DECISIONS.md`.
3. Do not reintroduce the old multiplicative recommendation formula (`DECISIONS.md`, 2026-08-08).
4. Do not claim paid-service parity or a drafting edge without the validation evidence specified
   here.
5. Preserve provider research and scaffolding even while it is inactive.
6. Port implementation knowledge from `espn-api`, `ffscrapr`, and `ffsimulator`; do not add Python/R
   services to the live draft path merely because the reference projects use those languages.
7. Keep provider normalization at the adapter boundary and the engine pure.
8. Never silently drop unmatched picks, unknown scoring keys, missing sources, or stale data.
9. Record real mock failures as sanitized fixtures.
10. When a roadmap phase begins, update this plan with current status, and record the decision that
    opened the gate in `DECISIONS.md`.
11. When you make a decision that should outlive the current task, add a dated entry to
    `DECISIONS.md` instead of writing it inline here. When a phase completes, move its detailed build
    record to `archive/PLAN-history.md` and leave only a status pointer here.
