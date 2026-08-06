# Fantasy Football Assistant

Live draft assistant + season co-pilot for Sleeper, ESPN, and Yahoo fantasy football. See
`PLAN.md` for the full scope, rationale, and phase breakdown — this file is conventions and
commands only.

## Tech stack

- **Frontend**: React + Vite + TypeScript, deployed as Azure Static Web Apps (Free plan)
- **API**: Azure Functions, Node 22, TypeScript, **HTTP triggers only** (SWA Free doesn't support
  timers/Durable Functions — no code should assume a server-side scheduler exists)
- **Data pipeline**: Python, runs via GitHub Actions cron (not Azure — that's the scheduler)
- **DB**: Cosmos DB, free tier (1000 RU/s + 25 GB), provisioned throughput — **not serverless**,
  and `enableFreeTier` can only be set at account creation, never after
- **Auth**: SWA's built-in GitHub/Entra ID login (`/.auth/*`) — no custom auth code
- **Hosting cost target: $0/month.** Any change that would incur cost needs a deliberate call-out.

## Repo layout

```
frontend/src/
  engine/          pure functions: scoring, vor, tiers, needs, draft/*, season/*
  components/      DraftBoard, RecommendationPanel, LineupOptimizer, WaiverBoard, TradeAnalyzer
  hooks/           useDraftPoll.ts
api/
  _shared/providers/   sleeper.ts, espn.ts, yahoo.ts — implement ProviderAdapter
  _shared/             espn-constants.ts, crypto.ts, cosmos.ts
  <function-name>/    one folder per HTTP-triggered function
shared/types.ts    the frontend/api contract — type-only, see below
pipeline/          build_data.py, weekly.py, requirements.txt
data/              generated JSON, committed to the repo (served from the CDN)
infra/             main.bicep
```

## Core conventions

**Canonical player ID is `sleeper_id`.** Sleeper's projections/stats/players endpoints are the
data spine; ESPN and Yahoo ids get translated to it via the DynastyProcess crosswalk at the
adapter boundary. Nothing above the adapter layer should hold a provider-specific player id.

**Stat and scoring keys use Sleeper's vocabulary** (`rush_yd`, `rec`, `rec_td`, `fum_lost`, …).
Projected points are always `Σ stat[k] × league.scoring[k]` over matching keys — an unrecognized
key is "not scored," not an error. ESPN/Yahoo adapters own translating *their* scoring settings
into this vocabulary; that translation happens once at the boundary, never inside the engine.

**`shared/types.ts` must stay type-only** — interfaces and type aliases only, no runtime exports
(no consts, functions, enums). It's included by both `frontend/tsconfig.json` and
`api/tsconfig.json`; because types erase at compile time, neither build gets a runtime dependency
on it. If you need a runtime constant shared by both sides, put it in the side that owns the
concept and let the other import the type only.

**Provider adapters implement `ProviderAdapter`** (`shared/types.ts`) and are the *only* place
provider-specific knowledge lives — endpoint shapes, cookie formats, ESPN's integer position/team
maps, OAuth flows. Code above the adapter layer must not branch on `provider`.

**The draft init/poll split is load-bearing, not incidental:**
- `init(cred, draftId)` — called once per draft. Settings, roster slots, scoring, full player
  pool. Can be slow; correctness over speed.
- `picks(cred, draftId)` — polled every 2-3s during a live draft. **Must resolve to exactly one
  upstream GET.** This is the only hot path in the product; don't add work to it.

**Engine modules (`frontend/src/engine/**`) are pure functions** of
`(settings, state, projections) → result`. No network calls, no provider awareness, no mocks
needed — they're tested directly against committed fixtures.

**Never silently drop an unmatched player.** A crosswalk miss produces `playerId: null` on a
`Pick`; surface it in the UI rather than dropping it, because a silently-missing pick corrupts
every downstream recommendation (the player would still show as available).

**Provider-specific gotchas** (see `PLAN.md` "Provider notes" for the full detail):
- ESPN's `SWID` cookie value **includes its surrounding braces** (`{ABC-123}`) — don't strip them.
- Yahoo rejects `localhost` redirect URIs; OAuth callback must be a real HTTPS URL, so register it
  against the deployed SWA URL and use that for local dev too. Append `?format=json` to Yahoo
  requests (default response is XML). Yahoo refresh tokens don't expire — store once, mint access
  tokens per session, refresh around the 55-minute mark.
- Sleeper is unauthenticated and explicitly read-only (no API token exists because nothing can be
  modified) — every feature is advisory, never "set my lineup for me."

## Commands

```
npm run install:all   # installs frontend/ and api/ deps
npm run dev            # frontend dev server (Vite)
npm run build           # builds api then frontend
npm test                 # frontend + api test suites (vitest, --run)
npm run typecheck        # tsc --noEmit, both packages
npm run pipeline          # python pipeline/build_data.py — regenerates data/*.json
```

Azure provisioning (`infra/main.bicep`) and `az login` are interactive — not something to run
unprompted.

## Testing philosophy

- Engine logic: unit tests on committed fixtures, no mocks (see "pure functions" above).
- Adapters: one shared contract-test suite run against each provider's recorded fixtures —
  asserts monotonic `overall`, `slotToTeam` covering all teams, no duplicate `playerId`.
- Pipeline: crosswalk coverage gate — CI fails if the match rate against Sleeper's top 300 by ADP
  drops below threshold. This is how rookie-season ID gaps get caught before draft day.
- The real end-to-end acceptance test is the **clock test**: time from a pick landing upstream to
  an updated recommendation on screen, target under 3 seconds. Validate against real provider mock
  drafts (all three offer them free) — that's the only way to test live polling honestly.
