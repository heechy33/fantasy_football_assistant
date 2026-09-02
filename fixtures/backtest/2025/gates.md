# 2025 Historical Backtest — Pre-declared Gates (2026-08-21)

Pre-declared before any harness run, for PLAN.md's Edge Validation Gate,
evaluation layer A (historical out-of-sample draft strategy). This file is
**committed** (unlike the bulk of `benchmarks/reports/` — since 2026-08-30 the
human-readable `.md` reports there are tracked too; only `.json`/`.log` machine
output stays gitignored) so the
pre-declaration is timestamped and reproducible; the matching dated entry in
`DECISIONS.md` (2026-08-21) carries the gate numbers and points here.

---

## League config (explicit, not inherited)

| Dimension | Value |
|---|---|
| Teams / draft | 12 teams, snake, **16 rounds** (192 picks) |
| Format | PPR, one-QB, no TE bonus |
| Starting lineup | `['QB','RB','RB','WR','WR','TE','FLEX','K','DEF']` (9 starters) |
| Bench | 7 (`BN`) → 16-player rosters |
| `format` | `{ reception: 'ppr', qb: 'one-qb', draft: 'snake' }` |

**Scoring map — plain PPR skill-position scoring plus K/DEF**:
`pass_yd 0.04, pass_td 4, pass_int -2, pass_2pt 2, rush_yd 0.1, rush_td 6,
rush_2pt 2, rec 1, rec_yd 0.1, rec_td 6, rec_2pt 2, fum_lost -2, fgm 3, xpm 1,
sack 1, int 2, fum_rec 2, def_td 6, def_kr_td 6` (K/DEF weights match
production's own default Sleeper PPR map, `adapters/sleeper.ts`'s
`DEFAULT_SCORING.ppr`). **Do not reuse `fixtures/sleeper/scoring-ppr.json`
unmodified** — it carries `bonus_rec_te: 0.5`, which would overvalue TEs.

**Correction (2026-08-22, post-pilot):** the original pre-declaration above
omitted every K/DEF scoring key ("must equal `weekly-stats.json`'s `pts`
column" was read too literally — that column is Sleeper's own precomputed
`pts_ppr`, not reproducible from a linear stat-weight map, and is irrelevant
to how *projections* get valued at draft time). With no K/DEF keys, every arm
that ranks by projected points valued every kicker and defense at exactly 0.
Baseline 3 (static VOR) has no forcing mechanism and never drafted K/DEF as a
result (0.000 coverage in the 2026-08-22 pilot, `benchmarks/reports/2026-08-
22-historical-backtest-2025-pilot.md`) — an artifact of the omission, not of
the static-VOR strategy, and it inflated the reported engine-vs-B3 gap by an
estimated 10-15 of the observed 24.53 pts/week. Fixed in
`frontend/src/engine/backtest.ts`'s `BACKTEST_SCORING`; the pilot must be
re-run before any number above this note is trusted.

---

## Baselines (PLAN.md:287-290)

1. Best available by FFC 2025 ADP.
2. Best available by raw projected PPR points (FFToday 2025).
3. **Static VOR without availability/lookahead — the gate baseline.**
4. Corrected MRV + tiers without simulation.

All four are run through the same simulated drafts and the same weekly
lineup optimizer; baselines 1/2/4 are reported, baseline 3 is gating.

**Note (2026-08-22):** a possible fifth arm, `c1` (sorting by Stage C's
simulated `lookaheadValue` instead of `planValue`), is **not** a fifth
pre-declared baseline in this list — it is an engine variant under test,
built only if `frontend/src/engine/simSortProbe.ts`'s disagreement probe
finds material disagreement (see `DECISIONS.md`'s 2026-08-22 "Sim-sort
disagreement probe" entry for the pre-declared threshold). If built, it is
reported-and-non-gating and is excluded from every predicate in "Primary
gate" and "Downside gate" below.

**Baseline roster legality (pre-declared, B1/B2 only):** a naive "best
available" arm may only draft a player whose position has an open slot. The
league does not split the 7 bench slots by position, so an open slot is a
per-position cap, not a literal slot list: `QB 2, RB 5, WR 6, TE 1, K 1,
DEF 1` (sums to the 16-round roster). Without this, B2's raw-points ranking
(QB-heavy) drafts a QB with nearly every pick — the 16-QB straw man — so the
rule is pre-declared here and enforced in the harness. The engine-based arms
(engine/B4/B3) are governed by the engine's own value logic, not these caps.

---

## Primary metric

**Mean optimized weekly starter points, weeks 1-17.**

- Unit: per-draft. For each simulated draft, take the mean over weeks 1-17 of
  the **deterministic optimal** weekly starting-lineup total (real 2025 weekly
  points, the league's `startingSlots`, FLEX = RB/WR/TE). Week 18 is excluded
  (starter-rest risk).
- Overall: mean of the per-draft means across N drafts.
- **N and seed:** N ≥ 1,000 simulated 2025 drafts, fixed RNG seed `20250825`,
  recorded in the harness report. Pairing is at the draft level: the engine and
  every baseline face identical draft slots and identical opponent picks.

---

## Primary gate (vs baseline 3, static VOR)

Passes only if **both** hold:

1. **Point floor:** engine mean ≥ baseline-3 mean − 0.25 pts/week.
2. **CI:** the paired-difference 95% CI (engine − baseline-3, per draft)
   excludes a loss worse than −0.25 pts/week (CI lower bound > −0.25).

This makes "ties" numeric: a tie means the point floor holds and the CI does
not show a material loss.

---

## Downside gate

Engine 10th-percentile weekly team total ≥ baseline-3 10th-percentile
− 0.5 pts. Percentile pooled over all (draft, week) cells across the N drafts.
This operationalizes "without a material increase in downside"
(PLAN.md:328-329).

---

## Secondary metrics (reported, non-gating)

- Replacement-adjusted points.
- Simulated H2H win rate.
- Playoff rate (weeks 15-17).
- Starter-week coverage (share of weeks 1-17 with a full legal lineup).
- Engine vs baselines 1, 2, and 4 (informational, not gating).

---

## Decision rule

If the engine fails any gate, the result is **written down** (dated entry in
`DECISIONS.md` + report under `benchmarks/reports/`) and the engine is
improved. The result is never buried, and providers or in-season features are
not added to hide it (PLAN.md:334-335).

---

## Inputs and leakage audit (frozen by `pipeline/backtest_snapshot.py`)

Snapshot lives in this directory: `adp-ppr.json` (FFC 2025 PPR, verbatim +
`sleeperId`), `projections.json` (FFToday 2025), `provenance.json` (audit).
Key numbers from the 2026-08-21 build:

- FFC window **2025-08-25 → 2025-09-01** (preseason), 249 rows, real observed
  `stdev/high/low/times_drafted`. FFC's board is **15 rounds** (180 picks);
  picks 181-192 in the 16-round config have no ADP coverage and rely on the
  opponent model's documented fallbacks.
- FFToday `Updated: 8/31/2025` — **preseason** (leakage gate passed).
- Identity gate: **248/249** FFC rows → sleeper_id (99.6% ≥ 97%).
  Unmatched, recorded by name: **Hollywood Brown (WR)** — FFC uses the
  nickname; Sleeper has "Marquise Brown". The harness must not silently drop
  him (treat as available-but-unmapped or hand-map explicitly).
- Outcome coverage (diagnostic, widened 2026-08-22 to the full FFC ∪
  FFToday-projected pool, 422 players): **413/422** have 2025 weekly rows. The
  9 without — 2309 Amari Cooper, 4018 Joe Mixon, 5119 Jason Sanders, 6803
  Brandon Aiyuk, 7042 Tyler Bass, 7437 Kyle Williams, 7561 Elijah Mitchell,
  11581 MarShawn Lloyd, 11640 Jermaine Burton — are **verified** (direct fetch
  of Sleeper's raw weekly-stats feed, every week 1-18) to carry no `pts_ppr`
  at all; genuine absence, not a `data/weekly-stats.json` build-time
  filtering artifact. Must be **scored 0 all season**, never excluded.
  `pipeline/backtest_snapshot.py` now fails loudly (`withoutOutcomesUnverified`)
  if a future snapshot regeneration surfaces a zero-outcome id outside this
  verified set.
- FFC→FFToday projection coverage: **246/248 (99.2%)**.
- `data/weekly-stats.json` (season 2025, 18 weeks, 649 players) and
  `data/players.json` are pinned by SHA-256 in `provenance.json`.
