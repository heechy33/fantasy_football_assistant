# 2025 Historical Backtest report — 2026-08-24

## Metadata

- Generated at: 2026-08-24T02:32:54.508Z
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
| Engine (Stage C on) | 240 | 130.564 | 97.660 | 1149.0 | 0.666 | 0.711 | 0.920 |
| C1 — Stage C lookahead sort (informational, non-gating) | 240 | 135.988 | 107.100 | 1241.2 | 0.791 | 0.766 | 0.978 |
| B4 — MRV + tiers, no simulation | 240 | 130.564 | 97.660 | 1149.0 | 0.666 | 0.711 | 0.920 |
| B3 — static VOR (gate baseline) | 240 | 116.253 | 84.300 | 905.7 | 0.325 | 0.569 | 0.694 |
| B2 — raw projected points | 240 | 126.951 | 93.520 | 1087.6 | 0.633 | 0.693 | 0.932 |
| B1 — FFC ADP | 240 | 130.511 | 99.240 | 1148.1 | 0.512 | 0.699 | 0.914 |

## Paired engine vs baseline-3 (static VOR)

- n = 240 paired drafts. Engine mean 130.564 vs baseline-3 mean 116.253.
- Mean paired difference (engine - b3): 14.310 pts/week, SE 0.658.
- Paired-difference 95% CI: [13.020, 15.600].

## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)

- C1 sorts by Stage C's simulated `lookaheadValue` instead of the production `planValue`; same Stage C simulation as `engine`, common-random-numbers-paired rollouts (`backtest.ts`'s `simulateDraft` shares `engine`'s `draftId` for `c1`). Not a gate — see `DECISIONS.md`'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.
- n = 240 paired drafts. C1 mean 135.988 vs engine mean 130.564.
- Mean paired difference (c1 - engine): 5.424 pts/week, SE 0.699.
- Paired-difference 95% CI: [4.053, 6.795].

## Gate verdicts

- **Pilot (non-gating)**: verdicts not applied — Directional pilot run (non-gating). All metrics and the paired CI are reported; gate verdicts are applied only in the gating run (BACKTEST_GATING=1, N >= 1000).

## Notes

- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` (documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, but it is load-bearing as the field policy.
- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all (draft, week) cells, weeks 1-17.
- FFC's board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage and rely on the opponent model's documented synthetic-ADP fallback.
- Determinism: rerunning with the same seed set reproduces the same 240-draft grid; only `metadata.generatedAt`/`gitCommit` differ between runs.
