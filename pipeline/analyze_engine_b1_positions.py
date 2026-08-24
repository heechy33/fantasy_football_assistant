"""Engine-vs-B1 positional attribution analysis (DECISIONS.md 2026-08-24 open item).

Question (open since the N=1008 gating record): the production engine sorts significantly
WORSE than plain best-available-by-FFC-ADP (-0.830 pts/wk, 95% CI [-1.539, -0.121]) on the
2025 grid. Localize the deficit by position bucket and draft slot, offline — NO new run.

Input: the already-committed instrumented diagnostics report
(`2026-08-24-historical-backtest-2025-pilot-c1-diagnostics.json`, 240 CRN-paired drafts,
FFToday context), whose `starterPointsByPosition` / `firstPickRoundByPosition` arrays cover
ALL six arms including b1. Draft indices are slot-major (12 slots x 20 seeds) and shared
across arms, so every comparison below is paired at the draft level.

INTERPRETATION RULES — fixed BEFORE this analysis was run (recorded in DECISIONS.md):
1. SHIPPABILITY-SYMMETRY RULE: if the engine-B1 deficit is significant only inside K+TE+DEF
   while the skill-only (QB+RB+WR) bucket is NOT significantly negative, the deficit gets
   the same no-waiver/streaming discount that ruled C1's edge non-promotable => documented
   reason it does not matter; closed for 2025 data.
2. SKILL-DEFICIT RULE: if skill-only IS significantly negative => a real sorting deficit
   exists; localize via the position x slot cross-tab and name a mechanism (timing read)
   before proposing any fix.
3. TIMING READ: first-pick round per position, engine vs B1 (mechanism evidence).
4. INTEGRITY SELF-CHECKS (must pass before any conclusion): (a) paired engine-c1 meanDiff
   reproduces the committed +1.012 exactly; (b) paired engine-B1 overall equals the
   arm-summary means delta; (c) per-draft six-bucket starter-point sums reconcile with
   `perDraftMeanWeekly` within float tolerance.
5. The position x slot table is EXPLORATORY (reported, no gate attached).

Caveats disclosed up front: pilot-size N=240 (the N=1008 gating artifact predates per-draft
arrays); FFToday context; 2025-conditional (one season, one outcome draw).

Usage: python pipeline/analyze_engine_b1_positions.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REPORTS = REPO / "benchmarks" / "reports"
DIAG_PATH = REPORTS / "2026-08-24-historical-backtest-2025-pilot-c1-diagnostics.json"
OUT_PATH = REPORTS / "2026-08-24-engine-b1-attribution-analysis.json"
POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")
CAP1 = ("TE", "K", "DEF")
SKILL = ("QB", "RB", "WR")
TEAMS = 12
# Committed reference value the pairing logic must reproduce (integrity anchor).
COMMITTED_ENGINE_MINUS_C1_MEAN = 1.012


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def t_ci95(values: list[float]) -> tuple[float, float]:
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    se = math.sqrt(var / n)
    t = {30: 2.042, 60: 2.000, 120: 1.980}.get(n - 1, 1.97)
    return mean - t * se, mean + t * se


def paired(diffs: list[float]) -> dict:
    lo, hi = t_ci95(diffs)
    return {"n": len(diffs), "meanDiff": sum(diffs) / len(diffs),
            "ciLower": lo, "ciUpper": hi,
            "significantAt95": lo > 0 or hi < 0}


def main() -> int:
    if not DIAG_PATH.exists():
        print(f"[abort] missing {DIAG_PATH.name}")
        return 2
    diag = load(DIAG_PATH)

    out: dict = {
        "report": "engine-b1-attribution-analysis",
        "source": DIAG_PATH.name,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "rules": ("pre-declared in pipeline/analyze_engine_b1_positions.py docstring and "
                  "DECISIONS.md before analysis ran"),
        "integrity": {},
        "pairedEngineMinusB1ByPosition": {},
        "verdict": None,
        "timing": {},
        "slotStratificationExploratory": {},
    }

    pdmw = diag["perDraftMeanWeekly"]
    spbp = diag["starterPointsByPosition"]
    fprp = diag["firstPickRoundByPosition"]
    n_drafts = len(pdmw["engine"])
    assert n_drafts == 240 and all(len(pdmw[a]) == n_drafts for a in pdmw), \
        "expected the committed 240-draft diagnostics grid"

    # ---- Rule 4: integrity self-checks ----
    # (a) pairing logic anchor: c1-engine must reproduce the committed +1.012
    # (NOTE: the committed +1.012 is c1 MINUS engine — the 2026-08-24 C1 entry's disclosure
    # records this exact label flip as the mistake to avoid.)
    c1_minus_engine = [c - e for e, c in zip(pdmw["engine"], pdmw["c1"])]
    anchor = sum(c1_minus_engine) / n_drafts
    ok_a = abs(anchor - COMMITTED_ENGINE_MINUS_C1_MEAN) < 5e-4
    # (b) engine-b1 overall vs arm-summary means delta
    eng_minus_b1 = [e - b for e, b in zip(pdmw["engine"], pdmw["b1"])]
    summary_delta = (diag["arms"]["engine"]["meanWeeklyPoints"]
                     - diag["arms"]["b1"]["meanWeeklyPoints"])
    ok_b = abs(sum(eng_minus_b1) / n_drafts - summary_delta) < 1e-9
    # (c) six-bucket reconciliation vs perDraftMeanWeekly
    max_gap = 0.0
    for arm in ("engine", "b1"):
        for i in range(n_drafts):
            bucket_sum = sum(spbp[arm][pos][i] for pos in POSITIONS)
            max_gap = max(max_gap, abs(bucket_sum - pdmw[arm][i]))
    ok_c = max_gap < 1e-6

    out["integrity"] = {
        "engineMinusC1ReproducesCommitted": {
            "computed": anchor, "expected": COMMITTED_ENGINE_MINUS_C1_MEAN, "ok": bool(ok_a)},
        "engineMinusB1MatchesSummaryDelta": {
            "computed": sum(eng_minus_b1) / n_drafts, "expected": summary_delta,
            "ok": bool(ok_b)},
        "bucketSumReconciliationMaxAbsGap": max_gap,
        "bucketsMatchPerDraftMeanWeekly": bool(ok_c),
    }
    print(f"[integrity] engine-c1 anchor {anchor:+.6f} vs committed "
          f"{COMMITTED_ENGINE_MINUS_C1_MEAN:+.3f}: {'OK' if ok_a else 'FAIL'}")
    print(f"[integrity] engine-b1 {sum(eng_minus_b1)/n_drafts:+.6f} vs summary delta "
          f"{summary_delta:+.6f}: {'OK' if ok_b else 'FAIL'}")
    print(f"[integrity] bucket-sum reconciliation max gap {max_gap:.2e}: "
          f"{'OK' if ok_c else 'FAIL'}")
    if not (ok_a and ok_b and ok_c):
        print("[abort] integrity self-check failed — no conclusions drawn")
        out["integrity"]["allPassed"] = False
        OUT_PATH.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
        return 1
    out["integrity"]["allPassed"] = True

    # ---- Paired engine-B1 by position bucket ----
    def bucket_diffs(buckets: tuple[str, ...], lo: int = 0, hi: int | None = None) -> list[float]:
        end = n_drafts if hi is None else hi
        return [sum(spbp["engine"][pos][i] - spbp["b1"][pos][i] for pos in buckets)
                for i in range(lo, end)]

    def fmt(stats: dict) -> str:
        star = "*" if stats["significantAt95"] else " "
        return (f"{stats['meanDiff']:+7.3f} [{stats['ciLower']:+7.3f}, "
                f"{stats['ciUpper']:+7.3f}] {star}(n={stats['n']})")

    print("\n[engine-B1 paired by position bucket, pts/wk]")
    for pos in POSITIONS:
        stats = paired([e - b for e, b in zip(spbp["engine"][pos], spbp["b1"][pos])])
        out["pairedEngineMinusB1ByPosition"][pos] = stats
        print(f"  {pos:>3}: {fmt(stats)}")
    for label, buckets in (("skill-only(QB+RB+WR)", SKILL), ("K+TE+DEF", CAP1),
                           ("all(inclusive)", POSITIONS)):
        stats = paired(bucket_diffs(buckets))
        out["pairedEngineMinusB1ByPosition"][label] = stats
        print(f"  {label}: {fmt(stats)}")

    # ---- Rules 1/2: verdict ----
    skill_only = out["pairedEngineMinusB1ByPosition"]["skill-only(QB+RB+WR)"]
    cap1_stats = out["pairedEngineMinusB1ByPosition"]["K+TE+DEF"]
    inclusive = out["pairedEngineMinusB1ByPosition"]["all(inclusive)"]
    deficit_is_cap1_only = (inclusive["meanDiff"] < 0
                            and cap1_stats["significantAt95"] and cap1_stats["meanDiff"] < 0
                            and not skill_only["significantAt95"])
    skill_deficit = bool(skill_only["significantAt95"] and skill_only["meanDiff"] < 0)
    if skill_deficit:
        verdict = ("SKILL-DEFICIT -> the deficit lives in QB+RB+WR starter points and survives "
                   "the streaming rule; localize mechanism via timing read + slot cross-tab "
                   "before naming any fix")
    elif deficit_is_cap1_only:
        verdict = ("CAP-SLOT-ONLY -> the deficit lives in K+TE+DEF starter points; by the "
                   "shippability-symmetry rule (no waiver wire in the backtest) it is not a "
                   "real-league liability; document and close for 2025 data")
    else:
        verdict = ("UNRESOLVED -> no decisive attribution at this N; escalate seeds only if a "
                   "verdict-relevant CI is borderline")
    out["verdict"] = verdict
    out["ruleInputs"] = {
        "skillOnlySignificantNegative": skill_deficit,
        "capOnlyDeficit": bool(deficit_is_cap1_only),
    }
    print(f"\n[verdict] {verdict}")

    # ---- Rule 3: timing read (engine - b1; negative = engine picks EARLIER) ----
    def median(vs: list[float]) -> float:
        s = sorted(v for v in vs if v > 0)
        if not s:
            return 0.0
        mid = len(s) // 2
        return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2

    print("\n[timing] first-pick round by position (mean / median; 0 = never drafted):")
    for pos in POSITIONS:
        engv, b1v = fprp["engine"][pos], fprp["b1"][pos]
        stats = paired([a - b for a, b in zip(engv, b1v)])
        out["timing"][pos] = {
            "engineMean": sum(engv) / n_drafts, "b1Mean": sum(b1v) / n_drafts,
            "engineMedian": median(engv), "b1Median": median(b1v),
            "pairedDiff": stats,
            "neverDraftedEngine": sum(1 for v in engv if v == 0),
            "neverDraftedB1": sum(1 for v in b1v if v == 0),
        }
        t = out["timing"][pos]
        print(f"  {pos:>3}: engine {t['engineMean']:5.2f}/{t['engineMedian']:4.1f}  "
              f"b1 {t['b1Mean']:5.2f}/{t['b1Median']:4.1f}  "
              f"diff {stats['meanDiff']:+5.2f} [{stats['ciLower']:+5.2f}, "
              f"{stats['ciUpper']:+5.2f}]{'*' if stats['significantAt95'] else ' '}")

    # ---- Rule 5: exploratory position x slot cross-tab ----
    seeds_per_slot = n_drafts // TEAMS
    print(f"\n[slot x position mean engine-B1 diffs, pts/wk — EXPLORATORY, no gate] "
          f"(slot-major indices, {seeds_per_slot} seeds/slot)")
    slot_table: dict[str, dict[str, object]] = {}
    for slot in range(TEAMS):
        lo = slot * seeds_per_slot
        hi = (slot + 1) * seeds_per_slot
        row: dict[str, object] = {}
        cells = []
        for pos in POSITIONS:
            stats = paired([e - b for e, b in zip(spbp["engine"][pos][lo:hi],
                                                  spbp["b1"][pos][lo:hi])])
            row[pos] = stats["meanDiff"]
            cells.append(f"{pos} {stats['meanDiff']:+6.2f}")
        inc = paired(bucket_diffs(POSITIONS, lo, hi))
        row["all"] = inc
        slot_table[str(slot + 1)] = row
        print(f"  slot {slot + 1:>2}: {' | '.join(cells)} | all {inc['meanDiff']:+6.2f} "
              f"[{inc['ciLower']:+6.2f}, {inc['ciUpper']:+6.2f}]"
              f"{'*' if inc['significantAt95'] else ' '}")
    out["slotStratificationExploratory"] = slot_table

    OUT_PATH.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"\n[written] {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())