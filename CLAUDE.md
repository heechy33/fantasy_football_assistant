# Fantasy Football Assistant

Live draft assistant + season co-pilot for Sleeper, ESPN, and Yahoo fantasy football. See
`PLAN.md` for the full scope, rationale, and phase breakdown — this file is conventions and
commands only.

## Active scope: Sleeper-first

The project is currently in a **Sleeper-only edge-validation phase** (see `PLAN.md`, "Status and
decision"). The active goal is a single narrow product: track a Sleeper PPR one-QB redraft snake
draft live and recommend the best pick with an explanation and honest uncertainty.

ESPN, Yahoo, Cosmos DB, and SWA auth are **preserved roadmap, not active work**. Do not start
building the ESPN or Yahoo adapters, provision Cosmos, or wire up `/.auth/*` login just because the
Sleeper UI looks done — `PLAN.md`'s "Expansion rule" gates that: work on those only starts once the
Edge Validation Gate in `PLAN.md` passes, or the user explicitly changes priority. Provider research
and scaffolding (`infra/main.bicep`, the `ProviderAdapter` contract, the credential types below) are
kept in the repo deliberately — they're future work, not dead code to delete.

## Tech stack

- **Frontend**: React + Vite + TypeScript, deployed as Azure Static Web Apps (Free plan)
- **API**: Azure Functions, Node 22, TypeScript, **HTTP triggers only** (SWA Free doesn't support
  timers/Durable Functions — no code should assume a server-side scheduler exists). Currently just
  a `/api/health` scaffold endpoint; no provider endpoints exist yet.
- **Data pipeline**: Python, runs via GitHub Actions cron (not Azure — that's the scheduler)
- **Draft engine**: pure TypeScript running client-side in a Web Worker, not the API — see
  "Why no auth/Cosmos in the active path" below. Nothing under this is built yet either.
- **DB**: Cosmos DB, free tier (1000 RU/s + 25 GB), provisioned throughput — **not serverless**,
  and `enableFreeTier` can only be set at account creation, never after. **Roadmap only** — not
  needed or provisioned for the active Sleeper path.
- **Auth**: SWA's built-in GitHub/Entra ID login (`/.auth/*`). **Roadmap only.** The active path
  needs no login — Sleeper needs just a username/user ID and is read-only. `/api/*` in
  `frontend/public/staticwebapp.config.json` must stay reachable by `anonymous` while this is true;
  don't gate it behind `authenticated` until real auth work begins.
- **Hosting cost target: $0/month.** Any change that would incur cost needs a deliberate call-out.

## Repo layout

What's actually on disk right now (mostly scaffold — no engine, no components, no provider
adapters exist yet):

```
frontend/src/       App.tsx, main.tsx, vite-env.d.ts   (default Vite scaffold, nothing built)
frontend/public/    staticwebapp.config.json, (generated) data/
api/src/
  index.ts
  functions/health.ts   the only endpoint that exists
shared/types.d.ts   the frontend/api contract — type-only, see below (NOT types.ts)
pipeline/           build_data.py, sources.py, transform.py, match.py, requirements.txt
data/               generated JSON, committed to the repo (served from the CDN)
infra/main.bicep    Cosmos DB + SWA Bicep — roadmap infra, not provisioned/active
```

The **active target layout** for the Sleeper-only build (`PLAN.md`, "Active repository layout") —
build toward this, not the older ESPN/Yahoo-inclusive layout:

```
frontend/src/
  engine/            pure functions, no network/provider awareness
    scoring.ts eligibility.ts lineupValue.ts replacement.ts tiers.ts
    availability.ts opponentModel.ts simulate.ts recommend.ts
  workers/draftEngine.worker.ts
  adapters/sleeper.ts        the only active adapter — espn.ts/yahoo.ts are roadmap
  data/              manifest/data-health helpers (not engine logic, not provider-aware)
    dataInvariants.ts dataHealth.ts
  components/
    ConnectSleeper DraftBoard MyRoster RecommendationPanel
    DataHealth ManualPickCorrection
  hooks/useDraftPoll.ts
shared/types.d.ts
pipeline/
data/
fixtures/sleeper/    hand-authored/recorded Sleeper league/draft/picks fixtures for tests
```

`api/_shared/providers/` (`espn.ts`, `yahoo.ts`, `cosmos.ts`, `crypto.ts`) is a **roadmap** path
from the pre-revision plan — don't create it until Yahoo/ESPN work actually starts. The API and
`infra/` directories stay in the repo for that later phase; don't delete them.

## Core conventions

**Canonical player ID is `sleeper_id`.** Sleeper's projections/stats/players endpoints are the
data spine; ESPN and Yahoo ids get translated to it via the DynastyProcess crosswalk at the
adapter boundary (roadmap). Nothing above the adapter layer should hold a provider-specific player
id.

**Stat and scoring keys use Sleeper's vocabulary** (`rush_yd`, `rec`, `rec_td`, `fum_lost`, …).
Projected points are always `Σ stat[k] × league.scoring[k]` over matching keys — an unrecognized
key is "not scored," not an error. ESPN/Yahoo adapters, when built, own translating *their* scoring
settings into this vocabulary; that translation happens once at the boundary, never inside the
engine.

**`shared/types.d.ts` must stay type-only** — interfaces and type aliases only, no runtime exports
(no consts, functions, enums). It's a `.d.ts`, not `.ts`, on purpose: `tsc` never emits JS for
declaration files, so both `frontend/tsconfig.json` and `api/tsconfig.json` can include it without
`rootDir` conflicts, and the `.d.ts` extension structurally prevents accidental runtime exports. If
you need a runtime constant shared by both sides, put it in the side that owns the concept and let
the other import the type only.

**League format is three independent dimensions, not one union.** `LeagueSettings.format` is a
`LeagueFormat` with separate `reception` (`standard`/`half-ppr`/`ppr`/`custom`), `qb`
(`one-qb`/`two-qb`/`superflex`), and `draft` (`snake`/`linear`/`auction`) fields — PPR and two-QB
are not mutually exclusive, so don't reintroduce a single `scoringFormat` union. The raw
`LeagueSettings.scoring` map and `startingSlots`/`rosterSlots` remain authoritative for actual
scoring/roster logic; `format` only selects ADP sets and UI defaults.

**Provider adapters implement `ProviderAdapter`** (`shared/types.d.ts`) and are the *only* place
provider-specific knowledge lives — endpoint shapes, cookie formats, ESPN's integer position/team
maps, OAuth flows. Code above the adapter layer must not branch on `provider`. Only
`adapters/sleeper.ts` is active work right now; the interface stays provider-general so ESPN/Yahoo
slot in later without changing anything above the adapter boundary.

**The draft init/poll split is load-bearing, not incidental:**
- `init(cred, draftId)` — called once per draft. Settings, roster slots, scoring, full player
  pool. Can be slow; correctness over speed.
- `picks(cred, draftId)` — polled every 2-3s during a live draft. **Must resolve to exactly one
  upstream GET.** This is the only hot path in the product; don't add work to it.

**Engine modules (`frontend/src/engine/**`) are pure functions** of
`(settings, state, projections) → result`. No network calls, no provider awareness, no mocks
needed — they're tested directly against committed fixtures. **Do not implement the old
`VOR × need × (1/tier_gap) / P_available` formula** — it inverts tier urgency and is unbounded by
`P_available`. The corrected design (slot-aware marginal roster value, bounded tier urgency, VONA
opponent-pick rollouts) is specified in `PLAN.md`, "Recommendation engine".

**Never silently drop an unmatched player.** A crosswalk miss produces `playerId: null` on a
`Pick`; surface it in the UI rather than dropping it, because a silently-missing pick corrupts
every downstream recommendation (the player would still show as available).

**Provider-specific gotchas** (see `PLAN.md` for full detail; ESPN/Yahoo items are roadmap notes,
preserved for when that work starts):
- ESPN's `SWID` cookie value **includes its surrounding braces** (`{ABC-123}`) — don't strip them.
- Yahoo access tokens last ~1 hour; refresh tokens are long-lived and rotating but not guaranteed
  never to expire — if a refresh response supplies a new token, atomically replace the old one.
  Append `?format=json` to Yahoo requests (default response is XML). Use a real deployed HTTPS
  callback, not `localhost`, and verify current registration behavior before assuming otherwise.
- Sleeper is unauthenticated and explicitly read-only (no API token exists because nothing can be
  modified) — every feature is advisory, never "set my lineup for me."

## Commands

```
npm run install:all    # installs frontend/ and api/ deps
npm run dev             # frontend dev server (Vite)
npm run build            # builds api then frontend (stages data/ into frontend/public/data first)
npm test                  # frontend + api test suites (vitest, --run)
npm run typecheck         # tsc --noEmit, both packages
npm run verify:artifact   # asserts frontend/dist/ contains the required config + data files
npm run pipeline           # python pipeline/build_data.py — regenerates data/*.json
```

Azure provisioning (`infra/main.bicep`) and `az login` are interactive, and not needed for the
active Sleeper path anyway — not something to run unprompted.

## Testing philosophy

- Engine logic: unit tests on committed fixtures, no mocks (see "pure functions" above). Engine
  modules don't exist yet — the exit criterion is that `npm test` fails on zero test files, not
  that it silently passes (`--passWithNoTests` is removed once real tests exist).
- Data-layer helpers (`frontend/src/data/`): tested against the real committed `data/*.json` for
  invariants — unique player IDs, finite/non-negative stats, valid ADP ranges — and against
  `fixtures/sleeper/` for the degraded-data-mode resolver.
- `fixtures/sleeper/` currently holds **hand-authored** fixtures matching Sleeper's documented API
  shapes and `shared/types.d.ts` — not recordings of a real draft. Swap these for real recorded
  Sleeper mock-draft fixtures once S1 (live Sleeper connection) lands.
- Adapters: one shared contract-test suite run against each provider's recorded fixtures —
  asserts monotonic `overall`, `slotToTeam` covering all teams, no duplicate `playerId`.
  (Roadmap — only relevant once more than the Sleeper adapter exists.)
- Pipeline: crosswalk coverage gate — CI fails if the match rate against Sleeper's top 300 by ADP
  drops below threshold. This is how rookie-season ID gaps get caught before draft day.
- The real end-to-end acceptance test is the **clock test**: time from a pick landing upstream to
  an updated recommendation on screen, target under 3 seconds. Validate against real Sleeper mock
  drafts — that's the only way to test live polling honestly.
