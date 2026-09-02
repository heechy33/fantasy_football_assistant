# Availability/VONA calibration report — 2026-08-22

## Metadata

- Generated at: 2026-08-24T07:12:19.307Z
- `data/manifest.json` builtAt: 2026-08-22T09:23:24.318051+00:00
- FFToday projections upstream updated at: 8/20/2026
- Active ADP source (`adp_active_ppr`): sleeper
- Drafts scored (N=11): `1392688856670687232` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1391308704153874432` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730676591087616` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730609540935680` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392732613948473344` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392732908569001984` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733045735329792` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733148135043072` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392735522555703296` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `2026-08-15-espn-10team` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`), `espn-draft2-10team-16round` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`)
- Git commit: ec6927136040763839ca7d4831ae84582845c90f

> **Pilot caveat**: N=11 drafts (9 bot mocks + 2 all-human ESPN drafts). The bot mocks are the machinery cohort (bots grade the engine, not human shape); the two all-human drafts are the held-out shape sample for the Phase 2c gates and are never fitted. Current committed data/ was applied retroactively against all drafts; this validates engine mechanism, not a dated-snapshot projection-accuracy backtest (that is PLAN.md Gate A/D, separate scope).

## Coverage

- Decision points replayed: 165 (11 skipped — see per-decision-point log in the JSON sibling of this report)
- In-window unmatched picks (crosswalk misses): 0 — non-zero silently corrupts `actualSurvived` / VONA / lookahead oracles for those players (see per-decision-point `unmatchedWindowPickOveralls` / `coverage.unmatchedWindowPickOverallsByDecisionPoint`)
- Full analytic cohort (rows with an ADP-based prediction): 35609
- Fixed-intersection cohort (also has a simulated counterpart): 3378
- Analytic-only rows (prediction available, no simulated counterpart): 32231
- All-seat availability rows (seat-independent, every team's pick->next-pick window): 2050341
- All-seat in-window unmatched picks (crosswalk misses): 0

## A. Availability calibration

### A.1 `availableNextPickProbability` — full analytic cohort

Pooled (N=35609, Brier=0.0206):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 499 | 0.027 | 0.114 |
| 0.1-0.2 | 198 | 0.150 | 0.293 |
| 0.2-0.3 | 192 | 0.249 | 0.406 |
| 0.3-0.4 | 205 | 0.352 | 0.478 |
| 0.4-0.5 | 223 | 0.450 | 0.507 |
| 0.5-0.6 | 297 | 0.548 | 0.576 |
| 0.6-0.7 | 378 | 0.652 | 0.706 |
| 0.7-0.8 | 514 | 0.750 | 0.728 |
| 0.8-0.9 | 883 | 0.855 | 0.863 |
| 0.9-1.0 | 32220 | 0.996 | 0.996 |

Per draft:

**1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3325, Brier=0.0182)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 26 | 0.041 | 0.154 |
| 0.1-0.2 | 19 | 0.151 | 0.211 |
| 0.2-0.3 | 19 | 0.242 | 0.316 |
| 0.3-0.4 | 19 | 0.353 | 0.632 |
| 0.4-0.5 | 21 | 0.453 | 0.429 |
| 0.5-0.6 | 34 | 0.550 | 0.559 |
| 0.6-0.7 | 37 | 0.652 | 0.649 |
| 0.7-0.8 | 46 | 0.749 | 0.674 |
| 0.8-0.9 | 82 | 0.855 | 0.902 |
| 0.9-1.0 | 3022 | 0.997 | 0.999 |

**1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3326, Brier=0.0184)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 36 | 0.036 | 0.083 |
| 0.1-0.2 | 15 | 0.159 | 0.467 |
| 0.2-0.3 | 17 | 0.247 | 0.353 |
| 0.3-0.4 | 21 | 0.352 | 0.429 |
| 0.4-0.5 | 20 | 0.446 | 0.550 |
| 0.5-0.6 | 27 | 0.546 | 0.704 |
| 0.6-0.7 | 36 | 0.650 | 0.667 |
| 0.7-0.8 | 47 | 0.751 | 0.660 |
| 0.8-0.9 | 79 | 0.854 | 0.861 |
| 0.9-1.0 | 3028 | 0.997 | 0.998 |

**1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3326, Brier=0.0162)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 50 | 0.025 | 0.120 |
| 0.1-0.2 | 13 | 0.149 | 0.231 |
| 0.2-0.3 | 17 | 0.248 | 0.412 |
| 0.3-0.4 | 14 | 0.347 | 0.571 |
| 0.4-0.5 | 21 | 0.461 | 0.571 |
| 0.5-0.6 | 20 | 0.547 | 0.400 |
| 0.6-0.7 | 26 | 0.651 | 0.654 |
| 0.7-0.8 | 45 | 0.750 | 0.756 |
| 0.8-0.9 | 75 | 0.857 | 0.867 |
| 0.9-1.0 | 3045 | 0.997 | 0.999 |

**1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3325, Brier=0.0174)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 39 | 0.026 | 0.077 |
| 0.1-0.2 | 17 | 0.151 | 0.176 |
| 0.2-0.3 | 12 | 0.256 | 0.500 |
| 0.3-0.4 | 21 | 0.346 | 0.619 |
| 0.4-0.5 | 18 | 0.444 | 0.444 |
| 0.5-0.6 | 30 | 0.547 | 0.600 |
| 0.6-0.7 | 35 | 0.649 | 0.600 |
| 0.7-0.8 | 47 | 0.750 | 0.745 |
| 0.8-0.9 | 71 | 0.857 | 0.873 |
| 0.9-1.0 | 3035 | 0.997 | 0.998 |

**1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3131, Brier=0.0185)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 71 | 0.024 | 0.085 |
| 0.1-0.2 | 23 | 0.152 | 0.261 |
| 0.2-0.3 | 19 | 0.244 | 0.526 |
| 0.3-0.4 | 16 | 0.342 | 0.250 |
| 0.4-0.5 | 20 | 0.449 | 0.550 |
| 0.5-0.6 | 25 | 0.554 | 0.640 |
| 0.6-0.7 | 27 | 0.648 | 0.778 |
| 0.7-0.8 | 34 | 0.747 | 0.706 |
| 0.8-0.9 | 70 | 0.855 | 0.929 |
| 0.9-1.0 | 2826 | 0.996 | 0.996 |

**1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0238)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 44 | 0.031 | 0.114 |
| 0.1-0.2 | 19 | 0.146 | 0.316 |
| 0.2-0.3 | 26 | 0.253 | 0.308 |
| 0.3-0.4 | 28 | 0.352 | 0.429 |
| 0.4-0.5 | 23 | 0.449 | 0.696 |
| 0.5-0.6 | 32 | 0.555 | 0.500 |
| 0.6-0.7 | 42 | 0.653 | 0.762 |
| 0.7-0.8 | 57 | 0.753 | 0.842 |
| 0.8-0.9 | 98 | 0.856 | 0.878 |
| 0.9-1.0 | 2763 | 0.996 | 0.996 |

**1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0263)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 44 | 0.035 | 0.227 |
| 0.1-0.2 | 21 | 0.156 | 0.238 |
| 0.2-0.3 | 22 | 0.255 | 0.545 |
| 0.3-0.4 | 21 | 0.355 | 0.381 |
| 0.4-0.5 | 33 | 0.451 | 0.424 |
| 0.5-0.6 | 35 | 0.555 | 0.657 |
| 0.6-0.7 | 39 | 0.650 | 0.821 |
| 0.7-0.8 | 60 | 0.752 | 0.700 |
| 0.8-0.9 | 93 | 0.854 | 0.860 |
| 0.9-1.0 | 2764 | 0.995 | 0.996 |

**1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3131, Brier=0.0222)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 62 | 0.023 | 0.097 |
| 0.1-0.2 | 18 | 0.159 | 0.278 |
| 0.2-0.3 | 25 | 0.252 | 0.440 |
| 0.3-0.4 | 17 | 0.351 | 0.412 |
| 0.4-0.5 | 16 | 0.458 | 0.438 |
| 0.5-0.6 | 26 | 0.540 | 0.731 |
| 0.6-0.7 | 43 | 0.650 | 0.814 |
| 0.7-0.8 | 48 | 0.749 | 0.771 |
| 0.8-0.9 | 85 | 0.859 | 0.882 |
| 0.9-1.0 | 2791 | 0.995 | 0.995 |

**1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0244)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 38 | 0.030 | 0.079 |
| 0.1-0.2 | 24 | 0.146 | 0.375 |
| 0.2-0.3 | 18 | 0.244 | 0.444 |
| 0.3-0.4 | 25 | 0.349 | 0.600 |
| 0.4-0.5 | 23 | 0.439 | 0.348 |
| 0.5-0.6 | 37 | 0.542 | 0.459 |
| 0.6-0.7 | 46 | 0.651 | 0.652 |
| 0.7-0.8 | 60 | 0.751 | 0.833 |
| 0.8-0.9 | 98 | 0.855 | 0.898 |
| 0.9-1.0 | 2763 | 0.995 | 0.996 |

**2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3157, Brier=0.0190)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 41 | 0.023 | 0.049 |
| 0.1-0.2 | 12 | 0.140 | 0.333 |
| 0.2-0.3 | 10 | 0.249 | 0.400 |
| 0.3-0.4 | 11 | 0.363 | 0.364 |
| 0.4-0.5 | 14 | 0.455 | 0.643 |
| 0.5-0.6 | 11 | 0.534 | 0.455 |
| 0.6-0.7 | 14 | 0.655 | 0.643 |
| 0.7-0.8 | 33 | 0.747 | 0.545 |
| 0.8-0.9 | 60 | 0.853 | 0.800 |
| 0.9-1.0 | 2951 | 0.997 | 0.993 |

**espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3492, Brier=0.0224)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 48 | 0.018 | 0.188 |
| 0.1-0.2 | 17 | 0.140 | 0.353 |
| 0.2-0.3 | 7 | 0.245 | 0.000 |
| 0.3-0.4 | 12 | 0.375 | 0.500 |
| 0.4-0.5 | 14 | 0.452 | 0.571 |
| 0.5-0.6 | 20 | 0.543 | 0.550 |
| 0.6-0.7 | 33 | 0.663 | 0.667 |
| 0.7-0.8 | 37 | 0.747 | 0.649 |
| 0.8-0.9 | 72 | 0.853 | 0.708 |
| 0.9-1.0 | 3232 | 0.997 | 0.994 |

By cohort (Phase 2d stratification):

| Stratum | n | Brier |
|---|---|---|
| bot | 28960 | 0.0205 |
| human | 6649 | 0.0208 |

### A.1a Error by round and position (pooled analytic cohort)

These strata are descriptive only. They identify where more capture is needed rather
than supporting parameter retuning.

**By round**

| Stratum | n | Brier |
|---|---|---|
| Round 1 | 3326 | 0.0076 |
| Round 2 | 3199 | 0.0063 |
| Round 3 | 3086 | 0.0108 |
| Round 4 | 2959 | 0.0095 |
| Round 5 | 2846 | 0.0140 |
| Round 6 | 2719 | 0.0121 |
| Round 7 | 2606 | 0.0204 |
| Round 8 | 2479 | 0.0215 |
| Round 9 | 2366 | 0.0310 |
| Round 10 | 2239 | 0.0279 |
| Round 11 | 2126 | 0.0343 |
| Round 12 | 2002 | 0.0395 |
| Round 13 | 1891 | 0.0517 |
| Round 14 | 1598 | 0.0339 |
| Round 15 | 167 | 0.0393 |

**By position**

| Stratum | n | Brier |
|---|---|---|
| DEF | 4593 | 0.0156 |
| K | 4605 | 0.0213 |
| QB | 4801 | 0.0185 |
| RB | 6873 | 0.0246 |
| TE | 4849 | 0.0220 |
| WR | 9888 | 0.0200 |

### A.2 `unconditionalProbability` (baseline #1 — ignores survival-to-currentPick conditioning)

Pooled (N=35609, Brier=0.0251):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 713 | 0.027 | 0.244 |
| 0.1-0.2 | 265 | 0.147 | 0.404 |
| 0.2-0.3 | 234 | 0.250 | 0.504 |
| 0.3-0.4 | 260 | 0.351 | 0.585 |
| 0.4-0.5 | 297 | 0.453 | 0.640 |
| 0.5-0.6 | 320 | 0.551 | 0.681 |
| 0.6-0.7 | 403 | 0.652 | 0.742 |
| 0.7-0.8 | 548 | 0.753 | 0.808 |
| 0.8-0.9 | 913 | 0.857 | 0.903 |
| 0.9-1.0 | 31656 | 0.996 | 0.997 |

### A.3 Fixed-intersection comparison: analytic vs. simulated

Rows where both `availableNextPickProbability` and `simulatedSurvivalProbability` exist (N=3378).

**`availableNextPickProbability`** (pooled Brier=0.1019):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 368 | 0.025 | 0.043 |
| 0.1-0.2 | 112 | 0.150 | 0.232 |
| 0.2-0.3 | 117 | 0.248 | 0.333 |
| 0.3-0.4 | 119 | 0.353 | 0.454 |
| 0.4-0.5 | 101 | 0.448 | 0.436 |
| 0.5-0.6 | 160 | 0.546 | 0.487 |
| 0.6-0.7 | 196 | 0.652 | 0.633 |
| 0.7-0.8 | 235 | 0.749 | 0.664 |
| 0.8-0.9 | 350 | 0.854 | 0.806 |
| 0.9-1.0 | 1620 | 0.978 | 0.980 |

**`simulatedSurvivalProbability`** (pooled Brier=0.1206):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 311 | 0.000 | 0.074 |
| 0.1-0.2 | 153 | 0.125 | 0.229 |
| 0.2-0.3 | 94 | 0.250 | 0.277 |
| 0.3-0.4 | 134 | 0.375 | 0.403 |
| 0.5-0.6 | 125 | 0.500 | 0.480 |
| 0.6-0.7 | 150 | 0.625 | 0.540 |
| 0.7-0.8 | 219 | 0.750 | 0.607 |
| 0.8-0.9 | 342 | 0.875 | 0.708 |
| 0.9-1.0 | 1850 | 1.000 | 0.947 |

### A.4 Leave-one-draft-out empirical round/position baseline

Each draft's prediction-eligible rows are scored against a survival-rate table built from the *other*
draft alone. This uses the same N as the analytic score, making the Brier comparison like-for-like. Pooled
(N=35609, Brier=0.0405):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.8-0.9 | 839 | 0.875 | 0.897 |
| 0.9-1.0 | 34770 | 0.959 | 0.958 |

### A.5 All-seat survival-curve calibration (Phase 2b, seat-independent)

Every team's pick->next-pick window is scored for every not-yet-drafted ADP player - the direct,
large-n test of the analytic survival model. The 9 bot mocks grade machinery; the two all-human
ESPN drafts are the held-out shape sample for the Phase 2c gates and are never fitted.

Pooled (N=2050341, Brier=0.0039):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 5295 | 0.027 | 0.131 |
| 0.1-0.2 | 2175 | 0.149 | 0.291 |
| 0.2-0.3 | 2163 | 0.250 | 0.366 |
| 0.3-0.4 | 2367 | 0.351 | 0.437 |
| 0.4-0.5 | 2588 | 0.452 | 0.517 |
| 0.5-0.6 | 3163 | 0.551 | 0.583 |
| 0.6-0.7 | 4014 | 0.652 | 0.676 |
| 0.7-0.8 | 5653 | 0.752 | 0.763 |
| 0.8-0.9 | 9734 | 0.856 | 0.864 |
| 0.9-1.0 | 2013189 | 0.999 | 0.999 |

By cohort:

| Stratum | n | Brier |
|---|---|---|
| bot | 1706740 | 0.0038 |
| human | 343601 | 0.0045 |

Per draft:
- **1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=171850, Brier=0.0032
- **1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=171850, Brier=0.0032
- **1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=171850, Brier=0.0033
- **1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=171850, Brier=0.0032
- **1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=203868, Brier=0.0043
- **1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=203868, Brier=0.0042
- **1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=203868, Brier=0.0043
- **1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=203868, Brier=0.0043
- **1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=203868, Brier=0.0041
- **2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=160226, Brier=0.0042
- **espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=183375, Brier=0.0047

## B. Analytic wait loss (VONA)

### B.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 27252 | 0.17 | 0.05 |
| starter mode | 19368 | 0.23 | 0.07 |
| bench mode | 7884 | 0.03 | -0.01 |

### B.2 Rank agreement (mean per-decision-point Spearman correlation, oracle VONA vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 154 | -0.059 | 0.075 | 0.241 | -0.059 | 0.856 (154) |
| starter mode | 154 | 0.023 | 0.295 | 0.283 | 0.219 | 0.838 (109) |
| bench mode | 57 | 0.246 | 0.247 | 0.284 | 0.071 | 0.867 (57) |

The engine estimate is the candidate's unified marginal roster utility minus the expected best
surviving substitute in the same eligibility group. The real-history oracle uses the best substitute
that actually survived the open-open opponent window. Rank agreement is therefore meaningful in
both starter and bench cohorts; n/a only means a stratum lacks enough non-constant decision points.

## Interpretation

This 11-draft directional report does **not** establish calibration. The conditioned analytic model's pooled
Brier score (0.0206) is modestly better than the
unconditional baseline (0.0251), but the largest
high-probability bucket dominates the pooled score and the lower/middle buckets require additional
captured drafts and round/position review. The fixed-intersection simulation comparison is also
directional only (analytic Brier 0.1019, simulated
Brier 0.1206). This run adds two all-human ESPN drafts
(cohort 'human', the Phase 2b held-out shape sample under fixtures/real-drafts/) and the
seat-independent all-seat availability section (A.5); those rows are validation, never fit. Keep
availability labeled experimental until the Phase 2c gates on this human cohort pass (or a larger
independent sample supports calibration).

## C. Unified roster-utility planning

The realized oracle forces each current candidate, removes opponents' actual open-open-window
picks, then takes the best surviving follow-up under the same starter-plus-depth roster utility.
Regret is oracle-best utility minus the utility of each policy's selected candidate.

| Cohort | n | Plan regret | Old S2 regret | ADP regret | Projection regret | Improvement vs S2 | Top-choice agreement |
|---|---:|---:|---:|---:|---:|---:|---:|
| All | 154 | 1.95 | 5.04 | 21.54 | 32.53 | 61.3% | 53.2% |
| Bot drafts (9, machinery) | 126 | 1.76 | 5.00 | 23.99 | 38.32 | 64.8% | 57.1% |
| Human drafts (2, held-out) | 28 | 2.79 | 5.19 | 10.53 | 6.48 | 46.2% | 35.7% |
| One core hole | 18 | 0.39 | 3.76 | 17.19 | 15.85 | 89.6% | 72.2% |
| Zero core holes | 57 | 0.82 | 0.88 | 5.13 | 6.62 | 6.4% | 59.6% |

Reported-decision snapshots, including Kelce/Sutton and White/Pittman plan components when present,
are stored in the JSON sibling under planning.reportedDecisionSnapshots.

### Two-pick gate

Status: **requires-two-window-evaluation**. Zero-hole one-horizon mean regret is
0.8226, so the maximum possible absolute improvement
from any two-pick policy is also 0.8226. That
cannot clear the predeclared 0.5 utility-point gate. The production objective therefore remains
deterministic one-horizon planning; no analytic correction is added to the legacy rollout.

## D. Legacy rollout lookahead diagnostic (correction 3 — "take c" oracle)

### C.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 3396 | 7.08 | -6.01 |
| starter mode | 2261 | 7.21 | -5.68 |
| bench mode | 1135 | 6.82 | -6.65 |

### C.2 Rank agreement (mean per-decision-point Spearman correlation, oracle lookahead vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 154 | 0.391 | 0.507 | 0.623 | 0.399 | 0.934 (114) |
| starter mode | 154 | 0.574 | 0.618 | 0.751 | 0.721 | 0.936 (110) |
| bench mode | 57 | n/a | n/a | n/a | n/a | n/a (0) |

## Descoped this round

- Explicitly descoped this round: Monte Carlo SE on a probability is analytic (sqrt(p(1-p)/n) ~= 0.177 at n=8,p=0.5); the sweep only earns its cost once rank-agreement (not raw probability noise) is the open question, and this directional sample cannot answer that reliably.
