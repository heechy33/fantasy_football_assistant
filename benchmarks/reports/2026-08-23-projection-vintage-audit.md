# Projection source vintage audit — 2026-08-23

**Question:** can Sleeper/ESPN/CBS 2025 projections be recovered **verifiably frozen before the
2025-09-04 kickoff**, so Phase C's step-1 offline screen (blend vs FFToday-only MAE/rank against
2025 actuals in `data/weekly-stats.json`) is a clean test?

**Pre-declared rule (fixed before any probe was fired):** a provider **PASSES** only if (a) 2025
projection rows are retrievable today, AND (b) their as-of vintage is verifiable ≤ 2025-09-04 from
source-carried provenance or an independent archive capture in the 2025-06-01 → 2025-09-04 window.
Otherwise **FAIL**. Contamination diagnostics (correlation with realized actuals, embedded roster
fields) inform interpretation but do not override the provenance requirement. Machine-readable twin:
`2026-08-23-projection-vintage-audit.json`.

---

## Verdicts

| Provider | Retrievable? | Vintage-verifiable? | Verdict |
|---|---|---|---|
| Sleeper | Yes — HTTP 200, 3,304 rows / 637 with `pts_ppr` | **No** — every row bulk re-synced `last_modified` = **2026-01-04T09:21Z** (~20 s spread, one batch) | FAIL (unverifiable) |
| ESPN | Yes — 1,090 players, 1,052 season-projection entries | **No** — payload carries no as-of field of any kind | FAIL (unverifiable) |
| CBS | No — `/stats/{POS}/2025/restofseason/...` returns 200 but renders **zero table rows** | — | FAIL (not retrievable) |
| Wayback | CDX for CBS 2025 URLs, Jun–Sep 2025: **0 captures** | — | no archival recovery path |

**Overall: CUT.** The retrospective 2025 offline blend-vs-FFToday screen is infeasible as a clean
test. Pivot to the prospective 2026 design on the already-frozen `data/projections-providers.json`
snapshot (`fetchedAt` 2026-08-22, before the 2026 first game) — that snapshot has exactly the clean
provenance this audit demands.

## Evidence detail

**Sleeper** (`https://api.sleeper.app/projections/nfl/2025`, production param shape from
`pipeline/sources.py::fetch_sleeper_adp`): rows self-carry `season: 2025` and **2025-vintage rosters**
— Kyler Murray (5849) has `team: ARI` in the row while today's live player map says MIN; Jacoby
Brissett (3257) `team: ARI`; rows project `gp=18`. Accuracy vs realized 2025 PPR actuals:
n = 567 overlap, **r = 0.786**, median |Δ| = 28.3 pts — typical *preseason*-projection accuracy
(final revisions would show r > 0.9 with tiny diffs). So content is plausibly preseason-genuine,
but the only provenance is the post-season bulk timestamp, which cannot distinguish frozen-August
values from mid-season-revised values. Under the pre-declared rule: FAIL.

**ESPN** (`leaguedefaults/seasons/2025`, production `x-fantasy-filter`): entries selected per
`espn_projections.py`'s contract (`seasonId=2025 && statSourceId=1 && statSplitTypeId=0 &&
scoringPeriodId=0`). Accuracy vs half-PPR actuals (n = 478 crosswalked via `players.json`
`ids.espn`): **r = 0.794**, median |Δ| = 22.4 — projection-grade content, **not final revisions**
(an initial single-player reading — Gibbs 317.28 vs 366.9 — looked like a half-PPR tell but is
ordinary projection error). Zero timestamps anywhere in the payload → unverifiable → FAIL.

**CBS:** dead for 2025; by URL construction any historical rendering would be mid/post-season
"restofseason" values anyway, never preseason.

## Exploratory carve-out (explicitly non-gating)

Because both retrievable sources carry projection-grade content with 2025-shaped values, an
**unverified advisory screen** (Sleeper+ESPN 2025 vs 2025 actuals; labeled exploratory-only; never
gating; never citable alone) is permissible if wanted. Any build decision still requires the
prospective 2026 ladder (rank-utility screen → disagreement probe → CRN-paired pilot → gated run)
on the frozen 2026 snapshots.

## Observations recorded as observations, not evidence

- Sleeper-2025 r = 0.786 vs FFToday-fixture r = 0.732 against the same actuals is tantalizing for
  the blend hypothesis but is **not comparable evidence**: different pools (567 vs 380), and the
  FFToday control used an approximate stat-weight subset rather than `BACKTEST_SCORING`.
- Honesty note: an initial throwaway correlation computed r = 0.0014 due to a scripting bug in the
  probe one-liner; recomputation cross-checked against the FFToday control produced the figures
  above.

## Limitations

Single audit day; endpoints may change. Only Wayback queried among archives. Sleeper value-vintage
is ambiguous by construction and stays that way.
