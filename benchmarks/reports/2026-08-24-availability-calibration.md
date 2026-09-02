# Availability/VONA calibration report — 2026-08-24

## Metadata

- Generated at: 2026-08-24T20:32:37.932Z
- `data/manifest.json` builtAt: 2026-08-24T19:56:11.923784+00:00
- FFToday projections upstream updated at: 8/20/2026
- Active ADP source (`adp_active_ppr`): sleeper
- Drafts scored (N=11): `1392688856670687232` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1391308704153874432` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730676591087616` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730609540935680` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392732613948473344` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392732908569001984` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733045735329792` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733148135043072` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392735522555703296` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `2026-08-15-espn-10team` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`), `espn-draft2-10team-16round` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`)
- Git commit: b78b851ad7388eb282a3cbdb60767758ec2945b9

> **Pilot caveat**: N=11 drafts (9 bot mocks + 2 all-human ESPN drafts). The bot mocks are the machinery cohort (bots grade the engine, not human shape); the two all-human drafts are the held-out shape sample for the Phase 2c gates and are never fitted. Current committed data/ was applied retroactively against all drafts; this validates engine mechanism, not a dated-snapshot projection-accuracy backtest (that is PLAN.md Gate A/D, separate scope).

## Coverage

- Decision points replayed: 165 (11 skipped — see per-decision-point log in the JSON sibling of this report)
- In-window unmatched picks (crosswalk misses): 0 — non-zero silently corrupts `actualSurvived` / VONA / lookahead oracles for those players (see per-decision-point `unmatchedWindowPickOveralls` / `coverage.unmatchedWindowPickOverallsByDecisionPoint`)
- Full analytic cohort (rows with an ADP-based prediction): 35609
- Fixed-intersection cohort (also has a simulated counterpart): 3392
- Analytic-only rows (prediction available, no simulated counterpart): 32217
- All-seat availability rows (seat-independent, every team's pick->next-pick window): 2386341
- All-seat in-window unmatched picks (crosswalk misses): 0

## A. Availability calibration

### A.1 `availableNextPickProbability` — full analytic cohort

Pooled (N=35609, Brier=0.0214):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 501 | 0.026 | 0.116 |
| 0.1-0.2 | 211 | 0.149 | 0.327 |
| 0.2-0.3 | 201 | 0.249 | 0.443 |
| 0.3-0.4 | 204 | 0.347 | 0.510 |
| 0.4-0.5 | 246 | 0.451 | 0.537 |
| 0.5-0.6 | 286 | 0.549 | 0.601 |
| 0.6-0.7 | 402 | 0.654 | 0.714 |
| 0.7-0.8 | 524 | 0.752 | 0.731 |
| 0.8-0.9 | 859 | 0.856 | 0.860 |
| 0.9-1.0 | 32175 | 0.996 | 0.996 |

Per draft:

**1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3325, Brier=0.0190)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 27 | 0.040 | 0.185 |
| 0.1-0.2 | 20 | 0.153 | 0.200 |
| 0.2-0.3 | 22 | 0.250 | 0.455 |
| 0.3-0.4 | 14 | 0.352 | 0.643 |
| 0.4-0.5 | 27 | 0.457 | 0.481 |
| 0.5-0.6 | 29 | 0.547 | 0.448 |
| 0.6-0.7 | 38 | 0.648 | 0.737 |
| 0.7-0.8 | 52 | 0.755 | 0.731 |
| 0.8-0.9 | 79 | 0.855 | 0.886 |
| 0.9-1.0 | 3017 | 0.996 | 0.998 |

**1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3326, Brier=0.0196)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 34 | 0.030 | 0.088 |
| 0.1-0.2 | 19 | 0.151 | 0.526 |
| 0.2-0.3 | 16 | 0.256 | 0.250 |
| 0.3-0.4 | 23 | 0.346 | 0.435 |
| 0.4-0.5 | 22 | 0.452 | 0.727 |
| 0.5-0.6 | 27 | 0.548 | 0.630 |
| 0.6-0.7 | 37 | 0.654 | 0.649 |
| 0.7-0.8 | 47 | 0.756 | 0.702 |
| 0.8-0.9 | 77 | 0.856 | 0.844 |
| 0.9-1.0 | 3024 | 0.996 | 0.998 |

**1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3326, Brier=0.0174)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 49 | 0.025 | 0.143 |
| 0.1-0.2 | 17 | 0.146 | 0.176 |
| 0.2-0.3 | 15 | 0.238 | 0.533 |
| 0.3-0.4 | 18 | 0.346 | 0.500 |
| 0.4-0.5 | 14 | 0.456 | 0.571 |
| 0.5-0.6 | 26 | 0.554 | 0.577 |
| 0.6-0.7 | 30 | 0.656 | 0.667 |
| 0.7-0.8 | 44 | 0.757 | 0.773 |
| 0.8-0.9 | 72 | 0.860 | 0.847 |
| 0.9-1.0 | 3041 | 0.997 | 0.998 |

**1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3325, Brier=0.0184)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 39 | 0.025 | 0.077 |
| 0.1-0.2 | 15 | 0.140 | 0.200 |
| 0.2-0.3 | 20 | 0.254 | 0.500 |
| 0.3-0.4 | 15 | 0.350 | 0.733 |
| 0.4-0.5 | 22 | 0.451 | 0.455 |
| 0.5-0.6 | 31 | 0.552 | 0.677 |
| 0.6-0.7 | 33 | 0.650 | 0.636 |
| 0.7-0.8 | 45 | 0.749 | 0.733 |
| 0.8-0.9 | 75 | 0.855 | 0.840 |
| 0.9-1.0 | 3030 | 0.997 | 0.998 |

**1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3131, Brier=0.0197)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 71 | 0.023 | 0.085 |
| 0.1-0.2 | 23 | 0.144 | 0.304 |
| 0.2-0.3 | 22 | 0.249 | 0.500 |
| 0.3-0.4 | 17 | 0.345 | 0.412 |
| 0.4-0.5 | 23 | 0.454 | 0.565 |
| 0.5-0.6 | 19 | 0.550 | 0.737 |
| 0.6-0.7 | 32 | 0.653 | 0.719 |
| 0.7-0.8 | 30 | 0.751 | 0.700 |
| 0.8-0.9 | 74 | 0.855 | 0.905 |
| 0.9-1.0 | 2820 | 0.996 | 0.996 |

**1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0252)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 43 | 0.027 | 0.116 |
| 0.1-0.2 | 24 | 0.146 | 0.333 |
| 0.2-0.3 | 21 | 0.247 | 0.286 |
| 0.3-0.4 | 30 | 0.347 | 0.567 |
| 0.4-0.5 | 27 | 0.452 | 0.593 |
| 0.5-0.6 | 29 | 0.552 | 0.621 |
| 0.6-0.7 | 48 | 0.653 | 0.729 |
| 0.7-0.8 | 57 | 0.756 | 0.807 |
| 0.8-0.9 | 89 | 0.856 | 0.876 |
| 0.9-1.0 | 2764 | 0.995 | 0.995 |

**1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0276)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 44 | 0.034 | 0.205 |
| 0.1-0.2 | 25 | 0.156 | 0.400 |
| 0.2-0.3 | 19 | 0.251 | 0.368 |
| 0.3-0.4 | 25 | 0.350 | 0.520 |
| 0.4-0.5 | 32 | 0.451 | 0.531 |
| 0.5-0.6 | 32 | 0.545 | 0.625 |
| 0.6-0.7 | 42 | 0.652 | 0.810 |
| 0.7-0.8 | 61 | 0.750 | 0.738 |
| 0.8-0.9 | 91 | 0.852 | 0.857 |
| 0.9-1.0 | 2761 | 0.995 | 0.995 |

**1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3131, Brier=0.0237)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 62 | 0.021 | 0.081 |
| 0.1-0.2 | 18 | 0.145 | 0.444 |
| 0.2-0.3 | 23 | 0.248 | 0.522 |
| 0.3-0.4 | 21 | 0.348 | 0.381 |
| 0.4-0.5 | 19 | 0.449 | 0.474 |
| 0.5-0.6 | 28 | 0.543 | 0.786 |
| 0.6-0.7 | 42 | 0.656 | 0.833 |
| 0.7-0.8 | 48 | 0.755 | 0.750 |
| 0.8-0.9 | 86 | 0.861 | 0.860 |
| 0.9-1.0 | 2784 | 0.995 | 0.995 |

**1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0259)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 40 | 0.029 | 0.075 |
| 0.1-0.2 | 22 | 0.145 | 0.409 |
| 0.2-0.3 | 23 | 0.251 | 0.565 |
| 0.3-0.4 | 21 | 0.337 | 0.571 |
| 0.4-0.5 | 32 | 0.443 | 0.438 |
| 0.5-0.6 | 32 | 0.551 | 0.438 |
| 0.6-0.7 | 46 | 0.656 | 0.761 |
| 0.7-0.8 | 63 | 0.755 | 0.825 |
| 0.8-0.9 | 93 | 0.855 | 0.892 |
| 0.9-1.0 | 2760 | 0.995 | 0.995 |

**2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3157, Brier=0.0186)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 42 | 0.024 | 0.071 |
| 0.1-0.2 | 14 | 0.151 | 0.214 |
| 0.2-0.3 | 12 | 0.246 | 0.500 |
| 0.3-0.4 | 10 | 0.355 | 0.400 |
| 0.4-0.5 | 12 | 0.440 | 0.583 |
| 0.5-0.6 | 13 | 0.544 | 0.462 |
| 0.6-0.7 | 18 | 0.652 | 0.611 |
| 0.7-0.8 | 36 | 0.743 | 0.556 |
| 0.8-0.9 | 55 | 0.858 | 0.891 |
| 0.9-1.0 | 2945 | 0.997 | 0.993 |

**espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3492, Brier=0.0214)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 50 | 0.021 | 0.180 |
| 0.1-0.2 | 14 | 0.160 | 0.286 |
| 0.2-0.3 | 8 | 0.238 | 0.250 |
| 0.3-0.4 | 10 | 0.354 | 0.400 |
| 0.4-0.5 | 16 | 0.448 | 0.563 |
| 0.5-0.6 | 20 | 0.543 | 0.600 |
| 0.6-0.7 | 36 | 0.659 | 0.583 |
| 0.7-0.8 | 41 | 0.745 | 0.610 |
| 0.8-0.9 | 68 | 0.857 | 0.750 |
| 0.9-1.0 | 3229 | 0.997 | 0.994 |

By cohort (Phase 2d stratification):

| Stratum | n | Brier |
|---|---|---|
| bot | 28960 | 0.0217 |
| human | 6649 | 0.0201 |

### A.1a Error by round and position (pooled analytic cohort)

These strata are descriptive only. They identify where more capture is needed rather
than supporting parameter retuning.

**By round**

| Stratum | n | Brier |
|---|---|---|
| Round 1 | 3326 | 0.0080 |
| Round 2 | 3199 | 0.0066 |
| Round 3 | 3086 | 0.0110 |
| Round 4 | 2959 | 0.0099 |
| Round 5 | 2846 | 0.0140 |
| Round 6 | 2719 | 0.0135 |
| Round 7 | 2606 | 0.0210 |
| Round 8 | 2479 | 0.0231 |
| Round 9 | 2366 | 0.0319 |
| Round 10 | 2239 | 0.0297 |
| Round 11 | 2126 | 0.0354 |
| Round 12 | 2002 | 0.0408 |
| Round 13 | 1891 | 0.0529 |
| Round 14 | 1598 | 0.0362 |
| Round 15 | 167 | 0.0412 |

**By position**

| Stratum | n | Brier |
|---|---|---|
| DEF | 4593 | 0.0161 |
| K | 4605 | 0.0218 |
| QB | 4801 | 0.0196 |
| RB | 6873 | 0.0255 |
| TE | 4849 | 0.0228 |
| WR | 9888 | 0.0211 |

### A.2 `unconditionalProbability` (baseline #1 — ignores survival-to-currentPick conditioning)

Pooled (N=35609, Brier=0.0265):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 738 | 0.026 | 0.255 |
| 0.1-0.2 | 290 | 0.149 | 0.476 |
| 0.2-0.3 | 234 | 0.250 | 0.543 |
| 0.3-0.4 | 260 | 0.352 | 0.596 |
| 0.4-0.5 | 309 | 0.452 | 0.638 |
| 0.5-0.6 | 318 | 0.556 | 0.720 |
| 0.6-0.7 | 415 | 0.651 | 0.733 |
| 0.7-0.8 | 549 | 0.753 | 0.809 |
| 0.8-0.9 | 925 | 0.858 | 0.904 |
| 0.9-1.0 | 31571 | 0.996 | 0.997 |

### A.3 Fixed-intersection comparison: analytic vs. simulated

Rows where both `availableNextPickProbability` and `simulatedSurvivalProbability` exist (N=3392).

**`availableNextPickProbability`** (pooled Brier=0.1061):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 369 | 0.024 | 0.046 |
| 0.1-0.2 | 131 | 0.149 | 0.260 |
| 0.2-0.3 | 109 | 0.250 | 0.376 |
| 0.3-0.4 | 115 | 0.349 | 0.487 |
| 0.4-0.5 | 123 | 0.448 | 0.447 |
| 0.5-0.6 | 147 | 0.549 | 0.517 |
| 0.6-0.7 | 198 | 0.653 | 0.621 |
| 0.7-0.8 | 234 | 0.749 | 0.650 |
| 0.8-0.9 | 347 | 0.854 | 0.813 |
| 0.9-1.0 | 1619 | 0.978 | 0.977 |

**`simulatedSurvivalProbability`** (pooled Brier=0.1253):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 331 | 0.000 | 0.088 |
| 0.1-0.2 | 135 | 0.125 | 0.207 |
| 0.2-0.3 | 108 | 0.250 | 0.370 |
| 0.3-0.4 | 116 | 0.375 | 0.405 |
| 0.5-0.6 | 117 | 0.500 | 0.513 |
| 0.6-0.7 | 154 | 0.625 | 0.552 |
| 0.7-0.8 | 224 | 0.750 | 0.589 |
| 0.8-0.9 | 340 | 0.875 | 0.688 |
| 0.9-1.0 | 1867 | 1.000 | 0.944 |

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

Pooled (N=2386341, Brier=0.0035):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 5415 | 0.027 | 0.135 |
| 0.1-0.2 | 2277 | 0.149 | 0.324 |
| 0.2-0.3 | 2209 | 0.250 | 0.402 |
| 0.3-0.4 | 2386 | 0.351 | 0.463 |
| 0.4-0.5 | 2632 | 0.451 | 0.531 |
| 0.5-0.6 | 3229 | 0.551 | 0.617 |
| 0.6-0.7 | 4108 | 0.653 | 0.690 |
| 0.7-0.8 | 5714 | 0.753 | 0.769 |
| 0.8-0.9 | 9672 | 0.855 | 0.861 |
| 0.9-1.0 | 2348699 | 0.999 | 0.999 |

By cohort:

| Stratum | n | Brier |
|---|---|---|
| bot | 1986740 | 0.0035 |
| human | 399601 | 0.0037 |

Per draft:
- **1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=199850, Brier=0.0029
- **1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=199850, Brier=0.0029
- **1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=199850, Brier=0.0030
- **1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=199850, Brier=0.0029
- **1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=237468, Brier=0.0039
- **1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=237468, Brier=0.0039
- **1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=237468, Brier=0.0039
- **1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=237468, Brier=0.0039
- **1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=237468, Brier=0.0037
- **2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=186226, Brier=0.0036
- **espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=213375, Brier=0.0038

## B. Analytic wait loss (VONA)

### B.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 27252 | 0.17 | 0.04 |
| starter mode | 19368 | 0.23 | 0.07 |
| bench mode | 7884 | 0.03 | -0.01 |

### B.2 Rank agreement (mean per-decision-point Spearman correlation, oracle VONA vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 154 | -0.047 | 0.074 | 0.232 | -0.061 | 0.858 (154) |
| starter mode | 154 | 0.043 | 0.295 | 0.279 | 0.217 | 0.838 (109) |
| bench mode | 57 | 0.247 | 0.246 | 0.280 | 0.066 | 0.871 (57) |

The engine estimate is the candidate's unified marginal roster utility minus the expected best
surviving substitute in the same eligibility group. The real-history oracle uses the best substitute
that actually survived the open-open opponent window. Rank agreement is therefore meaningful in
both starter and bench cohorts; n/a only means a stratum lacks enough non-constant decision points.

## Interpretation

This 11-draft directional report does **not** establish calibration. The conditioned analytic model's pooled
Brier score (0.0214) is modestly better than the
unconditional baseline (0.0265), but the largest
high-probability bucket dominates the pooled score and the lower/middle buckets require additional
captured drafts and round/position review. The fixed-intersection simulation comparison is also
directional only (analytic Brier 0.1061, simulated
Brier 0.1253). This run adds two all-human ESPN drafts
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
| All | 154 | 2.23 | 5.24 | 22.04 | 32.81 | 57.5% | 51.3% |
| Bot drafts (9, machinery) | 126 | 1.77 | 5.26 | 24.58 | 38.65 | 66.3% | 55.6% |
| Human drafts (2, held-out) | 28 | 4.29 | 5.19 | 10.62 | 6.55 | 17.4% | 32.1% |
| One core hole | 18 | 0.39 | 3.58 | 17.41 | 16.04 | 89.0% | 66.7% |
| Zero core holes | 57 | 0.92 | 0.98 | 5.81 | 7.36 | 5.9% | 56.1% |

Reported-decision snapshots, including Kelce/Sutton and White/Pittman plan components when present,
are stored in the JSON sibling under planning.reportedDecisionSnapshots.

### Two-pick gate

Status: **requires-two-window-evaluation**. Zero-hole one-horizon mean regret is
0.9250, so the maximum possible absolute improvement
from any two-pick policy is also 0.9250. That
cannot clear the predeclared 0.5 utility-point gate. The production objective therefore remains
deterministic one-horizon planning; no analytic correction is added to the legacy rollout.

## D. Legacy rollout lookahead diagnostic (correction 3 — "take c" oracle)

### C.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 3415 | 7.16 | -6.09 |
| starter mode | 2254 | 7.34 | -5.82 |
| bench mode | 1161 | 6.80 | -6.61 |

### C.2 Rank agreement (mean per-decision-point Spearman correlation, oracle lookahead vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 154 | 0.398 | 0.507 | 0.611 | 0.391 | 0.929 (114) |
| starter mode | 154 | 0.584 | 0.618 | 0.743 | 0.713 | 0.934 (110) |
| bench mode | 57 | n/a | n/a | n/a | n/a | n/a (0) |

## Descoped this round

- Explicitly descoped this round: Monte Carlo SE on a probability is analytic (sqrt(p(1-p)/n) ~= 0.177 at n=8,p=0.5); the sweep only earns its cost once rank-agreement (not raw probability noise) is the open question, and this directional sample cannot answer that reliably.
