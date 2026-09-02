# 2025 Historical Backtest report — 2026-08-24

## Metadata

- Generated at: 2026-08-24T08:05:50.991Z
- Git commit: ec6927136040763839ca7d4831ae84582845c90f
- Pilot run (directional, non-gating) — seeds per slot: 20, drafts per arm: 240, seed base: `20250825`
- League: 12-team snake PPR, 16 rounds, plain PPR (no TE bonus), startingSlots QB/RB/RB/WR/WR/TE/FLEX/K/DEF, playoffStartWeek 15

## Integrity (never silently drop)

- FFC board rows: 249; resolved to sleeper ids: 249.
- Hand-mapped: FFC "Hollywood Brown" (id 3249) -> Sleeper Marquise Brown (5848).
- Drafted-but-zero-outcome players (scored 0 all season, never excluded): 2309, 4018, 6803, 7042, 7437
- Resolved ids missing from players.json (must be none): none.
- FFC rows still unresolvable after the hand-map (must be none): none.

## Primary metric — mean optimized weekly starter points (weeks 1-17)

| Arm | Drafts | Mean weekly pts | 10th-pct weekly | Replacement-adj | Coverage | H2H win rate | Playoff rate |
|---|---|---|---|---|---|---|---|
| Engine (Stage C on) | 240 | 126.883 | 101.200 | 1062.1 | 0.814 | 0.601 | 0.831 |
| C1 — Stage C lookahead sort (informational, non-gating) | 240 | 128.159 | 102.800 | 1083.8 | 0.747 | 0.659 | 0.927 |
| B4 — MRV + tiers, no simulation | 240 | 126.883 | 101.200 | 1062.1 | 0.814 | 0.601 | 0.831 |
| B3 — static VOR (gate baseline) | 240 | 114.355 | 84.600 | 849.1 | 0.294 | 0.473 | 0.342 |
| B2 — raw projected points | 240 | 120.834 | 84.000 | 959.3 | 0.706 | 0.555 | 0.672 |
| B1 — FFC ADP | 240 | 125.099 | 93.560 | 1031.8 | 0.598 | 0.545 | 0.581 |

## Paired engine vs baseline-3 (static VOR)

- n = 240 paired drafts. Engine mean 126.883 vs baseline-3 mean 114.355.
- Mean paired difference (engine - b3): 12.528 pts/week, SE 0.260.
- Paired-difference 95% CI: [12.019, 13.037].

## Subject starter points by position (diagnostics-only — 2026-08-24 c1-attribution pre-declaration)

Mean weekly optimized-starter points attributed to each starter's own position (weeks 1-17; FLEX points land in the occupant's position, so the six columns sum to the arm's mean weekly total). K/TE/DEF are the cap-1 slots ({"TE":1,"K":1,"DEF":1}). Paired per-position CIs and the pre-declared flip test are computed offline by `pipeline/analyze_c1_positions.py`.

| Arm | QB | RB | WR | TE | K | DEF | K+TE+DEF |
|---|---|---|---|---|---|---|---|
| Engine (Stage C on) | 17.914 | 49.505 | 32.913 | 11.550 | 8.000 | 7.000 | 26.550 |
| C1 — Stage C lookahead sort (informational, non-gating) | 21.069 | 48.570 | 32.416 | 11.105 | 8.000 | 7.000 | 26.105 |
| B4 — MRV + tiers, no simulation | 17.914 | 49.505 | 32.913 | 11.550 | 8.000 | 7.000 | 26.550 |
| B3 — static VOR (gate baseline) | 4.752 | 54.149 | 30.376 | 7.867 | 10.388 | 6.824 | 25.078 |
| B2 — raw projected points | 23.124 | 29.508 | 41.975 | 10.374 | 8.176 | 7.676 | 26.227 |
| B1 — FFC ADP | 18.040 | 40.708 | 42.796 | 9.570 | 7.902 | 6.083 | 23.555 |

Mean round of the subject's first pick at each position (lower = earlier; 0 = never drafted):

| Arm | QB | RB | WR | TE | K | DEF |
|---|---|---|---|---|---|---|
| Engine (Stage C on) | 4.00 | 1.08 | 3.58 | 6.25 | 16.00 | 15.00 |
| C1 — Stage C lookahead sort (informational, non-gating) | 2.88 | 1.17 | 3.51 | 5.99 | 16.00 | 15.00 |
| B4 — MRV + tiers, no simulation | 4.00 | 1.08 | 3.58 | 6.25 | 16.00 | 15.00 |
| B3 — static VOR (gate baseline) | 6.00 | 1.00 | 4.00 | 7.00 | 9.00 | 8.00 |
| B2 — raw projected points | 1.00 | 9.08 | 3.08 | 9.33 | 12.08 | 14.50 |
| B1 — FFC ADP | 9.08 | 2.33 | 1.75 | 11.25 | 16.00 | 14.42 |

## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)

- C1 sorts by Stage C's simulated `lookaheadValue` instead of the production `planValue`; same Stage C simulation as `engine`, common-random-numbers-paired rollouts (`backtest.ts`'s `simulateDraft` shares `engine`'s `draftId` for `c1`). Not a gate — see `DECISIONS.md`'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.
- n = 240 paired drafts. C1 mean 128.159 vs engine mean 126.883.
- Mean paired difference (c1 - engine): 1.276 pts/week, SE 0.333.
- Paired-difference 95% CI: [0.624, 1.928].

## Gate verdicts

- **Pilot (non-gating)**: verdicts not applied — Directional pilot run (non-gating). All metrics and the paired CI are reported; gate verdicts are applied only in the gating run (BACKTEST_GATING=1, N >= 1000).

## Notes

- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` (documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, but it is load-bearing as the field policy.
- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all (draft, week) cells, weeks 1-17.
- FFC's board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage and rely on the opponent model's documented synthetic-ADP fallback.
- Determinism: rerunning with the same seed set reproduces the same 240-draft grid; only `metadata.generatedAt`/`gitCommit` differ between runs.
