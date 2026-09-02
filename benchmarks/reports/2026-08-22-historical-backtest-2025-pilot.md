# 2025 Historical Backtest report — 2026-08-22

## Metadata

- Generated at: 2026-08-22T23:02:43.059Z
- Git commit: ec6927136040763839ca7d4831ae84582845c90f
- Pilot run (directional, non-gating) — seeds per slot: 1, drafts per arm: 12, seed base: `20250825`
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
| Engine (Stage C on) | 12 | 127.763 | 99.400 | 1077.1 | 0.632 | 0.684 | 0.835 |
| C1 — Stage C lookahead sort (informational, non-gating) | 12 | 131.249 | 105.700 | 1136.3 | 0.750 | 0.722 | 0.980 |
| B4 — MRV + tiers, no simulation | 12 | 127.763 | 99.400 | 1077.1 | 0.632 | 0.684 | 0.835 |
| B3 — static VOR (gate baseline) | 12 | 112.872 | 83.300 | 823.9 | 0.304 | 0.537 | 0.607 |
| B2 — raw projected points | 12 | 122.855 | 87.800 | 993.6 | 0.623 | 0.658 | 0.920 |
| B1 — FFC ADP | 12 | 130.267 | 101.960 | 1119.6 | 0.358 | 0.704 | 0.939 |

## Paired engine vs baseline-3 (static VOR)

- n = 12 paired drafts. Engine mean 127.763 vs baseline-3 mean 112.872.
- Mean paired difference (engine - b3): 14.891 pts/week, SE 2.992.
- Paired-difference 95% CI: [9.027, 20.756].

## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)

- C1 sorts by Stage C's simulated `lookaheadValue` instead of the production `planValue`; same Stage C simulation as `engine`, common-random-numbers-paired rollouts (`backtest.ts`'s `simulateDraft` shares `engine`'s `draftId` for `c1`). Not a gate — see `DECISIONS.md`'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.
- n = 12 paired drafts. C1 mean 131.249 vs engine mean 127.763.
- Mean paired difference (c1 - engine): 3.486 pts/week, SE 3.099.
- Paired-difference 95% CI: [-2.587, 9.559].

## Gate verdicts

- **Pilot (non-gating)**: verdicts not applied — Directional pilot run (non-gating). All metrics and the paired CI are reported; gate verdicts are applied only in the gating run (BACKTEST_GATING=1, N >= 1000).

## Notes

- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` (documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, but it is load-bearing as the field policy.
- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all (draft, week) cells, weeks 1-17.
- FFC's board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage and rely on the opponent model's documented synthetic-ADP fallback.
- Determinism: rerunning with the same seed set reproduces the same 12-draft grid; only `metadata.generatedAt`/`gitCommit` differ between runs.
