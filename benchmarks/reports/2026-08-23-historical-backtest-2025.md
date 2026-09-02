# 2025 Historical Backtest report — 2026-08-23

## Metadata

- Generated at: 2026-08-23T03:19:48.524Z
- Git commit: ec6927136040763839ca7d4831ae84582845c90f
- **Gating run** — seeds per slot: 84, drafts per arm: 1008, seed base: `20250825`
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
| Engine (Stage C on) | 1008 | 129.390 | 98.300 | 1104.7 | 0.627 | 0.702 | 0.926 |
| C1 — Stage C lookahead sort (informational, non-gating) | 1008 | 130.158 | 100.620 | 1117.8 | 0.746 | 0.727 | 0.967 |
| B4 — MRV + tiers, no simulation | 1008 | 129.390 | 98.300 | 1104.7 | 0.627 | 0.702 | 0.926 |
| B3 — static VOR (gate baseline) | 1008 | 112.719 | 83.200 | 821.3 | 0.298 | 0.539 | 0.616 |
| B2 — raw projected points | 1008 | 124.125 | 91.000 | 1015.2 | 0.586 | 0.666 | 0.914 |
| B1 — FFC ADP | 1008 | 130.220 | 98.980 | 1118.8 | 0.498 | 0.691 | 0.900 |

## Paired engine vs baseline-3 (static VOR)

- n = 1008 paired drafts. Engine mean 129.390 vs baseline-3 mean 112.719.
- Mean paired difference (engine - b3): 16.671 pts/week, SE 0.264.
- Paired-difference 95% CI: [16.155, 17.187].

## C1 vs engine (informational, non-gating — sim-sort disagreement probe follow-up)

- C1 sorts by Stage C's simulated `lookaheadValue` instead of the production `planValue`; same Stage C simulation as `engine`, common-random-numbers-paired rollouts (`backtest.ts`'s `simulateDraft` shares `engine`'s `draftId` for `c1`). Not a gate — see `DECISIONS.md`'s 2026-08-22 "Sim-sort disagreement probe" entry for why this arm exists.
- n = 1008 paired drafts. C1 mean 130.158 vs engine mean 129.390.
- Mean paired difference (c1 - engine): 0.768 pts/week, SE 0.274.
- Paired-difference 95% CI: [0.231, 1.305].

## Gate verdicts

- **primary-point-floor**: PASS — engine mean 129.390 >= baseline-3 mean 112.719 - 0.25
- **primary-ci**: PASS — paired-diff 95% CI lower 16.155 > -0.25 (mean diff 16.671, SE 0.264, n=1008)
- **downside**: PASS — engine 10th-percentile weekly total 98.300 >= baseline-3 83.200 - 0.5

## Notes

- The 11 non-subject seats always draft via `opponentModel.ts` with `defaultOpponentModelConfig` (documented uncalibrated pending S6) — identical across arms, so it cannot bias the paired comparison, but it is load-bearing as the field policy.
- Week 18 is excluded (starter-rest risk); the downside 10th-percentile is pooled over all (draft, week) cells, weeks 1-17.
- FFC's board is 15 rounds/180 picks; picks 181-192 in the 16-round config have no ADP coverage and rely on the opponent model's documented synthetic-ADP fallback.
- Determinism: rerunning with the same seed set reproduces the same 1008-draft grid; only `metadata.generatedAt`/`gitCommit` differ between runs.
