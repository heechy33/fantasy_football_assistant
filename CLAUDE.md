# Fantasy Football Assistant

Live draft assistant + season co-pilot for Sleeper, ESPN, and Yahoo fantasy football. See
`PLAN.md` for current status and sequencing, `DECISIONS.md` for the durable (condensed)
design-decision log, `archive/DECISIONS-history.md` for that log's full unabridged detail, and
`archive/PLAN-history.md` for completed-phase build detail — this file is conventions, repo
layout, and commands only. Agent verification loop (when to run tests): `AGENTS.md` — follow it
regardless of which coding agent you are. Update this file whenever a structural thing changes
(new top-level directory, new active adapter, new command, a scope exception opening/closing) —
not on a schedule, and not for anything that's just "what's being worked on right now" (that
belongs in `PLAN.md`).

## Active scope: Sleeper-first

The project is currently in a **Sleeper-only edge-validation phase** (see `PLAN.md`, "Status and
decision"). The active goal is a single narrow product: track a Sleeper PPR one-QB redraft snake
draft live and recommend the best pick with an explanation and honest uncertainty.

ESPN, Yahoo, Cosmos DB, and SWA auth are **preserved roadmap, not active work**. Work on those
starts only when `PLAN.md`'s Edge Validation Gate passes or the user explicitly changes priority.
Provider research and scaffolding (`infra/main.bicep`, the `ProviderAdapter` contract) are kept
deliberately — future work, not dead code to delete.

> **Closed exception — August 14-15, 2026.** A narrow ESPN draft-day project (manual takeover, an
> ESPN reconnaissance Chrome extension under `extension/`, a draft-only `DraftProviderAdapter`
> family under `frontend/src/adapters/espn*.ts`, draft-day packaging) was authorized ahead of the
> gate for one real private-league draft on August 15, 2026. That draft is done and the exception
> is closed (`DECISIONS.md`, 2026-08-14). The files stay (draft-day scope only, no cookie/raw-
> traffic storage) but opening the in-season ESPN track is a new decision — it still needs the
> gate or an explicit priority change.

> **Priority change — August 25, 2026.** The user explicitly changed priority ahead of the gate:
> the product is restructuring into a public/gated split — an anonymous public Draft Guide
> (`/draft-guide`), a routing migration, and landing/onboarding rework ship first (phases 0-3);
> Clerk auth (replacing SWA's `/.auth/*` — see `DECISIONS.md`, 2026-08-25, for why SWA Free's
> provider set can't do Google) and Cosmos-backed saved leagues/drafts follow (phases 4-5). This
> authorizes no in-season ESPN/Yahoo work; the DB/Auth roadmap note below stays accurate until
> phase 4 starts.

## Tech stack and architecture rules

- **Frontend**: React + Vite + TypeScript → Azure Static Web Apps (Free). **API**: Azure
  Functions, Node 22, TypeScript, **HTTP triggers only** — SWA Free has no timers/Durable
  Functions, so no code should assume a server-side scheduler exists. Currently just `/api/health`;
  no provider endpoints exist yet.
- **Data pipeline**: Python, runs via GitHub Actions cron (not Azure — that's the scheduler).
- **Draft engine**: pure TypeScript. Stage C (VONA rollouts) runs in a long-lived Web Worker
  (`frontend/src/workers/recommendation.worker.ts` + `hooks/useRecommendationRefinement.ts`, shipped
  in `f821318`) initialized at pool load with cooperative cancel of superseded requests; a
  deterministic main-thread fallback board keeps the UI usable if the worker fails or is
  unavailable.
- **DB/Auth**: Cosmos DB free tier (provisioned; `enableFreeTier` set-only-at-creation) and SWA
  `/.auth/*` — **roadmap only**. Keep `/api/*` `anonymous` in `frontend/public/staticwebapp.config.json`.
- **Hosting cost target: $0/month** — any change that incurs cost needs a deliberate call-out.

## Repo layout (highlights — the code is the full map)

- `frontend/src/engine/` — pure functions, no network/provider awareness. `recommend.ts` wires
  the analytic one-pick `planValue`, Stage C rollouts, and the deterministic board sort (marginal
  roster utility → VOR → projected points → player id). (The old Draft Score residual tie-break /
  card composite has been deleted.)
- `frontend/src/adapters/` — `sleeper.ts`/`draftOrder.ts` are the only in-season/live-poll
  adapters. `espn*.ts` are draft-day-only from the closed exception — **do not extend into an
  in-season ESPN adapter without a new decision**. Yahoo isn't created yet.
- `frontend/src/data/` — context/data-health/player-pool helpers (not engine logic), incl.
  `percentileRankings.ts`/`qbPercentileRankings.ts`/`cardRoleStats.ts` (Role-tab and card-bottom
  cohort percentile ranking, display-only, never feeds `planValue`). `state/`, `hooks/`,
  `components/`, `styles/tokens.css` — draft-board state, UI. `DraftWorkspace` + `MyTeamRail` +
  `RecommendationBoard` / `PlayerCard` (+ its row twin `PlayerBoardRow`, shared logic in
  `playerBoardFace.ts`) + `PlayerDetailDrawer` are the current workspace components (earlier
  `DraftBoard`/`RecommendationPanel` sketches were superseded; don't recreate them).
  `RecommendationBoard.tsx`'s "All" tab always excludes K/DEF, and excludes QBs once
  `format.qb === 'one-qb'` and the starting QB slot is filled (see `DECISIONS.md`, 2026-08-22) —
  both are presentation filters, not engine changes; position tabs are never filtered.
- `frontend/src/routes/` — the route tree (`App.tsx` composes it): `AppLayout` (nav shell),
  `LandingRoute`, `DraftGuideRoute` (public), `DraftRoomRoute`, and `routes/onboarding/` (the
  real connect flow — the landing renders inert illustrations only). `session/DraftSessionProvider`
  sits above `<Routes>` so the live poll survives navigation.
- `extension/` — draft-day-only ESPN reconnaissance Chrome extension (closed exception), not an
  in-season sync product.
- `api/src/functions/health.ts` — the only endpoint. `shared/types.d.ts` — the frontend/api
  contract, type-only.
- `pipeline/` (`build_data.py`, `sources.py`, …) → `data/` — committed JSON consumed by the app
  (incl. `weekly-ppr.json`). `data/adp-ffc-*.json` and `data/adp-underdog-bestball.json` are
  **display-only** lanes (Market ADP tile only) — never an engine input, never blended into
  `data/adp-*.json`'s redraft-engine boards (`DECISIONS.md`, 2026-08-24). The FantasyPros stars/SOS
  decoration pipeline was cut entirely (`DECISIONS.md`, 2026-08-23/24) — do not re-add it without a
  new decision.
- `fixtures/sleeper/` — **hand-authored** fixtures (not yet a real recorded draft; open item).
  `fixtures/underdog/` — a committed contract fixture (recorded Sharp Football Analysis HTML,
  read by `pipeline/test_underdog_adp.py`), not recon scratch. `fixtures/espn-contract/` — same
  idea: two recorded-and-scrubbed ESPN live-stream slices read by `espnOffset.test.ts` — committed
  because a test fixture has to survive a fresh checkout (CI has no `fixtures/espn/` on disk).
  `fixtures/espn/` itself stays gitignored recon scratch, not contract fixtures — don't add a test
  dependency on anything under it. `infra/main.bicep` — roadmap. `archive/` — completed-phase
  history (`PLAN-history.md`), the condensed-away decision detail (`DECISIONS-history.md`), and
  gitignored cursor-plan scratch.
- Not yet built: `workers/draftEngine.worker.ts` and `api/_shared/providers/` — don't create
  either until in-season work actually starts.

## Core conventions

**Canonical player ID is `sleeper_id`.** Sleeper's projections/stats/players endpoints are the
data spine; ESPN/Yahoo ids translate to it via the DynastyProcess crosswalk at the adapter
boundary (roadmap). Nothing above the adapter layer holds a provider-specific player id.

**Stat and scoring keys use Sleeper's vocabulary** (`rush_yd`, `rec`, `rec_td`, `fum_lost`, …).
Projected points are always `Σ stat[k] × league.scoring[k]` over matching keys — an unrecognized
key is "not scored," not an error. ESPN/Yahoo adapters, when built, own translating their scoring
settings into this vocabulary, once, at the boundary.

**`shared/types.d.ts` must stay type-only** — interfaces/type aliases only, no runtime exports
(no consts, functions, enums). `.d.ts` avoids `tsc` emit and `rootDir` conflicts across
`frontend/` and `api/`. Shared runtime constants go in the side that owns the concept.

**League format is three independent dimensions, not one union.** `LeagueSettings.format`
separates `reception` (`standard`/`half-ppr`/`ppr`/`custom`), `qb` (`one-qb`/`two-qb`/
`superflex`), and `draft` (`snake`/`linear`/`auction`) — PPR and two-QB aren't mutually exclusive;
don't reintroduce a single `scoringFormat` union. The raw `scoring` map and
`startingSlots`/`rosterSlots` stay authoritative; `format` only selects ADP sets and UI defaults.

**Provider adapters implement `ProviderAdapter`** (`shared/types.d.ts`) and are the only place
provider-specific knowledge lives — endpoint shapes, cookie formats, ESPN's integer position/team
maps, OAuth flows. Code above the adapter layer must not branch on `provider`.

**The draft init/poll split is load-bearing:**
- `init(cred, draftId)` — once per draft. Settings, roster slots, scoring, full player pool. Can
  be slow; correctness over speed.
- `picks(cred, draftId)` — polled every 2-3s during a live draft. **Must resolve to exactly one
  upstream GET.** This is the only hot path; don't add work to it.

**Engine modules are pure functions** of `(settings, state, projections) → result` — no network,
no provider awareness, tested directly against committed fixtures. **Do not reintroduce the old
`VOR × need × (1/tier_gap) / P_available` formula** (rejected 2026-08-08 — it inverts tier urgency
and is unbounded by `P_available`). The corrected design is in `PLAN.md`'s "Recommendation engine"
and `DECISIONS.md`'s 2026-08-10/2026-08-11 entries.

**Never silently drop an unmatched player.** A crosswalk miss produces `playerId: null` on a
`Pick`; surface it in the UI. A silently-missing pick corrupts every downstream recommendation
(the player would still show as available).

## Provider gotchas

(ESPN/Yahoo items are roadmap notes, preserved for when that work starts; see `PLAN.md` for full
detail.)

- Sleeper is unauthenticated and explicitly read-only (no API token exists) — every feature is
  advisory, never "set my lineup for me."
- ESPN's `SWID` cookie value **includes its surrounding braces** (`{ABC-123}`) — don't strip them.
- Yahoo tokens last ~1 hour; refresh tokens are rotating, atomically replace on refresh; append
  `?format=json` (default is XML); use a real deployed HTTPS callback, not localhost.

## Commands

```
npm run install:all    # installs frontend/ and api/ deps
npm run dev             # frontend dev server (Vite)
npm run build            # builds api then frontend (stages data/ into frontend/public/data first)
npm test                  # frontend + api test suites (vitest, --run) — outer loop, once per task
npm run test:frontend -- path/to/file.test.ts   # inner loop; directory paths work too
npm run test:api -- path/to/file.test.ts
npm run typecheck         # tsc --noEmit, both packages
npm run verify:artifact   # asserts frontend/dist/ contains the required config + data files
npm run pipeline           # python pipeline/build_data.py — regenerates data/*.json
npm run backtest            # opt-in 2025 historical draft-strategy backtest (5 arms); slow
npm run probe:simsort       # opt-in Stage C sim-sort disagreement probe; cheap, non-gating
npm run snapshot:vintage -- --date YYYY-MM-DD [--dest DIR]  # list/materialize layer D data vintages (git tags)
```

Azure provisioning (`infra/main.bicep`) and `az login` are interactive, and not needed for the
active Sleeper path — not something to run unprompted.

## Agent verification loop

Follow `AGENTS.md`. Inner loop: the sibling test file or directory, re-run only that on failure.
Outer loop: `npm test` **once** when the task is done if runtime code changed; if it is green, stop.
Do not stack typecheck + full test + build + `verify:artifact` as a ritual. Do not run `backtest` /
`probe:simsort` / `pipeline` / `STAGE_C_BENCH` unless that is the task. Browser only for UI/layout/
routing/client-state/rendered-data changes. Docs-only diffs: run nothing.

## Testing philosophy

- Engine logic: tests on committed fixtures and the real committed `data/` output, no mocks.
  `npm test` fails on zero test files (`--passWithNoTests` removed). `engine.test.ts` covers scoring
  diagnostics, FLEX/SUPER_FLEX counterexamples, draining-pool replacement/VOR, tier boundaries,
  availability boundaries, crosswalk-miss handling, and end-to-end determinism.
- Stage C: `recommendStageC.test.ts`/`recommendSimulation.test.ts` cover `buildRolloutPool`,
  analytic plan sorting, cache-key invalidation, and the fallback matrix (off-clock, zero-scenario,
  null-follow-up, timed-out); `recommendSimulation.integration.test.ts` runs the real (unmocked)
  simulator end to end; **`recommendPerformance.test.ts` pins `DEFAULT_SCENARIOS` against real
  `data/` — read its file doc before changing scenario counts or engine hot paths.**
- Data-layer helpers (`frontend/src/data/`): tested against real `data/*.json` invariants (unique
  player IDs, finite/non-negative stats, valid ADP ranges) and `fixtures/sleeper/` for the
  degraded-data-mode resolver.
- Adapters: each adapter is tested against its own recorded fixtures (`sleeper.test.ts`,
  `espn*.test.ts`, `draftOrder.test.ts`); a single shared contract suite run against every
  provider's fixtures — monotonic `overall`, `slotToTeam` covering all teams, no duplicate
  `playerId` — is still to build.
- Pipeline: crosswalk coverage gate — CI fails if the match rate against Sleeper's top 300 by ADP
  drops below threshold. This is how rookie-season ID gaps get caught before draft day.
- Acceptance is the **clock test**: pick lands upstream → updated recommendation on screen, target
  under 3 seconds, against real Sleeper mock drafts — the only way to test live polling honestly.

