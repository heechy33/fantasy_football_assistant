# Draft Score residual tie-break — A/B comparison

Hand-authored addendum to `2026-08-10-availability-calibration.md` (that file is regenerated
verbatim by `benchmarkAvailability.bench.ts` each run — this file is not, and documents the specific
comparison PLAN.md's Draft Score decision record and step 9 of
`DRAFT_SCORE_WAR_ROOM_REVISED_PLAN.md` call for). Same 9 recorded drafts, same committed
`data/manifest.json` snapshot (`builtAt: 2026-08-10T02:27:22.885650+00:00`), same git working tree —
the only variable is whether `recommend.ts`'s within-band comparator includes the `draftScore`
residual breaker.

## Method

1. Ran `npm run benchmark:availability` against the shipped comparator (survival → ADP → draftScore
   → planValue → id) — **policy (b)**.
2. Temporarily disabled the `draftScore` comparator line in `compareWithinBand`
   (`frontend/src/engine/recommend.ts`), falling back to the pre-step-5 comparator (survival → ADP →
   planValue → id) — **policy (a)**.
3. Re-ran the identical harness against the same fixtures/data.
4. Restored the shipped comparator immediately (confirmed via `grep` that no trace of the disabled
   line remained) and re-ran the full test suite + typecheck to confirm the working tree matched the
   pre-experiment state before continuing other work.
5. Diffed both runs' `.md` and `.json` reports.

## Result

**The two reports are byte-identical except for the `generatedAt`/`Generated at` timestamp fields.**
Every Section A (availability calibration) and Section B (VONA MAE/rank-agreement) number matches
exactly, as expected — neither of those computations reads `draftScore`. More significantly, **Section
C's regret and top-choice-agreement numbers are also identical**:

| Cohort | n | Plan regret | Top-choice agreement |
|---|---:|---:|---:|
| All | 126 | 1.75 | 54.8% |
| One core hole | 12 | 1.28 | 66.7% |
| Zero core holes | 47 | 0.37 | 63.8% |

Full per-decision-point candidate data in the JSON sibling is also identical between the two runs —
not merely the summary tables.

## Interpretation

The residual tie-break's trigger condition is narrow by design (amendment A3, PLAN.md's decision
record): it only decides ordering among rows that are *already* tied on the near-tie band's value
threshold **and** tied on next-pick survival **and** tied on consensus ADP. On these 9 real recorded
drafts (126 scored decision points), no such three-way tie ever included the board's actual top
choice — so `engineTop` (the row Section C scores) never moved. This is the expected outcome of a
policy explicitly scoped as "does not become the primary sort" (see the decision record): on this
sample, it is currently a no-op for the metric an oracle-regret harness can observe, not a change
that improved or worsened it.

This does **not** mean the tie-break has no effect at all — `nearTie`-flagged bands *do* form on real
boards (see the pre-existing `recommendExpansion.test.ts` and `recommendDraftScoreTieBreak.test.ts`
unit coverage for constructed cases where it demonstrably reorders rows). It means that within this
specific 9-draft, 126-decision-point sample, no such band happened to contain the eventual #1 choice
with survival and ADP also tied. A larger or differently-shaped sample could observe a nonzero delta;
this harness does not currently have that shape of case in its recorded fixtures.

## Promotion-gate status

Per PLAN.md's decision record and this plan's "Promotion gate" section: the residual-breaker policy
(b) is what ships. Full-Draft-Score-as-primary-sort (policy c) remains **not implemented** and is
correctly out of scope — nothing in this comparison changes that gate. Sections A and B reproduced
exactly, confirming the tie-break introduced no hidden availability/VONA regression; Section C showed
no measurable regret delta on the current recorded sample, so there is no evidence yet either
supporting or rejecting a future promotion to policy (c) — that decision still requires its own
dedicated benchmark pass once/if it's proposed.
