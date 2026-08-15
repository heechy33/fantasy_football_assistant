# Fantasy Football Co-Pilot — Sleeper-First Build Plan

## Status and decision

**Plan revised:** August 8, 2026
**Active objective:** prove that the recommendation engine creates a measurable drafting edge in
**PPR redraft snake drafts on Sleeper** before expanding the product.

**Progress:** Gate 0, S0, S1, S2, Phase 1 player context, and the Stage C VONA rollout integration
are implemented and locally verified (see "Active execution plan" below for measured results).
Stage C currently runs on the main thread under the existing budgeted mode; the Web Worker and
calibration work remain open S3/S6 items.

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

> **Authorized exception — August 14, 2026.** The narrow ESPN draft-day project defined in
> `espn_provider_chrome_extension_2026-08-14.plan.md` (Phases 0-5: manual takeover, ESPN
> reconnaissance Chrome extension, a draft-only `DraftProviderAdapter`, and draft-day packaging) is
> explicitly authorized to proceed **ahead of** the Edge Validation Gate for the August 15, 2026
> private league draft. This exception is limited to that draft-day scope: it stays strictly additive
> to the Sleeper path (no changes to `ProviderAdapter`, `adapters/sleeper.ts`, Sleeper fixtures, or
> the engine's public surface), does not open the in-season ESPN feature track, does not store ESPN
> cookies or raw traffic, and does not change the gate or its passing criteria.

---

## What exists today

As of August 8, 2026 this is a working live-draft assistant for one narrow case (Sleeper PPR
one-QB snake), not a scaffold. See "Active execution plan" for the phase-by-phase build record.

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
  positional-extension contract below
- FFToday-sourced season projections via the offline Python pipeline (`pipeline/fftoday.py`),
  normalized into `SeasonProjection`, behind the `SeasonProjectionProvider` boundary
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

- Web Worker execution for Stage C (deferred, not currently required by measured cost — see S3),
  two-turn rollouts, empirical opponent-model calibration, and real clock testing against a live
  mock (S3/S5/S6)
- Draft-experience polish: filters/search, tier-cliff visualization, manual pin/avoid, data
  freshness panel (S4)
- Reliability/clock testing under real conditions, edge validation against baselines (S5-S6)
- Provider adapters beyond Sleeper, Cosmos DB, SWA auth (roadmap, gated by the Edge Validation Gate)
- Real recorded Sleeper mock-draft fixtures — `fixtures/sleeper/` is still hand-authored

### Verified locally on August 10, 2026

- `npm test`: frontend 320/320 passing (1 opt-in scenario-count sweep skipped by design) across 28
  files; API 1/1 passing in 1 file
- Stage B focused selection: 100/100 passing across 6 files
- `npm run typecheck`: frontend and API pass
- S2's deterministic recommendation guard passes its 250 ms median ceiling on real committed data
  (measured ~110 ms). Stage C's two performance guards pass on the same data: the warm (realistic
  steady-state) case measured ~233-475 ms median at `DEFAULT_SCENARIOS = 8`, the cold (first
  Stage C-eligible turn of a session) case ~950-1150 ms — see S3's "Performance" note for the full
  breakdown and the two engine-level fixes (`addPlayerToLineup`'s exact-tie fast path,
  `teamRosterCache`) that made this measurement meaningful in the first place. `git diff --check`
  passes.
- `npm run build` and `npm run verify:artifact` pass
- Pipeline tests: 44/44 passing, including FFToday retry/matching, ADP fallback, bye-week, and
  nflverse failure/season-leakage fail-open cases
- Generated data artifacts and crosswalk coverage: see the data manifest; the top-300 coverage gate
  is enforced in `pipeline/build_data.py` and fails the build below threshold

### Phase 1 context coverage snapshot — August 8, 2026

- Draft season: 2026; usage season: 2025; durability/injury window: 2023-2025.
- FFC PPR population: 5,187 twelve-team PPR mock drafts and 256 returned rows. The manifest records
  mock drafts, team count, season, format, and row count separately for every FFC format.
- Report-only cohort: 190 top-ADP PPR QB/RB/WR/TE veterans available in the current 256-row feed.
- Crosswalks in cohort: PFR 190/190 and GSIS 190/190.
- Covered: 190; verified known absent: 2; missing: 0; match rate: 100.0%.
- Missing player IDs: `[]`.
- Weekly-roster diagnostics reported, without guessing, 2 rows with unknown status `E01`.
- This is a report, not a blocking threshold. Usage, availability, and injury history do not affect
  recommendation math, and no low/medium/high injury-risk label is produced.
- Opportunity quality fields use direct weekly statistics and optional PBP red-zone/end-zone/goal-line
  counts; unavailable denominators remain null rather than being imputed.

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

**Current implementation status (2026-08-07):** the target design below is the role-separated,
FantasyPros-primary stack — that has not changed. What's actually running for the S2 prototype is
narrower: FFToday season-projection tables are the sole implemented performance-projection source
(`pipeline/fftoday.py`), not Rotowire or FantasyPros. Neither the FantasyPros API access nor the
Rotowire/ECR/no-lost-player-union pipeline described below has been built. Treat this section as
the target architecture for when a second source is added, not a description of what runs today —
see S2 in "Active execution plan" for what's actually implemented and its prototype-only
constraints (unmonetized, attribution, `noindex`, legally unverified redistribution).

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
   Sleeper ID. The current FFToday active top-300 board must have at least 90% projection coverage,
   and every uncovered row must be emitted in a review report. The long-term multi-source union
   target remains 99% coverage once the licensed multi-source stack is active.
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
2. Projection available, but usable ADP coverage is below 50% of the full roster universe:
   projected-value board with default-mix replacement demand; make no board-wide availability
   claim. This fallback describes insufficient coverage, not necessarily total ADP absence.
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

The implemented pipeline has **one performance-projection source**: FFToday season-projection
tables (see P0.5's "Current implementation status" and S2 in "Active execution plan"), not the
Rotowire-via-Sleeper endpoint originally scoped here. Research still selects the official
FantasyPros consensus projection API as the eventual primary source for the private edge test,
subject to the P0.5 access gate — that has not been pursued yet. FFC ADP remains an independent
market signal, not a projection model.

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
    scoring.ts eligibility.ts replacement.ts tiers.ts availability.ts ranking.ts rng.ts
    opponentModel.ts simulate.ts recommend.ts
  adapters/sleeper.ts draftOrder.ts
  data/dataHealth.ts dataInvariants.ts loadPlayerPool.ts playerContext.ts playerPortrait.ts
  state/draftBoardState.ts persistence.ts
  hooks/useDraftPoll.ts useDraftBoardState.ts useMediaQuery.ts useModalFocus.ts usePlayerBoardData.ts
  components/
    ConnectSleeper DraftWorkspace DraftLog Drawer MyTeamRail
    PlayerContextModal PlayerPortrait RecommendationCard
    DataHealth ManualPickCorrection
shared/types.d.ts
pipeline/
data/
```

No `workers/` directory exists yet — Stage C's rollout runs on the main thread; see S3 below for
why measured cost hasn't required moving it off yet. `DraftBoard`/`MyRoster`/`RecommendationPanel`
(an earlier layout sketch) were superseded by `DraftWorkspace` + `MyTeamRail` +
`RecommendationCard`/`PlayerContextModal` before those components existed; `lineupValue.ts` was
never split out — the lineup optimizer and its `PreparedLineup`/`addPlayerToLineup` incremental
step live in `eligibility.ts`.

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

Bench value is discounted and cannot be summed independently for every eligible starter. The
implemented objective is `rosterUtility = optimizedStarterValue + maximumWeightDepthMatching`.
Bench QB/RB/WR/TE players are matched one-to-one to occupied eligible core slots. Edge value is
production over positional replacement multiplied by the incumbent's expected unavailable
fraction. FLEX uses the starter solver's eligibility rules; starter upgrades remain on the starter
path and cannot also receive a depth edge.

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

**Implementation note (S3, `simulate.ts`):** the shipped board does not sort on this literal
`VONA(player)` formula. `runSimulation` returns two related-but-distinct numbers per candidate:
`lookaheadValue` (`E(finished-roster value) − commonBaseline`, what `recommend.ts` actually sorts
skill candidates by) and `vona` (`MRV(c) − E(best MRV among survivors)`, this section's literal
definition, surfaced only as an explanation field — see §8's interface below, which predates this
distinction and only names `vona`).

#### 2026-08-10 unified-utility timing revision

The formulas above describe the original S3 rollout diagnostic. Production ranking now uses:

```text
planValue(c) =
  marginalRosterUtility(c now)
  + E(best conditional marginalRosterUtility at the next user pick)

VONA(c) =
  max(0, marginalRosterUtility(c)
    - E(best surviving marginalRosterUtility in c's eligibility group))
```

The follow-up expectation orders candidates by conditional utility after `c` and uses ADP-based
survival plus the probability that every higher-utility option is gone. ADP affects timing only,
never intrinsic player quality. VONA is explanation only because its timing effect is already
inside `planValue`; it is not added again.

Missing ADP uses fixed-seed simulated survival when available and demotes confidence. If neither
source exists, VONA is null and the planner does not credit the player as a future option.
`lookaheadValue`, rollout VONA, downside, and simulated survival remain diagnostics/benchmark
fields; they do not sort the production board. This explicitly supersedes the original S3
starter-only sort note immediately above.

The zero-hole two-future-pick policy was rejected at the nine-draft regret-ceiling prescreen:
one-horizon mean regret was below the predeclared 0.5 utility-point absolute-improvement gate, so
even a perfect two-pick policy could not qualify. Production therefore stays at one deterministic
future pick; the second user-pick boundary remains available to a future analysis harness.

### 7. Candidate evaluation

For each reasonable candidate at the current pick:

1. Force that player onto the user's roster.
2. Run the same random opponent scenarios until the user's next one or two selections.
3. Optimize the user's likely follow-up choices.
4. Compare expected finished-roster starter value and downside.

Run this in a Web Worker, seed simulations for reproducibility, reuse the same random scenarios for
candidate comparisons, and cache results until draft state changes.

**Implementation note:** seeding, common-random-numbers reuse, and caching are built (`rng.ts`,
`recommend.ts`'s `simulationCache`/`teamRosterCache`). The Web Worker is not — S3's "Performance"
note explains why measured main-thread cost hasn't required it yet.

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
  marginalRosterUtility: number;
  expectedFollowUpValue: number;
  planValue: number;
  planningHorizon: 0 | 1 | 2;
  vor: number;
  vona: number | null;
  vonaSource: 'analytic' | 'simulationFallback' | 'unavailable';
  tier: number;
  tierGapAfter: number;
  availableNextPickProbability: number | null;
  confidence: 'low' | 'medium' | 'high';
  reasons: string[];
  warnings: string[];
}
```

**Implementation note:** `rankingBasis` is `planValue | rosterUtility | specialTeams`. The shipped
`Recommendation` (`recommend.ts`) is a superset of this
sketch — it also carries `lookaheadValue`, `downside` (10th-percentile), and
`simulatedSurvivalProbability` alongside `vona`, plus S2 fields (`replacementAdjustedValue`,
`tierBoundaryGap`, availability range/sample size, special-teams disposition) this sketch predates.

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

### 10. Draft Score — 2026-08-11 composite decision record

A published, audit-able 0–100 composite for card display and residual tie-breaking, decomposed into
three named axes. Full spec: `DRAFT_SCORE_WAR_ROOM_REVISED_PLAN.md`.

```text
Value = 100 × clamp01(marginalRosterUtility / VALUE_ANCHOR)
Edge  = 100 × clamp01(1 - availableNextPickProbability)     // 0 with no future pick or no ADP
Risk  = 100 × clamp01(
  0.50 × (100 - resolvedDurabilityScore) / 100
  + 0.30 × injuryPenalty
  + 0.20 × clamp01(availabilityStdev / dispersionAnchorPicks)
)
draftScore = clamp(0, 100, (0.65 × Value + 0.35 × Edge) × (1 - 0.25 × Risk / 100))
```

**The product name is Draft Score, not "3D Value."** FFToday supplies one point estimate per
player, not a floor/ceiling/consensus distribution, so a third projection axis would be
fabricated. Value/Edge/Risk are the three axes actually supported by data already on hand.

**It does not become the primary sort.** `planValue` (§6's unified-utility revision) remains the
production ranking objective, including the survival → ADP → planValue → id within-band near-tie
order. Draft Score enters only as a residual tie-break, replacing `planValue` at the third
comparator position, strictly after survival and ADP — a player who is scarcer/less likely to
survive still outranks a prettier composite. Promotion to full primary sort requires a written
decision after the Edge Validation Gate's benchmark harness reports paired regret/agreement numbers
for the current policy versus the residual-breaker policy.

**2026-08-11 A/B result** (`benchmarks/reports/2026-08-11-draft-score-tie-break-ab.md`): ran the
9-recorded-draft availability/VONA harness with the residual breaker enabled and disabled. Sections
A and B reproduced exactly, as expected (neither reads `draftScore`). Section C's regret and
top-choice-agreement numbers were also identical — on this sample, no near-tie band containing the
eventual top choice was also tied on survival and ADP, so the breaker never fired at rank 1. Not
evidence for or against promoting to full primary sort; that remains its own future decision.

**Edge excludes VONA and `tierUrgency`.** Both are already timing signals folded into `planValue`
(§6); adding them to Edge would double-count scarcity and fight the validated near-tie order.
`tierUrgency` remains explanation-only, consistent with `tiers.ts`'s existing doc comment. **Risk
excludes engine `confidence`** — that field is data-quality (scoring severity, ADP sample size,
K/DEF disposition), not player-medical risk; K/DEF rows are always `confidence: 'low'`, so folding
it into Risk would silently discount every special-teams card.

**Missing data resolves to unknown, never to safe.** A player with no `player-usage.json` row (most
rookies; the artifact covers 997 of 4384 players) gets the league-median observed durability score
(pipeline-measured; see `context.risk_defaults_report` and `manifest.riskDefaults`), not zero, and
the card renders visibly hatched — never a green low-risk state built from an absent signal.

---

## Active execution plan — Sleeper edge track

Time estimates are planning aids, not permission to skip exit criteria.

### S0 — Blocking fixes and deployable artifact — ✅ Complete

Exit criteria:

- Every P0 item above is resolved or has an explicit, user-approved deferment. ✅
- Production artifact includes config and all required data. ✅ (`npm run verify:artifact`)
- Deployed `/data/manifest.json` and `/api/health` work. ✅
- League format dimensions are corrected. ✅ (independent `reception`/`qb`/`draft` fields)
- First fixtures/tests exist and "no tests" can no longer pass silently. ✅

### S1 — Sleeper connection and live/manual board — ✅ Complete

Build:

- Connect by Sleeper username/user ID.
- List 2026 leagues/drafts.
- Load league settings, roster slots, draft order, teams, and existing picks.
- Poll `/v1/draft/{draft_id}/picks` every 2–3 seconds with backoff and stale-state display.
- Add a universal manual mode plus undo/correction.
- Surface unmatched players instead of silently treating them as available.

Exit criteria — met, verified against a real Sleeper mock draft (`674c7e5`, "sleeper mock draft
connection"):

- A real Sleeper mock draft updates within one poll interval.
- Refresh/reconnect reconstructs the complete board.
- Manual correction recovers from a bad/missing match without corrupting availability.

`fixtures/sleeper/` is still hand-authored, not a recording of that mock — swapping in a real
recorded fixture set remains open (see "What exists today").

### S2 — Deterministic PPR engine — ✅ Complete

The active S2 source is FFToday's public season-projection tables, fetched only by the offline
Python pipeline and normalized into the existing `SeasonProjection` shape behind the
`SeasonProjectionProvider` boundary, so a permitted licensed feed can replace FFToday later without
changing the engine. The browser makes no FFToday request during a live draft.

FFToday is prototype-only and redistribution permission is legally unverified. The prototype must
remain unmonetized, carry source attribution and update age, use `noindex`, and retain the last
successful artifact when a refresh fails. Do not launch a paid or commercial product without
FFToday permission or a licensed replacement. FFToday's fantasy-point column is never used as the
league score — points are always recomputed from components. Generic CSV imports, licensed feeds,
source consensus, VONA simulations, and K/DEF high-confidence advice are post-S2 scope.

Built (`frontend/src/engine/`):

- Linear scoring with diagnostics (`scoring.ts`) — unsupported/missing keys classified
  minor/material, never silently "unknown means zero" without a visible warning
- Slot-aware lineup optimizer (`eligibility.ts`) — exact bitmask-DP solver over (slot, remaining
  players), correctly handles FLEX/SUPER_FLEX counterexamples instead of a positional cutoff
- MRV and draining-pool replacement/VOR (`replacement.ts`) — replacement rank shrinks as a position
  is consumed rather than staying fixed to the static full-pool level
- ADP-derived replacement demand (`replacement.ts`) uses full scored-ADP counts at complete
  coverage, extrapolates at 50% or better usable coverage, and uses a frozen default positional
  mix below 50%. Starter demand is a floor; K/DEF demand is capped at named starting capacity.
- Leader-anchored tiers with bounded, non-inverted urgency (`tiers.ts`)
- Survival-conditioned availability (`availability.ts`) — climbs monotonically as the player keeps
  surviving picks, guarded against near-zero-denominator noise
- Ranked recommendation board with explanations (`recommend.ts`) — sorts on
  `replacementAdjustedValue` (not raw points, fixing the old open-slot degeneracy), and populates
  Stage C lookahead/VONA fields when simulation is active with deterministic S2 fallback. K/DEF
  remain below the displayed skill-player
  board until every non-K/DEF core starter slot, including FLEX, is filled and the user's
  settings-aware late-draft window arrives. In the standard one-D/ST, one-K format, D/ST is due at
  the penultimate team selection and kicker at the final selection. The schedule adapts to total
  rounds, multiple/absent/already-filled slots, never recommends a backup beyond configured
  capacity, and preserves the old core-only fallback when reliable team-clock data is unavailable.
- The late-draft K/DEF schedule is an S2 strategy guardrail, not a high-confidence projection claim.
  Standard redraft guidance favors reserving both for the final selections and streaming based on
  weekly matchup because preseason positional separation is small and volatile. The safe default
  still drafts one kicker in the final round when a K slot exists; intentionally ending without a
  kicker remains deferred until the product can model platform rules and provide a Week 1 reminder.

Exit criteria — met, verified August 8, 2026:

- Unit tests cover scoring, FLEX counterexamples, replacement, tiers, and probability boundaries.
  308/308 frontend tests and 1/1 API test passing, including
  draining-pool replacement invariants, tier-boundary vs. adjacent-gap distinctions, and
  survival-conditioned availability monotonicity.
- Known Sleeper league projections reconcile within an explained tolerance. Five real committed
  `data/` player totals reconcile exactly (±1e-6) under standard PPR scoring.
- Recommendations update deterministically after every fixture pick. Verified: identical input
  produces identical output including tie order; re-ranks correctly after an opponent pick; MRV
  degenerates to raw points only on a genuinely open slot.

### S3 — VONA rollout engine — ✅ Implemented (main thread), calibration/two-turn deferred

> **Current ranking revision:** Stage C rollout fields are now diagnostics and a missing-ADP
> fallback. Skill cards sort on deterministic one-pick `planValue` over unified roster utility in
> both starter and bench states. The historical implementation notes below remain as the record of
> the rollout subsystem, not the current production sort contract.

Opponent pick model (`opponentModel.ts`): per-scenario ADP noise plus a bounded roster-need bonus,
deliberately not "every opponent blindly follows ADP." `defaultOpponentModelConfig(teams, rounds)`
supplies uncalibrated starting values (documented "Uncalibrated pending S6" on every field) — S6
calibrates them against a recorded Sleeper mock; nothing here is tuned yet.

Seeded, Node-testable rollout (`rng.ts`, `simulate.ts`): PCG32 + Box-Muller RNG with a prefix
property (`deriveStream`), one opponent-pick window simulated per scenario
(`simulateOpponentWindow`), and an exact branch-and-bound best-follow-up search
(`bestFollowUpValue`). Next-turn only — the two-turn rollout PLAN.md originally scoped is deferred;
one-turn lookahead is what's built and tested.

Stage C wiring (`recommend.ts`) — the seam that turns simulation output into a displayed board:

- Rollout pool (`buildRolloutPool`) unions three terms, all in deterministic S2 order: the global
  top `max(3 * limit, 15)`; up to two positive-MRV, non-deprioritized leaders per QB/RB/WR/TE; and
  each of QB/RB/WR/TE's own top `limit` regardless of MRV — the third term is what guarantees a
  position tab always returns a full board even when the global leaders are concentrated elsewhere
  (e.g. a due K/DEF pick). K/DEF are excluded only from the simulated candidate set (they're never
  useful VONA targets and simulating them wastes a rollout window) — they stay in the deterministic
  order, `remainingPlayers`, and the final displayed sort.
- All-or-nothing lookahead sort: the board ranks on `lookaheadValue` only when every displayed
  skill candidate has one; any other case (no `simulation` context, an explicit zero-scenario
  request with a real follow-up, off-clock) falls back wholesale to the S2 `replacementAdjustedValue`
  sort, never a partial mix of the two scales. A null-follow-up (the user's final pick) is not a
  fallback case — `simulate.ts` collapses it to the deterministic MRV cleanly, with fields still
  populated.
- Stage C only runs while `decisionPick === currentPick` — i.e. only during the user's own turn,
  never speculatively for a future turn the current rollout has no pre-decision window for. Off
  those turns the board is the plain S2 board; this is a known, currently-permanent boundary, not a
  bug (see the exit-criteria note below).
- Reapplies the complete S2 special-teams policy on the final sort (`isDeprioritized`, due/overdue
  priority, configured-capacity exclusion) — opponent drafting and the full survivor pool remain
  ungated.
- Two caches, both cleared together by `clearSimulationCache()`: a single-entry simulation-result
  cache keyed on every input that can vary independently, and an incrementally-extended
  `teamRosterCache` (extends its previous pick-prefix via the fast incremental step below instead
  of re-solving all opponent lineups from scratch — see "Performance," next).

MRV/VOR fallback if simulation misses its deadline: the `'budgeted'` execution mode and `timedOut`
diagnostic exist and are tested, but the shipped default is `'fixed'` (see "Performance" below) —
`'budgeted'` remains available for callers that opt in.

#### Performance — two engine-level fixes, not just a scenario-count choice

Measuring Stage C's real cost surfaced two defects in shared engine code that a naive scenario-count
sweep would have misdiagnosed as "simulation is inherently slow":

1. **`addPlayerToLineup`'s exact-tie fallback was the dominant cost, not scenario count.** On an
   ambiguous tie (~11% of calls on real committed data, deep in a draft) it re-ran the full
   exponential `solveIndexed` DP (~37ms each) to resolve *which* tied assignment matches the
   reference DP's canonical choice — necessary for display (`assignedRosterSlot`), but every one of
   Stage C's hot-path callers (`bestFollowUpValue`, `simulateOpponentWindow`, the per-candidate MRV
   pass in `runSimulation`) only ever reads `.result.value`, never occupant identity. `.result.value`
   is exact regardless of which tied option is taken — augmenting-path optimality holds starting
   from *any* tied-optimal assignment, not only the canonical one — so a new
   `resolveAmbiguityExactly` parameter (default `true`, preserving exact behavior for
   `recommend.ts`'s displayed S2 board) lets Stage C's three hot-path calls skip the fallback. This
   alone cut a single scenario's cost from ~7.3s to ~44ms — roughly 150x.
2. **`buildTeamRosters` re-solved all opponent lineups from scratch on every call.** A live draft
   mostly *appends* picks between polls, so `recommend.ts` now maintains `teamRosterCache`: when the
   new call's relevant picks are the previous call's plus a clean append, it extends incrementally
   via the same value-safe fast path (occupancy-only consumers — `needBonusFromLineup` — never read
   identity either); any non-append change (a manual correction, a settings change) falls back to a
   full rebuild, so this is never wrong, only sometimes not faster. The same deferred-identity
   principle was applied to `recommend.ts`'s own widened deterministic prefilter
   (`patchExactAssignment`): exact identity is resolved only for cards that actually end up
   displayed, not all ~100 evaluated candidates.

`DEFAULT_SCENARIOS = 8`, selected 2026-08-10 against the real committed `data/` at Stage C's
worst-case fixture (12 teams, 16 rounds, slot 1 — the longest opponent window a 12-team snake
produces, near-full 14-incumbent roster). Two measurements matter, not one:

- **Warm** (the realistic steady state — `teamRosterCache` extends rather than rebuilds, which is
  what happens on every Stage C-eligible turn after the first in a session): ~75-90ms fixed
  overhead plus ~23ms/scenario, roughly linear. 8 scenarios measured ~233ms in isolation — this is
  what the default was actually chosen against.
- **Cold** (nothing cached — only the very first Stage C-eligible turn of a session pays this):
  dominated by fixed one-time cost (`buildTeamRosters` from scratch, the widened deterministic
  pass) more than by scenario count; ~950-1150ms at 8 scenarios. Rare in practice, and still well
  inside the 3s clock test, but deliberately not the number the default was tuned against.

The 250ms internal target (tighter than the 3s product-level clock test) exists because the 2.5-3s
live poll interval already consumes most of that 3s budget on its own — Stage C's own compute needs
to be small relative to the poll interval, not merely small relative to 3s.

Exit criteria:

- Same seed/state produces the same recommendation — verified: `'fixed'` mode is the shipped
  default, and `simulate.ts`'s prefix property (`deriveStream`) plus `recommend.ts`'s cache-key
  fingerprinting guarantee this; tested directly.
- Candidate comparisons use common scenarios and remain stable across reasonable simulation
  counts — verified for ordering stability at real-data scenario counts; not yet validated against
  a recorded mock (S6).
- UI remains responsive and produces a result well inside the pick clock — true for the warm case
  (the common one) on the main thread today; the cold case and the still-unbuilt Web Worker are
  open items below, not because measured cost has demanded a worker yet, but because the cold case
  hasn't been stress-tested against the live poll loop end-to-end.

Deferred, not built: the Web Worker (main-thread cost turned out to be a fixable engine defect, not
an inherent scenario-count problem — revisit if real usage still shows main-thread jank), the
two-turn rollout, and opponent-model calibration (S6).

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
