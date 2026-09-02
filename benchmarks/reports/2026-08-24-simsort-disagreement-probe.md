# Stage C sim-sort disagreement probe — 2026-08-24

## Metadata

- Generated at: 2026-08-24T07:12:22.748Z
- Git commit: ec6927136040763839ca7d4831ae84582845c90f
- Grid: 12 slots x 3 seeds, 576 subject-turn observations.
- Along the real `engine` draft trajectory (subject always advances on the actual production pick); at every subject turn, records whether a pure Stage C lookahead sort (`simSortChoice`) would have chosen a different player.

## Overall

| Picks | Disagreements | Rate | Mean Δrank | Mean Spearman (planValue vs lookahead) |
|---|---|---|---|---|
| 576 | 218 | 0.378 | 0.95 | 0.538 |

## By round band

| Round | Picks | Disagreements | Rate | Mean Δrank |
|---|---|---|---|---|
| 1-3 | 108 | 25 | 0.231 | 0.38 |
| 4-8 | 180 | 88 | 0.489 | 1.38 |
| 9-12 | 144 | 67 | 0.465 | 0.83 |
| 13-16 | 144 | 38 | 0.264 | 0.94 |

## No-ADP-coverage subset (either the engine pick or the sim pick has no ADP row)

- Picks: 0, disagreements: 0, rate: 0.000.

## Basis counts

- lookahead: 504
- special-teams-deferred: 72
- no-lookahead: 0

## Decision

- **BUILD the C1 arm** — Build the C1 backtest arm if overall top-1 disagreement >= 0.05, OR any round band >= 0.1, OR the no-ADP-coverage subset >= 0.1.
