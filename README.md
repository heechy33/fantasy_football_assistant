# Fantasy Football Assistant

A live draft assistant for fantasy football. It connects to a real draft (Sleeper API, plus a
Chrome extension for ESPN), tracks picks as they happen, and recommends who to take next based on
your actual roster, league scoring, and who's likely to still be there at your next turn.

Currently built and used for Sleeper PPR one-QB redraft snake drafts. ESPN support exists for
draft day only, built for and used in a real private-league draft in August 2026. Yahoo and
in-season features (lineups, waivers, trades) aren't built yet.

## Why

Most draft tools give you a static ranking and let you figure out the rest. This one re-runs the
math after every pick: given the players still on the board and the roster you've built so far,
what actually helps you most, and how likely is it to still be around when your pick comes back
around. The recommendation logic (scoring, replacement value, lineup construction, simulation) is
all custom, not a wrapper around someone else's rankings.

## What it does

- Polls Sleeper every 2-3 seconds during a live draft, with reconnect/backoff handling, plus a
  manual entry mode for offline or laggy drafts.
- Scores every available player against your league's actual scoring settings and roster slots,
  not a generic point total.
- Runs an exact lineup solver (handles FLEX correctly) to figure out what a player is really worth
  to your specific roster, not just raw projected points.
- Groups players into tiers based on real drops in value, and estimates the odds a player survives
  to your next pick using ADP data.
- Runs seeded Monte Carlo simulations of the rest of the draft (including likely opponent picks) to
  value each candidate by what it sets up next, not just the immediate pick.
- Shows player context alongside each recommendation: recent scoring history, usage trends, ADP
  comparison, injury/depth-chart status.
- Surfaces data problems instead of hiding them — stale sources, unmatched players, and low-sample
  ADP all show up in the UI rather than silently affecting the recommendation.

## How it's built

Data gets to the app two ways:

1. A Python pipeline pulls projections, ADP, and historical stats from a few different sources
   (FantasyPros, Rotowire, FFC, nflverse), validates and cross-references player IDs across them,
   and commits the result as JSON that the frontend ships with. This runs on a schedule via GitHub
   Actions and fails CI if player-ID matching drops below a coverage threshold.
2. During a live draft, a provider adapter (Sleeper, or the ESPN extension) streams the real board
   into the same recommendation engine that runs entirely client-side.

The engine itself is plain TypeScript — deterministic, seeded, no server calls during a draft, and
covered by tests that run against real committed data rather than mocks.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Backend | Azure Functions (Node, TypeScript) |
| Data pipeline | Python, scheduled via GitHub Actions |
| Hosting | Azure Static Web Apps (free tier) |
| Testing | Vitest, pytest |

## Running it locally

Requires Node 20+ and Python 3.

```sh
npm run install:all   # install frontend + API dependencies
npm run dev           # start the Vite dev server
npm test              # run all frontend + API tests
npm run typecheck     # TypeScript checks across both packages
npm run build         # build API, then frontend
npm run pipeline      # regenerate data/*.json from upstream sources
```

## Repository layout

```
api/          Azure Functions (TypeScript) — HTTP-only endpoints
frontend/     React + Vite app — UI, provider adapters, and the engine
pipeline/     Python data pipeline (build_data.py)
data/         Committed, versioned data artifacts consumed by the app
shared/       Shared TypeScript contracts
extension/    ESPN reconnaissance Chrome extension (draft-day scope)
infra/        Azure Bicep provisioning (not yet deployed)
.github/      CI/CD workflows
```

## What's next

- Backtesting the recommendation engine against simple baselines (ADP, raw projected points, static
  VOR) on historical data, before expanding scope further.
- Full ESPN and Yahoo support beyond draft day.
- Post-draft grades, weekly lineup advice, waiver and trade suggestions.
