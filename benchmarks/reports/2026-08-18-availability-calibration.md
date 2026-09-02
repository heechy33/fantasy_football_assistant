# Availability/VONA calibration report — 2026-08-18

## Metadata

- Generated at: 2026-08-21T20:34:48.508Z
- `data/manifest.json` builtAt: 2026-08-18T09:28:35.870952+00:00
- FFToday projections upstream updated at: 8/13/2026
- Active ADP source (`adp_active_ppr`): sleeper
- Drafts scored (N=11): `1392688856670687232` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1391308704153874432` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730676591087616` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392730609540935680` (bot, humanSeats=1, autodraftShare=0.9, marketShare=1, adp=`adp-ppr.json`), `1392732613948473344` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392732908569001984` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733045735329792` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392733148135043072` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `1392735522555703296` (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1, adp=`adp-ppr.json`), `2026-08-15-espn-10team` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`), `espn-draft2-10team-16round` (human, humanSeats=10, autodraftShare=0, marketShare=0, adp=`adp-espn-ppr.json`)
- Git commit: 71e281e89d96ddf32d5f15d92e30d1e981ae871a

> **Pilot caveat**: N=11 drafts (9 bot mocks + 2 all-human ESPN drafts). The bot mocks are the machinery cohort (bots grade the engine, not human shape); the two all-human drafts are the held-out shape sample for the Phase 2c gates and are never fitted. Current committed data/ was applied retroactively against all drafts; this validates engine mechanism, not a dated-snapshot projection-accuracy backtest (that is PLAN.md Gate A/D, separate scope).

## Coverage

- Decision points replayed: 165 (11 skipped — see per-decision-point log in the JSON sibling of this report)
- In-window unmatched picks (crosswalk misses): 0 — non-zero silently corrupts `actualSurvived` / VONA / lookahead oracles for those players (see per-decision-point `unmatchedWindowPickOveralls` / `coverage.unmatchedWindowPickOverallsByDecisionPoint`)
- Full analytic cohort (rows with an ADP-based prediction): 34672
- Fixed-intersection cohort (also has a simulated counterpart): 3414
- Analytic-only rows (prediction available, no simulated counterpart): 31258
- All-seat availability rows (seat-independent, every team's pick->next-pick window): 1763075
- All-seat in-window unmatched picks (crosswalk misses): 0

## A. Availability calibration

### A.1 `availableNextPickProbability` — full analytic cohort

Pooled (N=34672, Brier=0.0209):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 497 | 0.027 | 0.129 |
| 0.1-0.2 | 193 | 0.149 | 0.259 |
| 0.2-0.3 | 195 | 0.249 | 0.364 |
| 0.3-0.4 | 193 | 0.349 | 0.446 |
| 0.4-0.5 | 250 | 0.452 | 0.512 |
| 0.5-0.6 | 295 | 0.552 | 0.600 |
| 0.6-0.7 | 370 | 0.654 | 0.686 |
| 0.7-0.8 | 526 | 0.754 | 0.732 |
| 0.8-0.9 | 837 | 0.857 | 0.865 |
| 0.9-1.0 | 31316 | 0.996 | 0.996 |

Per draft:

**1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3241, Brier=0.0182)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 24 | 0.033 | 0.167 |
| 0.1-0.2 | 19 | 0.147 | 0.211 |
| 0.2-0.3 | 20 | 0.237 | 0.300 |
| 0.3-0.4 | 15 | 0.352 | 0.533 |
| 0.4-0.5 | 28 | 0.454 | 0.536 |
| 0.5-0.6 | 30 | 0.551 | 0.367 |
| 0.6-0.7 | 37 | 0.648 | 0.676 |
| 0.7-0.8 | 50 | 0.753 | 0.720 |
| 0.8-0.9 | 80 | 0.856 | 0.900 |
| 0.9-1.0 | 2938 | 0.997 | 0.999 |

**1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3241, Brier=0.0186)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 35 | 0.033 | 0.057 |
| 0.1-0.2 | 15 | 0.158 | 0.400 |
| 0.2-0.3 | 18 | 0.251 | 0.389 |
| 0.3-0.4 | 19 | 0.349 | 0.368 |
| 0.4-0.5 | 22 | 0.448 | 0.636 |
| 0.5-0.6 | 28 | 0.559 | 0.643 |
| 0.6-0.7 | 38 | 0.654 | 0.658 |
| 0.7-0.8 | 43 | 0.755 | 0.651 |
| 0.8-0.9 | 81 | 0.856 | 0.852 |
| 0.9-1.0 | 2942 | 0.997 | 0.999 |

**1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3241, Brier=0.0164)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 45 | 0.018 | 0.111 |
| 0.1-0.2 | 18 | 0.139 | 0.167 |
| 0.2-0.3 | 17 | 0.255 | 0.529 |
| 0.3-0.4 | 13 | 0.339 | 0.462 |
| 0.4-0.5 | 21 | 0.452 | 0.476 |
| 0.5-0.6 | 24 | 0.551 | 0.542 |
| 0.6-0.7 | 24 | 0.657 | 0.542 |
| 0.7-0.8 | 46 | 0.757 | 0.783 |
| 0.8-0.9 | 69 | 0.858 | 0.870 |
| 0.9-1.0 | 2964 | 0.997 | 0.999 |

**1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1; N=3241, Brier=0.0174)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 40 | 0.028 | 0.075 |
| 0.1-0.2 | 11 | 0.153 | 0.182 |
| 0.2-0.3 | 21 | 0.249 | 0.429 |
| 0.3-0.4 | 18 | 0.357 | 0.500 |
| 0.4-0.5 | 20 | 0.454 | 0.550 |
| 0.5-0.6 | 31 | 0.561 | 0.581 |
| 0.6-0.7 | 33 | 0.657 | 0.636 |
| 0.7-0.8 | 42 | 0.751 | 0.762 |
| 0.8-0.9 | 73 | 0.856 | 0.863 |
| 0.9-1.0 | 2952 | 0.997 | 0.998 |

**1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3045, Brier=0.0186)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 71 | 0.025 | 0.085 |
| 0.1-0.2 | 24 | 0.150 | 0.250 |
| 0.2-0.3 | 18 | 0.251 | 0.333 |
| 0.3-0.4 | 16 | 0.346 | 0.438 |
| 0.4-0.5 | 21 | 0.450 | 0.476 |
| 0.5-0.6 | 24 | 0.547 | 0.708 |
| 0.6-0.7 | 31 | 0.648 | 0.774 |
| 0.7-0.8 | 29 | 0.752 | 0.690 |
| 0.8-0.9 | 66 | 0.853 | 0.909 |
| 0.9-1.0 | 2745 | 0.996 | 0.997 |

**1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3045, Brier=0.0239)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 44 | 0.032 | 0.136 |
| 0.1-0.2 | 19 | 0.146 | 0.263 |
| 0.2-0.3 | 25 | 0.250 | 0.320 |
| 0.3-0.4 | 23 | 0.339 | 0.304 |
| 0.4-0.5 | 30 | 0.451 | 0.633 |
| 0.5-0.6 | 29 | 0.557 | 0.517 |
| 0.6-0.7 | 43 | 0.657 | 0.814 |
| 0.7-0.8 | 61 | 0.752 | 0.787 |
| 0.8-0.9 | 90 | 0.858 | 0.867 |
| 0.9-1.0 | 2681 | 0.996 | 0.996 |

**1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3045, Brier=0.0268)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 45 | 0.038 | 0.200 |
| 0.1-0.2 | 21 | 0.157 | 0.286 |
| 0.2-0.3 | 19 | 0.254 | 0.526 |
| 0.3-0.4 | 22 | 0.349 | 0.364 |
| 0.4-0.5 | 31 | 0.448 | 0.452 |
| 0.5-0.6 | 36 | 0.550 | 0.639 |
| 0.6-0.7 | 41 | 0.650 | 0.707 |
| 0.7-0.8 | 61 | 0.757 | 0.754 |
| 0.8-0.9 | 90 | 0.856 | 0.867 |
| 0.9-1.0 | 2679 | 0.996 | 0.996 |

**1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3045, Brier=0.0222)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 61 | 0.023 | 0.115 |
| 0.1-0.2 | 22 | 0.158 | 0.227 |
| 0.2-0.3 | 19 | 0.248 | 0.263 |
| 0.3-0.4 | 18 | 0.346 | 0.556 |
| 0.4-0.5 | 22 | 0.458 | 0.455 |
| 0.5-0.6 | 29 | 0.555 | 0.759 |
| 0.6-0.7 | 37 | 0.654 | 0.838 |
| 0.7-0.8 | 46 | 0.751 | 0.739 |
| 0.8-0.9 | 80 | 0.856 | 0.887 |
| 0.9-1.0 | 2711 | 0.995 | 0.995 |

**1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1; N=3045, Brier=0.0248)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 38 | 0.030 | 0.132 |
| 0.1-0.2 | 22 | 0.145 | 0.318 |
| 0.2-0.3 | 21 | 0.247 | 0.381 |
| 0.3-0.4 | 22 | 0.348 | 0.591 |
| 0.4-0.5 | 29 | 0.450 | 0.276 |
| 0.5-0.6 | 33 | 0.546 | 0.636 |
| 0.6-0.7 | 43 | 0.651 | 0.558 |
| 0.7-0.8 | 63 | 0.751 | 0.841 |
| 0.8-0.9 | 93 | 0.855 | 0.882 |
| 0.9-1.0 | 2681 | 0.995 | 0.996 |

**2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3079, Brier=0.0199)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 42 | 0.023 | 0.095 |
| 0.1-0.2 | 9 | 0.144 | 0.222 |
| 0.2-0.3 | 9 | 0.245 | 0.333 |
| 0.3-0.4 | 12 | 0.358 | 0.333 |
| 0.4-0.5 | 11 | 0.454 | 0.636 |
| 0.5-0.6 | 14 | 0.537 | 0.643 |
| 0.6-0.7 | 13 | 0.659 | 0.538 |
| 0.7-0.8 | 38 | 0.759 | 0.553 |
| 0.8-0.9 | 54 | 0.861 | 0.796 |
| 0.9-1.0 | 2877 | 0.997 | 0.992 |

**espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0; N=3404, Brier=0.0239)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 52 | 0.019 | 0.250 |
| 0.1-0.2 | 13 | 0.138 | 0.308 |
| 0.2-0.3 | 8 | 0.241 | 0.000 |
| 0.3-0.4 | 15 | 0.365 | 0.467 |
| 0.4-0.5 | 15 | 0.452 | 0.667 |
| 0.5-0.6 | 17 | 0.545 | 0.588 |
| 0.6-0.7 | 30 | 0.659 | 0.667 |
| 0.7-0.8 | 47 | 0.755 | 0.660 |
| 0.8-0.9 | 61 | 0.860 | 0.787 |
| 0.9-1.0 | 3146 | 0.997 | 0.991 |

By cohort (Phase 2d stratification):

| Stratum | n | Brier |
|---|---|---|
| bot | 28189 | 0.0207 |
| human | 6483 | 0.0220 |

### A.1a Error by round and position (pooled analytic cohort)

These strata are descriptive only. They identify where more capture is needed rather
than supporting parameter retuning.

**By round**

| Stratum | n | Brier |
|---|---|---|
| Round 1 | 3260 | 0.0079 |
| Round 2 | 3133 | 0.0062 |
| Round 3 | 3020 | 0.0108 |
| Round 4 | 2893 | 0.0093 |
| Round 5 | 2780 | 0.0144 |
| Round 6 | 2653 | 0.0120 |
| Round 7 | 2540 | 0.0209 |
| Round 8 | 2413 | 0.0215 |
| Round 9 | 2300 | 0.0323 |
| Round 10 | 2173 | 0.0274 |
| Round 11 | 2060 | 0.0363 |
| Round 12 | 1933 | 0.0409 |
| Round 13 | 1820 | 0.0533 |
| Round 14 | 1532 | 0.0341 |
| Round 15 | 162 | 0.0417 |

**By position**

| Stratum | n | Brier |
|---|---|---|
| DEF | 4593 | 0.0157 |
| K | 4605 | 0.0221 |
| QB | 4647 | 0.0182 |
| RB | 6719 | 0.0244 |
| TE | 4695 | 0.0226 |
| WR | 9413 | 0.0208 |

### A.2 `unconditionalProbability` (baseline #1 — ignores survival-to-currentPick conditioning)

Pooled (N=34672, Brier=0.0253):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 696 | 0.025 | 0.240 |
| 0.1-0.2 | 256 | 0.145 | 0.371 |
| 0.2-0.3 | 243 | 0.248 | 0.494 |
| 0.3-0.4 | 262 | 0.351 | 0.546 |
| 0.4-0.5 | 291 | 0.450 | 0.660 |
| 0.5-0.6 | 333 | 0.552 | 0.673 |
| 0.6-0.7 | 397 | 0.653 | 0.751 |
| 0.7-0.8 | 523 | 0.754 | 0.792 |
| 0.8-0.9 | 888 | 0.856 | 0.905 |
| 0.9-1.0 | 30783 | 0.996 | 0.997 |

### A.3 Fixed-intersection comparison: analytic vs. simulated

Rows where both `availableNextPickProbability` and `simulatedSurvivalProbability` exist (N=3414).

**`availableNextPickProbability`** (pooled Brier=0.0983):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 358 | 0.024 | 0.039 |
| 0.1-0.2 | 115 | 0.148 | 0.200 |
| 0.2-0.3 | 116 | 0.247 | 0.284 |
| 0.3-0.4 | 107 | 0.349 | 0.374 |
| 0.4-0.5 | 134 | 0.451 | 0.485 |
| 0.5-0.6 | 152 | 0.552 | 0.500 |
| 0.6-0.7 | 197 | 0.655 | 0.604 |
| 0.7-0.8 | 243 | 0.755 | 0.695 |
| 0.8-0.9 | 341 | 0.857 | 0.845 |
| 0.9-1.0 | 1651 | 0.979 | 0.976 |

**`simulatedSurvivalProbability`** (pooled Brier=0.1201):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 337 | 0.000 | 0.095 |
| 0.1-0.2 | 133 | 0.125 | 0.143 |
| 0.2-0.3 | 103 | 0.250 | 0.330 |
| 0.3-0.4 | 104 | 0.375 | 0.462 |
| 0.5-0.6 | 136 | 0.500 | 0.441 |
| 0.6-0.7 | 146 | 0.625 | 0.555 |
| 0.7-0.8 | 218 | 0.750 | 0.596 |
| 0.8-0.9 | 346 | 0.875 | 0.708 |
| 0.9-1.0 | 1891 | 1.000 | 0.946 |

### A.4 Leave-one-draft-out empirical round/position baseline

Each draft's prediction-eligible rows are scored against a survival-rate table built from the *other*
draft alone. This uses the same N as the analytic score, making the Brier comparison like-for-like. Pooled
(N=34672, Brier=0.0417):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.8-0.9 | 917 | 0.877 | 0.900 |
| 0.9-1.0 | 33755 | 0.958 | 0.957 |

### A.5 All-seat survival-curve calibration (Phase 2b, seat-independent)

Every team's pick->next-pick window is scored for every not-yet-drafted ADP player - the direct,
large-n test of the analytic survival model. The 9 bot mocks grade machinery; the two all-human
ESPN drafts are the held-out shape sample for the Phase 2c gates and are never fitted.

Pooled (N=1763075, Brier=0.0045):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 5304 | 0.027 | 0.140 |
| 0.1-0.2 | 2198 | 0.150 | 0.268 |
| 0.2-0.3 | 2130 | 0.250 | 0.361 |
| 0.3-0.4 | 2310 | 0.350 | 0.423 |
| 0.4-0.5 | 2655 | 0.451 | 0.494 |
| 0.5-0.6 | 3184 | 0.553 | 0.586 |
| 0.6-0.7 | 3924 | 0.653 | 0.674 |
| 0.7-0.8 | 5628 | 0.754 | 0.761 |
| 0.8-0.9 | 9353 | 0.856 | 0.866 |
| 0.9-1.0 | 1726389 | 0.999 | 0.999 |

By cohort:

| Stratum | n | Brier |
|---|---|---|
| bot | 1467340 | 0.0043 |
| human | 295735 | 0.0054 |

Per draft:
- **1392688856670687232** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=147910, Brier=0.0036
- **1391308704153874432** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=147910, Brier=0.0036
- **1392730676591087616** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=147910, Brier=0.0037
- **1392730609540935680** (bot, humanSeats=1, autodraftShare=0.9, marketShare=1): N=147910, Brier=0.0036
- **1392732613948473344** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=175140, Brier=0.0049
- **1392732908569001984** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=175140, Brier=0.0048
- **1392733045735329792** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=175140, Brier=0.0049
- **1392733148135043072** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=175140, Brier=0.0049
- **1392735522555703296** (bot, humanSeats=1, autodraftShare=0.9167, marketShare=1): N=175140, Brier=0.0046
- **2026-08-15-espn-10team** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=137996, Brier=0.0050
- **espn-draft2-10team-16round** (human, humanSeats=10, autodraftShare=0, marketShare=0): N=157739, Brier=0.0057

## B. Analytic wait loss (VONA)

### B.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 26339 | 0.17 | 0.05 |
| starter mode | 18771 | 0.23 | 0.07 |
| bench mode | 7568 | 0.02 | -0.01 |

### B.2 Rank agreement (mean per-decision-point Spearman correlation, oracle VONA vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 154 | -0.075 | 0.058 | 0.227 | -0.068 | 0.862 (154) |
| starter mode | 154 | 0.010 | 0.288 | 0.278 | 0.215 | 0.846 (109) |
| bench mode | 57 | 0.242 | 0.245 | 0.288 | 0.074 | 0.868 (57) |

The engine estimate is the candidate's unified marginal roster utility minus the expected best
surviving substitute in the same eligibility group. The real-history oracle uses the best substitute
that actually survived the open-open opponent window. Rank agreement is therefore meaningful in
both starter and bench cohorts; n/a only means a stratum lacks enough non-constant decision points.

## Interpretation

This 11-draft directional report does **not** establish calibration. The conditioned analytic model's pooled
Brier score (0.0209) is modestly better than the
unconditional baseline (0.0253), but the largest
high-probability bucket dominates the pooled score and the lower/middle buckets require additional
captured drafts and round/position review. The fixed-intersection simulation comparison is also
directional only (analytic Brier 0.0983, simulated
Brier 0.1201). This run adds two all-human ESPN drafts
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
| All | 154 | 1.68 | 4.53 | 20.89 | 32.52 | 62.9% | 52.6% |
| Bot drafts (9, machinery) | 126 | 1.46 | 4.37 | 23.26 | 38.26 | 66.6% | 54.8% |
| Human drafts (2, held-out) | 28 | 2.69 | 5.25 | 10.25 | 6.69 | 48.9% | 42.9% |
| One core hole | 18 | 0.91 | 3.30 | 16.51 | 15.23 | 72.6% | 61.1% |
| Zero core holes | 57 | 0.54 | 0.82 | 5.58 | 6.31 | 35.0% | 59.6% |

Reported-decision snapshots, including Kelce/Sutton and White/Pittman plan components when present,
are stored in the JSON sibling under planning.reportedDecisionSnapshots.

### Two-pick gate

Status: **requires-two-window-evaluation**. Zero-hole one-horizon mean regret is
0.5354, so the maximum possible absolute improvement
from any two-pick policy is also 0.5354. That
cannot clear the predeclared 0.5 utility-point gate. The production objective therefore remains
deterministic one-horizon planning; no analytic correction is added to the legacy rollout.

## D. Legacy rollout lookahead diagnostic (correction 3 — "take c" oracle)

### C.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 3434 | 7.17 | -6.40 |
| starter mode | 2270 | 7.39 | -6.24 |
| bench mode | 1164 | 6.75 | -6.70 |

### C.2 Rank agreement (mean per-decision-point Spearman correlation, oracle lookahead vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 154 | 0.387 | 0.497 | 0.619 | 0.404 | 0.928 (113) |
| starter mode | 154 | 0.574 | 0.618 | 0.756 | 0.729 | 0.938 (109) |
| bench mode | 57 | n/a | n/a | n/a | n/a | n/a (0) |

## Descoped this round

- Explicitly descoped this round: Monte Carlo SE on a probability is analytic (sqrt(p(1-p)/n) ~= 0.177 at n=8,p=0.5); the sweep only earns its cost once rank-agreement (not raw probability noise) is the open question, and this directional sample cannot answer that reliably.
