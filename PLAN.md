# Fantasy Football Co-Pilot — Sleeper-First Build Plan

This file is the **current status and forward-looking sequencing plan** only. Durable design
decisions and their reasoning live in `DECISIONS.md`. Completed-phase build detail and historical
implementation notes live in `archive/PLAN-history.md`. Repo conventions/commands live in
`CLAUDE.md`.

## Status

**Plan last revised:** August 30, 2026

**The Sleeper edge track is complete, and the Edge Validation Gate is closed and authorized.** All
phases (Gate 0, S0-S3, S4 draft experience, S5 reliability/clock, S6/edge validation) are done —
their build records and exit-criteria evidence live in `archive/PLAN-history.md`, and the closure
evidence lives in `DECISIONS.md`'s 2026-08-30 (6) entry. On 2026-08-30 the user reviewed the gate
evidence and authorized roadmap expansion. **No next track is chosen yet** — the roadmap below is a
menu, not a plan; opening any specific track is its own dated decision in `DECISIONS.md`.

The long-term product is still a season-long assistant for Sleeper, ESPN, and Yahoo (live draft
assistant, post-draft grades, lineup optimizer, waiver assistant, trade analyzer). Those features are
preserved in the roadmap below, not deleted.

### Product promise (unchanged)

> During a Sleeper PPR redraft snake draft, track the board live and recommend the pick most likely
> to improve the user's finished roster, with an understandable explanation and an honest measure
> of uncertainty.

The first release targets one-QB PPR redraft snake leagues; the data model's independent
`reception`/`qb`/`draft` dimensions keep other formats addable without a schema rewrite.

### Expansion rule (updated 2026-08-30)

The gate has **passed**, so expansion is now unlocked by evidence rather than by exception or a
priority change. What still holds: opening any specific roadmap track (Yahoo, ESPN in-season, new
formats, in-season features) is an explicit, dated decision — expansion is *permitted*, not
*automatic*.

---

## What exists today

A working live-draft assistant for Sleeper PPR one-QB snake drafts — not a scaffold. Full build
record: `archive/PLAN-history.md`.

- Sleeper connection, league/draft init, 1s poll with backoff/stale display, manual mode with
  undo/correction, and draft-completion detection (`session/completion.ts`)
- Deterministic PPR engine (`frontend/src/engine/`): linear scoring with diagnostics, exact
  bitmask-DP slot optimizer, MRV/draining-pool VOR, leader-anchored tiers, survival-conditioned
  availability, ranked recommendation board with explanations
- Stage C: seeded opponent-pick rollouts with VONA/lookahead/downside in a long-lived Web Worker
  (`recommendation.worker.ts`), deterministic S2 fallback board
- FFToday-sourced projections via the offline Python pipeline, behind the `SeasonProjectionProvider`
  boundary; display-only FFC and Underdog best-ball ADP lanes (never engine inputs)
- Draft UX: engine/ADP board modes, Draft Room launcher, live/manual/ESPN-bridge sessions, layered
  recommendations, data-health warnings; public Draft Guide, Clerk auth, Cosmos-backed saved
  leagues/drafts (phases 4-5 of the 2026-08-25 restructure, all shipped)
- Edge-gate evaluation: 2025 historical backtest harness (six arms, paired slot×seed grid,
  pre-declared gates in `fixtures/backtest/2025/gates.md`), availability-calibration harness
  (`npm run benchmark:availability`), dated snapshot vintages (`npm run snapshot:vintage`)
- Nine real recorded Sleeper mock fixtures (`fixtures/sleeper/`) + two transcribed all-human ESPN
  drafts (`fixtures/real-drafts/`) in an 11-draft availability registry

Deliberately absent: empirical opponent-model calibration, two-turn rollouts, board search, pin/
avoid/custom-rank, a consolidated source/freshness panel (backlog below).

---

## Engine invariants (do not break these)

The durable "do not do this" rules; everything else about engine design is in `DECISIONS.md`.

1. Do **not** reintroduce `VOR × need × (1/tier_gap) / P_available` (`DECISIONS.md`, 2026-08-08) —
   inverted tier urgency, unbounded availability multiplier.
2. Engine modules are pure functions of settings, draft state, and versioned data. Provider-specific
   knowledge stays at the adapter boundary, never inside the engine.
3. Initialization (pool/settings) and per-pick updates (draft state) are separate paths.
4. Never silently drop an unmatched pick, unknown scoring key, missing source, or stale data —
   surface it and degrade confidence explicitly.

---

## Edge Validation Gate — CLOSED (2026-08-30)

The full program (baselines, layer definitions, gate numbers) is in `archive/PLAN-history.md`'s
S6 entry, `DECISIONS.md`'s 2026-08-24/30 entries, and the tracked reports under
`benchmarks/reports/*.md`. Summary:

- **Layer A (historical backtest): PASS.** N = 1,008, all three pre-declared gates vs static VOR
  (`benchmarks/reports/2026-08-23-historical-backtest-2025.md`).
- **Layer B (availability calibration): measured; disposition = labeled experimental.** The model is
  miscalibrated in the decision-relevant range (under-predicts survival in the 0-0.5 buckets; pooled
  Brier 0.0217 is flattered by 90% of rows sitting in the 0.9-1.0 bucket), so the gate's passing
  criterion — "demonstrably calibrated or explicitly labeled experimental" — is met via the label,
  which ships in the UI (`PlayerContextBody.tsx`).
- **S5 (reliability/clock): closed on operational evidence** — five live-mock bugs found and fixed
  with regression tests in the 2026-08-28/29 mocks (`DECISIONS.md`), plus the CI-gated latency
  budget (`recommendPerformance.test.ts`: median < 3000 ms against real `data/`). The instrumented
  clock test was not run; see the S5 archive entry for why.
- **What was explicitly NOT proven:** engine-vs-B1 is AMBIGUOUS at the default opponent-noise level
  (a localized construction shift, resolved at every other tested noise level); the edge claim
  itself awaits layers C/D below.

Owner review completed 2026-08-30 → expansion authorized.

---

## Standing in-season tracking (continuous, not gating)

These are now standing obligations that ride along with whatever track is active — they were gate
blockers before; they are not anymore.

- **Layer C — 2026 live mocks:** every mock still validates sync, latency, robustness, and
  recommendation sanity, and each failure becomes a sanitized fixture. This already happened
  informally in the 2026-08-28/29 mocks; keep recording.
- **Layer D — projection accuracy:** once 2026 in-season outcomes exist, compare retained projection
  vintages against actuals (MAE, bias, rank correlation, range calibration). The retention machinery
  already ships (`refresh-data.yml` vintage tags, `npm run snapshot:vintage`); only the analysis is
  calendar-bound.

---

## Backlog — draft experience (explicitly not blockers)

Deferred S4 leftovers plus test gaps found in the 2026-08-30 audit. None block anything; each is a
normal task when draft-experience work resumes.

- Board player search — `BoardFilters.tsx` has no input at all
- Manual pin/avoid/custom-rank override — no such identifiers exist in `frontend/src`
- A real tier-cliff view — today it is text-only (`NextUpChip`)
- A consolidated source/freshness panel — `DataHealth.tsx` is a warning-only banner with no
  per-source `fetchedAt`
- Wire the reconnect path — `useDraftPoll.ts`'s reconnect handler is implemented but has zero call
  sites
- Test gaps: no sibling tests for `RecommendationBoard.tsx`/`PlayerBoardRow.tsx` (the primary
  draft-surface render path); `routes/` is 6 tests / 13 sources; `auth/` is 1 test / 6 sources and
  is the Clerk boundary

---

## Roadmap after the edge gate (menu, unchosen)

Everything below is preserved scope, not abandoned work and not a commitment.

### Roadmap A — Provider expansion

- **A1. Universal manual-mode hardening** — import/export, custom draft order, keepers, traded
  picks, before any risky credential work.
- **A2. Yahoo adapter + OAuth** — see `CLAUDE.md`'s preserved Yahoo findings. Exit: live mock
  tracked, token rotation/reconnect tested, the live `draftresults` question answered with a
  recorded fixture.
- **A3. ESPN in-season adapter** — the draft-day exception is closed; in-season ESPN (weekly
  rosters, free agents) is a new decision. See `CLAUDE.md`'s preserved ESPN findings;
  extension-first, one targeted upstream read per poll, no programmatic login.

### Roadmap B — Draft formats and premium-depth features

PPR superflex/two-QB (format dimensions already independent); half-PPR/standard; keepers, custom/
traded orders, third-round reversal; auction as a separate engine, not a snake flag;
dynasty/rookie/IDP after new data/valuation models; CSV import + source weighting; league-mate
draft tendencies; a mock-draft simulator for reproducible strategy testing.

### Roadmap C — Post-draft and in-season product

- **C1. Post-draft grades** — graded via optimized starters, discounted bench/replacement value,
  roster fragility; never raw summed VOR.
- **C2. Weekly data layer** — weekly projections/actuals, schedules, injuries, trending adds/drops,
  rest-of-season snapshots with provenance; GitHub Actions is the scheduler (SWA Functions are
  HTTP-only).
- **C3. Lineup/start-sit optimizer** — reuse the slot optimizer; matchup context only after proving
  it improves weekly accuracy.
- **C4. Waiver assistant** — free agents + weekly/ROS projections + roster fit + Sleeper trending,
  ranked adds with reasons.
- **C5. Trade analyzer** — both rosters' marginal-value deltas, depth-adjusted, with downside.
- **C6. Multi-season keeper/dynasty support** — after B's format work.

---

## Product-wide risks

| Risk | Mitigation |
|---|---|
| One implemented undocumented projection source | P0.5 official-consensus adapter, raw-source retention, versioned snapshots, health checks, degraded modes, user import |
| Projection quality creates a ceiling on engine quality | Historical out-of-sample tests and ongoing 2026 accuracy tracking (layer D) |
| ADP availability model is miscalibrated | Brier/calibration tests; bounded use; labeled experimental; empirical replacement |
| Simulation creates false precision | Seeded reproducibility, confidence labels, comparison with simple baselines, explanations |
| Crosswalk gaps, especially rookies | Coverage gate, name/position/team fallback, visible unmatched picks, manual correction |
| Sleeper endpoint/schema changes | Recorded fixtures, runtime schema checks, cached committed snapshot |
| Draft clock latency | Direct Sleeper polling, Web Worker, cached rollouts, deterministic fallback board |
| Projection/data redistribution terms | Provenance registry, attribution, terms review, user import fallback |
| ESPN fragility/security | Extension-first, manual fallback, no programmatic login, avoid cookie storage |
| Yahoo draft/live-token uncertainty | Test risky assumptions first and preserve recorded fixtures |
| Accidental Azure cost | Free SKUs, Cosmos 1,000 RU/s cap, explicit review before paid resources |

---

## Cost target

The target remains **$0/month**: Azure Static Web Apps Free, managed HTTP Functions included with
SWA, GitHub Actions within the free allowance, Cosmos free tier. Any change that introduces a paid
resource must be explicitly called out and approved.

---

## Handoff rules for future agents

1. This file is the source of truth for *current* sequencing only. `DECISIONS.md` holds the
   reasoning trail; `archive/PLAN-history.md` holds completed-phase detail; `CLAUDE.md` holds repo
   conventions/commands.
2. Gate 0 is complete; do not reopen a P0 item without recording why in `DECISIONS.md`.
3. Do not reintroduce the old multiplicative recommendation formula (`DECISIONS.md`, 2026-08-08).
4. Do not claim a drafting edge beyond what the evidence above supports — engine-vs-B1 is AMBIGUOUS
   at the default opponent-noise level, and the edge claim awaits layers C/D.
5. Preserve provider research and scaffolding even while it is inactive.
6. Port implementation knowledge from `espn-api`, `ffscrapr`, and `ffsimulator`; do not add Python/R
   services to the live draft path merely because the reference projects use those languages.
7. Keep provider normalization at the adapter boundary and the engine pure.
8. Never silently drop unmatched picks, unknown scoring keys, missing sources, or stale data.
9. Record real mock failures as sanitized fixtures.
10. Opening any roadmap track is a dated `DECISIONS.md` entry plus a PLAN.md status update.
11. When a decision should outlive the current task, add a dated `DECISIONS.md` entry instead of
    writing it inline here. When a phase completes, move its detailed build record to
    `archive/PLAN-history.md` and leave only a status pointer here.


