# 2025 Historical Backtest report — 2026-08-24

## Metadata

- Generated at: 2026-08-24T06:50:04.958Z
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
| Engine (Stage C on) | 240 | 177.308 | 154.220 | 1919.3 | 0.734 | 1.000 | 1.000 |
| C1 — Stage C lookahead sort (informational, non-gating) | 240 | 178.255 | 155.220 | 1935.4 | 0.755 | 1.000 | 1.000 |
| B4 — MRV + tiers, no simulation | 240 | 177.308 | 154.220 | 1919.3 | 0.734 | 1.000 | 1.000 |
| B3 — static VOR (gate baseline) | 240 | 165.579 | 133.300 | 1719.9 | 0.642 | 1.000 | 1.000 |
| B2 — raw projected points | 240 | 177.853 | 157.100 | 1928.6 | 0.635 | 1.000 | 1.000 |
| B1 — FFC ADP | 240 | 169.071 | 132.940 | 1779.3 | 0.486 | 1.000 | 1.000 |

## Paired engine vs baseline-3 (static VOR)

- n = 240 paired drafts. Engine mean 177.308 vs baseline-3 mean 165.579.
- Mean paired difference (engine - b3): 11.729 pts/week, SE 0.316.
- Paired-difference 95% CI: [11.109, 12.349].

## Subject starter points by position (diagnostics-only — 2026-08-24 c1-attribution pre-declaration)

Mean weekly optimized-starter points attributed to each starter's own position (weeks 1-17; FLEX points land in the occupant's position, so the six columns sum to the arm's mean weekly total). K/TE/DEF are the cap-1 slots ({"TE":1,"K":1,"DEF":1}). Paired per-position CIs and the pre-declared flip test are computed offline by `pipeline/analyze_c1_positions.py`.

| Arm | QB | RB | WR | TE | K | DEF | K+TE+DEF |
|---|---|---|---|---|---|---|---|
| Engine (Stage C on) | 21.461 | 76.112 | 42.393 | 21.535 | 8.944 | 6.863 | 37.342 |
| C1 — Stage C lookahead sort (informational, non-gating) | 21.031 | 75.526 | 44.310 | 21.535 | 8.965 | 6.887 | 37.388 |
| B4 — MRV + tiers, no simulation | 21.461 | 76.112 | 42.393 | 21.535 | 8.944 | 6.863 | 37.342 |
| B3 — static VOR (gate baseline) | 11.791 | 73.081 | 53.675 | 10.365 | 9.844 | 6.824 | 27.032 |
| B2 — raw projected points | 23.124 | 70.420 | 57.919 | 10.457 | 9.043 | 6.890 | 26.390 |
| B1 — FFC ADP | 23.028 | 69.859 | 55.382 | 10.365 | 6.372 | 4.064 | 20.801 |

Mean round of the subject's first pick at each position (lower = earlier; 0 = never drafted):

| Arm | QB | RB | WR | TE | K | DEF |
|---|---|---|---|---|---|---|
| Engine (Stage C on) | 7.00 | 2.00 | 1.00 | 6.00 | 16.00 | 15.00 |
| C1 — Stage C lookahead sort (informational, non-gating) | 7.00 | 2.00 | 1.00 | 6.00 | 16.00 | 15.00 |
| B4 — MRV + tiers, no simulation | 7.00 | 2.00 | 1.00 | 6.00 | 16.00 | 15.00 |
| B3 — static VOR (gate baseline) | 6.00 | 1.01 | 2.00 | 8.99 | 8.00 | 7.01 |
| B2 — raw projected points | 1.00 | 4.00 | 3.00 | 14.00 | 15.00 | 16.00 |
| B1 — FFC ADP | 12.00 | 2.00 | 1.00 | 13.98 | 16.00 | 15.00 |

## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)

- C1 sorts by Stage C's simulated `lookaheadValue` instead of the production `planValue`; same Stage C simulation as `engine`, common-random-numbers-paired rollouts (`backtest.ts`'s `simulateDraft` shares `engine`'s `draftId` for `c1`). Not a gate — see `DECISIONS.md`'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.
- n = 240 paired drafts. C1 mean 178.255 vs engine mean 177.308.
- Mean paired difference (c1 - engine): 0.947 pts/week, SE 0.318.
- Paired-difference 95% CI: [0.324, 1.570].

## Gate verdicts

- **Pilot (non-gating)**: verdicts not applied — Directional pilot run (non-gating). All metrics and the paired CI are reported; gate verdicts are applied only in the gating run (BACKTEST_GATING=1, N >= 1000).

## Notes

- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` (documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, but it is load-bearing as the field policy.
- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all (draft, week) cells, weeks 1-17.
- FFC's board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage and rely on the opponent model's documented synthetic-ADP fallback.
- Determinism: rerunning with the same seed set reproduces the same 240-draft grid; only `metadata.generatedAt`/`gitCommit` differ between runs.
