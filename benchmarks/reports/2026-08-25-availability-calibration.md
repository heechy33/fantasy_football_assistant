# Availability/VONA calibration report — 2026-08-25

## Metadata

- Generated at: 2026-08-26T02:48:01.957Z
- `data/manifest.json` builtAt: 2026-08-25T19:14:07.572699+00:00
- FFToday projections upstream updated at: 8/20/2026
- Active ADP source (`adp_active_ppr`): sleeper
- Drafts scored (N=11): `1392688856670687232` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1391308704153874432` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730676591087616` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730609540935680` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392732613948473344` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392732908569001984` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733045735329792` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733148135043072` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392735522555703296` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `2026-08-15-espn-10team` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`), `espn-draft2-10team-16round` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`)
- Git commit: f30fabec9709e48aab12ce2cd6164fe01ea07146

> **Pilot caveat**: N=11 drafts (9 bot mocks + 2 all-human ESPN drafts). The bot mocks are the machinery cohort (bots grade the engine, not human shape); the two all-human drafts are the held-out shape sample for the Phase 2c gates and are never fitted. Current committed data/ was applied retroactively against all drafts; this validates engine mechanism, not a dated-snapshot projection-accuracy backtest (that is PLAN.md Gate A/D, separate scope).

## Coverage

- Decision points replayed: 165 (11 skipped — see per-decision-point log in the JSON sibling of this report)
- In-window unmatched picks (crosswalk misses): 0 — non-zero silently corrupts `actualSurvived` / VONA / lookahead oracles for those players (see per-decision-point `unmatchedWindowPickOveralls` / `coverage.unmatchedWindowPickOverallsByDecisionPoint`)
- Full analytic cohort (rows with an ADP-based prediction): 35609
- Fixed-intersection cohort (also has a simulated counterpart): 3398
- Analytic-only rows (prediction available, no simulated counterpart): 32211
- All-seat availability rows (seat-independent, every team's pick->next-pick window): 2465301
- All-seat in-window unmatched picks (crosswalk misses): 0

## A. Availability calibration

### A.1 `availableNextPickProbability` — full analytic cohort

Pooled (N=35609, Brier=0.0217):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 519 | 0.027 | 0.127 |
| 0.1-0.2 | 208 | 0.152 | 0.346 |
| 0.2-0.3 | 196 | 0.248 | 0.449 |
| 0.3-0.4 | 211 | 0.349 | 0.521 |
| 0.4-0.5 | 249 | 0.455 | 0.530 |
| 0.5-0.6 | 275 | 0.550 | 0.611 |
| 0.6-0.7 | 404 | 0.653 | 0.718 |
| 0.7-0.8 | 511 | 0.751 | 0.734 |
| 0.8-0.9 | 850 | 0.855 | 0.855 |
| 0.9-1.0 | 32186 | 0.996 | 0.996 |

Per draft:

**1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3325, Brier=0.0193)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 27 | 0.037 | 0.185 |
| 0.1-0.2 | 22 | 0.154 | 0.227 |
| 0.2-0.3 | 19 | 0.247 | 0.421 |
| 0.3-0.4 | 20 | 0.351 | 0.650 |
| 0.4-0.5 | 24 | 0.465 | 0.417 |
| 0.5-0.6 | 27 | 0.550 | 0.481 |
| 0.6-0.7 | 44 | 0.655 | 0.795 |
| 0.7-0.8 | 43 | 0.755 | 0.651 |
| 0.8-0.9 | 79 | 0.854 | 0.899 |
| 0.9-1.0 | 3020 | 0.996 | 0.998 |

**1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3326, Brier=0.0198)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 36 | 0.033 | 0.111 |
| 0.1-0.2 | 19 | 0.148 | 0.474 |
| 0.2-0.3 | 16 | 0.251 | 0.313 |
| 0.3-0.4 | 20 | 0.349 | 0.500 |
| 0.4-0.5 | 22 | 0.445 | 0.682 |
| 0.5-0.6 | 28 | 0.549 | 0.643 |
| 0.6-0.7 | 32 | 0.649 | 0.688 |
| 0.7-0.8 | 54 | 0.752 | 0.722 |
| 0.8-0.9 | 72 | 0.854 | 0.792 |
| 0.9-1.0 | 3027 | 0.996 | 0.998 |

**1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3326, Brier=0.0175)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 53 | 0.027 | 0.132 |
| 0.1-0.2 | 14 | 0.159 | 0.286 |
| 0.2-0.3 | 15 | 0.254 | 0.467 |
| 0.3-0.4 | 13 | 0.342 | 0.615 |
| 0.4-0.5 | 22 | 0.452 | 0.545 |
| 0.5-0.6 | 22 | 0.558 | 0.591 |
| 0.6-0.7 | 32 | 0.653 | 0.656 |
| 0.7-0.8 | 38 | 0.754 | 0.789 |
| 0.8-0.9 | 73 | 0.855 | 0.836 |
| 0.9-1.0 | 3044 | 0.997 | 0.998 |

**1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3325, Brier=0.0187)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 41 | 0.026 | 0.122 |
| 0.1-0.2 | 15 | 0.139 | 0.133 |
| 0.2-0.3 | 16 | 0.257 | 0.500 |
| 0.3-0.4 | 19 | 0.347 | 0.737 |
| 0.4-0.5 | 22 | 0.463 | 0.455 |
| 0.5-0.6 | 30 | 0.556 | 0.700 |
| 0.6-0.7 | 33 | 0.654 | 0.606 |
| 0.7-0.8 | 46 | 0.748 | 0.717 |
| 0.8-0.9 | 73 | 0.856 | 0.849 |
| 0.9-1.0 | 3030 | 0.997 | 0.998 |

**1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3131, Brier=0.0200)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 73 | 0.023 | 0.110 |
| 0.1-0.2 | 19 | 0.143 | 0.316 |
| 0.2-0.3 | 24 | 0.234 | 0.458 |
| 0.3-0.4 | 18 | 0.350 | 0.389 |
| 0.4-0.5 | 21 | 0.451 | 0.571 |
| 0.5-0.6 | 22 | 0.545 | 0.682 |
| 0.6-0.7 | 29 | 0.653 | 0.724 |
| 0.7-0.8 | 32 | 0.754 | 0.781 |
| 0.8-0.9 | 73 | 0.856 | 0.877 |
| 0.9-1.0 | 2820 | 0.996 | 0.996 |

**1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0256)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 47 | 0.030 | 0.128 |
| 0.1-0.2 | 23 | 0.154 | 0.435 |
| 0.2-0.3 | 19 | 0.251 | 0.263 |
| 0.3-0.4 | 32 | 0.348 | 0.469 |
| 0.4-0.5 | 24 | 0.448 | 0.667 |
| 0.5-0.6 | 32 | 0.552 | 0.594 |
| 0.6-0.7 | 45 | 0.652 | 0.800 |
| 0.7-0.8 | 56 | 0.758 | 0.804 |
| 0.8-0.9 | 92 | 0.857 | 0.859 |
| 0.9-1.0 | 2762 | 0.995 | 0.995 |

**1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0280)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 45 | 0.034 | 0.222 |
| 0.1-0.2 | 25 | 0.160 | 0.360 |
| 0.2-0.3 | 21 | 0.253 | 0.429 |
| 0.3-0.4 | 25 | 0.348 | 0.600 |
| 0.4-0.5 | 33 | 0.464 | 0.515 |
| 0.5-0.6 | 30 | 0.553 | 0.633 |
| 0.6-0.7 | 44 | 0.654 | 0.773 |
| 0.7-0.8 | 59 | 0.751 | 0.729 |
| 0.8-0.9 | 90 | 0.853 | 0.878 |
| 0.9-1.0 | 2760 | 0.995 | 0.995 |

**1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3131, Brier=0.0240)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 63 | 0.021 | 0.095 |
| 0.1-0.2 | 21 | 0.153 | 0.429 |
| 0.2-0.3 | 21 | 0.253 | 0.524 |
| 0.3-0.4 | 20 | 0.351 | 0.400 |
| 0.4-0.5 | 22 | 0.458 | 0.500 |
| 0.5-0.6 | 28 | 0.549 | 0.786 |
| 0.6-0.7 | 37 | 0.654 | 0.838 |
| 0.7-0.8 | 48 | 0.752 | 0.771 |
| 0.8-0.9 | 89 | 0.861 | 0.876 |
| 0.9-1.0 | 2782 | 0.996 | 0.994 |

**1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3132, Brier=0.0264)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 40 | 0.027 | 0.075 |
| 0.1-0.2 | 24 | 0.143 | 0.458 |
| 0.2-0.3 | 25 | 0.250 | 0.640 |
| 0.3-0.4 | 20 | 0.350 | 0.450 |
| 0.4-0.5 | 31 | 0.448 | 0.484 |
| 0.5-0.6 | 28 | 0.548 | 0.429 |
| 0.6-0.7 | 51 | 0.653 | 0.686 |
| 0.7-0.8 | 61 | 0.753 | 0.852 |
| 0.8-0.9 | 90 | 0.854 | 0.889 |
| 0.9-1.0 | 2762 | 0.995 | 0.995 |

**2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3157, Brier=0.0186)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 44 | 0.026 | 0.068 |
| 0.1-0.2 | 12 | 0.157 | 0.250 |
| 0.2-0.3 | 12 | 0.240 | 0.500 |
| 0.3-0.4 | 13 | 0.356 | 0.462 |
| 0.4-0.5 | 11 | 0.456 | 0.545 |
| 0.5-0.6 | 11 | 0.547 | 0.455 |
| 0.6-0.7 | 19 | 0.646 | 0.579 |
| 0.7-0.8 | 34 | 0.740 | 0.588 |
| 0.8-0.9 | 53 | 0.855 | 0.868 |
| 0.9-1.0 | 2948 | 0.997 | 0.993 |

**espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3492, Brier=0.0213)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 50 | 0.020 | 0.180 |
| 0.1-0.2 | 14 | 0.160 | 0.286 |
| 0.2-0.3 | 8 | 0.238 | 0.250 |
| 0.3-0.4 | 11 | 0.348 | 0.455 |
| 0.4-0.5 | 17 | 0.454 | 0.471 |
| 0.5-0.6 | 17 | 0.542 | 0.647 |
| 0.6-0.7 | 38 | 0.655 | 0.632 |
| 0.7-0.8 | 40 | 0.742 | 0.575 |
| 0.8-0.9 | 66 | 0.855 | 0.758 |
| 0.9-1.0 | 3231 | 0.997 | 0.994 |

By cohort (Phase 2d stratification):

| Stratum | n | Brier |
|---|---|---|
| bot | 28960 | 0.0221 |
| human | 6649 | 0.0200 |

### A.1a Error by round and position (pooled analytic cohort)

These strata are descriptive only. They identify where more capture is needed rather
than supporting parameter retuning.

**By round**

| Stratum | n | Brier |
|---|---|---|
| Round 1 | 3326 | 0.0080 |
| Round 2 | 3199 | 0.0066 |
| Round 3 | 3086 | 0.0112 |
| Round 4 | 2959 | 0.0100 |
| Round 5 | 2846 | 0.0142 |
| Round 6 | 2719 | 0.0135 |
| Round 7 | 2606 | 0.0210 |
| Round 8 | 2479 | 0.0232 |
| Round 9 | 2366 | 0.0321 |
| Round 10 | 2239 | 0.0301 |
| Round 11 | 2126 | 0.0356 |
| Round 12 | 2002 | 0.0415 |
| Round 13 | 1891 | 0.0538 |
| Round 14 | 1598 | 0.0374 |
| Round 15 | 167 | 0.0419 |

**By position**

| Stratum | n | Brier |
|---|---|---|
| DEF | 4593 | 0.0163 |
| K | 4605 | 0.0225 |
| QB | 4801 | 0.0197 |
| RB | 6873 | 0.0259 |
| TE | 4849 | 0.0229 |
| WR | 9888 | 0.0213 |

### A.2 `unconditionalProbability` (baseline #1 — ignores survival-to-currentPick conditioning)

Pooled (N=35609, Brier=0.0269):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 755 | 0.026 | 0.254 |
| 0.1-0.2 | 281 | 0.149 | 0.505 |
| 0.2-0.3 | 239 | 0.250 | 0.536 |
| 0.3-0.4 | 254 | 0.350 | 0.571 |
| 0.4-0.5 | 300 | 0.451 | 0.663 |
| 0.5-0.6 | 326 | 0.554 | 0.739 |
| 0.6-0.7 | 429 | 0.653 | 0.730 |
| 0.7-0.8 | 519 | 0.753 | 0.807 |
| 0.8-0.9 | 915 | 0.857 | 0.901 |
| 0.9-1.0 | 31591 | 0.996 | 0.996 |

### A.3 Fixed-intersection comparison: analytic vs. simulated

Rows where both `availableNextPickProbability` and `simulatedSurvivalProbability` exist (N=3398).

**`availableNextPickProbability`** (pooled Brier=0.1069):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 382 | 0.025 | 0.058 |
| 0.1-0.2 | 125 | 0.152 | 0.288 |
| 0.2-0.3 | 107 | 0.250 | 0.374 |
| 0.3-0.4 | 123 | 0.350 | 0.488 |
| 0.4-0.5 | 120 | 0.453 | 0.433 |
| 0.5-0.6 | 144 | 0.551 | 0.542 |
| 0.6-0.7 | 200 | 0.653 | 0.610 |
| 0.7-0.8 | 230 | 0.748 | 0.643 |
| 0.8-0.9 | 331 | 0.854 | 0.813 |
| 0.9-1.0 | 1636 | 0.977 | 0.975 |

**`simulatedSurvivalProbability`** (pooled Brier=0.1265):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 342 | 0.000 | 0.085 |
| 0.1-0.2 | 127 | 0.125 | 0.236 |
| 0.2-0.3 | 115 | 0.250 | 0.374 |
| 0.3-0.4 | 101 | 0.375 | 0.446 |
| 0.5-0.6 | 125 | 0.500 | 0.496 |
| 0.6-0.7 | 159 | 0.625 | 0.528 |
| 0.7-0.8 | 209 | 0.750 | 0.603 |
| 0.8-0.9 | 344 | 0.875 | 0.686 |
| 0.9-1.0 | 1876 | 1.000 | 0.942 |

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

Pooled (N=2465301, Brier=0.0035):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 5521 | 0.027 | 0.139 |
| 0.1-0.2 | 2292 | 0.149 | 0.342 |
| 0.2-0.3 | 2172 | 0.250 | 0.406 |
| 0.3-0.4 | 2454 | 0.351 | 0.467 |
| 0.4-0.5 | 2628 | 0.453 | 0.536 |
| 0.5-0.6 | 3205 | 0.552 | 0.629 |
| 0.6-0.7 | 4085 | 0.652 | 0.691 |
| 0.7-0.8 | 5655 | 0.753 | 0.766 |
| 0.8-0.9 | 9672 | 0.856 | 0.861 |
| 0.9-1.0 | 2427617 | 0.999 | 0.999 |

By cohort:

| Stratum | n | Brier |
|---|---|---|
| bot | 2052540 | 0.0034 |
| human | 412761 | 0.0036 |

Per draft:
- **1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=206430, Brier=0.0029
- **1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=206430, Brier=0.0029
- **1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=206430, Brier=0.0030
- **1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=206430, Brier=0.0028
- **1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=245364, Brier=0.0038
- **1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=245364, Brier=0.0038
- **1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=245364, Brier=0.0038
- **1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=245364, Brier=0.0039
- **1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=245364, Brier=0.0037
- **2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=192336, Brier=0.0035
- **espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=220425, Brier=0.0037

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
| all candidates | 154 | -0.045 | 0.074 | 0.237 | -0.059 | 0.856 (154) |
| starter mode | 154 | 0.045 | 0.295 | 0.282 | 0.219 | 0.836 (109) |
| bench mode | 57 | 0.245 | 0.247 | 0.280 | 0.066 | 0.870 (57) |

The engine estimate is the candidate's unified marginal roster utility minus the expected best
surviving substitute in the same eligibility group. The real-history oracle uses the best substitute
that actually survived the open-open opponent window. Rank agreement is therefore meaningful in
both starter and bench cohorts; n/a only means a stratum lacks enough non-constant decision points.

## Interpretation

This 11-draft directional report does **not** establish calibration. The conditioned analytic model's pooled
Brier score (0.0217) is modestly better than the
unconditional baseline (0.0269), but the largest
high-probability bucket dominates the pooled score and the lower/middle buckets require additional
captured drafts and round/position review. The fixed-intersection simulation comparison is also
directional only (analytic Brier 0.1069, simulated
Brier 0.1265). This run adds two all-human ESPN drafts
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
| All | 154 | 2.27 | 5.24 | 21.93 | 33.09 | 56.6% | 50.6% |
| Bot drafts (9, machinery) | 126 | 1.82 | 5.25 | 24.44 | 38.98 | 65.2% | 54.8% |
| Human drafts (2, held-out) | 28 | 4.29 | 5.19 | 10.62 | 6.55 | 17.4% | 32.1% |
| One core hole | 18 | 0.39 | 3.58 | 16.89 | 16.35 | 89.0% | 66.7% |
| Zero core holes | 57 | 0.92 | 0.97 | 5.87 | 7.76 | 4.3% | 56.1% |

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
| all simulated rows | 3421 | 7.22 | -6.10 |
| starter mode | 2255 | 7.46 | -5.86 |
| bench mode | 1166 | 6.76 | -6.57 |

### C.2 Rank agreement (mean per-decision-point Spearman correlation, oracle lookahead vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 154 | 0.399 | 0.507 | 0.612 | 0.389 | 0.927 (114) |
| starter mode | 154 | 0.584 | 0.618 | 0.742 | 0.710 | 0.934 (110) |
| bench mode | 57 | n/a | n/a | n/a | n/a | n/a (0) |

## Descoped this round

- Explicitly descoped this round: Monte Carlo SE on a probability is analytic (sqrt(p(1-p)/n) ~= 0.177 at n=8,p=0.5); the sweep only earns its cost once rank-agreement (not raw probability noise) is the open question, and this directional sample cannot answer that reliably.
