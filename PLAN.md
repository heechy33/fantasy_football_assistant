# Fantasy Football Co-Pilot — Scope & Build Plan

## Context

`C:\Projects\fantasy_football_assistant` is an empty git repo. This is a greenfield build of a
season-long fantasy football assistant across Sleeper, ESPN, and Yahoo:

1. **Live draft assistant** — tracks every pick as it lands, tells you who to take next and why
2. **Post-draft grades** — how did every team in your league do
3. **In-season lineup tools** — weekly start/sit with matchup context
4. **Waiver assistant** — who to add, who to drop, backed by league-wide trending data
5. **Trade analyzer** — who wins a proposed trade, rest-of-season

**Decisions made:** TypeScript/Node 22 API · multi-user from day 1 · VOR+tiers+need engine ·
Azure ($100 student credit, 12 months).

### The calendar phases this for us

Today is **Aug 5, 2026**. This isn't an arbitrary scope decision — the season imposes the order:

| Feature | Needed by | Runway |
|---|---|---|
| Draft assistant | drafts run mid-to-late Aug | **~2-3 weeks. Hard deadline.** |
| Post-draft grades | right after your draft | ~3 weeks |
| Lineup / start-sit | NFL week 1, ~Sept 10 | ~5 weeks |
| Waiver assistant | week 2, ~Sept 17 | ~6 weeks |
| Trade analyzer | weeks 3-10 | ~7 weeks |

So the full scope is buildable without conflict: the draft assistant ships first because it *must*,
and every in-season feature gets 2–4 more weeks of runway. Total ~30 working days across ~7 weeks,
shipping continuously rather than in one drop.

### One product-wide constraint: advisory, not automated

**Sleeper's API is explicitly read-only** — "No API Token is necessary, as you cannot modify contents
via this API." So we recommend lineups and waiver claims; you execute them in your league's app.
This is exactly where the paid tools land too (FantasyPros: "The app will not make the draft picks
for you"). Worth stating up front so it's a design decision, not a late surprise.

---

## Correction: why the OSS libraries fetch "all that data" — and why we do too

My earlier framing was wrong, and the code says something more useful. From
`espn_api/football/league.py`, `League()` calls `_fetch_league()`, which does exactly this:

```python
def _fetch_league(self):
    data = super()._fetch_league(SettingsClass=Settings)   # 1. league + scoring/roster settings
    self.nfl_week = data['status']['latestScoringPeriod']
    self._fetch_players()                                  # 2. full player pool
    self._fetch_teams(data)                                # 3. teams + _get_all_pro_schedule()
                                                           #    + 18 weeks of opponents
                                                           #    + margin-of-victory
    super()._fetch_draft()                                 # 4. draft picks
```

**We need all four — the same data, in the same volume.** You can't compute value over replacement
without the full player pool, or apply your scoring without the settings. Your instinct was right;
I mis-stated it. And now that in-season features are in scope, **item 3 is ours too** — the pro
schedule and weekly opponents are precisely what start/sit advice runs on. There is no longer any
part of that fetch we don't want.

The real difference is **cadence**:

| Path | Frequency | Shape |
|---|---|---|
| **Init** — settings, roster slots, scoring, player pool | once per draft / once per week | Library-shaped. Latency irrelevant. |
| **Poll** — new picks | **every 2-3s during a draft** | One hand-rolled targeted GET. The only hot path in the product. |
| **Weekly** — projections, stats, matchups, free agents | once or twice a day | Batch, offline, in the pipeline. |

`espn-api` couples all four fetches into one object construction, so seeing a single new pick means
re-running everything or reaching into the private `_fetch_draft()`. That coupling — not the data
volume — is the reason we hand-roll the poll path.

**What we deliberately lift from `espn-api`:** `POSITION_MAP` / `PRO_TEAM_MAP` (ESPN encodes
positions and pro teams as bare integers), the 401 → alternate-endpoint retry
(`/seasons/{y}/segments/0/leagues/{id}` ⇄ `/leagueHistory/{id}?seasonId={y}`), and its
`mPositionalRatings` view for matchup strength. That retry is hard-won production knowledge.

---

## What the paid services do, and what we can match

### Draft tools

| Product | Price | Live sync | Method |
|---|---|---|---|
| **DraftKick** | $59 once | Yahoo/ESPN/CBS/Sleeper (~95%) | Aggregated multi-source projections. Flagship: **projected availability** — "know when to strike." |
| **FantasyPros Draft Wizard** | ~$71/yr | Broadest — but **ESPN needs their Chrome extension** | Expert Consensus Rankings, built from *rankings* not stats. Plus league-mate tendencies. |
| **Draft Sharks War Room** | ~$96/yr | All major | "3D Projections," ADP Market Index, proprietary Injury Risk. |
| **RotoWire** | ~$83/yr | ~50% — **no ESPN** | Own projections + ADP, upside, floor, scarcity, team needs. |
| **Footballguys Draft Dominator** | ~$62/yr | Sleeper/MFL (~15%) | The original VBD tool. |
| **Draft Hero** | $46 once + à la carte | 8 platforms (~99%) | Multi-source, sold separately. Reported sync flakiness. |

**ESPN live sync is the industry's weak spot** — FantasyPros needs a browser extension for it,
RotoWire skips ESPN entirely. Your hardest provider is hard for everyone.

### In-season tools — the paid bundles map almost exactly onto what we're adding

Draft Sharks ships "Who Should I Start," "League-synced Free Agent Finder," "Redraft Trade
Navigator," "Team Intel." FantasyPros MVP ships Start/Sit Assistant, Waiver Wire Assistant, Trade
Analyzer. So the five features here are the standard premium bundle, at $60–96/yr.

### Feature-by-feature: can we build it?

**Yes, fully — free data, verified:**

| Feature | How |
|---|---|
| Live pick sync, 3 providers | Our adapters |
| **Custom league scoring** | ✅ **Structurally better than FantasyPros.** Sleeper projections return *component stats* (`rush_yd`, `rec`, `rec_td`, `fum_lost`…), so we compute true projected points under your exact settings. FantasyPros derives from rankings — the weakness DraftKick markets against. |
| VOR / VBD | Projections + replacement level from roster slots × teams |
| Tiers | 1-D gap clustering on VOR |
| ADP, value-vs-ADP bargains | FFC gives `adp`, `stdev`, `high`, `low`, `times_drafted` |
| **Projected availability** | ✅ DraftKick's flagship paid feature is a normal CDF over FFC's `stdev`. Essentially free. |
| Roster needs, positional runs, bye conflicts | Pick stream + roster slots + FFC `bye` |
| **Post-draft grades** | The draft engine run retrospectively over all teams. Nearly free. |
| **Weekly start/sit** | Sleeper weekly projections ✅ 132 RBs w/ real week-1 numbers, **includes an `opponent` field** |
| **Waiver adds/drops** | ✅ Sleeper `trending/add` + `trending/drop` — 46,674 adds in 24h on the top player. League-wide behavioural signal, free. |
| **Trade analyzer** | Rest-of-season projections + VOR delta on both rosters |

**Partial — honest gaps:**

| Gap | Detail |
|---|---|
| Multi-source projection aggregate | One source (Rotowire via Sleeper) + FFC ADP as cross-check. DraftKick's aggregate is genuinely better. Pipeline is built to take a second source. |
| Upside / floor | Point estimates, not distributions. Can approximate from ADP `stdev` + positional historical variance. |
| Injury risk | Sleeper gives `injury_status` / `injury_body_part` (current state), not a predictive model. Draft Sharks' is proprietary. |

**No, and fine:** proprietary projections (PFF grades, Draft Sharks 3D), FantasyPros ECR (licensed),
mock draft simulator (*deliberately skipped* — real provider mocks are free and make better test data).

**One paid feature we can match:** FantasyPros charges for league-mate tendency analysis. All three
providers expose your league's *past* drafts, so we can model each manager's positional habits —
"the guy ahead of you took a QB in round 3 both of the last two years." Stretch goal.

**Bottom line:** ~85% of the premium bundle on free data, structurally better on custom scoring,
DraftKick's flagship metric for free. Replaces $60–96/yr.

---

## Architecture

```
┌─ Azure Static Web Apps (Free plan) ──────────────────────────────┐
│  frontend/  React + Vite + TS                                    │
│    Draft: board · recommendation panel                            │
│    Season: lineup optimizer · waiver board · trade analyzer       │
│    · ENGINE RUNS CLIENT-SIDE (all features)                       │
│                                                                  │
│  data/  static JSON on the CDN (committed by pipeline)            │
│    players · projections/season · projections/week-N · stats      │
│    adp · crosswalk · trending · defense-vs-position               │
│                                                                  │
│  api/  managed functions, node:22, TS  ── HTTP triggers only      │
│    GET  /api/leagues                                              │
│    GET  /api/draft/{prov}/{id}/init     ← ONCE per draft           │
│    GET  /api/draft/{prov}/{id}/picks    ← POLLED every 2-3s        │
│    GET  /api/league/{prov}/{id}/rosters ← in-season, on demand     │
│    GET  /api/league/{prov}/{id}/free-agents                       │
│    POST /api/connect/espn  ·  GET /api/yahoo/login|callback        │
│                                                                  │
│  /.auth/*  built-in GitHub / Entra login (free, zero code)         │
└──────────────────────────────────────────────────────────────────┘
        │                              │
  ┌─────▼──────────┐      ┌────────────▼─────────────┐
  │ Cosmos DB      │      │ Sleeper / ESPN / Yahoo    │
  │ (free tier)    │      └──────────────────────────┘
  │ users/{userId} │
  │  espn:  AES-GCM│      ┌──────────────────────────┐
  │  yahoo: AES-GCM│      │ GitHub Actions (Python)   │
  │  rosters, prefs│      │ THE SCHEDULER — cron       │
  └────────────────┘      │ nightly + Tue AM waivers   │
                          └──────────────────────────┘
```

**SWA Free has no timer triggers, so GitHub Actions cron is our scheduler** (free on public repos).
It runs the Python pipeline nightly in-season — weekly projections, stats, trending, defense-vs-
position — and commits to `data/`. This is a real architectural addition the draft-only scope
didn't need.

**The engine runs client-side** for every feature: projections, ADP, crosswalk, and trending are all
static CDN assets, so the browser holds every input. Zero function invocations for the expensive
part, no cold start while the draft clock runs, instant re-scoring when you toggle an assumption.

### Repo layout

```
fantasy_football_assistant/
  frontend/src/
    engine/
      scoring.ts        component stats × YOUR league scoring   ← shared by everything
      vor.ts  tiers.ts  needs.ts                               ← shared
      draft/     availability.ts runs.ts recommend.ts grades.ts
      season/    lineup.ts waiver.ts trade.ts matchup.ts
    components/  DraftBoard RecommendationPanel LineupOptimizer
                 WaiverBoard TradeAnalyzer ConnectProvider
    hooks/       useDraftPoll.ts  (adaptive interval + backoff)
  api/
    _shared/providers/  sleeper.ts espn.ts yahoo.ts index.ts (adapters)
    _shared/espn-constants.ts    ← ported from espn-api
    _shared/crypto.ts cosmos.ts
    draft-init/ draft-picks/ leagues/ rosters/ free-agents/
    connect-espn/ yahoo-login/ yahoo-callback/
  shared/       types shared by frontend + api
  pipeline/     build_data.py  weekly.py  requirements.txt
  data/         generated, committed
  infra/        main.bicep  (SWA + Cosmos free tier)
  .github/workflows/  deploy.yml  refresh-data.yml  weekly-refresh.yml
```

### Unified data model (`shared/types.ts`)

```ts
type Provider = 'sleeper' | 'espn' | 'yahoo';
type PlayerId = string;   // canonical = sleeper_id (our projections spine)

interface LeagueSettings {
  teams: number;
  rosterSlots: Record<string, number>;   // { QB:1, RB:2, WR:2, TE:1, FLEX:1, K:1, DST:1, BN:6 }
  scoring: Record<string, number>;       // { rec:1.0, rush_yd:0.1, rec_td:6, ... }
  waiverType?: 'faab' | 'rolling' | 'reverse';
  playoffStartWeek?: number;
}

// ---- Draft ----
interface DraftInit { /* teams, rounds, draftType, slotToTeam, myTeamId, mySlot, settings */ }
interface DraftPicks { status: 'pre'|'drafting'|'complete'; picks: Pick[];
                       onTheClock: {...} | null; fetchedAt: number }
interface Pick { overall: number; round: number; slot: number; teamId: string;
                 playerId: PlayerId | null;   // null = crosswalk miss, surfaced in UI
                 providerPlayerId: string }

// ---- Season ----
interface Roster { teamId: string; owner: string;
                   starters: PlayerId[]; bench: PlayerId[]; ir: PlayerId[] }
interface WeeklyProjection { playerId: PlayerId; week: number;
                             opponent: string;            // Sleeper provides this
                             stats: Record<string, number> }

interface DraftAdapter {
  listLeagues(cred): Promise<LeagueRef[]>;
  init(cred, draftId): Promise<DraftInit>;
  picks(cred, draftId): Promise<DraftPicks>;      // hot path
  rosters(cred, leagueId): Promise<Roster[]>;     // in-season
  freeAgents(cred, leagueId): Promise<PlayerId[]>;
}
```

Nothing above the adapter layer knows which provider it's talking to. That isolation is what makes
ESPN's fragility survivable, and it's what lets in-season features work on all three for free.

---

## The engine

`scoring.ts` is the foundation every feature shares — component stats × your league's scoring. Get
it right once and five features inherit it.

### Draft

```
projected_points(p) = Σ proj_stat[k] × league.scoring[k]
replacement(pos)    = Nth-best at pos,  N = teams × (starters[pos] + flex_share[pos])
VOR(p)              = projected_points(p) − replacement(p.pos)
P_available(p)      = 1 − Φ((my_next_pick − adp) / stdev)
need(p)             = f(unfilled starting slots, bye conflicts)
tier_urgency(p)     = 1 / (VOR gap to next player at same position)

score(p) = VOR(p) × need(p) × tier_urgency(p) / max(P_available(p), ε)
```

Outputs: ranked board with one-line rationale ("RB3 by VOR, 71% gone by your next pick") ·
projected availability · tier-cliff warnings ("last of tier 2 RB") · positional run detection
("4 of the last 6 were WR") · value-vs-ADP bargains · bye conflicts.

### Post-draft grades
Sum VOR across each team's roster; rank. Add best-value pick, biggest reach, positional balance vs
league average. Reuses `scoring.ts` + `vor.ts` wholesale — ~1 day.

### Lineup / start-sit
Weekly projections carry an `opponent` field, so matchup context comes free. Add
defense-vs-position strength from Sleeper weekly stats (and ESPN's `mPositionalRatings`).
Assigning players to slots under FLEX eligibility is a **bipartite matching problem** — greedy is
wrong when FLEX competes with RB2/WR2. Use Hungarian algorithm on a small matrix (~20 players ×
~10 slots); trivial at this size, and correct.
Outputs: optimal lineup, per-slot alternatives with point deltas, "start X over Y (+2.3 pts)",
bye/injury flags.

### Waiver assistant
Inputs: free agents from the provider, weekly + rest-of-season projections, and **Sleeper trending
adds/drops** — a league-wide behavioural signal most paid tools don't have this cleanly.
Outputs: ranked adds by VOR-over-your-worst-starter, drop candidates, FAAB bid suggestion as a % of
remaining budget, and **breakout detection** — players whose recent actual stats outpace their
projections (from `/stats/nfl/{season}/{week}`).

### Trade analyzer
Rest-of-season projections (sum remaining weeks, playoff weeks weighted by
`settings.playoffStartWeek`) → VOR delta for both sides → positional need delta → verdict.
Outputs: who wins and by how much, effect on each side's starting lineup, bye-week impact.

Every engine module is a **pure function** of `(settings, state, projections) → result`. No network,
no mocks — fully unit-testable on committed fixtures.

---

## Data sources (all free, all verified working)

| Source | Gives | Verified |
|---|---|---|
| `api.sleeper.app/projections/nfl/2026?season_type=regular&position[]=RB` | Season Rotowire projections, **component stats** + ADP in 6 formats. 742 rows, 139 with real projections. | ✅ 200, 700 KB |
| `api.sleeper.app/projections/nfl/2026/{week}?season_type=regular` | **Weekly** projections + **`opponent` field**. 132 RBs w/ real week-1 numbers. | ✅ 200, 490 KB |
| `api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular` | Weekly **actual** stats → breakout detection, accuracy tracking | ✅ 200, 165 KB |
| `api.sleeper.app/v1/players/nfl/trending/{add,drop}?lookback_hours=24` | League-wide waiver signal. Top player: 46,674 adds/24h. | ✅ 200 |
| `fantasyfootballcalculator.com/api/v1/adp/{ppr,half-ppr,standard,2qb}?teams=12&year=2026` | ADP + **`stdev`**, `high`, `low`, `times_drafted`, `bye`. 4,622 drafts. | ✅ 200 (`dynasty`/`rookie` empty) |
| `raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv` | Crosswalk: `sleeper_id`, `espn_id`, `yahoo_id`, `fantasypros_id`, `gsis_id`, `mfl_id`. Weekly. GPL-3.0. | ✅ all columns |
| `api.sleeper.app/v1/players/nfl` | Player metadata, ~5 MB. Cache ≤1×/day. | ✅ |

`stdev` is the quiet MVP — it turns ADP from a number into a probability. Sleeper's projections and
stats endpoints are **undocumented**; risk-managed below.

---

## Provider notes

**Sleeper** (easiest, no auth) — `/v1/user/{id}/drafts/nfl/2026`, `/v1/draft/{id}/picks`,
`/v1/league/{id}`, `/v1/league/{id}/rosters`, `/v1/league/{id}/users`. Under 1000 req/min.
**Read-only by design.** Returns `access-control-allow-origin: *` and exposes `etag`, so the browser
*could* poll directly — a free escape hatch if we brush the bandwidth quota.

**Yahoo** (moderate, OAuth2) — scope `fspt-r`. **Redirect URI must be HTTPS; Yahoo rejects
`localhost`** → deploy the SWA in Phase 0 and register
`https://<app>.azurestaticapps.net/api/yahoo/callback`, using it for local dev too. Append
`?format=json` (defaults to XML). **Refresh tokens don't expire** — store the refresh token, mint
access tokens per session, refresh at ~55 min. Defuses the "auth expiry mid-draft" risk.
⚠️ **Unverified: whether `draftresults` populates during a live draft or only after.** Test day 1 of
Phase 6. Fallback: diff `/league/{key}/players;status=T`, which definitely updates.

**ESPN** (hardest, no official API) —
`GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{id}?view=mDraftDetail`
→ `draftDetail.picks[]` fills in live. ✅ Verified 200 unauthenticated on a public league. In-season
views: `mRoster`, `mSettings`, `kona_player_info`, `mPositionalRatings`. Private leagues need
`SWID={...}` (braces included) + `espn_s2`; can't be automated — ESPN added recaptcha specifically
to block programmatic login. Ship a **bookmarklet** that reads `document.cookie` on espn.com and
one-click POSTs to `/api/connect/espn`. Browser-extension approach held in reserve.

---

## Azure free-tier findings

- **SWA Free**: managed Functions included, 100 GB/mo bandwidth, 2 custom domains, free TLS,
  500 MB storage. No SLA.
- **`node:22` supported** via `apiRuntime` in `staticwebapp.config.json`. **HTTP triggers only** —
  no timers, no Durable Functions (BYO Functions needs paid Standard). Hence: draft polling is
  client-driven, and **GitHub Actions cron is the in-season scheduler**.
- **Built-in auth free on every plan** — "All features listed in this article are available in all
  Static Web Apps plans." Preconfigured GitHub + Entra: `/.auth/login/github`, `/.auth/me` →
  `{ userId, userDetails }`. This is what makes multi-user cheap.
- **Cosmos DB free tier**: 1000 RU/s + 25 GB, account lifetime. **Opt in at creation, one per
  subscription, not available on serverless** — Bicep with `enableFreeTier: true` and provisioned
  throughput. Not toggleable later.
- **Azure for Students**: disables when the $100 credit is exhausted *or* at 12 months. We spend $0,
  so the 12-month expiry binds. Renewable while a student; otherwise upgrade to pay-as-you-go and
  the free SKUs stay free.

---

## Phases

### Track A — Draft (hard deadline: mid-to-late August)

| # | Phase | Days | Exit criteria |
|---|---|---|---|
| 0 | Repo + SWA deploy + auth | 0.5 | `/.auth/login/github` live; Yahoo redirect URI registered against the real URL |
| 1 | Data pipeline + crosswalk | 2 | `data/*.json` committed by GH Action; crosswalk hit-rate measured |
| 2 | Sleeper adapter + live board | 2 | Real Sleeper mock draft renders picks live, end to end |
| 3 | Engine core — `scoring` → `vor` → `tiers` | 2 | Unit tests green on fixtures. **Shared foundation for all 5 features.** |
| 4 | Engine draft signals — availability, runs, needs, byes, bargains | 2 | All 6 signals render during a Sleeper mock |
| 5 | Multi-user credentials | 1 | Cosmos free tier provisioned; AES-GCM round-trips per userId |
| 6 | Yahoo OAuth + adapter | 3 | Yahoo mock tracked live; **`draftresults`-live question answered day 1** |
| 7 | ESPN adapter + bookmarklet | 2.5 | ESPN mock tracked live; bookmarklet onboards a second account |
| 8 | Draft hardening | 1 | Backoff, stale-data banner, crosswalk-miss surfacing, **clock test passes** |

**Track A ≈ 16 days.** Phases 0–4 give a competitive Sleeper-only assistant in ~2 weeks — already
past most free tools. **If ESPN (Phase 7) blows past ~40% of its budget, ship Sleeper + Yahoo and
fast-follow.** The adapter interface makes that a config change, not a refactor.

### Track B — Season (rolling deadlines, Sept–Oct)

| # | Phase | Days | Ship by | Exit criteria |
|---|---|---|---|---|
| 9 | Post-draft grades | 1 | after your draft | Every team graded; best value + biggest reach called out |
| 10 | In-season data layer — weekly projections, stats, matchups, rosters, FAs + GH Actions cron | 2.5 | early Sept | `weekly-refresh.yml` green; `rosters`/`freeAgents` on all 3 adapters |
| 11 | Lineup / start-sit optimizer | 3 | **NFL wk 1, ~Sept 10** | Hungarian assignment correct under FLEX; per-slot deltas shown |
| 12 | Waiver assistant | 3 | **wk 2, ~Sept 17** | Ranked adds/drops, FAAB suggestion, breakout detection from actuals |
| 13 | Trade analyzer | 2.5 | wk 3, ~Sept 24 | Two-sided verdict w/ playoff-week weighting and lineup impact |
| 14 | Season hardening + stretch (league-mate tendencies) | 2 | Oct | Accuracy tracking: projections vs actuals, surfaced honestly |

**Track B ≈ 14 days. Grand total ≈ 30 working days over ~7 calendar weeks**, shipping continuously.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Sleeper projections + stats endpoints are undocumented** | Pipeline *commits* output to `data/`, so features run off a snapshot, not a live dependency. FFC ADP is an independent second source. Degraded mode: ADP-only board. **Highest-impact single dependency — 4 of 5 features rest on it.** |
| **Yahoo `draftresults` may not update live** | Test day 1 of Phase 6. Fallback: diff `players;status=T`. |
| **ESPN breaks without warning** | Adapter isolation; extension path in reserve; per-provider health indicator in UI. |
| **Crosswalk gaps, esp. rookies** — verified: 2026 rookies have `sleeper_id` + `espn_id` but `fantasypros_id = NA` | Fallback match on normalized `name+pos+team`. **Surface unmatched players in the UI** — one silently dropped pick corrupts every downstream recommendation. |
| **Scope is now 2× the original** | Two tracks with real calendar deadlines, not one deadline. Track A is independently shippable; Track B degrades gracefully feature by feature. |
| **Single projection source** | Honest gap vs DraftKick. Pipeline built for a second source; ADP cross-checks. |
| **Advisory only — can't set lineups or claim waivers** | Sleeper is read-only by design. Same constraint every paid tool has. Stated up front in the UI. |
| **Cold start on the poll path** | Client polling keeps the function warm; first poll may lag ~1s. Show a connecting state. |
| **Cosmos free tier is opt-in-at-creation** | Get the Bicep right the first time — not toggleable later. |
| **No SLA on SWA Free** | Acceptable for a friend group. Document it. |

## Cost

SWA Free $0 · managed Functions $0 (included) · Cosmos free tier $0 · GitHub Actions $0 (public
repo) = **$0/mo, $100 credit untouched.** Replaces $60–96/yr of subscriptions.

---

## Verification

**Mock drafts are the real test for Track A** — every provider offers them free, and they're the
only way to validate live polling before draft day.

1. **Engine unit tests** (`engine/**/*.test.ts`) — pure functions over committed fixtures. Known
   settings + partial state → assert rankings, tier boundaries, availability probabilities, and
   **optimal lineup under FLEX eligibility** (the case greedy gets wrong). In CI.
2. **Adapter contract tests** — one shared suite per provider against recorded fixtures: monotonic
   `overall`, `slotToTeam` covers all teams, no duplicate `playerId`, rosters sum to roster size.
3. **Crosswalk coverage gate** — pipeline fails CI if match rate against Sleeper's top 300 by ADP
   drops below threshold. Catches rookie ID gaps before draft day, not during.
4. **Scoring validation** — compute projected points under a known league's settings and reconcile
   against that provider's own displayed projections. This is our claimed edge; prove it.
5. **Sleeper live mock** (Phases 2, 4) — picks appear within one poll interval; all 6 signals render.
6. **Yahoo live mock** (Phase 6) — specifically: does `draftresults` update mid-draft?
7. **ESPN live mock** (Phase 7) — private league, extracted cookies, `mDraftDetail.picks[]` grows.
8. **Two-account test** (Phase 7) — a second GitHub login connects its own ESPN cookies via the
   bookmarklet and sees only its own leagues. Validates multi-user isolation.
9. **Clock test** (Phase 8) — the real acceptance test: pick landing upstream → updated
   recommendation on screen, **under 3 seconds**.
10. **Lineup backtest** (Phase 11) — run the optimizer on 2025 weekly data and compare against
    actual optimal lineups in hindsight. Quantifies the edge before trusting it live.
11. **Projection accuracy tracking** (Phase 14) — log projected vs actual weekly, surface MAE in the
    UI. Honest calibration beats false confidence.
