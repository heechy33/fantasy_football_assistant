# 2025 Historical Backtest report — 2026-08-24

## Metadata

- Generated at: 2026-08-24T06:59:42.493Z
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
| Engine (Stage C on) | 240 | 146.535 | 115.700 | 1396.2 | 0.700 | 0.934 | 1.000 |
| C1 — Stage C lookahead sort (informational, non-gating) | 240 | 145.567 | 115.220 | 1379.7 | 0.718 | 0.929 | 1.000 |
| B4 — MRV + tiers, no simulation | 240 | 146.535 | 115.700 | 1396.2 | 0.700 | 0.934 | 1.000 |
| B3 — static VOR (gate baseline) | 240 | 143.808 | 112.900 | 1349.8 | 0.555 | 0.915 | 1.000 |
| B2 — raw projected points | 240 | 139.970 | 106.820 | 1284.6 | 0.706 | 0.893 | 1.000 |
| B1 — FFC ADP | 240 | 139.973 | 107.380 | 1284.6 | 0.446 | 0.901 | 0.999 |

## Paired engine vs baseline-3 (static VOR)

- n = 240 paired drafts. Engine mean 146.535 vs baseline-3 mean 143.808.
- Mean paired difference (engine - b3): 2.727 pts/week, SE 0.689.
- Paired-difference 95% CI: [1.377, 4.078].

## Subject starter points by position (diagnostics-only — 2026-08-24 c1-attribution pre-declaration)

Mean weekly optimized-starter points attributed to each starter's own position (weeks 1-17; FLEX points land in the occupant's position, so the six columns sum to the arm's mean weekly total). K/TE/DEF are the cap-1 slots ({"TE":1,"K":1,"DEF":1}). Paired per-position CIs and the pre-declared flip test are computed offline by `pipeline/analyze_c1_positions.py`.

| Arm | QB | RB | WR | TE | K | DEF | K+TE+DEF |
|---|---|---|---|---|---|---|---|
| Engine (Stage C on) | 17.252 | 56.373 | 40.996 | 16.269 | 8.737 | 6.907 | 31.913 |
| C1 — Stage C lookahead sort (informational, non-gating) | 17.764 | 58.119 | 36.864 | 17.153 | 8.787 | 6.879 | 32.819 |
| B4 — MRV + tiers, no simulation | 17.252 | 56.373 | 40.996 | 16.269 | 8.737 | 6.907 | 31.913 |
| B3 — static VOR (gate baseline) | 16.141 | 59.050 | 39.209 | 13.129 | 9.444 | 6.835 | 29.408 |
| B2 — raw projected points | 23.205 | 47.685 | 42.004 | 11.449 | 8.736 | 6.892 | 27.077 |
| B1 — FFC ADP | 20.264 | 49.301 | 48.148 | 10.881 | 5.921 | 5.457 | 22.259 |

Mean round of the subject's first pick at each position (lower = earlier; 0 = never drafted):

| Arm | QB | RB | WR | TE | K | DEF |
|---|---|---|---|---|---|---|
| Engine (Stage C on) | 6.89 | 1.47 | 2.43 | 6.15 | 16.00 | 15.00 |
| C1 — Stage C lookahead sort (informational, non-gating) | 5.42 | 1.46 | 3.07 | 6.20 | 16.00 | 15.00 |
| B4 — MRV + tiers, no simulation | 6.89 | 1.47 | 2.43 | 6.15 | 16.00 | 15.00 |
| B3 — static VOR (gate baseline) | 6.15 | 1.08 | 3.73 | 7.15 | 8.88 | 7.83 |
| B2 — raw projected points | 1.00 | 3.05 | 5.22 | 10.13 | 15.00 | 16.00 |
| B1 — FFC ADP | 8.88 | 2.40 | 1.51 | 9.84 | 16.00 | 15.00 |

## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)

- C1 sorts by Stage C's simulated `lookaheadValue` instead of the production `planValue`; same Stage C simulation as `engine`, common-random-numbers-paired rollouts (`backtest.ts`'s `simulateDraft` shares `engine`'s `draftId` for `c1`). Not a gate — see `DECISIONS.md`'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.
- n = 240 paired drafts. C1 mean 145.567 vs engine mean 146.535.
- Mean paired difference (c1 - engine): -0.968 pts/week, SE 0.666.
- Paired-difference 95% CI: [-2.273, 0.337].

## Gate verdicts

- **Pilot (non-gating)**: verdicts not applied — Directional pilot run (non-gating). All metrics and the paired CI are reported; gate verdicts are applied only in the gating run (BACKTEST_GATING=1, N >= 1000).

## Notes

- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` (documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, but it is load-bearing as the field policy.
- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all (draft, week) cells, weeks 1-17.
- FFC's board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage and rely on the opponent model's documented synthetic-ADP fallback.
- Determinism: rerunning with the same seed set reproduces the same 240-draft grid; only `metadata.generatedAt`/`gitCommit` differ between runs.
