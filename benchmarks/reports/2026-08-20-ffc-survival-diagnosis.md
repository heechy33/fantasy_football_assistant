# FFC observed-ADP survival-curve diagnosis (Phase 2a)

- FFC PPR window: 2026-08-13 -> 2026-08-20 · 6978 twelve-team mocks · 15 rounds
- Players scored: 264 fetched, 263 with complete high/adp/low/stdev/times_drafted (n>=2).

## H1 - tail skew by ADP band (normal => (adp-high) ~= (low-adp))

| Band | n | mean (adp-high) | mean (low-adp) | mean asym (L-R) | L>R frac | high==1 frac |
|---|---|---|---|---|---|---|
| pooled | 263 | 30.67 | 27.72 | 2.95 | 0.54 | 0.019 |
| <=12 | 12 | 3.62 | 5.04 | -1.42 | 0.0 | 0.333 |
| <=24 | 12 | 8.46 | 9.46 | -1.0 | 0.25 | 0.0 |
| <=48 | 24 | 12.22 | 14.11 | -1.89 | 0.292 | 0.0 |
| deep tail | 215 | 35.48 | 31.52 | 3.96 | 0.614 | 0.005 |

## H1 - range vs normality (observed (low-high) vs d2(times_drafted)*stdev)

| Band | n | median ratio | mean ratio | frac <0.8 | frac >1.2 |
|---|---|---|---|---|---|
| pooled | 263 | 0.923 | 0.908 | 0.213 | 0.023 |
| <=12 | 12 | 0.999 | 0.954 | 0.167 | 0.0 |
| <=24 | 12 | 0.842 | 0.788 | 0.25 | 0.0 |
| <=48 | 24 | 0.935 | 0.906 | 0.125 | 0.042 |
| deep tail | 215 | 0.91 | 0.912 | 0.223 | 0.023 |

## H2 - per-player CV vs fitted_stdev band constant

| Band | n | band CV | median obs CV | p10 | p90 | p90/p10 | band CV in [p10,p90] | far from band CV | mean obs/fitted stdev |
|---|---|---|---|---|---|---|---|---|---|
| <=12 | 12 | 0.247 | 0.218 | 0.177 | 0.38 | 2.14 | yes | 0.0 | 0.903 |
| <=24 | 12 | 0.169 | 0.17 | 0.139 | 0.206 | 1.47 | yes | 0.0 | 1.01 |
| <=48 | 24 | 0.124 | 0.122 | 0.1 | 0.161 | 1.62 | yes | 0.042 | 1.053 |
| deep tail | 215 | 0.112 | 0.112 | 0.083 | 0.16 | 1.93 | yes | 0.037 | 1.065 |

## Right-censoring check (mock length ceiling = 180 picks, near-ceiling margin = 10 picks)

A player's `low` cannot exceed the mock's fixed length even if the true right tail extends further, and a rarely-drafted player's `low` is a max over a small, biased sample. Both artificially shrink the observed right tail for deep-ADP players. This section checks whether H1's asymmetry survives once those rows are excluded, rather than assuming it does.

| Band | n | at ceiling | near ceiling | asym incl. censored | asym excl. censored |
|---|---|---|---|---|---|
| pooled | 263 | 0.361 | 0.475 | 2.95 | -0.71 |
| <=12 | 12 | 0.0 | 0.0 | -1.42 | -1.42 |
| <=24 | 12 | 0.0 | 0.0 | -1.0 | -1.0 |
| <=48 | 24 | 0.0 | 0.0 | -1.89 | -1.89 |
| deep tail | 215 | 0.442 | 0.581 | 3.96 | -0.26 |

**Flagged as a likely censoring artifact:** deep tail — a large fraction of these players sit near the mock's length ceiling, and excluding them collapses or reverses the left-longer asymmetry. Do not encode this band's raw asymmetry into a band-flipping H1 kernel without the exclusion.

## Rule-based verdicts

- H1 skew flagged: **True**
- H1 skew survives the right-censoring check (not solely a mock-length artifact): **False**
- Bands flagged as censoring artifacts: **['deep tail']**
- H1 range inconsistent with normal extremes: **False**
- H2 within-band CV heterogeneity flagged: **True**
- H2 band CV representative in every band: **True**

*Caveats: the top band's left tail is mechanically bounded by pick 1 (see `high==1 frac`); FFC `high/low` semantics are earliest/latest pick (verified on the live feed), so a range ratio well below 1.0 means either the reported extremes are not true min/max or the tails are thinner than normal. The right-censoring check above guards the *deep-ADP* band specifically — see the top of this file for why a fixed-length mock corrupts that band's apparent skew direction.*