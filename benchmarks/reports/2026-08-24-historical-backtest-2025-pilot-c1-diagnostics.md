# 2025 Historical Backtest report — 2026-08-24

## Metadata

- Generated at: 2026-08-24T04:56:16.061Z
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
| Engine (Stage C on) | 240 | 129.666 | 99.600 | 1109.4 | 0.614 | 0.707 | 0.926 |
| C1 — Stage C lookahead sort (informational, non-gating) | 240 | 130.678 | 101.920 | 1126.6 | 0.750 | 0.729 | 0.967 |
| B4 — MRV + tiers, no simulation | 240 | 129.666 | 99.600 | 1109.4 | 0.614 | 0.707 | 0.926 |
| B3 — static VOR (gate baseline) | 240 | 112.634 | 83.200 | 819.9 | 0.298 | 0.537 | 0.612 |
| B2 — raw projected points | 240 | 124.025 | 90.520 | 1013.5 | 0.573 | 0.666 | 0.920 |
| B1 — FFC ADP | 240 | 130.502 | 100.020 | 1123.6 | 0.497 | 0.694 | 0.913 |

## Paired engine vs baseline-3 (static VOR)

- n = 240 paired drafts. Engine mean 129.666 vs baseline-3 mean 112.634.
- Mean paired difference (engine - b3): 17.032 pts/week, SE 0.526.
- Paired-difference 95% CI: [16.002, 18.062].

## Subject starter points by position (diagnostics-only — 2026-08-24 c1-attribution pre-declaration)

Mean weekly optimized-starter points attributed to each starter's own position (weeks 1-17; FLEX points land in the occupant's position, so the six columns sum to the arm's mean weekly total). K/TE/DEF are the cap-1 slots ({"TE":1,"K":1,"DEF":1}). Paired per-position CIs and the pre-declared flip test are computed offline by `pipeline/analyze_c1_positions.py`.

| Arm | QB | RB | WR | TE | K | DEF | K+TE+DEF |
|---|---|---|---|---|---|---|---|
| Engine (Stage C on) | 19.843 | 44.226 | 40.518 | 8.762 | 8.326 | 7.991 | 25.079 |
| C1 — Stage C lookahead sort (informational, non-gating) | 19.466 | 46.926 | 35.095 | 12.678 | 8.487 | 8.025 | 29.190 |
| B4 — MRV + tiers, no simulation | 19.843 | 44.226 | 40.518 | 8.762 | 8.326 | 7.991 | 25.079 |
| B3 — static VOR (gate baseline) | 4.912 | 52.616 | 31.281 | 7.263 | 9.734 | 6.828 | 23.825 |
| B2 — raw projected points | 23.054 | 33.913 | 41.642 | 9.122 | 8.392 | 7.903 | 25.416 |
| B1 — FFC ADP | 20.825 | 41.016 | 45.773 | 9.504 | 5.824 | 7.559 | 22.887 |

Mean round of the subject's first pick at each position (lower = earlier; 0 = never drafted):

| Arm | QB | RB | WR | TE | K | DEF |
|---|---|---|---|---|---|---|
| Engine (Stage C on) | 4.06 | 1.19 | 3.28 | 7.64 | 16.00 | 15.00 |
| C1 — Stage C lookahead sort (informational, non-gating) | 3.15 | 1.17 | 3.53 | 6.51 | 16.00 | 15.00 |
| B4 — MRV + tiers, no simulation | 4.06 | 1.19 | 3.28 | 7.64 | 16.00 | 15.00 |
| B3 — static VOR (gate baseline) | 6.01 | 1.01 | 3.94 | 6.99 | 9.00 | 8.00 |
| B2 — raw projected points | 1.00 | 7.07 | 3.21 | 10.05 | 13.27 | 15.28 |
| B1 — FFC ADP | 9.57 | 2.54 | 1.59 | 13.24 | 15.84 | 13.64 |

## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)

- C1 sorts by Stage C's simulated `lookaheadValue` instead of the production `planValue`; same Stage C simulation as `engine`, common-random-numbers-paired rollouts (`backtest.ts`'s `simulateDraft` shares `engine`'s `draftId` for `c1`). Not a gate — see `DECISIONS.md`'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.
- n = 240 paired drafts. C1 mean 130.678 vs engine mean 129.666.
- Mean paired difference (c1 - engine): 1.012 pts/week, SE 0.585.
- Paired-difference 95% CI: [-0.135, 2.159].

## Gate verdicts

- **Pilot (non-gating)**: verdicts not applied — Directional pilot run (non-gating). All metrics and the paired CI are reported; gate verdicts are applied only in the gating run (BACKTEST_GATING=1, N >= 1000).

## Notes

- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` (documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, but it is load-bearing as the field policy.
- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all (draft, week) cells, weeks 1-17.
- FFC's board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage and rely on the opponent model's documented synthetic-ADP fallback.
- Determinism: rerunning with the same seed set reproduces the same 240-draft grid; only `metadata.generatedAt`/`gitCommit` differ between runs.
