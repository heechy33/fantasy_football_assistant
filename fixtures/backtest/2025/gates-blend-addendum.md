# Blend-vs-FFToday Backtest Ladder — Pre-declared Gates Addendum (2026-08-23)

Addendum to `gates.md` (which stays authoritative for the engine-vs-baseline gates and league
config). Pre-declared **before** any pavg construction, screen, probe, or run. Supersedes the
"exploratory carve-out / default is skip" language in `DECISIONS.md`'s 2026-08-23 step-0 entry
(a new dated entry there records this). Companion freeze:
`fixtures/projection-freeze/2025-retrievable/` (built by `pipeline/freeze_2025_retrievable.py`,
SHA-256 pinned; never re-fetch silently).

**Standing caveat, attached to every result below this line:** both non-FFToday projection sources
FAILED the 2026-08-23 vintage audit. The frozen bytes are post-resync state; they cannot be sworn
to be August-2025 values. Every number produced under this addendum is **2025-conditional**
(one season, one outcome draw, this opponent model, this FFC ADP field) — CIs quantify
draft-level variance only, never across-season variance.

---

## 0. Asymmetric decision logic (pre-declared, from the vintage asymmetry)

If Sleeper/ESPN values were partially revised toward actuals mid-season, the blend arm receives an
unfair advantage. Therefore:

- **Blend loses → conclusive permanent cut.** Even possibly-contaminated data lost; clean
  preseason-grade data loses worse.
- **Blend wins → provisional only.** A win cannot by itself promote blending to production;
  it authorizes provisional status with mandatory in-season 2026 confirmation (section 7).
- The content evidence (r ≈ 0.79 = ordinary preseason accuracy, embedded 2025 rosters,
  injury-shaped busts) makes *wholesale* revision implausible but partial revision unfalsifiable.

## 1. Step A — source freeze (done first)

Fetch Sleeper-2025 + ESPN-2025 once via production request shapes
(`pipeline/sources.py::fetch_sleeper_adp`, `pipeline/espn_projections.py::fetch_espn_projections`),
save verbatim to `fixtures/projection-freeze/2025-retrievable/` with SHA-256 pins, request recipes,
and vintage caveats in `provenance.json`. Never re-fetch silently (`--force` = deliberate new
vintage, requires a new dated DECISIONS entry).

## 2. Step A2 — outcome-coverage extension (hard blocker for everything below)

`data/weekly-stats.json` covers 649 players; the candidate pool (Sleeper ∪ ESPN projections) is
wider. `gates.md`'s "scored 0 all season" rule was verified only for 9 known-absent players in the
422-player FFToday∪FFC pool; applied to a wider pool it becomes systematic anti-blend bias.
Therefore: fetch raw Sleeper weekly stats weeks 1–18/2025 for the full pool (same freeze script),
build an extended outcomes artifact covering every candidate-pool player who has any weekly row,
re-run the zero-outcome verification pass on the widened set (fail loudly on unverified zeros),
pin SHA-256. "Scored 0" may again state reality, not artifact coverage.

## 3. Step B — `pavg` construction (all choices fixed here, before building)

- Sources: FFToday backtest fixture (`fixtures/backtest/2025/projections.json`) + Sleeper + ESPN
  (from section 1's freeze). CBS is dead for 2025 (audit).
- **Conversion: re-score RAW stat columns through `BACKTEST_SCORING` only. Never use provider-
  precomputed points** — Sleeper rows' `pts_ppr` embeds Sleeper's own map incl. `bonus_rec_te`
  (banned by `gates.md`); ESPN default scoring is half-PPR.
- Identity: Sleeper ids are native. ESPN ids crosswalk through `data/players.json`'s `ids.espn`;
  pre-declared match-rate gate ≥ 97% of ESPN season-projection entries, else fail loudly with
  unmatched names recorded (mirrors the snapshot identity gate).
- Blend (amended 2026-08-23 before any pavg bytes existed; original point-level wording replaced
  because the engine consumes a stats map): **key-level equal-weight mean** — `pavg.stats[key]` =
  mean of that key's value over the sources covering the player AND providing that key; scored once
  via `BACKTEST_SCORING`. Key-coverage asymmetry between sources can make this diverge from a
  point-level blend of per-source totals; the offline screen therefore computes BOTH variants and
  reports their rank agreement, so the divergence is measured, not assumed.
- Fallback hierarchy: a player covered by exactly one source takes that source's value; a player
  covered by none is absent from the pavg board (never zero-filled).
- Individual sources are also scored standalone, so the average can be judged against its own
  components at every later rung.

## 4. Step C — offline rank-utility screen (exploratory label)

Candidates `{fftoday, sleeper, espn, pavg}` vs 2025 actuals on the draft-relevant pool: Spearman
and top-N (top-24/top-48 per position) hit rates, bootstrap CIs (1000 resamples, seed 20250823,
matching `pipeline/measure_sos.py` conventions). Labeled exploratory-only; informs, never gates;
not citable alone (vintage asymmetry applies most strongly here since rank metrics touch actuals
directly).

## 5. Step D — disagreement probe (authorizes building the arms)

Board-level top-1 pick disagreement between the pavg board and the FFToday board across draft
slots/rounds, bucketed like `simSortProbe.ts` (`SIM_SORT_BUILD_ARM_THRESHOLDS`: overall ≥ 0.05 OR
any round band ≥ 0.1 → build). **Pre-declared early exit:** if overall < 0.02 AND every round band
< 0.05, stop the ladder — outcome recorded as "no material difference detected; keep FFToday."
A pass below build-threshold-but-above-exit-threshold proceeds with the explicit note that a null
pilot result is then expected and uninformative.

## 6. Step E/F — pilot and gated run (architecture fixed here)

**Architecture (corrects the earlier "additive arm" framing):** a projection swap changes
`buildBacktestContext`'s `scores`, replacement levels, and opponent-pool membership — it cannot be
an in-run additive arm like `c1`. Therefore: **separate CRN-paired runs.** The pavg arms run in a
dedicated run with a pavg context; pairing across runs is valid because `draftSeedFor(slot,
seedIndex)` is input-independent. Integrity gate: before any comparison, re-running the committed
FFToday config must reproduce the committed reports byte-for-byte.

- **Pilot:** arms `{b2, engine}` × contexts `{fftoday, pavg}`; 12 slots × 12 seeds = 144 paired
  drafts per comparison, seed base `20250825`. Gate: harness integrity + direction only.
- **Pool policy (pre-declared):** primary comparison on the **union** pool (matches reality:
  real blending widens coverage; requires section 2 first). Mandatory diagnostic: same rung on the
  **intersection** pool (identical universes) to attribute any effect to ranking quality vs
  coverage. If union wins but intersection does not, record "coverage-driven, not quality-driven".
- **Gated run:** N = 1008 paired drafts per arm-comparison (84 seeds × 12 slots), paired against
  the committed 2026-08-23 run.

**Decision rule (vs `engine`/FFToday context, pre-declared):**

| Outcome | Rule | Action |
|---|---|---|
| Loss | CI upper bound < +0.25 pts/wk | Cut blending permanently |
| Win | CI lower > +0.25 AND 10th-pct pooled weekly ≥ engine's − 0.5 | Provisional promotion for 2026 drafts + mandatory in-season confirmation |
| Ambiguous | neither | Keep FFToday; burden stays on the blend |

A win's provisional status converts to production only after the prospective 2026 ladder
(`DECISIONS.md` step-0 pivot) confirms direction in-season. Composite ADP remains on its own
availability-calibration track, untouched by all of this.

## 7. What this ladder can and cannot claim

Can: a pre-declared, paired, non-circular estimate of whether blending would have helped in 2025
under known conditions. Cannot: establish cross-season superiority — that is what the mandatory
in-season confirmation is for.
