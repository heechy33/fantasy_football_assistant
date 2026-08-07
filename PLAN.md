# Fantasy Football Co-Pilot — Sleeper-First Build Plan

## Status and decision

**Plan revised:** August 6, 2026
**Active objective:** prove that the recommendation engine creates a measurable drafting edge in
**PPR redraft snake drafts on Sleeper** before expanding the product.

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
this document passes, or when the user explicitly changes the priority.

---

## What exists today

The repository is a healthy scaffold, not yet a working draft assistant.

### Implemented

- React/Vite/TypeScript frontend scaffold
- Node 22 Azure Functions scaffold with a health endpoint
- Shared frontend/API type declarations
- Azure Static Web Apps and Cosmos DB Bicep scaffold
- GitHub Actions deployment and daily data-refresh workflows
- Python pipeline for Sleeper players/projections, Fantasy Football Calculator ADP, and the
  DynastyProcess player-ID crosswalk
- Generated 2026 data committed under `data/`

### Verified locally on August 6, 2026

- `npm run typecheck` passes
- `npm run build` passes
- `npm test` exits successfully, but **there are no test files yet**; this is not meaningful test
  coverage
- Generated artifacts contain:
  - 4,383 normalized player records
  - 3,299 season-projection records
  - 633 records with positive PPR projected points
  - 249 PPR ADP records
  - 100% player-ID match coverage in the top-300 gate

### Not implemented

- Draft board and recommendation UI
- Any engine modules
- Sleeper live-draft integration
- Provider adapters
- Manual draft tracking/correction
- Engine, adapter, or UI tests
- Edge backtesting or availability calibration

The current frontend accurately describes itself as a scaffold. Future agents must not infer that a
green build means any draft functionality exists.

---

## Blocking fixes — complete before the feature plan

These are **Gate 0**. Do not move into recommendation features while any P0 item is unresolved.

### P0.1 — Complete and verify Static Web Apps packaging

The original audit build output only `index.html` and JavaScript assets; it omitted both
`staticwebapp.config.json` and `data/*.json`.

During this plan revision, the workspace also contains a separate uncommitted move of
`staticwebapp.config.json` from the repository root to `frontend/public/`. That is the correct Vite
source location because Vite copies `public/` into `dist/`. A production rebuild verified that the
configuration now reaches `frontend/dist/staticwebapp.config.json`. Preserve and review that move
rather than creating a duplicate root configuration. The same rebuild verified that
`frontend/dist/data/manifest.json` is still absent, so generated data still needs an explicit
staging step.

Required fix:

1. Keep `frontend/public/staticwebapp.config.json` as the single configuration source and verify it
   becomes `frontend/dist/staticwebapp.config.json` on every production build.
2. Add one deterministic frontend staging/build step that copies generated root `data/` to
   `frontend/dist/data/` (or stages it under `frontend/public/data/` before Vite builds).
3. Avoid committed duplicate data copies; root `data/` remains the generated source of truth.
4. Add a CI assertion that the production artifact contains:
   - `dist/staticwebapp.config.json`
   - `dist/data/manifest.json`
   - `dist/data/players.json`
   - `dist/data/projections-season.json`
   - `dist/data/adp-ppr.json`
5. Smoke-test `/data/manifest.json`, SPA fallback, and `/api/health` after deployment.

Reference: https://learn.microsoft.com/en-us/azure/static-web-apps/configuration

### P0.2 — Correct the league-format model

The current `scoringFormat: 'standard' | 'half-ppr' | 'ppr' | '2qb'` incorrectly treats PPR and
two-QB as mutually exclusive. Replace it with independent dimensions, for example:

```ts
interface LeagueFormat {
  reception: 'standard' | 'half-ppr' | 'ppr' | 'custom';
  qb: 'one-qb' | 'two-qb' | 'superflex';
  draft: 'snake' | 'linear' | 'auction';
}
```

The original raw scoring map and roster slots remain authoritative. The format fields select ADP
and UI defaults; they must never replace the actual league rules.

### P0.3 — Replace the old recommendation formula

Do not implement the former formula:

```text
VOR × need × (1 / tier_gap) / P_available
```

It has two known defects:

- `1 / tier_gap` reverses tier urgency. A larger cliff should increase urgency, not reduce it.
- Dividing by `P_available` is unbounded. A 1% survival estimate creates a 100× multiplier and can
  overwhelm player quality and roster construction.

The corrected engine is specified in **Recommendation engine** below.

### P0.4 — Establish real tests and fixtures

Before recommendation logic lands:

- Add recorded Sleeper league/draft/picks fixtures.
- Add small committed scoring, projections, ADP, and partial-draft fixtures.
- Make `npm test` fail if no test files are found; remove `--passWithNoTests` once the first tests
  exist.
- Add data-invariant tests: unique player IDs, monotonic picks, no duplicate drafted players,
  finite projected scores, and source freshness.

### P0.5 — Lock the draft-data strategy, provenance, and top-player coverage

**Decision (2026-08-06):** use a role-separated, multi-source stack for the private Sleeper PPR
edge test. FantasyPros' official preseason consensus projections are the primary performance
forecast; the Rotowire-derived Sleeper projection is a separately measured challenger and
last-known-good fallback. FantasyPros PPR ECR is a rank/tier and coverage guard. FFC PPR ADP is the
market-availability distribution. Sleeper draft picks are the only authority for who is actually
available. nflverse supplies historical results for validation.

This replaces the previous idea of using DynastyProcess `db_fpecr` as the live ECR feed. Use the
official FantasyPros API for current projections/ECR when access is approved; retain DynastyProcess
for the player-ID crosswalk and historical research only.

| Data role | Selected source | Engine use | Decision/constraint |
|---|---|---|---|
| Live draft truth and Sleeper identity | Documented Sleeper API | League settings, player pool, picks, drafted/undrafted state | A ranking or projection source can never mark a player drafted |
| Primary performance forecast | Official FantasyPros API preseason consensus projections | Component stats scored with league rules; `points_ppr` as a validation check | Private/non-production edge test only under approved API access |
| Projection challenger/fallback | Rotowire-derived projection exposed by Sleeper | Separate board, disagreement, coverage fallback, last-known-good board | Endpoint is undocumented; do not assume redistribution rights |
| Consensus rank/tier guard | Official FantasyPros PPR ECR | Candidate-union coverage, tier comparison, disagreement warning | Never convert rank into fake points or double-count it in MRV |
| Market availability | FFC 12-team PPR ADP distribution | `adp`, `stdev`, `high`, `low`, `times_drafted`; survival calibration | Not a performance projection; cache daily and attribute FFC |
| Historical outcomes | nflverse weekly/season player stats | Score reconstruction and out-of-sample source/engine evaluation | Attribute nflverse and preserve season cutoffs |
| ID fallback | DynastyProcess `db_playerids` | Sleeper/FantasyPros/other ID matching | Preserve GPL-3.0 notices and source metadata |
| User override | Imported projection/ranking CSV | Private alternative, manual corrections, future licensed-source path | Must use the same normalized source interface |

#### Why this is the default

Fantasy Football Analytics' 2014–2025 evaluation found that aggregation was more stable than any
single source: its simple average beat individual projections in 69% of head-to-head comparisons,
and FantasyPros had the most top-three finishes. It also found that a simple average slightly beat
historically weighted averaging overall. FantasyPros now exposes official consensus rankings and
component projections through a documented API. That makes the official consensus feed a better
accuracy candidate for this private test than promoting one undocumented single-source projection
or adding more scrapers.

References:

- https://fantasyfootballanalytics.net/which-projections-are-most-accurate
- https://github.com/FantasyFootballAnalytics/ffanalytics
- https://www.fantasypros.com/api-data/
- https://api.fantasypros.com/public/v2/docs/
- https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API
- https://help.fantasyfootballcalculator.com/article/42-adp-rest-api
- https://nflreadpy.nflverse.com/api/load_functions/

#### Combining-source policy

Multiple data is better only when it adds a distinct signal and survives out-of-sample testing.
Do **not** average every available number:

- FantasyPros is already a projection consensus. Do not equal-weight it with Rotowire until source
  overlap is known; that could count the same opinion twice.
- Keep projected production, expert rank, and market ADP in separate fields. The engine uses
  projected stats for league-scored value, ECR for coverage/tier disagreement, and ADP for
  availability/lookahead.
- Retain every raw source row and its score before deriving a consensus. Never overwrite source data
  with a blended value.
- If a genuinely independent second component-projection set is added later, start with a simple
  position-specific mean (plus median/robust-average experiment), not hand-tuned weights. Promote a
  blend only when past-season cutoffs and 2026 mocks beat FantasyPros consensus alone on defined
  accuracy and roster-value metrics.
- A source disagreement increases uncertainty; it does not justify hiding a player or silently
  changing the recommendation.

#### No-lost-player contract

The draft board must be built with unions and left joins, never an inner join across sources:

1. Candidate universe = active Sleeper draftable players **union** FantasyPros projections **union**
   FantasyPros PPR ECR **union** Rotowire projections **union** FFC PPR ADP **union** user imports.
2. Remove players only from live Sleeper picks or an explicit manual correction.
3. Missing projection, ECR, or ADP is `null` plus a visible source-status flag, never zero and never
   “drafted.”
4. Each recommendation pass must evaluate the union of the top 30 engine values, top 20 undrafted
   ECR players, top 20 undrafted ADP players, all players in the current positional tier, and any
   user-pinned player.
5. Artifact generation fails if any top-200 PPR ECR or top-200 PPR ADP player cannot map to a
   Sleeper ID. The top-300 union must have at least 99% projection coverage, and every uncovered row
   must be emitted in a review report.
6. If the primary projection is missing for a covered player, use Rotowire only as a labeled
   fallback and lower confidence. A high-ECR/ADP player with no projection remains visible in an
   `unscoredNeedsReview` list.

#### Provenance, freshness, and access requirements

Every generated artifact and source record must declare `sourceId`, source role, upstream URL,
terms/license URL, season/scoring, upstream update time when available, fetch time, schema version,
row count, content hash, source health, and stale reason. The UI shows the active projection source,
fallback status, and age.

- Fetch FantasyPros only in the offline pipeline using `FANTASYPROS_API_KEY`; never expose the key in
  Vite, the browser bundle, fixtures, logs, or generated artifacts.
- Require a successful draft-day refresh or an explicit last-known-good snapshot with a visible age
  warning. Never switch sources silently during a live draft.
- FFC documents free personal/commercial API use, requests attribution, and updates once daily; cache
  it rather than polling it live.
- FantasyPros free API access is for personal, non-commercial, non-production prototypes. Personal
  production requires Premium access; paid apps, redistribution, high-volume use, or revenue require
  a commercial agreement. Its current guidance also prohibits building a directly competing
  product. Describe this assistant accurately in the access request and treat any public deployment
  containing FantasyPros data as blocked without explicit applicable permission.
- The open-source `ffanalytics` code is implementation knowledge for normalized source adapters,
  robust/simple averages, uncertainty, and scoring. Its GPL code license does not grant permission
  to redistribute data scraped from its upstream sites; do not make its scrapers a production feed.
- Confirm terms for the undocumented Rotowire-derived Sleeper projection before public use. Preserve
  Sleeper attribution where required, DynastyProcess GPL-3.0 notices, nflverse attribution, and
  source-specific notices in the app.

#### P0.5 blocking fixes and exit criteria

Do not begin the next engine phase until all of these are complete:

- Obtain/approve the FantasyPros API access intended for the private prototype, or record the source
  as blocked and keep Rotowire as the explicitly labeled temporary primary.
- Add normalized multi-projection and ECR source interfaces; store raw source values independently.
- Add FantasyPros projection/ECR pipeline adapters, recorded fixtures, schema validation, secret
  handling, last-known-good behavior, and provenance fields.
- Implement the no-lost-player union, matching report, hard coverage gates, null handling, fallback
  labels, and tests for a high-ECR player missing from every other source.
- Generate a source-comparison artifact showing FantasyPros-versus-Rotowire ranks, PPR points,
  positional differences, missing players, and disagreement. Do not create an unvalidated blend.
- Add FFC, FantasyPros, Sleeper, DynastyProcess, nflverse, and user-import attribution/access status
  to the data manifest; public-release blockers must be machine-readable.
- Verify the app can run from each declared degraded state in P0.6 without losing the live drafted
  state or silently relabeling one signal as another.

### P0.6 — Define degraded behavior

The app must still function when an upstream artifact is missing or stale:

1. Projection + ADP available: full engine.
2. Projection available, ADP missing: projected-value board; no availability claim.
3. ADP available, projection missing: clearly labeled market-rank board; no “best roster” claim.
4. Both missing/stale: manual board only with a blocking data-health warning.

Never silently substitute one signal for another.

---

## Research corrections and current conclusions

This section replaces the overconfident claims in the previous plan.

### What paid draft services actually establish as the benchmark

The relevant premium behavior is not the number of pages in a bundle. The draft benchmark is:

- league-specific scoring and roster settings
- live or reliable manual pick tracking
- a personal/customizable cheat sheet
- player tiers and positional scarcity
- team construction and upcoming opponent needs
- availability/“can I wait?” guidance
- rapid recommendation updates under a draft clock
- manual correction when sync or player matching fails
- transparent explanations rather than an unexplained rank

FantasyPros' current Draft Assistant describes personal cheat sheets, team needs, and positional
scarcity as recommendation inputs, and still requires a Chrome extension for ESPN live sync:
https://support.fantasypros.com/hc/en-us/articles/115001308567-What-is-the-Draft-Assistant

The project must **not** claim “85% of the premium bundle,” “structurally better than FantasyPros,”
or “paid-service equivalent” before the edge gate passes. Feature resemblance is not evidence of
recommendation quality.

### Custom scoring conclusion

Sleeper component projections are valuable because standard PPR scoring can be computed from
projected receptions, yards, touchdowns, turnovers, and other linear components.

The correct claim is:

> Exact for supported linear scoring categories; explicitly approximate or unsupported for
> threshold, range, and other nonlinear rules.

Examples requiring special handling include 100-yard bonuses, once-per-game thresholds, some DST
points-allowed ranges, and provider-specific position overrides. `ffscrapr` contains useful
implementation knowledge here, including the distinction between per-event (`each`) and threshold
(`once`) scoring.

### Projection-source conclusion

The implemented pipeline currently has **one performance-projection source**: Rotowire data exposed
through an undocumented Sleeper endpoint. Research now selects the official FantasyPros consensus
projection API as the primary source for the private edge test, subject to the P0.5 access gate. FFC
ADP remains an independent market signal, not a projection model.

Therefore:

- Single-source projection error is the highest engine-quality risk.
- The UI must surface projection source and data age.
- The pipeline needs a source interface capable of retaining multiple projections per player.
- Add official FantasyPros projections/ECR now as specified in P0.5; keep Rotowire raw and separate
  as the challenger/fallback.
- Do not use DynastyProcess's scraped FantasyPros ECR as the current production feed and do not
  create a FantasyPros-plus-Rotowire average until overlap and out-of-sample results justify it.
- Historical validation and top-player coverage matter more than arbitrary projection weights.

### Availability conclusion

FFC supplies `adp`, `stdev`, `high`, `low`, and `times_drafted`. An initial normal-CDF estimate is a
reasonable baseline:

```text
P(still available at next pick) = 1 − Φ((next_pick − adp) / stdev)
```

But this is only a model input and an explanation signal. It assumes a roughly normal draft-position
distribution and ignores the current room's roster needs, runs, platform rankings, and the fact that
the player has survived to the current pick. It must be calibrated and must never be used as an
unbounded score divisor.

### Architecture conclusion

The client-side pure-function engine remains the right choice: low latency, no cold start on the
draft clock, easy deterministic tests, and instant recomputation.

For the Sleeper-first release, authentication, Cosmos DB, and Azure Functions are not required for
the hot path. Sleeper is officially read-only and unauthenticated, and its documented guideline is
to stay under 1,000 calls/minute: https://docs.sleeper.com/

Use direct browser polling for Sleeper if the already-verified CORS behavior remains available. Keep
the adapter contract so the network path can later move behind the API without changing the engine.

### Azure corrections

- Static Web Apps Free currently allows **250 MB per environment**, not 500 MB; total storage across
  environments is 500 MB. Included bandwidth is 100 GB/month.
- Node.js 22 is supported by managed SWA Functions via `apiRuntime: node:22`.
- Managed Functions support HTTP triggers only; scheduled refresh remains a GitHub Actions job.
- Cosmos DB free tier remains 1,000 RU/s + 25 GB, one opted-in account per subscription, and is not
  available for serverless accounts.
- When Cosmos becomes active, add an account throughput cap of 1,000 RU/s so later configuration
  cannot accidentally create a bill.

References:

- https://learn.microsoft.com/en-us/azure/static-web-apps/quotas
- https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes
- https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier

---

## Open-source implementation knowledge map

We are using open-source projects as engineering references, not blindly installing them into the
runtime.

| Project | What to learn/reuse | License/status note |
|---|---|---|
| `cwendt94/espn-api` | ESPN views, integer position/team maps, cookie shapes, retry/fallback endpoints, draft parsing | MIT; provider-roadmap reference |
| `ffverse/ffscrapr` | Normalized provider contracts, ESPN/Sleeper scoring maps, threshold scoring, starter min/max, FLEX edge cases, recorded-fixture ideas | Open-source R package; port concepts/tests to TS |
| `ffverse/ffsimulator` | Positional-rank bootstrap outcomes, games-played/injury modeling, replacement players, lineup optimization, season simulation, wins added | MIT; primary engine research reference |
| `FantasyFootballAnalytics/ffanalytics` | Multi-source adapter shape, league scoring, simple/robust averages, uncertainty, VOR, source-comparison methods | GPL code; implementation reference only, not permission to redistribute scraped upstream data |
| `DynastyProcess/data` | Player-ID crosswalk; potentially ECR/rank history after terms review | Weekly automated data; GPL-3.0 |
| `nflverse` / `nflreadr` | Historical weekly stats/rosters for scoring reconstruction and out-of-sample testing | Historical-data/backtest foundation |

Primary references:

- https://github.com/cwendt94/espn-api
- https://ffscrapr.ffverse.com/reference/index.html
- https://github.com/ffverse/ffsimulator
- https://ffsimulator.ffverse.com/articles/custom
- https://github.com/FantasyFootballAnalytics/ffanalytics
- https://github.com/DynastyProcess/data
- https://github.com/nflverse

### ESPN knowledge preserved for the roadmap

From `espn-api`, a full league fetch includes league/settings, player pool, teams/schedule, and draft
results. We ultimately need the same data; the architectural difference is cadence:

| Path | Frequency | Shape |
|---|---|---|
| Init | Once per draft/connection | Settings, slots, teams, player identity |
| Poll | Every 2–3 seconds while drafting | Exactly one targeted draft-picks request |
| Weekly | Once or twice daily in season | Batch projections, stats, matchups, free agents |

Do not recreate a heavyweight league object on every poll. Preserve `POSITION_MAP`, `PRO_TEAM_MAP`,
the 401 alternate-endpoint retry, and `mPositionalRatings` as provider-adapter knowledge.

---

## Sleeper-first architecture

```text
┌─ Azure Static Web Apps Free ───────────────────────────────────┐
│ React + Vite + TypeScript                                      │
│                                                               │
│ Draft UI                                                      │
│   board · roster · shortlist · rationale · manual correction  │
│                                                               │
│ Web Worker                                                    │
│   scoring · slot optimization · VOR/MRV · tiers · VONA        │
│   opponent-pick rollouts · recommendation confidence          │
│                                                               │
│ Static /data from production build                            │
│   players · projections · PPR ADP · manifest                  │
└───────────────────────────────────────────────────────────────┘
        │ direct read-only poll                 ▲
        ▼                                       │ daily build
   Sleeper documented API                 GitHub Actions + Python
```

### Why no auth/Cosmos in the active path

- Sleeper connection needs only a username/user ID and draft/league ID.
- Preferences and recent draft selection can initially live in browser storage.
- Avoiding credentials and database work protects the time needed for the engine.
- The long-term API/provider boundary remains in `shared/types.d.ts`; this is sequencing, not a
  discarded architecture.

### Active repository layout

```text
frontend/src/
  engine/
    scoring.ts
    eligibility.ts
    lineupValue.ts
    replacement.ts
    tiers.ts
    availability.ts
    opponentModel.ts
    simulate.ts
    recommend.ts
  workers/draftEngine.worker.ts
  adapters/sleeper.ts
  components/
    ConnectSleeper DraftBoard MyRoster RecommendationPanel
    DataHealth ManualPickCorrection
  hooks/useDraftPoll.ts
shared/types.d.ts
pipeline/
data/
```

The API and infrastructure directories remain for the roadmap; do not delete them.

---

## Recommendation engine

### Design principles

1. All engine modules are pure functions of settings, draft state, and versioned data.
2. Provider-specific data is normalized before it reaches the engine.
3. The engine optimizes roster outcomes, not a hand-tuned multiplication of unrelated signals.
4. Availability and uncertainty are modeled and explained, not presented as certainty.
5. Recommendations remain useful if simulation is slow or unavailable.

### 1. Scoring

```text
projected_points(player) = Σ projected_stat[k] × league_scoring[k]
```

For launch PPR scoring, validate the result against a known Sleeper league. Unknown scoring keys
must be surfaced in diagnostics. “Unknown means zero” may be the computational fallback, but it must
not silently support an “exact scoring” claim.

### 2. Eligibility and slot-aware marginal roster value

A single positional cutoff is too crude when RB/WR/TE compete for FLEX. Use the same assignment
logic needed by the later lineup optimizer now.

```text
MRV(player, roster) =
  optimized_projected_starter_value(roster + player)
  − optimized_projected_starter_value(roster)
```

Use a small assignment/min-cost-flow, matching, or dynamic-programming solver. The implementation
must correctly handle dedicated slots before FLEX and leave a path for SUPER_FLEX.

Bench value is not zero, but it is discounted and should later reflect injury/replacement outcomes.
Do not simply sum full VOR across starters and bench.

### 3. Replacement and VOR

VOR remains a useful board/explanation metric, but replacement must derive from league size, roster
slots, FLEX competition, and the available/drafted player pool. It is not permanently fixed to:

```text
teams × (named starters + arbitrary flex share)
```

Initial implementation may use a documented deterministic replacement rule. The simulation layer
then improves it by observing which players are actually likely to remain draftable or replaceable.

### 4. Tiers

Build positional tiers from meaningful drops in projected points or MRV/VOR. A larger drop after a
player means a stronger cliff. Store the raw gap and a bounded normalized urgency; never invert the
gap accidentally.

### 5. Availability

Provide:

- estimated probability the player reaches the user's next pick
- expected draft range
- source/sample size
- a low-confidence flag for sparse/noisy ADP

Recondition or recalculate after every pick. The initial normal model is acceptable only until an
empirical or calibrated model proves better.

### 6. VONA and opponent-pick simulation

The first decision layer is value over next available:

```text
VONA(player) =
  MRV if selected now
  − E(best MRV option available at the user's next turn)
```

The expectation comes from repeated rollouts of opponent picks using:

- ADP distribution
- current availability
- each opponent roster and open starting slots
- bounded roster-need adjustments
- recent positional demand/run state

Do not hard-code that every opponent blindly follows ADP. Start with a simple documented model,
then calibrate it against recorded Sleeper mocks/drafts.

### 7. Candidate evaluation

For each reasonable candidate at the current pick:

1. Force that player onto the user's roster.
2. Run the same random opponent scenarios until the user's next one or two selections.
3. Optimize the user's likely follow-up choices.
4. Compare expected finished-roster starter value and downside.

Run this in a Web Worker, seed simulations for reproducibility, reuse the same random scenarios for
candidate comparisons, and cache results until draft state changes.

The engine must have a fast fallback board based on MRV + VOR + bounded tier/availability context so
the UI never freezes under the draft clock.

### 8. Recommendation output

Return a shortlist, not a false single-player certainty:

```ts
interface Recommendation {
  playerId: PlayerId;
  rank: number;
  projectedPoints: number;
  marginalRosterValue: number;
  vor: number;
  vona: number | null;
  tier: number;
  tierGapAfter: number;
  availableNextPickProbability: number | null;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
  warnings: string[];
}
```

Example rationale:

> Take RB X: he adds 24 projected points to your optimal starters, has a 68% chance of being gone
> by your next turn, and the next RB tier is 13 points lower. WR Y is the best alternative and is
> more likely to survive.

Runs and byes remain context/warnings. Bye overlap is a late tie-breaker, not a strong early-round
penalty.

### 9. Outcome distributions — after the deterministic engine works

Use `ffsimulator` as the reference for mapping historical positional rank to weekly outcome
distributions, games played, replacement players, and optimized lineups. This supplies floor,
ceiling, and injury/replacement effects without pretending every player follows one point estimate.

Do not block the first live Sleeper board on a full season simulator. Add distributions in a
measured step and prove that they improve historical results.

---

## Active execution plan — Sleeper edge track

Time estimates are planning aids, not permission to skip exit criteria.

### S0 — Blocking fixes and deployable artifact (1–2 days)

Exit criteria:

- Every P0 item above is resolved or has an explicit, user-approved deferment.
- Production artifact includes config and all required data.
- Deployed `/data/manifest.json` and `/api/health` work.
- League format dimensions are corrected.
- First fixtures/tests exist and “no tests” can no longer pass silently.

### S1 — Sleeper connection and live/manual board (2 days)

Build:

- Connect by Sleeper username/user ID.
- List 2026 leagues/drafts.
- Load league settings, roster slots, draft order, teams, and existing picks.
- Poll `/v1/draft/{draft_id}/picks` every 2–3 seconds with backoff and stale-state display.
- Add a universal manual mode plus undo/correction.
- Surface unmatched players instead of silently treating them as available.

Exit criteria:

- A real Sleeper mock draft updates within one poll interval.
- Refresh/reconnect reconstructs the complete board.
- Manual correction recovers from a bad/missing match without corrupting availability.

### S2 — Deterministic PPR engine (2–3 days)

Build:

- Linear scoring with diagnostics
- Eligibility/slot optimizer
- MRV and documented replacement/VOR
- Correct tiers and tier gaps
- PPR ADP/value comparison
- Initial availability probability with confidence/sample-size warnings

Exit criteria:

- Unit tests cover scoring, FLEX counterexamples, replacement, tiers, and probability boundaries.
- Known Sleeper league projections reconcile within an explained tolerance.
- Recommendations update deterministically after every fixture pick.

### S3 — VONA rollout engine (2–3 days)

Build:

- Opponent pick model
- Next-turn and optional two-turn rollouts
- Web Worker, seeded randomness, caching, and time budget
- MRV/VOR fallback if simulation misses its deadline

Exit criteria:

- Same seed/state produces the same recommendation.
- Candidate comparisons use common scenarios and remain stable across reasonable simulation counts.
- UI remains responsive and produces a result well inside the pick clock.

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

### S5 — Reliability and clock testing (1–2 days)

Exit criteria:

- Pick landing upstream → updated recommendation in under three seconds under normal conditions.
- Poll backoff, reconnect, stale data, duplicate picks, unknown players, tab suspension, and draft
  completion are tested.
- Production deploy passes artifact/data/config smoke checks.
- At least three full Sleeper mocks complete without board corruption.

### S6 — Edge validation (2–4 days initially, then ongoing)

The UI being polished is not proof of an edge. Run the validation program below and record results
in a versioned report/artifact.

Expansion is permitted only after the user reviews the results and accepts the gate.

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

Measure:

- optimized weekly starter points
- replacement-adjusted points
- simulated head-to-head wins/playoff rate across schedules
- downside/roster fragility

Start with recent seasons for which reliable preseason inputs can be reconstructed. `ffsimulator`,
DynastyProcess rank history, and nflverse weekly data are the starting references.

#### B. Availability calibration

On recorded drafts/mocks, measure:

- Brier score for “available at next pick” predictions
- calibration buckets (predicted 70% should occur roughly 70%)
- error by round and position

If the normal-CDF model is poorly calibrated, replace or correct it before marketing the feature.

#### C. 2026 live mock validation

Mocks validate synchronization, latency, robustness, and whether recommendations make contextual
sense. They do **not** by themselves prove real-season performance.

Record each state and recommendation so failures can become fixtures.

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

Preserved findings:

- Yahoo uses OAuth2 and Fantasy Sports read scope.
- Append `?format=json`; XML is otherwise common/default in the Fantasy API.
- Access tokens last about one hour.
- Refresh tokens are **long-lived, rotating, and revocable**, not guaranteed never to expire. If a
  refresh response supplies a new token, atomically replace the old token.
- Use a real registered HTTPS callback for the deployed app; validate current Yahoo registration
  behavior rather than relying on the old blanket “localhost is rejected” claim.
- It remains unverified whether `draftresults` updates during a live draft. Test this first.
- Candidate fallback: detect rostered-player changes through league player/roster endpoints, but
  prove latency and pick ownership before committing to it.

Exit criteria:

- Yahoo mock draft tracked live.
- Token rotation/revocation/reconnect paths tested.
- The live `draftresults` question is answered with a recorded fixture.

Reference: https://developer.yahoo.com/oauth2/guide/flows_authcode/

#### A3. ESPN extension + adapter

Preserved findings:

- ESPN has no supported public fantasy API; endpoints can change without notice.
- Public league draft data has been observed through
  `lm-api-reads.fantasy.espn.com/...?...view=mDraftDetail`.
- Private leagues require `SWID` (including braces) and `espn_s2` session cookies.
- Programmatic username/password login is not a viable design.
- FantasyPros also uses a Chrome extension for ESPN live sync.

Revised decision:

- Prefer a minimal, transparent browser extension that reads ESPN data in the user's existing
  session and forwards normalized draft state.
- Do not assume a bookmarklet can read the needed cookies. JavaScript cannot read `HttpOnly`
  cookies; verify actual attributes before retaining any bookmarklet fallback.
- Prefer not to upload/store ESPN session cookies at all. If credentials ever reach the API, treat
  them as high-value bearer credentials and perform a separate security review.
- Keep manual draft mode as the guaranteed fallback.

Port the relevant `espn-api`/`ffscrapr` maps and fixture knowledge into TypeScript behind the
provider adapter. The poll method must remain exactly one targeted upstream read.

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
bench/replacement value, roster fragility, and—once validated—season outcome simulations.

Outputs:

- projected starter strength and depth
- best value/reach relative to market
- positional/tier construction
- simulated range of finish, clearly labeled

#### C2. Weekly data layer

Add scheduled pipeline artifacts:

- weekly projections
- weekly actual stats
- NFL opponents/schedule
- injury/practice status
- trending adds/drops
- defense vs position/matchup features
- rest-of-season snapshots with provenance

GitHub Actions remains the scheduler because managed SWA Functions are HTTP-only.

#### C3. Lineup/start-sit optimizer

Reuse the slot optimizer introduced for draft MRV. Optimize the legal lineup under FLEX/SUPER_FLEX,
then show alternatives and point deltas. Add matchup context only after proving it improves weekly
accuracy; opponent labels alone are not an edge.

#### C4. Waiver assistant

Inputs:

- provider free agents
- weekly and rest-of-season projections
- the user's current roster and replacement options
- Sleeper trending adds/drops
- recent actual opportunity/production

Outputs:

- ranked adds and corresponding drops
- starter/depth impact
- calibrated FAAB range, not an unexplained single bid
- breakout signal with source/confidence

#### C5. Trade analyzer

Use rest-of-season outcome distributions, optimized weekly starters, replacement effects, roster
depth, and playoff weeks. A point-estimate VOR sum is only a baseline.

Outputs:

- impact on both teams
- expected points/wins and downside
- positional and bye/playoff effects
- explicit assumptions

#### C6. Season accuracy and hardening

- Retain dated recommendations and projections.
- Measure projection and recommendation error honestly.
- Add provider health, manual recovery, and source fallbacks.
- Recalibrate waiver/trade/lineup models from actual outcomes.

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

The init/poll split remains load-bearing:

- `init()` may fetch settings, roster slots, teams, and identity data.
- `picks()` is the live hot path and must be one targeted request with minimal transformation.
- Engine computation stays client-side and provider-independent.

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

The target remains **$0/month**:

- Azure Static Web Apps Free
- Managed HTTP Functions included with SWA
- GitHub Actions within the repository's free allowance
- Cosmos free tier only when the roadmap needs persistence

The active Sleeper track does not require Cosmos or provider credential storage. Any change that
introduces a paid resource must be explicitly called out and approved.

---

## Handoff rules for future agents

1. This file is the source of truth for sequencing. Sleeper edge work is active; other providers and
   in-season features are roadmap work.
2. Complete **Blocking fixes / Gate 0** before S1–S6.
3. Do not reintroduce the old multiplicative recommendation formula.
4. Do not claim paid-service parity or a drafting edge without the validation evidence specified
   here.
5. Preserve provider research and scaffolding even while it is inactive.
6. Port implementation knowledge from `espn-api`, `ffscrapr`, and `ffsimulator`; do not add Python/R
   services to the live draft path merely because the reference projects use those languages.
7. Keep provider normalization at the adapter boundary and the engine pure.
8. Never silently drop unmatched picks, unknown scoring keys, missing sources, or stale data.
9. Record real mock failures as sanitized fixtures.
10. When a roadmap phase begins, update this plan with measured results and the explicit decision
    that opened the gate.
