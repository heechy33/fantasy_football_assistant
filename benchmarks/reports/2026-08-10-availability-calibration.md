# Availability/VONA calibration report — 2026-08-10

## Metadata

- Generated at: 2026-08-12T02:29:41.042Z
- `data/manifest.json` builtAt: 2026-08-10T02:27:22.885650+00:00
- FFToday projections upstream updated at: 8/6/2026
- Active ADP source (`adp_active_ppr`): sleeper
- Recorded draft IDs: 1392688856670687232, 1391308704153874432, 1392730676591087616, 1392730609540935680, 1392732613948473344, 1392732908569001984, 1392733045735329792, 1392733148135043072, 1392735522555703296
- Git commit: 3fb5c3278d5f72947d1c67ad66e0c0e7cc3a46bb

> **Pilot caveat**: N=9 recorded drafts — within the plan's 5-10-draft directional-report target, but still not an independent historical draft-strategy backtest. Current committed data/ was applied retroactively against all drafts; this validates engine mechanism, not a dated-snapshot projection-accuracy backtest (that is PLAN.md Gate A/D, separate scope).

## Coverage

- Decision points replayed: 135 (9 skipped — see per-decision-point log in the JSON sibling of this report)
- In-window unmatched picks (crosswalk misses): 0 — non-zero silently corrupts `actualSurvived` / VONA / lookahead oracles for those players (see per-decision-point `unmatchedWindowPickOveralls` / `coverage.unmatchedWindowPickOverallsByDecisionPoint`)
- Full analytic cohort (rows with an ADP-based prediction): 26425
- Fixed-intersection cohort (also has a simulated counterpart): 2671
- Analytic-only rows (prediction available, no simulated counterpart): 23754

## A. Availability calibration

### A.1 `availableNextPickProbability` — full analytic cohort

Pooled (N=26425, Brier=0.0172):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 321 | 0.025 | 0.028 |
| 0.1-0.2 | 158 | 0.150 | 0.095 |
| 0.2-0.3 | 160 | 0.252 | 0.163 |
| 0.3-0.4 | 212 | 0.353 | 0.288 |
| 0.4-0.5 | 259 | 0.454 | 0.402 |
| 0.5-0.6 | 299 | 0.552 | 0.612 |
| 0.6-0.7 | 399 | 0.653 | 0.732 |
| 0.7-0.8 | 497 | 0.752 | 0.857 |
| 0.8-0.9 | 847 | 0.855 | 0.941 |
| 0.9-1.0 | 23273 | 0.995 | 0.999 |

Per draft:

**1392688856670687232** (N=3045, Brier=0.0165)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 21 | 0.027 | 0.048 |
| 0.1-0.2 | 14 | 0.153 | 0.000 |
| 0.2-0.3 | 18 | 0.250 | 0.167 |
| 0.3-0.4 | 19 | 0.358 | 0.158 |
| 0.4-0.5 | 26 | 0.459 | 0.423 |
| 0.5-0.6 | 34 | 0.553 | 0.647 |
| 0.6-0.7 | 53 | 0.657 | 0.755 |
| 0.7-0.8 | 47 | 0.753 | 0.766 |
| 0.8-0.9 | 92 | 0.856 | 0.946 |
| 0.9-1.0 | 2721 | 0.996 | 0.999 |

**1391308704153874432** (N=3045, Brier=0.0153)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 25 | 0.021 | 0.000 |
| 0.1-0.2 | 20 | 0.150 | 0.100 |
| 0.2-0.3 | 12 | 0.253 | 0.000 |
| 0.3-0.4 | 16 | 0.368 | 0.188 |
| 0.4-0.5 | 20 | 0.446 | 0.550 |
| 0.5-0.6 | 30 | 0.548 | 0.500 |
| 0.6-0.7 | 46 | 0.644 | 0.630 |
| 0.7-0.8 | 73 | 0.754 | 0.877 |
| 0.8-0.9 | 69 | 0.853 | 0.957 |
| 0.9-1.0 | 2734 | 0.996 | 0.998 |

**1392730676591087616** (N=3045, Brier=0.0142)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 43 | 0.023 | 0.047 |
| 0.1-0.2 | 15 | 0.145 | 0.200 |
| 0.2-0.3 | 12 | 0.251 | 0.000 |
| 0.3-0.4 | 19 | 0.346 | 0.316 |
| 0.4-0.5 | 24 | 0.457 | 0.458 |
| 0.5-0.6 | 21 | 0.550 | 0.571 |
| 0.6-0.7 | 34 | 0.663 | 0.824 |
| 0.7-0.8 | 31 | 0.749 | 0.806 |
| 0.8-0.9 | 92 | 0.856 | 0.891 |
| 0.9-1.0 | 2754 | 0.996 | 0.999 |

**1392730609540935680** (N=3045, Brier=0.0158)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 33 | 0.024 | 0.000 |
| 0.1-0.2 | 16 | 0.156 | 0.125 |
| 0.2-0.3 | 13 | 0.264 | 0.385 |
| 0.3-0.4 | 19 | 0.351 | 0.421 |
| 0.4-0.5 | 18 | 0.459 | 0.278 |
| 0.5-0.6 | 31 | 0.550 | 0.516 |
| 0.6-0.7 | 31 | 0.660 | 0.548 |
| 0.7-0.8 | 62 | 0.748 | 0.839 |
| 0.8-0.9 | 80 | 0.851 | 0.975 |
| 0.9-1.0 | 2742 | 0.996 | 0.998 |

**1392732613948473344** (N=2849, Brier=0.0157)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 59 | 0.022 | 0.034 |
| 0.1-0.2 | 27 | 0.155 | 0.074 |
| 0.2-0.3 | 25 | 0.251 | 0.280 |
| 0.3-0.4 | 31 | 0.348 | 0.355 |
| 0.4-0.5 | 28 | 0.457 | 0.607 |
| 0.5-0.6 | 22 | 0.560 | 0.727 |
| 0.6-0.7 | 25 | 0.650 | 0.800 |
| 0.7-0.8 | 43 | 0.751 | 0.884 |
| 0.8-0.9 | 68 | 0.858 | 0.941 |
| 0.9-1.0 | 2521 | 0.996 | 0.999 |

**1392732908569001984** (N=2849, Brier=0.0200)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 35 | 0.030 | 0.057 |
| 0.1-0.2 | 14 | 0.146 | 0.143 |
| 0.2-0.3 | 19 | 0.251 | 0.105 |
| 0.3-0.4 | 28 | 0.352 | 0.286 |
| 0.4-0.5 | 36 | 0.454 | 0.389 |
| 0.5-0.6 | 40 | 0.551 | 0.575 |
| 0.6-0.7 | 52 | 0.651 | 0.673 |
| 0.7-0.8 | 59 | 0.759 | 0.831 |
| 0.8-0.9 | 122 | 0.851 | 0.967 |
| 0.9-1.0 | 2444 | 0.995 | 1.000 |

**1392733045735329792** (N=2849, Brier=0.0200)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 28 | 0.031 | 0.036 |
| 0.1-0.2 | 17 | 0.147 | 0.059 |
| 0.2-0.3 | 20 | 0.261 | 0.150 |
| 0.3-0.4 | 24 | 0.354 | 0.292 |
| 0.4-0.5 | 38 | 0.451 | 0.158 |
| 0.5-0.6 | 45 | 0.557 | 0.689 |
| 0.6-0.7 | 65 | 0.650 | 0.754 |
| 0.7-0.8 | 67 | 0.752 | 0.881 |
| 0.8-0.9 | 105 | 0.857 | 0.962 |
| 0.9-1.0 | 2440 | 0.995 | 0.999 |

**1392733148135043072** (N=2849, Brier=0.0186)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 52 | 0.024 | 0.019 |
| 0.1-0.2 | 19 | 0.151 | 0.053 |
| 0.2-0.3 | 24 | 0.246 | 0.125 |
| 0.3-0.4 | 32 | 0.354 | 0.438 |
| 0.4-0.5 | 23 | 0.448 | 0.652 |
| 0.5-0.6 | 29 | 0.545 | 0.724 |
| 0.6-0.7 | 33 | 0.651 | 0.848 |
| 0.7-0.8 | 50 | 0.758 | 0.840 |
| 0.8-0.9 | 105 | 0.857 | 0.886 |
| 0.9-1.0 | 2482 | 0.995 | 0.998 |

**1392735522555703296** (N=2849, Brier=0.0195)

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 25 | 0.025 | 0.000 |
| 0.1-0.2 | 16 | 0.143 | 0.125 |
| 0.2-0.3 | 17 | 0.241 | 0.176 |
| 0.3-0.4 | 24 | 0.353 | 0.042 |
| 0.4-0.5 | 46 | 0.453 | 0.304 |
| 0.5-0.6 | 47 | 0.554 | 0.574 |
| 0.6-0.7 | 60 | 0.654 | 0.767 |
| 0.7-0.8 | 65 | 0.748 | 0.938 |
| 0.8-0.9 | 114 | 0.857 | 0.947 |
| 0.9-1.0 | 2435 | 0.995 | 1.000 |

### A.1a Error by round and position (pooled analytic cohort)

These strata are descriptive only. They identify where more capture is needed rather
than supporting parameter retuning.

**By round**

| Stratum | n | Brier |
|---|---|---|
| Round 1 | 2532 | 0.0057 |
| Round 2 | 2443 | 0.0050 |
| Round 3 | 2332 | 0.0082 |
| Round 4 | 2243 | 0.0083 |
| Round 5 | 2132 | 0.0095 |
| Round 6 | 2043 | 0.0154 |
| Round 7 | 1932 | 0.0167 |
| Round 8 | 1843 | 0.0184 |
| Round 9 | 1732 | 0.0172 |
| Round 10 | 1643 | 0.0210 |
| Round 11 | 1532 | 0.0209 |
| Round 12 | 1443 | 0.0309 |
| Round 13 | 1332 | 0.0318 |
| Round 14 | 1243 | 0.0723 |

**By position**

| Stratum | n | Brier |
|---|---|---|
| DEF | 3744 | 0.0108 |
| K | 3776 | 0.0080 |
| QB | 3156 | 0.0185 |
| RB | 5309 | 0.0223 |
| TE | 3044 | 0.0235 |
| WR | 7396 | 0.0184 |

### A.2 `unconditionalProbability` (baseline #1 — ignores survival-to-currentPick conditioning)

Pooled (N=26425, Brier=0.0206):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 434 | 0.030 | 0.069 |
| 0.1-0.2 | 235 | 0.153 | 0.162 |
| 0.2-0.3 | 263 | 0.252 | 0.354 |
| 0.3-0.4 | 283 | 0.351 | 0.509 |
| 0.4-0.5 | 310 | 0.453 | 0.648 |
| 0.5-0.6 | 353 | 0.552 | 0.731 |
| 0.6-0.7 | 418 | 0.653 | 0.861 |
| 0.7-0.8 | 520 | 0.754 | 0.910 |
| 0.8-0.9 | 785 | 0.856 | 0.964 |
| 0.9-1.0 | 22824 | 0.996 | 0.999 |

### A.3 Fixed-intersection comparison: analytic vs. simulated

Rows where both `availableNextPickProbability` and `simulatedSurvivalProbability` exist (N=2671).

**`availableNextPickProbability`** (pooled Brier=0.0831):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 264 | 0.022 | 0.023 |
| 0.1-0.2 | 113 | 0.150 | 0.088 |
| 0.2-0.3 | 111 | 0.253 | 0.153 |
| 0.3-0.4 | 129 | 0.355 | 0.287 |
| 0.4-0.5 | 139 | 0.454 | 0.381 |
| 0.5-0.6 | 161 | 0.552 | 0.621 |
| 0.6-0.7 | 196 | 0.653 | 0.709 |
| 0.7-0.8 | 224 | 0.750 | 0.857 |
| 0.8-0.9 | 318 | 0.852 | 0.937 |
| 0.9-1.0 | 1016 | 0.977 | 1.000 |

**`simulatedSurvivalProbability`** (pooled Brier=0.0962):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.0-0.1 | 219 | 0.000 | 0.032 |
| 0.1-0.2 | 130 | 0.125 | 0.138 |
| 0.2-0.3 | 112 | 0.250 | 0.205 |
| 0.3-0.4 | 121 | 0.375 | 0.223 |
| 0.5-0.6 | 149 | 0.500 | 0.463 |
| 0.6-0.7 | 165 | 0.625 | 0.521 |
| 0.7-0.8 | 230 | 0.750 | 0.709 |
| 0.8-0.9 | 363 | 0.875 | 0.873 |
| 0.9-1.0 | 1182 | 1.000 | 0.980 |

### A.4 Leave-one-draft-out empirical round/position baseline

Each draft's prediction-eligible rows are scored against a survival-rate table built from the *other*
draft alone. This uses the same N as the analytic score, making the Brier comparison like-for-like. Pooled
(N=26425, Brier=0.0448):

| Bucket | n | Mean predicted | Observed rate |
|---|---|---|---|
| 0.8-0.9 | 1814 | 0.871 | 0.879 |
| 0.9-1.0 | 24611 | 0.958 | 0.957 |

## B. Analytic wait loss (VONA)

### B.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 20050 | 0.15 | 0.06 |
| starter mode | 14312 | 0.21 | 0.08 |
| bench mode | 5738 | 0.02 | -0.00 |

### B.2 Rank agreement (mean per-decision-point Spearman correlation, oracle VONA vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 126 | -0.404 | 0.026 | 0.093 | -0.125 | 0.860 (126) |
| starter mode | 126 | -0.248 | 0.258 | 0.174 | 0.132 | 0.857 (90) |
| bench mode | 47 | 0.274 | 0.248 | 0.299 | n/a | 0.881 (47) |

The engine estimate is the candidate's unified marginal roster utility minus the expected best
surviving substitute in the same eligibility group. The real-history oracle uses the best substitute
that actually survived the open-open opponent window. Rank agreement is therefore meaningful in
both starter and bench cohorts; n/a only means a stratum lacks enough non-constant decision points.

## Interpretation

This 9-draft directional report does **not** establish calibration. The conditioned analytic model's pooled
Brier score (0.0172) is modestly better than the
unconditional baseline (0.0206), but the largest
high-probability bucket dominates the pooled score and the lower/middle buckets require additional
captured drafts and round/position review. The fixed-intersection simulation comparison is also
directional only (analytic Brier 0.0831, simulated
Brier 0.0962). Keep availability labeled experimental
until a larger, independent sample supports calibration or a correction.

## C. Unified roster-utility planning

The realized oracle forces each current candidate, removes opponents' actual open-open-window
picks, then takes the best surviving follow-up under the same starter-plus-depth roster utility.
Regret is oracle-best utility minus the utility of each policy's selected candidate.

| Cohort | n | Plan regret | Old S2 regret | ADP regret | Projection regret | Improvement vs S2 | Top-choice agreement |
|---|---:|---:|---:|---:|---:|---:|---:|
| All | 126 | 1.75 | 4.67 | 22.18 | 37.47 | 62.6% | 54.8% |
| One core hole | 12 | 1.28 | 4.55 | 12.69 | 14.42 | 71.8% | 66.7% |
| Zero core holes | 47 | 0.37 | 0.97 | 6.13 | 6.07 | 62.1% | 63.8% |

Reported-decision snapshots, including Kelce/Sutton and White/Pittman plan components when present,
are stored in the JSON sibling under planning.reportedDecisionSnapshots.

### Two-pick gate

Status: **rejected-at-prescreen**. Zero-hole one-horizon mean regret is
0.3659, so the maximum possible absolute improvement
from any two-pick policy is also 0.3659. That
cannot clear the predeclared 0.5 utility-point gate. The production objective therefore remains
deterministic one-horizon planning; no analytic correction is added to the legacy rollout.

## D. Legacy rollout lookahead diagnostic (correction 3 — "take c" oracle)

### C.1 MAE / bias vs. the real-history oracle

| Stratum | n | MAE | Bias |
|---|---|---|---|
| all simulated rows | 2772 | 4.42 | -2.34 |
| starter mode | 1849 | 5.81 | -4.16 |
| bench mode | 923 | 1.65 | 1.33 |

### C.2 Rank agreement (mean per-decision-point Spearman correlation, oracle lookahead vs. each baseline)

| Stratum | Decision points | vs ADP | vs raw projection | vs static VOR | vs deterministic S2 | vs engine (n points) |
|---|---|---|---|---|---|---|
| all candidates | 126 | 0.205 | 0.485 | 0.565 | 0.457 | 0.942 (92) |
| starter mode | 126 | 0.499 | 0.597 | 0.735 | 0.759 | 0.941 (90) |
| bench mode | 47 | n/a | n/a | n/a | n/a | n/a (0) |

## Descoped this round

- Explicitly descoped this round: Monte Carlo SE on a probability is analytic (sqrt(p(1-p)/n) ~= 0.177 at n=8,p=0.5); the sweep only earns its cost once rank-agreement (not raw probability noise) is the open question, and this directional sample cannot answer that reliably.
