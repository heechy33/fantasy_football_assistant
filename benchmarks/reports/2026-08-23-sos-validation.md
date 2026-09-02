# Early-window SOS validation (2025 outcomes)

**Pre-declared rule:** cut if |partial r| < 0.05 or the 95% week-cluster bootstrap CI crosses 0; cut unless the top-12 hit-rate delta is positive with >= 60% of position-week pairs positive. KEEP only if both pass.

## Windowed opponent-FPA signals (next-week PPR points, form-controlled)

| Signal | n | raw r | partial r (given form) | 95% CI | top-12 hit-rate delta | share pairs positive |
|---|---|---|---|---|---|---|
| sos_1w | 3109 | 0.1466 | 0.0730 | 0.0306, 0.1107 | -0.0653 | 0.1667 |
| sos_3w | 3329 | 0.2033 | 0.0939 | 0.0578, 0.1316 | -0.0632 | 0.1290 |
| sos_5w | 3116 | 0.2387 | 0.1194 | 0.0793, 0.1603 | -0.0661 | 0.1379 |
| sos_std | 3116 | 0.2612 | 0.1271 | 0.0936, 0.1629 | -0.0489 | 0.2414 |

Baseline mean within-pool Spearman (form only): 0.3928; best treatment: 0.3122.

## FantasyPros SOS stars (currently displayed)

- n = 343
- raw r vs season PPG: 0.0088
- partial r vs season PPG (given overall rank): -0.0494
- Sign reveals direction; magnitude judged against the same 0.05 bar.

## Verdict: **CUT**

Limitations: single season (2025), ~14 independent prediction weeks, FPA derived from the same feed it predicts (trailing windows prevent leakage, not shared-source bias). A null here justifies cutting because the burden of proof is on SOS.
