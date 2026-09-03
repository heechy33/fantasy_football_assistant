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

## Active scope: Yahoo from-scratch track open (A1); A2 (Yahoo adapter + OAuth) still unopened

The Sleeper edge track is **complete** and the Edge Validation Gate **closed and authorized on
2026-08-30** (`DECISIONS.md`, 2026-08-30 (6)). Roadmap expansion is unlocked by evidence — it no
longer needs an exception or priority change.

**Yahoo from-scratch track (A1) opened 2026-09-01** (`DECISIONS.md`, 2026-09-01) — driven by a hard
draft date (the user's Yahoo league drafts 2026-09-05, two weeks before the Yahoo dev API key
window). Phase 1 (universal manual-mode hardening: from-scratch session, click-to-draft
affordance, persistence v3→v4 bump) shipped 2026-09-01. Phase 2 (Yahoo ADP engine board —
`pipeline/yahoo_adp.py` modeled on `pipeline/espn_adp.py`, all three Yahoo-served formats:
standard / half-ppr / ppr) shipped 2026-09-01 (later) — the data plane and frontend wiring
are landed, and the pipeline produced all three `data/adp-yahoo-<fmt>.json` artifacts on
2026-09-02. The Yahoo adapter + OAuth track (A2) remains unopened — opening it
still needs its own dated decision in `DECISIONS.md`. The rest of the roadmap below is a
menu, not a plan: opening any other specific track (ESPN in-season, new formats, in-season
features) is its own dated decision recorded in `DECISIONS.md`, with a `PLAN.md` status update.

**Adapter-free provider lane (new, 2026-09-01).** A Yahoo from-scratch session runs through the
`Session` kind: 'manual' with `provider: 'yahoo'` and `frozenInit.settings.provider === 'yahoo'` —
no `DraftProviderAdapter` is implemented for Yahoo. The existing ESPN/Sleeper adapter families
under `frontend/src/adapters/espn*.ts` and `frontend/src/adapters/sleeper.ts` are unchanged.
The chip-driven click-to-log flow in `components/DraftLauncher.tsx` opens
`components/YahooDraftSetup.tsx` (new); the create flow commits via `handleYahooStart` (new) on
`session/DraftSessionProvider.tsx`, which is a thin wrapper over the existing
`handleTakeoverManual` path. The Phase 2 (now shipped) work was a *data* lane
(`pipeline/yahoo_adp.py` + `pipeline/sources.py`'s `fetch_yahoo_draft_analysis_html`), not an
adapter — Yahoo's draft picks still come from the user clicking cards in the Yahoo draft
room, never from a poll.

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
  Yahoo draft analysis is a client-rendered page; `pipeline/requirements.txt` includes Playwright,
  and the refresh workflow installs its Chromium browser before running the pipeline. For a local
  setup, run `python -m playwright install chromium` once after installing the requirements.
- **Draft engine**: pure TypeScript. Stage C (VONA rollouts) runs in a long-lived Web Worker
  (`frontend/src/workers/recommendation.worker.ts` + `hooks/useRecommendationRefinement.ts`, shipped
  in `f821318`) initialized at pool load with cooperative cancel of superseded requests; a
  deterministic main-thread fallback board keeps the UI usable if the worker fails or is
  unavailable.
- **DB/Auth**: Cosmos DB free tier is LIVE behind Clerk — authenticated Functions at
  `/api/leagues` + `/api/drafts` persist SavedLeague/SavedDraft docs (phases 4-5 shipped), with
  SWA's built-in `/.auth/*` unwired (Clerk's JWT check in `api/src/functions/authGuard.ts` is the
  enforcement point). Keep `/api/*` `anonymous` in `frontend/public/staticwebapp.config.json` —
  the Bearer token, not SWA roles, gates writes.
- **Hosting cost target: $0/month** — any change that incurs cost needs a deliberate call-out.

## Repo layout (highlights — the code is the full map)

- `frontend/src/engine/` — pure functions, no network/provider awareness. `recommend.ts` wires
  the analytic one-pick `planValue`, Stage C rollouts, and the deterministic board sort (marginal
  roster utility → VOR → projected points → player id). (The old Draft Score residual tie-break /
  card composite has been deleted.)
- `frontend/src/adapters/` — `sleeper.ts`/`draftOrder.ts` are the only in-season/live-poll
  adapters. `espn*.ts` are draft-day-only from the closed exception — **do not extend into an
  in-season ESPN adapter without a new decision** (`espnLeague.ts` is the same exception, one page
  wider: it parses the extension's league-page capture into `EspnLeagueSnapshot`/`LeagueSettings`
  — the ONLY place ESPN slot ids/statIds are translated; unmapped values become diagnostics).
  A Yahoo live/draft adapter isn't created yet; the current Yahoo path is the adapter-free
  click-to-log session plus the pipeline's public ADP data lane.
- `frontend/src/data/` — context/data-health/player-pool helpers (not engine logic), incl.
  `percentileRankings.ts`/`qbPercentileRankings.ts`/`cardRoleStats.ts` (Role-tab and card-bottom
  cohort percentile ranking, display-only, never feeds `planValue`). `state/`, `hooks/`,
  `components/`, `styles/tokens.css` — draft-board state, UI. `styles/leagues.css` is the
  leagues/connect design system (meta-chips, slot-pills, league tiles, the provider chooser, the
  ESPN league-summary card) — no `--border-1/2/3` used decoratively there, those stay reserved for
  focusable controls per tokens.css's own doc. `DraftWorkspace` + `MyTeamRail` +
  `RecommendationBoard` / `PlayerCard` (+ its row twin `PlayerBoardRow`, shared logic in
  `playerBoardFace.ts`) + `PlayerDetailDrawer` are the current workspace components (earlier
  `DraftBoard`/`RecommendationPanel` sketches were superseded; don't recreate them).
  `RecommendationBoard.tsx`'s "All" tab always excludes K/DEF, and excludes QBs once
  `format.qb === 'one-qb'` and the starting QB slot is filled (see `DECISIONS.md`, 2026-08-22) —
  both are presentation filters, not engine changes; position tabs are never filtered.
- `frontend/src/routes/` — the route tree (`App.tsx` composes it): `AppLayout` (nav shell),
  `LandingRoute`, `DraftGuideRoute` (public), `DraftRoomRoute` (disconnected state = `DraftLauncher`,
  which auto-lists the remembered Sleeper account's drafts, hard-gates ESPN start on the extension
  being present, and never navigates; a finished draft shows a `.draft-complete-banner`, never
  auto-navigates away), `LeaguesRoute` (the `/leagues` hub — SavedLeague cards that are LINKS to
  `LeagueDetailRoute` (`/leagues/:leagueId`, summary + drafted team) plus Remove; replaced the
  retired `TeamsPage`), `ConnectLeagueRoute` (`/leagues/connect`, the ONE connect surface — SAVE-ONLY,
  never starts a draft; a provider chooser with Sleeper active by default; `routes/onboarding/
  OnboardingLeague` aliases it for the wizard step, where it drops its own page heading —
  `OnboardingLayout` already supplies one), and `routes/onboarding/`. The 2026-08-27 connect/start
  split: saving a league (SavedLeague pointer) happens on the connect surface; starting a draft
  happens only in the Draft Room launcher, reconciled by `state/draftSync.ts`. The landing renders
  illustrations with a CTA only. `session/DraftSessionProvider` sits above `<Routes>` so the live
  poll survives navigation; `session/completion.ts` is the one place a live session (Sleeper poll,
  ESPN bridge, or manual log) is flagged finished, driving the `{ kind: 'complete' }` session state.
- `extension/` — draft-day-only ESPN Chrome extension (closed exception), not an in-season sync
  product. Content scripts run on the ESPN DRAFT pages (socket/pick capture) and, since the
  2026-08-27 connect split, also on the LEAGUE page (`/football/league*`) — where the league's own
  API JSON is captured (redacted, verbatim, its own storage key) so `/leagues/connect` can save a
  real ESPN league. Still read-only, still no cookies; DOM pick recon stays draft-page-scoped.
- `frontend/src/data/savedLeaguesRepository.ts` + `repositories/httpRepository.ts` — the single
  repository seam (`useSavedLeagues.ts` consumes it for UI pages; `state/draftSync.ts` mirrors
  sessions through it). `data/useSleeperAccount.ts` derives the remembered Sleeper account (id +
  username) from the most recently updated Sleeper `SavedLeague` — the one place that lookup
  happens; `data/season.ts` holds the shared `CURRENT_SEASON`. `state/persistence.ts` (localStorage
  `ffa.draftSession.v3`) holds ONLY the active draft-session record for refresh-resume — never
  league data — including a `complete` mode so a refresh on the completion banner restores the
  banner rather than resurrecting a live poll; cleared only when a draft session ends
  (`handleChooseAnotherDraft`/`handleReturnToConnect`).
- `api/src/functions/health.ts`, `leagues.ts`, `drafts.ts`. Leagues upserts are idempotent on
  `(userId, provider, providerLeagueId)` — never assume an absent client id means "new doc".
  `shared/types.d.ts` is the frontend/api contract, type-only.
- `pipeline/` (`build_data.py`, `sources.py`, …) → `data/` — committed JSON consumed by the app
  (incl. `weekly-ppr.json`). `data/adp-ffc-*.json` and `data/adp-underdog-bestball.json` are
  **display-only** lanes (Market ADP tile only) — never an engine input, never blended into
  `data/adp-*.json`'s redraft-engine boards (`DECISIONS.md`, 2026-08-24). The FantasyPros stars/SOS
  decoration pipeline was cut entirely (`DECISIONS.md`, 2026-08-23/24) — do not re-add it without a
  new decision. `data/player-status-overrides.json` is the one hand-maintained input under `data/`
  (everything else there is pipeline output) — same-day availability corrections (a commissioner's
  exempt-list move, a suspension) that a feed hasn't caught up to yet; always wins over Sleeper's
  own `status` field (`pipeline/transform.py`'s `resolve_availability`/`apply_status_overrides`).
- `fixtures/sleeper/` — recorded contract fixtures: **nine real recorded Sleeper mocks** committed
  since `ad2802b` (2026-08-13), ~90-92% autodrafted, so machinery-grade rather than human-shape; the
  remaining 14 flat files (scoring, players, partial drafts, …) are hand-authored.
  `fixtures/underdog/` — a committed contract fixture (recorded Sharp Football Analysis HTML,
  read by `pipeline/test_underdog_adp.py`), not recon scratch. `fixtures/espn-contract/` — same
  idea: two recorded-and-scrubbed ESPN live-stream slices read by `espnOffset.test.ts` — committed
  because a test fixture has to survive a fresh checkout (CI has no `fixtures/espn/` on disk).
  `fixtures/espn/` itself stays gitignored recon scratch, not contract fixtures — don't add a test
  dependency on anything under it. `infra/main.bicep` — roadmap. `archive/` — completed-phase
  history (`PLAN-history.md`), the condensed-away decision detail (`DECISIONS-history.md`), and
  gitignored cursor-plan scratch.
- `benchmarks/reports/` — dated harness output. The human-readable `.md` reports are **tracked**
  since 2026-08-30 (they carry the Edge Validation Gate evidence); `.json`/`.log` machine output
  stays gitignored.
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

(ESPN/Yahoo OAuth and live-adapter items are roadmap notes, preserved for when that work starts;
the Yahoo public ADP data lane is already active. See `PLAN.md` for full detail.)

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
- Color tokens (`frontend/src/styles/`): `teamColors.test.ts` and `tokens.contrast.test.ts` are
  real WCAG gates, not smoke tests — both parse `tokens.css`'s live values (never hardcode a
  surface/text hex) and assert real contrast ratios, including a 15:1 halation ceiling on
  `--text-1`/`--surface-0` alongside the usual 4.5:1/3:1 floors. Any token value change should run
  `npm run test:frontend -- src/styles`.
- Adapters: each adapter is tested against its own recorded fixtures (`sleeper.test.ts`,
  `espn*.test.ts`, `draftOrder.test.ts`); a single shared contract suite run against every
  provider's fixtures — monotonic `overall`, `slotToTeam` covering all teams, no duplicate
  `playerId` — is still to build.
- Pipeline: crosswalk coverage gate — CI fails if the match rate against Sleeper's top 300 by ADP
  drops below threshold. This is how rookie-season ID gaps get caught before draft day.
- Acceptance is the **clock test**: pick lands upstream → updated recommendation on screen, target
  under 3 seconds, against real Sleeper mock drafts — the only way to test live polling honestly.

